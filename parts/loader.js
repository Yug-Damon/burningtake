// ---------- topic loader: the data path only, no rendering (shared by topic.js and embed.js) ----------
// IndexedDB (warm) → shipped snapshot (cold, whole) → explorer scan (paged). Every path leaves the scope on disk so the next visit is the IndexedDB one.
// loadVotes(name, {onPage, onPhase, cancelled}) → Promise<{votes, source:"cache"|"snapshot"|"scan", requests}|null>
//   onPage(votes)   a batch of burns that just landed: the whole cache or snapshot, or one explorer page (25 burns)
//   onPhase(p)      progress: {phase:"cache"|"snapshot"|"scan"|"done", source?, count?, page?, pages?, height?, lastTx?, requests?}
//   cancelled()     → true when the caller moved on (another scope opened): the loader stops and resolves null
// Every vote carries tx (short txid form). cache[name] (shared.js) holds the full list for the page that asked, so addPending can prepend to it.
// persist(): confirmed burns through DB.put (cursor + sync record); the mempool ones as pending rows (DB.putPending), so receipt.html#<txid> and the
// burner page find a burn the explorer has only just seen. The confirmed row overwrites the pending one (same key) on the next scan.
const persist=(name,page,all)=>{ DB.put(name,page,all); const pend=page.filter(v=>v.h===null); if(pend.length) DB.putPending(name,pend); };
async function loadVotes(name,{onPage=()=>{},onPhase=()=>{},cancelled=()=>false}={}){
  onPhase({phase:"cache"});
  const rec=await DB.sync(name); if(cancelled()) return null;
  if(rec&&(rec.count||rec.lastTx)){                       // warm: read from disk, then fetch only what is newer than the cursor. An empty record (a scan that found nothing) protects nothing: a topic that gained a snapshot since is read cold
    const stored=(await DB.votes(name))||[]; if(cancelled()) return null;
    cache[name]=stored; onPage(stored);
    onPhase({phase:"cache", source:"cache", count:stored.length, lastTx:rec.lastTx, height:rec.height});
    await sleep(350); if(cancelled()) return null;          // ponytail: the stub has no new burns; the real page pages the explorer until it meets rec.lastTx
    onPhase({phase:"done", source:"cache", count:stored.length, requests:1});
    return {votes:stored, source:"cache", requests:1};
  }
  onPhase({phase:"snapshot"});                              // cold: the shipped snapshot (snapshots/<net>/<sha256(name)>.json) lands whole, then only burns newer than its height are fetched
  const snap=await snapshotFetch(name); if(cancelled()) return null;
  if(snap){
    const votes=snap.votes.map(cleanVote).filter(Boolean);
    cache[name]=votes; onPage(votes);
    onPhase({phase:"snapshot", source:"snapshot", count:votes.length, height:snap.height});
    persist(name, votes, votes);                            // on disk like a finished scan
    await sleep(350); if(cancelled()) return null;          // ponytail: the stub tail is empty; the real page pages the explorer from snap.height to the tip
    onPhase({phase:"done", source:"snapshot", count:votes.length, requests:1});
    return {votes, source:"snapshot", requests:1};
  }
  const votes=cache[name]||(cache[name]=stubVotes(name));  // no snapshot: the explorer, 25 burns per request
  const pages=Math.ceil(votes.length/25);
  for(let p=0;p<pages;p++){
    onPhase({phase:"scan", page:p+1, pages, count:Math.min((p+1)*25,votes.length)});
    await sleep(180+Math.random()*180); if(cancelled()) return null;
    const page=votes.slice(p*25,p*25+25); onPage(page);
    persist(name, page, p===pages-1 ? votes : null);        // each page lands on disk as it arrives; the sync record only once the scan completes
  }
  if(!pages) persist(name, [], votes);
  onPhase({phase:"done", source:"scan", count:votes.length, requests:pages});
  return {votes, source:"scan", requests:pages};
}
// ---------- a burn's home: every burn of every known topic, for pages that start from an address or a txid rather than a topic ----------
// loadAll({onPhase}) → Promise<[{txid,t,sats,h,from,tx,scope}]>: what IndexedDB holds, plus the snapshot of every indexed topic the cache does not know yet
// (each one is written to the cache, so the second visit is disk only). onPhase({phase:"cache"|"snapshots"|"done", k, n, count}).
async function loadAll({onPhase=()=>{}}={}){
  onPhase({phase:"cache"});
  const rows=(await DB.all())||[], known=new Set(((await DB.scopes())||[]).map(s=>s.name));
  const idx=await snapshotIndex(), todo=idx?idx.topics.map(t=>t.name).filter(n=>!known.has(n)):[];
  let k=0;
  for(const name of todo){
    onPhase({phase:"snapshots", k, n:todo.length, count:rows.length});
    const snap=await snapshotFetch(name); k++;
    if(!snap) continue;
    const votes=snap.votes.map(cleanVote).filter(Boolean);
    persist(name, votes, votes);
    for(const v of votes) rows.push({...v, scope:name});
  }
  onPhase({phase:"done", k, n:todo.length, count:rows.length});
  return rows;
}
