
// ---------- IndexedDB cache (every page): votes keyed [txid, scope] with indexes scope / txid, one sync record per scope ----------
// Confirmed burns never change, so a scope scanned once is read back from disk and only the tail is fetched.
// The cache is a speed-up, never the source of truth: it can be empty, blocked or evicted at any time.
// v2: compound key. One transaction can burn in several topics at once (a ballot, spec §4) and each burn is its own row;
// v1 rows were keyed by txid alone, so the upgrade drops both stores and the next visit rebuilds them from the snapshot.
const DB=(()=>{
  let dbp=null;
  const open=()=>dbp||(dbp=new Promise((res,rej)=>{
    let req; try{ req=indexedDB.open("burning-voice-"+NET,2); }catch(e){ return rej(e); }   // one cache per network
    req.onupgradeneeded=()=>{ const db=req.result;
      for(const s of ["votes","scopes"]) if(db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
      const v=db.createObjectStore("votes",{keyPath:["txid","scope"]}); v.createIndex("scope","scope"); v.createIndex("txid","txid");
      db.createObjectStore("scopes",{keyPath:"name"}); };
    req.onsuccess=()=>{ const db=req.result; db.onversionchange=()=>{ db.close(); dbp=null; }; res(db); };   // another tab upgrades or deletes the cache: let go, reopen on the next call (a held connection would block it forever)
    req.onerror=()=>rej(req.error); req.onblocked=()=>rej(new Error("blocked"));
  }));
  const tx=(db,stores,mode,fn)=>new Promise((res,rej)=>{ const t=db.transaction(stores,mode); const out=fn(t); t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); });
  const get=(store,key)=>new Promise((res,rej)=>{ const r=store.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const all=(idx,key)=>new Promise((res,rej)=>{ const r=idx.getAll(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  const byH=(a,b)=>(b.h??Infinity)===(a.h??Infinity) ? 0 : (b.h??Infinity)-(a.h??Infinity);
  return {
    async sync(name){ try{ const db=await open(); return await tx(db,["scopes"],"readonly",t=>get(t.objectStore("scopes"),name)) .then(x=>x||null); }catch{ return null; } },   // -> {name,lastTx,height,count,at} | null
    async votes(name){ try{ const db=await open(); const rows=await tx(db,["votes"],"readonly",t=>all(t.objectStore("votes").index("scope"),name)).then(p=>p); return (await rows).map(cleanVote).filter(Boolean).sort(byH); }catch{ return null; } },   // -> [{txid,t,sats,h,from,tx,scope[,vout]}] newest first | null
    async all(){ try{ const db=await open(); return (await tx(db,["votes"],"readonly",t=>all(t.objectStore("votes")))).map(cleanVote).filter(Boolean); }catch{ return null; } },                                            // -> every cached burn of every topic (burner page filters by from) | null
    async scopes(){ try{ const db=await open(); return await tx(db,["scopes"],"readonly",t=>all(t.objectStore("scopes"))); }catch{ return null; } },                                       // -> every sync record [{name,lastTx,height,count,at}] | null
    async byTx(txid){ try{ const db=await open(); const rows=await tx(db,["votes"],"readonly",t=>all(t.objectStore("votes").index("txid"),txid)).then(p=>p); return (await rows).map(cleanVote).filter(Boolean); }catch{ return null; } },            // -> every burn of one transaction, one row per topic (a ballot has several) | null
    async put(name,page,all){ try{ const db=await open(); await tx(db,["votes","scopes"],"readwrite",t=>{
        const vs=t.objectStore("votes"); for(const v of page) if(v.h!==null) vs.put({...v,scope:name});           // the mempool part goes through putPending (loader.js persist)
        if(all){ const conf=all.filter(v=>v.h!==null); t.objectStore("scopes").put({name, lastTx:conf[0]?conf[0].txid:null, height:TIP, count:conf.length, at:Date.now()}); }   // sync record once the whole scan landed
      }); }catch{} },
    async putPending(name,votes){ try{ const db=await open(); await tx(db,["votes"],"readwrite",t=>{ const vs=t.objectStore("votes"); for(const v of votes) vs.put({...v, h:null, scope:name, at:v.at||Date.now()}); }); }catch{} },   // a burn signed here, before the explorer sees it: the receipt page finds it by txid; the next scan overwrites the row with the confirmed one
    async prunePending(name,keep){ try{ const db=await open(); await tx(db,["votes"],"readwrite",t=>{ const r=t.objectStore("votes").index("scope").openCursor(IDBKeyRange.only(name));   // mempool burns the explorer no longer lists: replaced or dropped
        r.onsuccess=()=>{ const c=r.result; if(!c) return; if(c.value.h===null&&!keep.has(c.value.txid)) c.delete(); c.continue(); }; }); }catch{} },
  };
})();
