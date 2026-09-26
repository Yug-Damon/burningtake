// ---------- the data path, no rendering (every app page): IndexedDB first, then the explorer for everything newer ----------
// loadVotes(name, {onPage, onPhase, cancelled}) -> Promise<{votes, source:"cache"|"snapshot"|"scan", requests, height, error?}|null>
//   height: the block the votes are as of: the tip the scan read at, or the saved record's (0: nothing saved) when the explorer did not answer
//   onPage(votes)   burns that just landed, each txid once: what this browser (or a published snapshot) knows, then every explorer page
//   onPhase(p)      progress: {phase:"cache"|"snapshot"|"scan"|"done"|"error", source?, count?, page?, lastTx?, height?, requests?}
//   cancelled()     -> true when the caller moved on: the loader stops and resolves null
// The result's votes are the whole list with the mempool as the explorer lists it now: pages recount from it, not from the batches.
tipReady();                                                               // the chain tip, once per page (shared.js); the price and the fees start in walletui.js, on the pages that pay
const ADDRS=new Map();                                                    // topic name -> address, derived once per page
const topicAddr=async name=>{ if(!ADDRS.has(name)) ADDRS.set(name,(await deriveScope(name)).addr); return ADDRS.get(name); };
// force: always ask the explorer. Without it, a topic any page read in the last 60 s, at the current tip, is answered from disk with no request (Retry and the topic page's minute refresh force)
async function loadVotes(name,{addr:raw=null,force=false,onPage=()=>{},onPhase=()=>{},cancelled=()=>false}={}){
  if(!TIP) await tipReady();                                              // windows and deadlines need a tip: the cached one, else the first answer
  const addr=raw||await topicAddr(name), shown=new Set(), show=vs=>{ const f=vs.filter(v=>!shown.has(v.txid)); f.forEach(v=>shown.add(v.txid)); if(f.length) onPage(f); };
  let known=[], source="scan";
  onPhase({phase:"cache"});
  const rec=await DB.sync(name), disk=((await DB.votes(name))||[]).map(v=>v.h===null?{...v, unver:true}:v); if(cancelled()) return null;   // unconfirmed rows from disk: not verified on this visit yet
  let height=0;
  if(rec){ known=disk; source="cache"; height=rec.height||0; onPhase({phase:"cache", source, count:known.length, lastTx:rec.lastTx, height, at:rec.at||0}); }   // any record, even one that counted 0 burns, is what this browser knows
  else{
    known=disk.filter(v=>v.h===null);                                     // no record yet (a first read that failed or is still running): a burn just signed here survives it
    onPhase({phase:"snapshot"});
    const snap=await snapshotFetch(name); if(cancelled()) return null;
    if(snap){ const sv=snap.votes.map(cleanVote).filter(Boolean); known=[...known.filter(v=>!sv.some(x=>x.txid===v.txid)), ...sv]; source="snapshot"; height=+snap.height||0; DB.put(name, sv, sv, height, 0); onPhase({phase:"snapshot", source, count:known.length, height}); }
  }
  if(known.length){ cache[name]=known; show(known); }
  if(!force&&rec&&rec.at&&Date.now()-rec.at<60000){ await tipReady(); if(cancelled()) return null;   // read moments ago, by this page or another tab: no request
    if(rec.height>=TIP){ cache[name]=known; onPhase({phase:"done", source, count:known.length, requests:0, height:rec.height}); return {votes:known, source, requests:0, height:rec.height}; } }
  const topics=new Map([[addr,name]]), burns=txs=>txs.flatMap(tx=>txBurns(tx,topics)).map(cleanVote).filter(Boolean);
  const conf=known.filter(v=>v.h!==null), pend=[], fresh=[];              // newest first: the scan stops at the newest confirmed burn already known
  let scan;
  try{ scan=await scanAddress(addr,{stopTx:conf.length?conf[0].txid:null, cancelled, onPage:p=>{
    const m=burns(p.mempool), c=burns(p.confirmed); pend.push(...m); fresh.push(...c); show([...m,...c]);
    onPhase({phase:"scan", page:p.requests, count:shown.size}); }}); }
  catch(e){ if(cancelled()) return null; onPhase({phase:"error", source, count:known.length, height}); return {votes:known, source, requests:0, height, error:String((e&&e.message)||e)}; }
  if(!scan) return null;
  const listed=new Set([...pend,...fresh].map(v=>v.txid)), now=Date.now();
  const votes=[...pend, ...known.filter(v=>v.h===null&&!listed.has(v.txid)&&now-(v.at||0)<FRESH_PENDING), ...fresh, ...conf.filter(v=>!listed.has(v.txid))];   // a mempool burn the explorer stopped listing was replaced or dropped
  DB.put(name, fresh, votes, TIP); DB.putPending(name, pend); DB.prunePending(name, new Set(votes.filter(v=>v.h===null).map(v=>v.txid)));
  cache[name]=votes;
  onPhase({phase:"done", source, count:votes.length, requests:scan.requests, height:TIP});
  return {votes, source, requests:scan.requests, height:TIP};
}
// ---------- the directory (spec §7): registrations are burns to the root topic whose statement is a topic name ----------
// dirLoad(fresh) -> Promise<DIRECTORY>, once per page unless fresh: the root topic through loadVotes (cache first, then only what is newer).
// d.reg (the sponsor score) and d.listings sum the root burns naming the topic, d.first and d.last are their heights; d.stats and d.active come from dirTopics.
let ROOTV=[], DIRP=null, DIRERR=false, ROOTERR=false, ROOTH=0, DIRFRESH=false, DIRNET=0;   // ROOTERR: the root's last read failed (DIRERR: and nothing is saved); ROOTH: the block the directory is as of; DIRFRESH: read from the explorer on this visit; DIRNET: bumped when it lands
const dirLoad=(fresh=false)=>(!fresh&&DIRP)||(DIRP=loadVotes("",{force:fresh}).then(async r=>{ DIRNET++; ROOTV=(r&&r.votes)||[]; ROOTERR=!!(r&&r.error); ROOTH=(r&&r.height)||0; DIRERR=ROOTERR&&!ROOTV.length; DIRFRESH=DIRFRESH||!ROOTERR; await Promise.race([regTies(), sleep(1500)]); return dirBuild(); }));   // the ties never hold the directory long: a late answer shows at the next paint
// a registration or sponsorship signed in this browser: the directory takes it at once, in the mempool (it is on disk too: DB.putPending), until the explorer lists it
const dirAddPending=vs=>{ ROOTV=[...vs, ...ROOTV.filter(v=>!vs.some(x=>x.txid===v.txid))]; return dirBuild(); };
function dirBuild(){                                                      // the directory from the root topic's burns, keeping what the pages already counted
  const was=new Map(DIRECTORY.map(d=>[d.name,d])), next=new Map();
  for(const v of ROOTV){ const name=nameOf(v.t); if(!name) continue; const h=v.h??TIP+1;
    const d=next.get(name)||Object.assign(was.get(name)||{name, stats:null, active:0}, {reg:0, listings:0, first:Infinity, last:0});   // the same object: a count still running writes to the live entry
    d.reg+=v.sats; d.listings++; d.first=Math.min(d.first,h); d.last=Math.max(d.last,h); next.set(name,d); }
  DIRECTORY=[...next.values()].sort((a,b)=>a.first-b.first); return DIRECTORY;
}
// a topic's first root burn registers it (reg): the lowest height, then the earliest in that height. The explorer's order says little, so a tie asks once:
// in a block, each burn's place (/tx/:txid/merkle-proof, pos; kept in this browser); in the mempool, when mempool.space first saw it (else when this browser sent it)
let POS={}; try{ POS=JSON.parse(localStorage.getItem(NETKEY("bv.pos")))||{}; }catch{}
const SEENT={};
const regBefore=(a,b)=>{ const c=(x,y)=>x<y?-1:x>y?1:0, at=v=>v.h===null ? SEENT[v.txid]??(v.at?v.at/1000:Infinity) : POS[v.txid]??Infinity;
  return c(a.h??Infinity,b.h??Infinity) || c(at(a),at(b)); };
async function regTies(){
  const low=new Map(); for(const v of ROOTV){ const n=nameOf(v.t); if(!n) continue; const h=v.h??Infinity, o=low.get(n); if(!o||h<o.h) low.set(n,{h,vs:[v]}); else if(h===o.h) o.vs.push(v); }
  const tied=[...low.values()].filter(g=>g.vs.length>1).flatMap(g=>g.vs), ask=tied.filter(v=>v.h!==null&&!(v.txid in POS)), seen=(chainBases()[0]||"").startsWith("https://mempool.space/")?tied.filter(v=>v.h===null&&!(v.txid in SEENT)):[];   // first-seen times: mempool.space only
  await Promise.all([...ask.map(v=>chainGet(`/tx/${v.txid}/merkle-proof`).then(r=>{ POS[v.txid]=r.pos; }).catch(()=>{})),
    seen.length && chainGet("/v1/transaction-times?"+seen.map(v=>"txId[]="+v.txid).join("&")).then(ts=>seen.forEach((v,i)=>{ SEENT[v.txid]=ts[i]||null; })).catch(()=>{})]);   // a miss is remembered too (null: the send time decides), so it is not asked every minute
  if(ask.length) try{ localStorage.setItem(NETKEY("bv.pos"), JSON.stringify(POS)); }catch{}
}
const rootBurns=()=>{ const vs=ROOTV.map(v=>({...v, name:nameOf(v.t)})).filter(v=>v.name), first=new Map();   // the sponsorships, newest first
  for(const v of vs){ const o=first.get(v.name); if(!o || regBefore(v,o)<0) first.set(v.name,v); }   // still tied: the first listed (mempool.space lists a block, and the mempool, oldest first)
  for(const v of first.values()) v.reg=true; return vs; };
// the directory and every count from IndexedDB, before any request -> the lowest block they are as of (0: nothing saved, the page keeps its placeholders).
// Only topics with a sync record get numbers (a record that counted 0 burns counts); a topic the network already counted is never overwritten; records of topics
// that are not in the directory (opened here, unregistered) do not lower the height. A disk read that lands after the network directory changes nothing.
async function dirFromDisk(){
  const g=DIRNET, [recs,rows]=await Promise.all([DB.scopes(),DB.all()]); if(!recs||!rows||g!==DIRNET) return 0;
  const rec=new Map(recs.map(r=>[r.name,r])), root=rec.get(""); if(!root) return 0;
  const by=new Map(), byH=(a,b)=>(b.h??Infinity)===(a.h??Infinity)?0:(b.h??Infinity)-(a.h??Infinity);
  for(const v of rows) (by.get(v.scope)||by.set(v.scope,[]).get(v.scope)).push(v.h===null?{...v, unver:true}:v);
  for(const vs of by.values()) vs.sort(byH);
  if(!ROOTV.length){ ROOTV=by.get("")||[]; ROOTH=root.height||0; dirBuild(); }
  let low=root.height||0;
  for(const d of DIRECTORY){ const r=rec.get(d.name); if(!r||d.stats||d.name in cache) continue; dirCount(d,by.get(d.name)||[]); if(r.height) low=low?Math.min(low,r.height):r.height; }
  return low;
}
// a topic's numbers from its burns: cache[name], then d.stats (it has numbers) and d.active (its latest burn)
const dirCount=(d,vs)=>{ cache[d.name]=vs; d.stats={sats:vs.reduce((a,v)=>a+v.sats,0), votes:vs.length}; d.active=vs.reduce((a,v)=>Math.max(a,v.h??TIP+1),0); };
// dirTopics({onTopic, only}) -> Promise<{errors, low}>: the registered topics (only(d): a subset) through loadVotes, three at a time; burns land in cache[name], then d.stats and d.active
// errors: topics the explorer did not answer for; low: the lowest block the counted topics are as of. A failed topic with nothing saved keeps no numbers (unknown, not 0)
async function dirTopics({onTopic=()=>{},only=()=>true}={}){
  const todo=DIRECTORY.filter(only); let errors=0, low=Infinity;
  const worker=async()=>{ for(let d; (d=todo.shift()); ){ const r=await loadVotes(d.name).catch(e=>({votes:[], height:0, error:String(e)}));
    if(r&&r.error){ errors++; if(!r.height&&!r.votes.length){ onTopic(d); continue; } }
    dirCount(d,(r&&r.votes)||[]); if(r) low=Math.min(low,r.height||0); onTopic(d); } };
  await Promise.all([worker(),worker(),worker()]);
  return {errors, low:low===Infinity?0:low};
}
