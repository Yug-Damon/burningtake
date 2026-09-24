// ---------- the data path, no rendering (every app page): IndexedDB first, then the explorer for everything newer ----------
// loadVotes(name, {onPage, onPhase, cancelled}) -> Promise<{votes, source:"cache"|"snapshot"|"scan", requests, error?}|null>
//   onPage(votes)   burns that just landed, each txid once: what this browser (or a published snapshot) knows, then every explorer page
//   onPhase(p)      progress: {phase:"cache"|"snapshot"|"scan"|"done"|"error", source?, count?, page?, lastTx?, height?, requests?}
//   cancelled()     -> true when the caller moved on: the loader stops and resolves null
// The result's votes are the whole list with the mempool as the explorer lists it now: pages recount from it, not from the batches.
tipReady(); priceReady();                                                 // the chain tip and the BTC price, once per page (shared.js)
const ADDRS=new Map();                                                    // topic name -> address, derived once per page
const topicAddr=async name=>{ if(!ADDRS.has(name)) ADDRS.set(name,(await deriveScope(name)).addr); return ADDRS.get(name); };
const FRESH_PENDING=10*60000;                                             // a burn signed in this browser stays pending this long, even before the explorer lists it
async function loadVotes(name,{addr:raw=null,onPage=()=>{},onPhase=()=>{},cancelled=()=>false}={}){
  if(!TIP) await tipReady();                                              // windows and deadlines need a tip: the cached one, else the first answer
  const addr=raw||await topicAddr(name), shown=new Set(), show=vs=>{ const f=vs.filter(v=>!shown.has(v.txid)); f.forEach(v=>shown.add(v.txid)); if(f.length) onPage(f); };
  let known=[], source="scan";
  onPhase({phase:"cache"});
  const rec=await DB.sync(name); if(cancelled()) return null;
  if(rec&&(rec.count||rec.lastTx)){ known=(await DB.votes(name))||[]; source="cache"; onPhase({phase:"cache", source, count:known.length, lastTx:rec.lastTx}); }
  else{
    onPhase({phase:"snapshot"});
    const snap=await snapshotFetch(name); if(cancelled()) return null;
    if(snap){ known=snap.votes.map(cleanVote).filter(Boolean); source="snapshot"; DB.put(name, known, known); onPhase({phase:"snapshot", source, count:known.length, height:snap.height}); }
  }
  if(known.length){ cache[name]=known; show(known); }
  const topics=new Map([[addr,name]]), burns=txs=>txs.flatMap(tx=>txBurns(tx,topics)).map(cleanVote).filter(Boolean);
  const conf=known.filter(v=>v.h!==null), pend=[], fresh=[];              // newest first: the scan stops at the newest confirmed burn already known
  let scan;
  try{ scan=await scanAddress(addr,{stopTx:conf.length?conf[0].txid:null, cancelled, onPage:p=>{
    const m=burns(p.mempool), c=burns(p.confirmed); pend.push(...m); fresh.push(...c); show([...m,...c]);
    onPhase({phase:"scan", page:p.requests, count:shown.size}); }}); }
  catch(e){ if(cancelled()) return null; onPhase({phase:"error", source, count:known.length}); return {votes:known, source, requests:0, error:String((e&&e.message)||e)}; }
  if(!scan) return null;
  const listed=new Set([...pend,...fresh].map(v=>v.txid)), now=Date.now();
  const votes=[...pend, ...known.filter(v=>v.h===null&&!listed.has(v.txid)&&now-(v.at||0)<FRESH_PENDING), ...fresh, ...conf.filter(v=>!listed.has(v.txid))];   // a mempool burn the explorer stopped listing was replaced or dropped
  DB.put(name, fresh, votes); DB.putPending(name, pend); DB.prunePending(name, new Set(votes.filter(v=>v.h===null).map(v=>v.txid)));
  cache[name]=votes;
  onPhase({phase:"done", source, count:votes.length, requests:scan.requests});
  return {votes, source, requests:scan.requests};
}
// ---------- the directory (spec §7): registrations are burns to the root topic whose statement is a topic name ----------
// dirLoad(fresh) -> Promise<DIRECTORY>, once per page unless fresh: the root topic through loadVotes (cache first, then only what is newer).
// d.reg (the sponsor score) and d.listings sum the root burns naming the topic, d.first and d.last are their heights; d.stats and d.active come from dirTopics.
let ROOTV=[], DIRP=null, DIRERR=false;
const dirLoad=(fresh=false)=>(!fresh&&DIRP)||(DIRP=loadVotes("").then(r=>{
  ROOTV=(r&&r.votes)||[]; DIRERR=!!(r&&r.error)&&!ROOTV.length;
  const was=new Map(DIRECTORY.map(d=>[d.name,d])), next=new Map();
  for(const v of ROOTV){ const name=nameOf(v.t); if(!name) continue; const h=v.h??TIP+1;
    const d=next.get(name)||{name, stats:null, active:0, ...(was.get(name)||{}), reg:0, listings:0, first:Infinity, last:0};
    d.reg+=v.sats; d.listings++; d.first=Math.min(d.first,h); d.last=Math.max(d.last,h); next.set(name,d); }
  DIRECTORY=[...next.values()].sort((a,b)=>a.first-b.first); return DIRECTORY; }));
const rootBurns=()=>ROOTV.map(v=>({...v, name:nameOf(v.t)})).filter(v=>v.name);   // the sponsorships (a topic's first one registers it), newest first
// dirTopics({onTopic}) -> Promise: every registered topic through loadVotes, three at a time; its burns land in cache[name], then d.stats and d.active
async function dirTopics({onTopic=()=>{}}={}){
  const todo=[...DIRECTORY];
  const worker=async()=>{ for(let d; (d=todo.shift()); ){ const r=await loadVotes(d.name).catch(()=>null), vs=(r&&r.votes)||cache[d.name]||[];
    cache[d.name]=vs; d.stats={sats:vs.reduce((a,v)=>a+v.sats,0), votes:vs.length}; d.active=vs.reduce((a,v)=>Math.max(a,v.h??TIP+1),0); onTopic(d); } };
  await Promise.all([worker(),worker(),worker()]);
}
