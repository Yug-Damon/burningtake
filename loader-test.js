// node loader-test.js — loads parts/shared.js + parts/loader.js as browser code, with an in-memory IndexedDB (the DB object) and a stubbed explorer:
// the data path's rules. Each page() is a fresh page load over the same saved data, like a reload in one browser.
"use strict";
const fs=require("fs"), path=require("path"), assert=require("assert");
const src=["shared.js","loader.js"].map(f=>fs.readFileSync(path.join(__dirname,"parts",f),"utf8")).join("\n");
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
const store={}, ls={getItem:k=>store[k]??null, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; }};

// ---------- the saved data: a Map for the votes store and one for the sync records, like db.js ----------
const mem={votes:new Map(), scopes:new Map()};
const byH=(a,b)=>(b.h??Infinity)===(a.h??Infinity)?0:(b.h??Infinity)-(a.h??Infinity);
const DB={
  async sync(n){ return mem.scopes.get(n)||null; },
  async votes(n){ return [...mem.votes.values()].filter(v=>v.scope===n).sort(byH); },
  async all(){ return [...mem.votes.values()]; },
  async scopes(){ return [...mem.scopes.values()]; },
  async byTx(t){ return [...mem.votes.values()].filter(v=>v.txid===t); },
  async put(name,page,all,height,at=Date.now()){ for(const v of page) if(v.h!==null) mem.votes.set(v.txid+"|"+name,{...v,scope:name});
    if(all){ const conf=all.filter(v=>v.h!==null); mem.scopes.set(name,{name, lastTx:conf[0]?conf[0].txid:null, height, count:conf.length, at}); } },
  async putPending(name,vs){ for(const v of vs) mem.votes.set(v.txid+"|"+name,{...v, h:null, scope:name, at:v.at||Date.now()}); },
  async prunePending(name,keep){ for(const [k,v] of mem.votes) if(v.scope===name&&v.h===null&&!keep.has(v.txid)) mem.votes.delete(k); },
};

// ---------- the explorer: each address's history, newest first (the mempool, then confirmed) ----------
let tip=900000, calls=0, down=false; const H={};
const fetchImpl=async url=>{ const u=String(url);
  if(u.includes("snapshots/")) return {ok:false, status:404};
  calls++; if(down) throw new TypeError("Failed to fetch");
  if(u.endsWith("/blocks/tip/height")) return {ok:true, text:async()=>String(tip)};
  const m=u.match(/\/address\/(\w+)\/txs(?:\/chain\/(\w+))?$/);
  if(m){ const all=H[m[1]]||[], conf=all.filter(t=>t.status.confirmed);
    const page=m[2] ? conf.slice(conf.findIndex(t=>t.txid===m[2])+1, conf.findIndex(t=>t.txid===m[2])+26) : [...all.filter(t=>!t.status.confirmed), ...conf.slice(0,25)];
    return {ok:true, json:async()=>page}; }
  throw new Error("unexpected request "+u); };
const page=()=>new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch","DB",
  src+"\nreturn {loadVotes, dirLoad, dirFromDisk, dirTopics, deriveScope, tipReady, chainReset, tallyOf, weightedMedian, numFmt, get DIRECTORY(){ return DIRECTORY; }, get TIP(){ return TIP; }};")(
  doc, {}, ls, ()=>({matches:false}), {}, ()=>{}, (...a)=>fetchImpl(...a), DB);

// ---------- transactions shaped like the Esplora API's ----------
const hex=s=>Buffer.from(s,"utf8"); const opret=s=>{ const b=hex(s); return "6a"+b.length.toString(16).padStart(2,"0")+b.toString("hex"); };
const TXID=n=>n.toString(16).padStart(64,"0"), ME="tb1qburner000000000000000000000000000000abc";
const tx=(n,addr,t,sats,h=null)=>({txid:TXID(n), vin:[{prevout:{scriptpubkey_address:ME}}], status:h===null?{confirmed:false}:{confirmed:true, block_height:h},
  vout:[{scriptpubkey_type:"v0_p2wsh", scriptpubkey_address:addr, value:sats}, {scriptpubkey_type:"op_return", scriptpubkey:opret(t), value:0}]});

let n=0, failed=0; const ok=async(name,fn)=>{ n++; try{ await fn(); console.log(`ok ${n} - ${name}`); }catch(e){ failed++; console.log(`not ok ${n} - ${name}\n  ${e.stack}`); } };
(async()=>{
  const p0=page(); await p0.tipReady();
  const A=(await p0.deriveScope("pizza")).addr, ROOT=(await p0.deriveScope("")).addr;

  await ok("a first burn signed here survives a topic that has no record yet", async()=>{
    await DB.putPending("pizza",[{txid:TXID(1), t:"margherita", sats:1000, h:null, from:ME, at:Date.now()}]);
    H[A]=[];                                                   // the explorer does not list it yet
    const r=await page().loadVotes("pizza");
    assert.ok(!r.error); assert.deepStrictEqual(r.votes.map(v=>v.txid),[TXID(1)],"kept while it is fresh");
  });
  await ok("a topic read with no burns counts as saved: its record is used, with the block it is as of", async()=>{
    H[A]=[tx(1,A,"margherita",1000,899990)];                   // now confirmed
    await page().loadVotes("pizza",{force:true});               // forced: the record above is seconds old
    const rec=mem.scopes.get("pizza"); assert.strictEqual(rec.count,1); assert.strictEqual(rec.height,tip);
    const B=(await p0.deriveScope("empty-topic")).addr; H[B]=[];
    await page().loadVotes("empty-topic",{force:true}); assert.strictEqual(mem.scopes.get("empty-topic").count,0);
    down=true; const p=page(); p.chainReset(); const r=await p.loadVotes("empty-topic",{force:true}); down=false;
    assert.ok(r.error); assert.strictEqual(r.source,"cache"); assert.strictEqual(r.height,tip,"saved, as of the block it was read at");
  });
  await ok("the explorer does not answer: the result keeps the saved burns and says since when; nothing saved says 0", async()=>{
    down=true; const p=page(); p.chainReset();
    const r=await p.loadVotes("pizza",{force:true}); assert.ok(r.error); assert.deepStrictEqual(r.votes.map(v=>v.txid),[TXID(1)]); assert.strictEqual(r.height,tip);
    const none=await p.loadVotes("never-read",{force:true}); assert.ok(none.error); assert.strictEqual(none.height,0); assert.deepStrictEqual(none.votes,[]);
    down=false;
  });
  await ok("a warm topic costs one request: the scan stops at the newest burn already saved", async()=>{
    H[A]=[tx(3,A,"pepperoni",500,899999), tx(2,A,"funghi",700,899995), ...Array.from({length:30},(_,i)=>tx(100+i,A,"old",330,899000-i)), tx(1,A,"margherita",1000,899990)];
    H[A].sort((a,b)=>b.status.block_height-a.status.block_height);
    const p=page(); p.chainReset(); await p.tipReady(); calls=0;
    const r=await p.loadVotes("pizza",{force:true});
    assert.strictEqual(r.requests,1); assert.ok(["pepperoni","funghi","margherita"].every(t=>r.votes.some(v=>v.t===t)));
  });
  await ok("a topic read in the last minute at the current tip is not asked again, unless forced or a block came", async()=>{
    const p=page(); p.chainReset(); await p.tipReady(); calls=0;
    let r=await p.loadVotes("pizza"); assert.strictEqual(r.requests,0); assert.strictEqual(calls,0);
    r=await p.loadVotes("pizza",{force:true}); assert.strictEqual(r.requests,1);
    tip++; const q=page(); await q.tipReady(); calls=0;
    r=await q.loadVotes("pizza"); assert.strictEqual(r.requests,1,"a new block: read again");
  });
  await ok("dirFromDisk: the directory and every saved count before any request; a topic with no record stays uncounted", async()=>{
    H[ROOT]=[tx(10,ROOT,"pizza",330,899980), tx(11,ROOT,"unread-topic",330,899981)];
    const p=page(); p.chainReset(); await p.dirLoad(true); await p.dirTopics({only:d=>d.name==="pizza"});
    const q=page(); calls=0; const low=await q.dirFromDisk();
    assert.strictEqual(calls,0); assert.deepStrictEqual(q.DIRECTORY.map(d=>d.name).sort(),["pizza","unread-topic"]);
    const pz=q.DIRECTORY.find(d=>d.name==="pizza"), un=q.DIRECTORY.find(d=>d.name==="unread-topic");
    assert.ok(pz.stats&&pz.stats.sats>0); assert.strictEqual(un.stats,null,"unknown, not 0"); assert.ok(low>0);
  });
  await ok("dirTopics: every topic the explorer did not answer for is an error; one with nothing saved keeps no numbers, one saved keeps its own", async()=>{
    for(const r of mem.scopes.values()) r.at=Date.now()-120000;  // read two minutes ago: asked again
    const p=page(); await p.dirFromDisk(); down=true; p.chainReset();
    const r=await p.dirTopics(); down=false;
    assert.strictEqual(r.errors,2); assert.strictEqual(p.DIRECTORY.find(d=>d.name==="unread-topic").stats,null); assert.ok(p.DIRECTORY.find(d=>d.name==="pizza").stats);
  });
  await ok("counting rules: a burn with no take backs the topic (total, not shares); a row keeps its earliest spelling; an exact median split is the midpoint", async()=>{
    const p=page(), v=(n,t,sats,h)=>({txid:TXID(n), t, sats, h});
    const T=p.tallyOf("pizza",[v(1,"",500,10), v(2,"Margherita",330,12), v(3,"MARGHERITA!",330,9), v(4,"funghi",330,11)]);
    assert.strictEqual(T.sats,1490); assert.strictEqual(T.none.sats,500); assert.strictEqual(T.shareSats,990);
    assert.deepStrictEqual(T.answers.map(r=>r.t),["MARGHERITA!","funghi"],"the earliest burn's spelling, no blank row");
    assert.strictEqual(p.weightedMedian([{t:"100",sats:330},{t:"200",sats:330}]),150);
    assert.strictEqual(p.weightedMedian([{t:"100",sats:330},{t:"200",sats:331}]),200);
    assert.strictEqual(p.numFmt(2031,[2026,2100]),"2031"); assert.strictEqual(p.numFmt(166428.57,[50000,500000]),"166,429"); assert.strictEqual(p.numFmt(2.345,[0,10.5]),"2.35");
  });
  console.log(`\n${n-failed}/${n} passed${failed?`, ${failed} FAILED`:""}`); process.exitCode=failed?1:0;
})();
