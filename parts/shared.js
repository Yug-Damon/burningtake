// ---------- the directory: every registered topic, read from the root topic's burns (dirLoad, loader.js; spec §7) ----------
let DIRECTORY=[];            // [{name, reg, listings, first, last, active, stats}]: reg = sats burned to the root naming it (sponsor score), first/last = those burns' heights, active = the topic's latest burn, stats = {sats, votes} once counted
// ---------- sponsor score: sats burned to the root topic with a topic's name (registering and sponsoring are the same act) ----------
const REG_SATS=330;   // ponytail: registering lists a topic at the smallest burn Bitcoin relays (P2WSH dust); sponsoring is where an amount is chosen
const featureScore=name=>{ const d=DIRECTORY.find(t=>t.name===name); return d?(d.reg||0):0; };
const featuredRank=(n=8)=>[...DIRECTORY].filter(d=>(d.reg||0)>0).sort((a,b)=>b.reg-a.reg).slice(0,n).map(d=>({name:d.name, sats:d.reg}));
let TIP=0, BTCUSD=null;                               // the chain tip and the BTC price, from the explorer (the chain section below)
const fmt = n => n.toLocaleString("en-US");
// statements and topic names come from the chain, and names also from links: text only. Everything they reach through innerHTML goes through esc()
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hashText=()=>{ const h=location.hash.slice(1); try{ return decodeURIComponent(h); }catch{ return h; } };   // a malformed link (#%) must not break the page
// a burn read from the cache, a snapshot or (in the real build) the explorer: ids and numbers are checked here, so the pages can trust their shape
const cleanVote=v=>{ if(!v||!/^[0-9a-f]{64}$/.test(v.txid)) return null;
  return {...v, t:String(v.t??""), sats:Math.max(0,Math.round(+v.sats||0)), h:Number.isInteger(v.h)?v.h:null, from:/^[a-z0-9]{14,90}$/i.test(v.from||"")?v.from:null, tx:v.txid.slice(0,6)+"…"+v.txid.slice(-4)}; };
const nfc = x => { const a=Math.abs(+x); if(a<1e4) return String(x); const [d,s]=a>=1e9?[1e9,"B"]:a>=1e6?[1e6,"M"]:[1e3,"k"], v=+x/d*10;   // number chips: 50000 -> 50k, 1500000 -> 1.5M, only when exact
  return Math.abs(v-Math.round(v))<1e-9 ? Math.round(v)/10+s : fmt(+x); };                                                    // 12345 stays 12,345, years stay bare
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const $ = id => document.getElementById(id);
const LS=(k,v)=>{ try{ return v===undefined ? localStorage.getItem(k) : localStorage.setItem(k,v); }catch{ return null; } };   // always through NETKEY(): bv.vote.tip / bv.scope.tip / bv.summary / bv.wallet
const rhex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b=>b.toString(16).padStart(2,"0")).join("");
const norm = t => t.trim().toLowerCase().replace(/\s+/g," ").replace(/[.!?]+$/,"");

// ---------- network: one constant, read once ----------
// host label (mainnet. / signet. / testnet.) wins; else ?net= (remembered), else the remembered choice, else mainnet
const NET=(()=>{ const loc=typeof location!=="undefined"?location:{hostname:"",search:""}; const h=loc.hostname; const q=new URLSearchParams(loc.search).get("net"); let n = /^(signet|testnet)\./.test(h) ? "signet" : /^mainnet\./.test(h) ? "mainnet" : null; if(!n){ try{ n = q || localStorage.getItem("bv.net") || "mainnet"; if(q) localStorage.setItem("bv.net", q); }catch{ n = q || "mainnet"; } } return n==="signet"||n==="testnet" ? "signet" : "mainnet"; })();
const HRP = NET==="mainnet" ? "bc" : "tb";
const NETKEY = k => k + "." + NET;      // storage keys carry the network: a signet wallet is invisible on mainnet
// ---------- time window: one choice shared by Explore and the topic boards, remembered in this browser ----------
const WIN={all:Infinity, month:4320, week:1008, today:144};          // blocks, ~10 min each
const WINLABEL={all:"all time", month:"this month", week:"this week", today:"today"};
const winGet=()=>{ const w=LS(NETKEY("bv.window")); return w&&w in WIN ? w : "all"; };
const winSet=w=>{ if(w in WIN) LS(NETKEY("bv.window"),w); };
const TXURL = txid => "https://mempool.space/" + (NET==="mainnet"?"":"signet/") + "tx/" + txid;

const enc=new TextEncoder();
const toHex=u8=>[...u8].map(b=>b.toString(16).padStart(2,"0")).join("");
const cache={};
// an unconfirmed burn read from disk (unver: not listed again on this visit) says when it was last seen once it is older than a fresh send; the others are "in the mempool"
const FRESH_PENDING=10*60000;
const agoText=ms=>{ const m=Math.max(1,Math.round((Date.now()-ms)/60000)); return m<60?`${m} min ago`:m<2880?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`; };
// a confirmed burn's age in plain words, from blocks (about 10 minutes each), its block in the title (HTML: rows only)
const blockAgo=h=>{ const m=Math.max(0,tipEst()-h)*10; return m<10?"≈ just now":m<60?`≈ ${m} min ago`:m<2880?`≈ ${Math.round(m/60)} h ago`:`≈ ${Math.round(m/1440)} d ago`; };
const whenOf=v=>v.h!==null ? `<span title="block ${fmt(v.h)}">${blockAgo(v.h)}</span>` : v.unver&&v.at&&Date.now()-v.at>FRESH_PENDING ? "unconfirmed · last seen "+agoText(v.at) : "in the mempool";
// ---------- snapshots: static JSON a host may publish (spec §6), same shape as a finished scan, so a cold page starts from disk instead of the explorer ----------
const SNAPDIR="snapshots/"+NET+"/";
const snapshotKey=async name=>toHex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(name))));   // file name = hex sha256 of the canonical topic name
const snapshotGet=async url=>{ try{ if(typeof fetch!=="function") return null; const r=await fetch(url,{cache:"no-cache"}); if(!r.ok) return null; return await r.json(); }catch{ return null; } };   // any failure = no snapshot
let SNAPIDX=null;                                       // the index is fetched once per page: it says which topics have a snapshot file, so an unsnapshotted topic never 404s
const snapshotIndex=()=>SNAPIDX||(SNAPIDX=snapshotGet(SNAPDIR+"index.json").then(j=>j&&Array.isArray(j.topics) ? j : null));                                            // -> Promise<{height, topics:[{name, sats, votes, active, reg, listings}]} | null>
const snapshotFetch=async name=>{ const idx=await snapshotIndex(); if(idx&&!idx.topics.some(t=>t.name===name)) return null;
  const j=await snapshotGet(SNAPDIR+(await snapshotKey(name))+".json"); return j&&j.net===NET&&Array.isArray(j.votes) ? j : null; };   // -> {name, net, height, count, votes:[{txid,t,sats,h,from}]} | null
// ---------- explorer endpoint: an Esplora API base per network, overridable from the Data source row (index page) ----------
const ESPLORA_PRESETS={ mempool:{mainnet:"https://mempool.space/api", signet:"https://mempool.space/signet/api"}, blockstream:{mainnet:"https://blockstream.info/api", signet:"https://blockstream.info/signet/api"} };   // null: the preset has no server for that network
const esploraDefault=net=>ESPLORA_PRESETS.mempool[net]||ESPLORA_PRESETS.mempool.signet;
const esploraOverride=()=>{ const v=(LS(NETKEY("bv.endpoint"))||"").trim(); if(!v) return ""; if(ESPLORA_PRESETS[v]) return ESPLORA_PRESETS[v][NET]||""; return /^https?:\/\//.test(v) ? v.replace(/\/+$/,"") : ""; };   // stored: preset id or a full API base URL
const esploraFor=net=>esploraOverride()||esploraDefault(net);                                   // what this page reads the chain through
const esploraSet=v=>{ LS(NETKEY("bv.endpoint"),v||""); globalThis.ESPLORA_OVERRIDE_URL=esploraOverride(); chainReset(); };   // v: "" (mempool default) | "blockstream" | "https://…/api"
globalThis.ESPLORA_OVERRIDE_URL=esploraOverride();                                              // read by wallet.js esploraBase()
// ---------- the chain: every number on every page is read from the explorer above (Esplora API), cached in IndexedDB (db.js) ----------
const API_PAGE=25;                                                     // confirmed transactions per history page (Esplora)
// With no explorer of your own, the default one and then the other public one: whichever answered last goes first (remembered an hour),
// so a blocked or down explorer costs one timeout, not every page. The wallet (wallet.js esploraBase) follows the same choice.
let LIVE_BASE=(()=>{ try{ const j=JSON.parse(LS(NETKEY("bv.livebase"))||"null"); return j&&Date.now()-j.at<3600000 ? j.base : null; }catch{ return null; } })();
const chainBases=()=>{ const own=esploraOverride(); return own ? [own] : [...new Set([LIVE_BASE, ESPLORA_PRESETS.mempool[NET], ESPLORA_PRESETS.blockstream[NET]].filter(Boolean))]; };
// an explorer that just failed is skipped for a while: 30 s, doubling on repeats up to 5 min, remembered next to bv.livebase so the next page does not pay the timeouts again.
// When every explorer is marked, a call fails at once and the page keeps what it has. Offline marks nothing; Retry, the network coming back and a new data source clear the marks
let DOWN=(()=>{ try{ return JSON.parse(LS(NETKEY("bv.down"))||"{}")||{}; }catch{ return {}; } })();
const downSave=()=>LS(NETKEY("bv.down"),JSON.stringify(DOWN));
const downMark=base=>{ if(typeof navigator!=="undefined"&&navigator.onLine===false) return; const o=DOWN[base], n=o&&Date.now()-o.until<600000?Math.min(o.n*2,10):1; DOWN[base]={until:Date.now()+Math.min(300000,30000*n), n}; downSave(); };
const isDown=base=>!!DOWN[base]&&DOWN[base].until>Date.now();
function chainReset(){ DOWN={}; downSave(); }
if(typeof addEventListener==="function") addEventListener("online",chainReset);
async function chainGet(path,{text=false}={}){                         // GET explorer + path -> JSON (or text); throws when no explorer gives an answer
  let err; const bases=chainBases().filter(b=>!isDown(b));
  if(!bases.length){ err=new Error("the explorer did not answer"); err.down=true; throw err; }   // every explorer failed moments ago: at once, no timeouts
  for(const [bi,base] of bases.entries()){
    for(let i=0;i<4;i++){
      if(i) await sleep(800*2**(i-1));                                    // a busy explorer: 0.8 s, 1.6 s, 3.2 s
      let r;
      try{ r=await fetch(base+path, typeof AbortSignal!=="undefined"&&AbortSignal.timeout ? {signal:AbortSignal.timeout(6000)} : {}); }
      catch(e){ err=e; if(i===0&&bi===bases.length-1) continue; downMark(base); break; }   // unreachable (offline, blocked, too slow): marked, the next explorer; the last one gets a second try (a stale connection often answers the next time)
      if(r.ok){ if(DOWN[base]){ delete DOWN[base]; downSave(); }
        if(base!==LIVE_BASE&&!esploraOverride()){ LIVE_BASE=base; LS(NETKEY("bv.livebase"),JSON.stringify({base, at:Date.now()})); if(typeof dispatchEvent==="function") dispatchEvent(new Event("chainbase")); }
        return text ? (await r.text()).trim() : await r.json(); }
      err=new Error(`the explorer answered ${r.status}`); err.status=r.status;
      if(r.status===429){ if(i>=1){ downMark(base); break; } continue; }   // asked to slow down: one more try, then marked and the next explorer
      if(r.status<500) throw err;                                         // a 4xx is the answer, whoever is asked
      if(i===3) downMark(base);                                           // a 5xx four times: marked, the next explorer
    }
  }
  throw err;
}
TIP=+(LS(NETKEY("bv.tip"))||0);                                         // the last tip this browser saw: windows and countdowns work at once, the fresh one lands a moment later
let TIPAT=+(LS(NETKEY("bv.tipat"))||0), TIPLIVE=0, TIPERR=false;          // when TIP was read (ms), the tip read on this visit (0: none yet), whether the last read failed
const tipRefresh=async()=>{ try{ const h=+(await chainGet("/blocks/tip/height",{text:true})); if(Number.isInteger(h)&&h>0){ TIP=TIPLIVE=h; TIPAT=Date.now(); TIPERR=false; LS(NETKEY("bv.tip"),String(h)); LS(NETKEY("bv.tipat"),String(TIPAT)); return TIP; } }catch{} TIPERR=true; return TIP; };
// deadlines read the tip as it probably is now: a saved tip ages one block per 10 min since it was read, so a topic that closed since the last visit says so at once
const tipEst=()=>TIP&&TIPAT ? TIP+Math.floor((Date.now()-TIPAT)/600000) : TIP;
const blocksTo=h=>h-TIP-(TIP&&TIPAT?(Date.now()-TIPAT)/600000:0);        // blocks left until height h (fractional: the time since the tip was read counts)
// ---------- the sync line under every page's title: one wording for the same states ----------
// state: "loading" (nothing saved to show yet) | "updating" (saved data on screen, being checked) | "fresh" (every read of this pass answered) | "failed"
// height: the block the data on screen is as of, never the current tip (0: nothing saved); tail: what follows "synced · block N"; retry: the attribute of its button
// "synced" only comes from a pass where every read answered; retry leads the failed line, so a phone's cut-off line still shows it
function syncLine({state, height=0, tail="", retry="data-retry"}){
  const blk=height>0?`block ${fmt(height)}`:"";
  if(state==="failed") return `<button type="button" class="linkbtn" ${retry}>retry</button> · the explorer did not answer · ${blk?"as of "+blk:"nothing saved in this browser"}`;
  if(state==="fresh") return `<span class="dot"></span> synced${blk?" · "+blk:""}${tail?" · "+tail:""}`;
  if(state==="updating"&&blk) return `<span class="spin"></span> as of ${blk} · updating…`;
  return `<span class="spin"></span> reading the chain…`;
}
let ANN=null;                                                          // one polite live region per page, made on first use: pages announce entering and leaving the failed state, nothing else
const announce=t=>{ if(!ANN){ ANN=document.createElement("div"); ANN.setAttribute("aria-live","polite"); ANN.style.cssText="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"; document.body.appendChild(ANN); } if(ANN.textContent!==t) ANN.textContent=t; };
let TIPP=null, PRICEP=null;
const tipReady=()=>TIPP||(TIPP=tipRefresh());                          // started by loader.js on every app page
const tipFresh=()=>TIPERR?tipRefresh():tipReady();                     // before a pass says "synced": the tip read of this visit, asked again if it failed
const priceReady=()=>PRICEP||(PRICEP=NET!=="mainnet"||chainBases()[0]!==ESPLORA_PRESETS.mempool.mainnet ? Promise.resolve() : chainGet("/v1/prices").then(j=>{ if(+j.USD>0) BTCUSD=+j.USD; },()=>{}));   // only mempool.space serves a USD price: with another explorer the dollar hints stay hidden
const usdOf=sats=>BTCUSD ? "≈ $"+(sats/1e8*BTCUSD).toFixed(2) : "";
// ---------- the mining fee: the explorer's live estimates (Esplora /fee-estimates: {blocks ahead: sat/vB}), one speed chosen per network ----------
// Signet miners have been taking only 2 sat/vB and up while the estimates said 1: a burn at the minimum waited for days. Signet gets a floor of 2.
const FEE_SPEEDS=[["fast","Fast",1],["normal","Normal",6],["eco","Economy",144]];   // [id, label, target in blocks]
const FEE_FLOOR=NET==="signet"?2:1, FEE_FALLBACK=NET==="signet"?{fast:4,normal:3,eco:2}:{fast:5,normal:3,eco:1};   // no estimates: a guess that still confirms
const FEE_CAP=NET==="signet"?5:Infinity;   // ponytail: signet estimates run wild (blockstream's said 63.9 sat/vB while blocks took 2–4) and its sats are free: a ceiling there; mainnet trusts the estimate
let FEES=null, FEESAT=0, FEEP=null;
const feeRefresh=async()=>{ FEESAT=Date.now();
  try{ const j=await chainGet("/fee-estimates"), ks=Object.keys(j).map(Number).filter(n=>+j[n]>0).sort((a,b)=>a-b); if(!ks.length) return FEES;
    let prev=Infinity; const out={};
    for(const [id,,t] of FEE_SPEEDS){ const k=ks.find(n=>n>=t)??ks[ks.length-1]; out[id]=prev=Math.min(prev, FEE_CAP, Math.max(FEE_FLOOR, Math.ceil(+j[k]*10)/10)); }   // rounded up, never faster for less, never past the cap
    FEES=out; }catch{}
  return FEES; };
const feeReady=()=>{ if(!FEEP||Date.now()-FEESAT>120000) FEEP=feeRefresh(); return FEEP; };   // at most every two minutes
const feeRates=()=>FEES||FEE_FALLBACK;
const feeSpeed=()=>{ const s=LS(NETKEY("bv.fee")); return FEE_SPEEDS.some(f=>f[0]===s) ? s : "normal"; };
const feeRate=()=>feeRates()[feeSpeed()];
// ---------- one transaction -> its burns (spec §4): the outputs paying known topic addresses, each with its statement ----------
// Statements: the OP_RETURN payloads in output order, split on 0x1F, the pieces handed in order to the P2WSH outputs (every topic address is P2WSH).
// Several outputs to one topic are summed and take the first one's piece. No piece, or an empty one: an abstain.
const hexBytes=h=>new Uint8Array((String(h||"").match(/../g)||[]).map(x=>parseInt(x,16)));
const opReturnData=hex=>{ const b=hexBytes(hex), out=[]; if(b[0]!==0x6a) return null;   // OP_RETURN, then its pushes, concatenated
  for(let i=1;i<b.length;){ const op=b[i++], n=op<=0x4b?op:op===0x4c?b[i++]:op===0x4d?b[i++]|b[i++]<<8:-1; if(n<0||i+n>b.length) break; for(let j=0;j<n;j++) out.push(b[i+j]); i+=n; }
  return new Uint8Array(out); };
const UTF8=new TextDecoder();
function txBurns(tx,topics){                                           // topics: Map(address -> topic name) -> [{txid, name, t, sats, h, from, vout}]
  const vout=Array.isArray(tx&&tx.vout)?tx.vout:[], pieces=[];
  for(const o of vout) if(o.scriptpubkey_type==="op_return"){ const d=opReturnData(o.scriptpubkey); if(!d) continue;
    for(let s=0,i=0;i<=d.length;i++) if(i===d.length||d[i]===0x1f){ pieces.push(UTF8.decode(d.subarray(s,i))); s=i+1; } }
  const out=new Map(); let k=0;
  vout.forEach((o,i)=>{ if(o.scriptpubkey_type!=="v0_p2wsh") return; const piece=pieces[k++]??"", name=topics.get(o.scriptpubkey_address); if(name===undefined) return;
    if(!out.has(name)) out.set(name,{name, t:piece, sats:0, vout:i}); out.get(name).sats+=Math.round(+o.value||0); });
  const st=tx.status||{}, h=st.confirmed&&Number.isInteger(st.block_height)?st.block_height:null, pv=tx.vin&&tx.vin[0]&&tx.vin[0].prevout;
  return [...out.values()].map(b=>({txid:tx.txid, ...b, h, from:pv&&pv.scriptpubkey_address||null}));
}
// ---------- an address's history, newest first (Esplora): the mempool and the newest confirmed, then 25 confirmed per request, until stopTx ----------
async function scanAddress(addr,{stopTx=null,maxPages=Infinity,onPage=()=>{},cancelled=()=>false}={}){   // -> {mempool:[tx], confirmed:[tx], requests} | null when cancelled
  const mempool=[], confirmed=[]; let path=`/address/${addr}/txs`, requests=0;
  for(;;){
    const page=await chainGet(path); requests++; if(cancelled()) return null;
    const conf=page.filter(t=>t.status&&t.status.confirmed), mp=requests===1?page.filter(t=>!(t.status&&t.status.confirmed)):[];
    const stop=stopTx?conf.findIndex(t=>t.txid===stopTx):-1, fresh=stop>=0?conf.slice(0,stop):conf;
    mempool.push(...mp); confirmed.push(...fresh); onPage({mempool:mp, confirmed:fresh, requests});
    if(stop>=0 || conf.length<API_PAGE || requests>=maxPages) return {mempool, confirmed, requests};
    path=`/address/${addr}/txs/chain/${conf[conf.length-1].txid}`;
  }
}
// a registration states a topic's canonical name, as the app writes it (spec §7): lowercase, no whitespace, modifiers in canonical order.
// The root topic's address is also a well-known generic burn address: anything else burned there is some other burn, not a registration.
// A name is text: binary payloads decode to U+FFFD and control characters (seen on signet), and invisible or unassigned characters are not a name either (the joiner inside emoji is fine).
const nameOf=t=>{ const s=String(t||""); if(!s||s!==s.toLowerCase()||/\s/.test(s)||/[\p{C}\uFFFD]/u.test(s.replace(/\u200d/g,""))) return null; const c=canonical(parseScope(s)); return c===s ? c : null; };
// why a name would not be listed once paid for, in the reader's words (null: it registers). The New topic dialog and the topic page's Register check it before signing
const regIssue=name=>{ const s=String(name||""), n=enc.encode(s).length; if(!s) return "it has no name";
  if(n>80) return `it is ${n} bytes, 80 at most`; if(/\s/.test(s)) return "it contains spaces"; if(s!==s.toLowerCase()) return "it has capital letters";
  if(/[\p{C}\uFFFD]/u.test(s.replace(/\u200d/g,""))) return "it has invisible characters"; return nameOf(s)===s ? null : "it is not written the canonical way"; };
try{ const e=new URLSearchParams(location.search).get("endpoint"); if(e!==null) esploraSet(e.trim()); }catch{}   // ?endpoint=https://your-node/api (or blockstream, or empty for the default) sets it for this network and sticks (node.html)
// ---------- watchlist: topics this browser follows, with the count/height last seen (per network) ----------
const watchGet=()=>{ try{ const a=JSON.parse(LS(NETKEY("bv.watch"))||"[]"); return Array.isArray(a)?a.filter(w=>w&&typeof w.name==="string"):[]; }catch{ return []; } };   // -> [{name, seenH, seenCount}]
const watchSave=a=>{ try{ LS(NETKEY("bv.watch"),JSON.stringify(a)); }catch{} };
const watchHas=name=>watchGet().some(w=>w.name===name);
const watchToggle=name=>{ const a=watchGet(), i=a.findIndex(w=>w.name===name); if(i>=0) a.splice(i,1); else a.push({name, seenH:0, seenCount:0}); watchSave(a); return i<0; };   // -> true when now watched
const watchMarkSeen=(name,count,height,seen=null)=>{ const a=watchGet(), w=a.find(x=>x.name===name); if(!w) return; w.seenCount=count; w.seenH=height; if(seen) w.seen=seen; w.seenAt=Date.now(); watchSave(a); };   // seen: the call as last seen, written from a synced pass only
// the call as a watch record keeps it: who led, a yes-no's share, a number's estimate
const callSeen=(name,T)=>{ const p=parseScope(name), a=T.answers, tot=T.shareSats; return {lead:a[0]?a[0].key:null, yes:kindKey(p)==="yes-no"&&tot?Math.round((a.find(r=>r.key==="yes")||{sats:0}).sats/tot*100):null, med:p.range?weightedMedian(a):null}; };
// what changed since the last visit, in a few words: "+2 · android took the lead", "+2 · yes 79% (was 71%)", "+2 · estimate ↑ 4%", "Final · YES"
function watchNews(w, votes, T){
  const p=parseScope(w.name), k=kindKey(p), st=closeState(p), was=w.seen||{}, now=callSeen(w.name,T), n=Math.max(0,votes.length-(w.seenCount||0));
  if(st&&st.k==="final"&&T.answers[0]) return `Final · ${k==="yes-no"?T.answers[0].key.toUpperCase():T.answers[0].t}`;
  if(!n) return null;
  let what="";
  if(k==="yes-no"&&was.yes!=null&&now.yes!==was.yes) what=`yes ${now.yes}% (was ${was.yes}%)`;
  else if(k==="number"&&was.med&&now.med&&now.med!==was.med){ const d=Math.round((now.med-was.med)/Math.abs(was.med)*100); what= d ? `estimate ${d>0?"↑":"↓"} ${Math.abs(d)}%` : ""; }
  else if(was.lead&&now.lead&&now.lead!==was.lead) what= k==="duel" ? `${T.answers[0].t} took the lead` : "new leader";
  return `+${fmt(n)}${what?` · ${what}`:""}`;
}
// ---------- ballot: several burns kept aside, paid in one transaction (per network) ----------
const ballotGet=()=>{ try{ const a=JSON.parse(LS(NETKEY("bv.ballot"))||"[]"); return Array.isArray(a)?a.filter(e=>e&&typeof e.name==="string"&&typeof e.addr==="string"):[]; }catch{ return []; } };   // -> [{name, addr, statement, sats, intent}], intent on root burns only: "register" | "feature"
const ballotSave=a=>{ try{ LS(NETKEY("bv.ballot"),JSON.stringify(a)); }catch{} };
const ballotAdd=({name,addr,statement="",sats,intent})=>{ const a=ballotGet(); a.push({name, addr, statement:String(statement||""), sats:Math.max(0,Math.round(+sats||0)), intent:name?undefined:intent==="feature"?"feature":"register"}); ballotSave(a); return a.length; };
const ballotFind=addr=>ballotGet().findIndex(e=>e.addr===addr);   // one burn per address per transaction: a counter sums a topic's outputs under the first statement (spec §4)
const ballotSet=(i,patch)=>{ const a=ballotGet(); if(a[i]){ a[i]={...a[i],...patch}; ballotSave(a); } return a.length; };
const ballotRemove=i=>{ const a=ballotGet(); a.splice(i,1); ballotSave(a); return a.length; };
const ballotClear=()=>ballotSave([]);
const ballotSats=(entries=ballotGet())=>entries.reduce((a,e)=>a+(e.sats||0),0);
const BALLOT_SEP="\u001f";                                                                        // 0x1F between statements when several share one OP_RETURN (spec §4)

// ---------- closed questions: "question?a|b|c" in the scope name ----------
function parseScope(name){
  // grammar: question[?a|b|c | ?lo..hi][@deadline][!min]  — canonical order, so one question = one address
  let q=name, spec="", deadline=null, min=null;
  const i=name.indexOf("?"); if(i>=0){ q=name.slice(0,i); spec=name.slice(i+1); }
  const take=(src,re,set)=>src.replace(re,(_,v)=>{set(+v);return "";});
  q=take(q,/@(\d+)/,v=>deadline=v); q=take(q,/!(\d+)/,v=>min=v);
  spec=take(spec,/@(\d+)/,v=>deadline=v); spec=take(spec,/!(\d+)/,v=>min=v);
  let opts=null, range=null;
  const m=spec.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
  if (m) range=[+m[1],+m[2]].sort((a,b)=>a-b);
  else if (spec){ const o=[...new Set(spec.split("|").map(norm).filter(Boolean))]; if(o.length>1) opts=o; }
  return {q:q.trim(), opts, range, deadline, min};
}
const canonical = p => p.q + (p.opts?"?"+p.opts.join("|"):p.range?`?${p.range[0]}..${p.range[1]}`:"") + (p.deadline?"@"+p.deadline:"") + (p.min?"!"+p.min:"");
const kind = p => p.range ? "number" : p.opts ? (p.opts.length===2?"duel":"poll") : "open";
// ---------- one way to name, count and time a topic, for Explore and the topic page alike ----------
const isYesNo = p => !!p.opts && p.opts.length===2 && p.opts.includes("yes") && p.opts.includes("no");   // in either order: "no|yes" is its own name and address, shown as a yes-no all the same
const kindKey = p => { const k=kind(p); return k==="duel"&&isYesNo(p) ? "yes-no" : k; };   // open, yes-no, duel, poll, number
// one vocabulary per kind, on every surface: its word (eyebrows, lists, the embed, the batch), what one answer is called, the embed's call to action, the New topic chip's line
const KINDS={
  open:    {word:"open",   noun:"take",   cta:"Burn your take →",   blurb:"Anyone writes their own take. Takes ranked by sats."},
  "yes-no":{word:"yes-no", noun:"answer", cta:"Burn your answer →", blurb:"A prediction with a closing date. Burns are a signal, not a bet: nobody wins the sats."},
  duel:    {word:"duel",   noun:"answer", cta:"Burn your answer →", blurb:"Two sides, one bar."},
  poll:    {word:"poll",   noun:"answer", cta:"Burn your answer →", blurb:"3 or more options race."},
  number:  {word:"number", noun:"answer", cta:"Burn your answer →", blurb:"Everyone answers with a number; the estimate is weighted by sats."},
};
const kindWord = p => { const k=kindKey(p); return k==="poll" ? `poll · ${p.opts.length} options` : KINDS[k].word; };   // open, yes-no, duel, poll · N options, number
// a topic's question as a heading: hyphens read as spaces, a path as "food › …", a question mark on topics with fixed answers. Display only: links, search and data keep the name
const niceQ = name => { const p=parseScope(name), s=p.q.replace(/-/g," ").replace(/\//g," › ").replace(/\s+/g," ").trim(); return (s.charAt(0).toUpperCase()+s.slice(1))+(p.opts||p.range?"?":""); };
const topicName = (name,hash=true) => { const p=parseScope(name); return (hash?"#":"")+esc(p.q)+(p.opts||p.range?"?":""); };   // "#general", "#paris-cars?"  (escaped HTML)
// a number answer, one way everywhere: digits grouped only when the topic's range reaches 10,000 (years stay bare), no decimals on an integer range, the mean included
const numFmt = (x,range) => { if(x===null||x===undefined||!Number.isFinite(+x)) return "—"; const [lo,hi]=range||[0,Math.abs(+x)], ints=Number.isInteger(lo)&&Number.isInteger(hi);
  return (+x).toLocaleString("en-US",{useGrouping:Math.max(Math.abs(lo),Math.abs(hi))>=1e4, maximumFractionDigits:ints?0:2}); };
// a number topic's unit, when its name ends with one (the New topic dialog appends it): "$150,000", "€150,000", "150,000 sats", "42%"
const unitOf = p => { const m=((p&&p.q)||"").match(/-(in-usd|in-eur|in-sats|percent)$/); return m?m[1]:null; };
const numU = (x,p) => { const s=numFmt(x,p.range), u=unitOf(p); return s==="—"||!u ? s : u==="in-usd" ? "$"+s : u==="in-eur" ? "€"+s : u==="in-sats" ? s+" sats" : s+"%"; };
// a statement as the pages show it (escape it before HTML): a number topic's answer formatted like its board, the words as written otherwise
const shownT = (p,t) => { if(p&&p.range){ const x=numOf(t); if(Number.isFinite(x)) return numU(x,p); } return String(t??""); };
const numOf = t => { const m=norm(String(t)).match(/^(-?\d+(?:\.\d+)?)([km])?$/); return m ? +m[1]*(m[2]==="k"?1e3:m[2]==="m"?1e6:1) : NaN; };   // spec §5: "150k" = 150000
// closed to new burns: the next block reaches the deadline, so a burn sent now cannot count (tallyOf counts a pending burn as late from the same moment)
const closedAt = p => !!p.deadline && TIP>0 && tipEst()+1>=p.deadline;
// a deadline, one wording on every surface (topic header, Explore, the embed, watch chips): open, closing soon (2 days), last blocks (6), closed to new burns, closed, final.
// live: the tip read on this visit (TIPLIVE), for "final"; text: the header's words, short: a list's
const dlWhen = h => new Date(Date.now()+blocksTo(h)*600000).toLocaleDateString(undefined,{dateStyle:"medium"});
function closeState(p, live=TIPLIVE){
  if(!p||!p.deadline) return null; if(!TIP) return {k:"checking", text:"checking the deadline…", short:"checking the deadline"};
  const left=blocksTo(p.deadline), D=fmt(p.deadline), days=Math.round(left/144);
  if(tipEst()+1<p.deadline){
    if(left>288) return {k:"open", text:`Closes ≈ ${dlWhen(p.deadline)} · in ${days} days`, short:`closes in ≈ ${days} d`};
    if(left>6) return {k:"soon", text:`closing in ~${untilText(left)} · ${fmt(Math.ceil(left))} blocks left`, short:`closing in ~${untilText(left)}`};
    return {k:"last", text:`last blocks · ~${Math.max(1,Math.ceil(left))} left`, short:"last blocks"}; }
  if(tipEst()<p.deadline) return {k:"closing", text:"closed to new burns · the next block reaches the deadline", short:"closed to new burns"};
  if(!(live>=p.deadline+6)){ const n=Math.max(1,p.deadline+6-tipEst()); return {k:"closed", text:`Closed at block ${D} · final in ≈ ${untilText(n)} (${n} block${n===1?"":"s"})`, short:"closed"}; }
  return {k:"final", text:`Final · block ${D}`, short:"final"};
}
const untilText = blocks => { const m=Math.max(0,Math.round(blocks*10)), d=Math.floor(m/1440), h=Math.floor(m%1440/60); return d?`${d}d ${h}h`:h?`${h}h ${m%60}m`:`${m}m`; };   // blocks at ~10 min
const ICON_TAKE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>';   // a take: a megaphone, said out loud
// ---------- icon badges (.fi, base.css), one visual language on every page: the shape says what (ICON_TAKE, a megaphone, for any burn's take or answer,
// ✦ a sponsorship, a flame most burned, a clock the latest, a person a burner, # a registration), the tint which kind of burn (ember a take, red most burned, gold a sponsorship, slate a burner, grey a registration) ----------
const svgIcon = (d,fill) => `<svg width="16" height="16" viewBox="0 0 24 24" ${fill?'fill="currentColor"':'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${d}</svg>`;
const ICONS = {
  top: svgIcon('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),   // most burned: a flame
  latest: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),                   // the latest: a clock
  feature: svgIcon('<path d="M12 3c.5 4.7 4.3 8.5 9 9-4.7.5-8.5 4.3-9 9-.5-4.7-4.3-8.5-9-9 4.7-.5 8.5-4.3 9-9z"/>',true),   // a sponsorship, ✦ drawn: the glyph falls back to a tiny font on Safari (the key keeps the data's word: intent "feature")
  burner: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
  join: svgIcon('<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>'),   // a new burner
  reg: svgIcon('<path d="M10 4 8 20M16 4l-2 16M5 9h15M4 15h15"/>'),                               // a name gets registered
};
const iconBadge = (cls,icon) => `<span class="fi${cls?" "+cls:""}" aria-hidden="true">${icon}</span>`;
// ---------- RECENT, the timeline on Explore (every topic) and on a topic page (that topic alone): the latest events whatever the window, four kinds, each with its icon and its word:
// a take (an answer outside open topics), a new topic (a name's first root burn registers it), a sponsorship (the root burns after it), a new burner (an address's first burn in these topics) ----------
function recentDigest(burns, roots, lim={burns:3, roots:2, joins:2, all:6}){   // burns: [{v, name}], roots: rootBurns() (loader.js; reg:true on a registration); lim: how many of each kind, and in all
  const H=v=>v.h===null?1e12:v.h, by=(a,b)=>b.at-a.at, first={};
  for(const b of burns) if(b.v.from && !(first[b.v.from] && H(first[b.v.from].v)<=H(b.v))) first[b.v.from]=b;   // each burner's first burn
  return [...burns.map(b=>({kind:"burn", at:H(b.v), ...b})).sort(by).slice(0,lim.burns),
    ...roots.map(v=>({kind:v.reg?"reg":"feature", at:H(v), v, name:v.name})).sort(by).slice(0,lim.roots),
    ...Object.entries(first).map(([addr,b])=>({kind:"burner", at:H(b.v), ...b, addr})).sort(by).slice(0,lim.joins)].sort(by).slice(0,lim.all);   // a digest: every kind gets a place, then time orders them
}
// every take and topic name links to its topic page. o.here: on the topic page a burn names its burner instead of the topic; o.take(html): the take with its top-take star, o.tag(v): late / below min
function recentRow(x, o={}){
  const v=x.v, when=whenOf(v), addr=a=>`<a href="burner.html#${esc(a)}" title="${esc(a)}">${esc(a.slice(0,6)+"…"+a.slice(-4))}</a>`, by=v.from&&v.from!==o.self?addr(v.from)+" · ":"";   // o.self: the burner page's own address goes without saying
  const href=`topic.html#${esc(x.name)}`, tn=`<a href="${href}">${topicName(x.name)}</a>`, topic=(html,cls="")=>`<a class="fa${cls}" href="${href}">${html}</a>`;
  const row=(kind,icon,word,meta,what,right="")=>`<div class="fr ${kind}"><span class="fi" aria-hidden="true">${icon}</span><span class="fm"><span class="ft">${word}</span> · ${meta}</span>${right}${what}<b>${fmt(v.sats)} sats</b></div>`;
  if(x.kind==="burn") return row("burn", ICON_TAKE, kind(parseScope(x.name))==="open"?"take":"answer", (o.here?(v.from?addr(v.from):"unknown burner"):tn)+" · "+when+(o.tag?o.tag(v):""),
    o.take?o.take(v,topic):topic(v.t?esc(shownT(parseScope(x.name),v.t)):"<i>no take</i>"), `<a class="frx" href="receipt.html?in=${encodeURIComponent(x.name)}#${esc(v.txid)}">receipt →</a>`);
  if(x.kind==="reg") return row("reg", ICONS.reg, "new topic", by+when, topic(topicName(x.name)+" registered"));
  if(x.kind==="feature") return row("feature", ICONS.feature, "sponsor", by+when, topic(topicName(x.name)+" sponsored"));
  return row("burner", ICONS.join, "new burner", `first burn in ${tn} · ${when}`, `<a class="fa" href="burner.html#${esc(x.addr)}" title="${esc(x.addr)}">${esc(x.addr.slice(0,6)+"…"+x.addr.slice(-4))} joined</a>`);
}
const satsShort = n => n<1e3 ? String(n) : n<1e4 ? (n/1e3).toFixed(1).replace(/\.0$/,"")+"k" : n<1e6 ? Math.round(n/1e3)+"k" : (n/1e6).toFixed(1).replace(/\.0$/,"")+"M";   // "210k" on buttons
// counted burns of one topic, with the topic page's rules: late and below-minimum burns do not count; poll and number answers
// are kept apart from off-list ones (on:false), and number answers merge by value ("150k" and "150000" are one row)
// A burn with no take backs the topic: it counts in the topic's total, never as a row, a rank or a share (none). A row shows the spelling of its earliest burn
function tallyOf(name, votes){
  const p=parseScope(name), rows={}, none={sats:0, burns:0}, late={sats:0, burns:0}, dust={sats:0, burns:0}; let sats=0, burns=0;
  for(const v of votes){
    if(p.deadline && (v.h===null ? tipEst()+1>=p.deadline : v.h>=p.deadline)){ late.sats+=v.sats; late.burns++; continue; }
    if(p.min && v.sats<p.min){ dust.sats+=v.sats; dust.burns++; continue; }
    let key=norm(v.t), t=v.t, on=true;
    if(!key){ none.sats+=v.sats; none.burns++; sats+=v.sats; burns++; continue; }
    if(p.range){ const x=numOf(v.t); on=Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1]; if(on){ key="n:"+x; t=String(x); } }
    else if(p.opts) on=p.opts.includes(key);
    const r=rows[key]||(rows[key]={key, t, sats:0, burns:0, on, h0:Infinity, tx0:""}); r.sats+=v.sats; r.burns++; spell(r,v,t);
    if(on){ sats+=v.sats; burns++; }
  }
  const list=Object.values(rows).sort((a,b)=>b.sats-a.sats), answers=list.filter(r=>r.on);
  return {sats, burns, answers, other:list.filter(r=>!r.on), none, late, dust, shareSats:answers.reduce((a,r)=>a+r.sats,0)};   // shareSats: what shares are of (no-take sats left out); late and dust: shown, not counted
}
// the display spelling of a row: its earliest burn's (lowest height, then lowest txid; unconfirmed last), so a later burn never restyles a take (spec §5)
const spell=(r,v,t)=>{ const h=v.h??Infinity; if(h<r.h0||h===r.h0&&String(v.txid)<r.tx0){ r.t=t; r.h0=h; r.tx0=String(v.txid); } };
const weightedMedian = rows => { const tot=rows.reduce((a,r)=>a+r.sats,0); if(!tot) return null; let acc=0; const s=rows.slice().sort((a,b)=>numOf(a.t)-numOf(b.t));
  for(let i=0;i<s.length;i++){ acc+=s[i].sats; if(acc*2===tot&&i+1<s.length) return (numOf(s[i].t)+numOf(s[i+1].t))/2; if(acc*2>tot) return numOf(s[i].t); } return null; };   // an exact half split: the midpoint of the two values (spec §6)
function binsOf(lo,hi){                                      // round bins: 8 to 12 of {1, 2, 2.5, 5}×10^n across the range (50k..500k: 9 of 50k)
  const span=hi-lo||1, e0=Math.floor(Math.log10(span)); let step=null;
  for(let e=e0-2; e<=e0+1&&!step; e++) for(const m of [1,2,2.5,5]){ const s=m*10**e, n=Math.ceil(span/s-1e-9); if(n>=8&&n<=12){ step=s; break; } }
  step=step||span/10; const start=Math.floor(lo/step+1e-9)*step; return {start, step, n:Math.max(1,Math.ceil((hi-start)/step-1e-9))};
}
// a topic's current call in a few words, for lists and chips (T: tallyOf over the burns the result counts): the split, who leads, the estimate
function callOf(name, T){
  const p=parseScope(name), k=kindKey(p), a=T.answers, tot=T.shareSats; if(!a.length||!tot) return null;
  if(k==="yes-no") return `${Math.round((a.find(r=>r.key==="yes")||{sats:0}).sats/tot*100)}% yes`;
  if(k==="duel"){ const [x,y]=a; return y&&y.sats===x.sats ? `${x.t} ties with ${y.t}` : `${x.t} leads ${p.opts.find(o=>o!==x.key)}`; }
  if(k==="poll") return `${a[0].t} leads`;
  if(k==="number") return `≈ ${numU(weightedMedian(a),p)}`;
  return `leads “${a[0].t}”`;
}
// one burn's fate under its topic's rules, from the burn and the name alone (exact in a fresh browser): counted, in the total only, not in the result, not counted, pending
function burnStatus(p,v){ const t=norm(v.t||""), late=p.deadline&&(v.h===null?tipEst()+1>=p.deadline:v.h>=p.deadline);
  if(late) return "late · after the deadline, not counted";
  if(p.min&&v.sats<p.min) return `below this topic's ${fmt(p.min)}-sat minimum · not counted`;
  if(!t) return "no take · this burn backs the topic, not a statement";
  if(p.opts&&!p.opts.includes(t)) return "not one of the options · not in the result";
  if(p.range){ const x=numOf(t); if(!(Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1])) return "outside the range · not in the result"; }
  if(v.h===null) return p.deadline ? `pending · counts if it confirms before block ${fmt(p.deadline)}` : "pending · counts once it confirms";
  return p.deadline ? `counted · before the deadline (block ${fmt(p.deadline)})` : "counted";
}
// a topic in a list or on a receipt: its name and, compactly, the rules that make it another topic than its lookalikes
const topicLabel = name => { const p=parseScope(name), r=[p.opts&&kindKey(p)!=="yes-no"?p.opts.join(" | "):null, p.range?`${nfc(p.range[0])} – ${nfc(p.range[1])}`:null, p.deadline?`closes ≈ ${dlWhen(p.deadline)}`:null, p.min?`min ${nfc(p.min)}`:null].filter(Boolean);
  return topicName(name)+(r.length?` <span class="tl2">· ${esc(r.join(" · "))}</span>`:""); };
// ---------- what this site and this viewer chose not to show (spec: a front end may refuse to display a topic or a take): the text goes, its sats and bars stay ----------
// the site's list is a static hide.json next to snapshots/ ({"takes":[{"topic","take"}],"topics":[name]}); the viewer's lives in this browser
let HIDE={site:new Set(), topics:new Set(), mine:new Set()}, HIDEP=null;
try{ HIDE.mine=new Set(JSON.parse(LS(NETKEY("bv.hide"))||"[]")); }catch{}
const hideKey=(name,t)=>name+"\u0000"+norm(String(t||""));
const hideReady=()=>HIDEP||(HIDEP=snapshotGet("hide.json").then(j=>{ if(j&&Array.isArray(j.takes)) for(const x of j.takes) if(x&&typeof x.topic==="string") HIDE.site.add(hideKey(x.topic,x.take)); if(j&&Array.isArray(j.topics)) for(const n of j.topics) if(typeof n==="string") HIDE.topics.add(n); }));
const hiddenBy = (name,t) => HIDE.site.has(hideKey(name,t)) ? "site" : HIDE.mine.has(hideKey(name,t)) ? "you" : null;
const hideMine = (name,t,on=true) => { const k=hideKey(name,t); on?HIDE.mine.add(k):HIDE.mine.delete(k); LS(NETKEY("bv.hide"),JSON.stringify([...HIDE.mine])); };
const hiddenTxt = by => by==="site" ? "hidden by this site" : "hidden by you";
// the weighted quartiles, for the "middle half" of a number topic
const weightedQuantile = (rows,q) => { const tot=rows.reduce((a,r)=>a+r.sats,0); if(!tot) return null; let acc=0; for(const r of rows.slice().sort((a,b)=>numOf(a.t)-numOf(b.t))){ acc+=r.sats; if(acc>=tot*q) return numOf(r.t); } return null; };

// ---------- scope: name -> P2WSH(OP_RETURN name) ----------
const CH="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(v){const G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let c=1;for(const x of v){const b=c>>>25;c=((c&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((b>>>i)&1)c^=G[i]}return c>>>0}
function hrpExpand(h){const r=[];for(const ch of h)r.push(ch.charCodeAt(0)>>5);r.push(0);for(const ch of h)r.push(ch.charCodeAt(0)&31);return r}
function toWords(bytes){let acc=0,bits=0,out=[];for(const b of bytes){acc=((acc<<8)|b)&0xfff;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31)}}if(bits>0)out.push((acc<<(5-bits))&31);return out}
function bech32(hrp,ver,prog){const data=[ver,...toWords(prog)];const pm=polymod([...hrpExpand(hrp),...data,0,0,0,0,0,0])^1;const chk=[];for(let i=0;i<6;i++)chk.push((pm>>>(5*(5-i)))&31);return hrp+"1"+[...data,...chk].map(d=>CH[d]).join("")}
async function deriveScope(name){
  const nb=enc.encode(name);
  const script=new Uint8Array(nb.length ? [0x6a, ...(nb.length<=75?[nb.length]:[0x4c,nb.length]), ...nb] : [0x6a]);   // root scope: bare OP_RETURN
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",script));
  return {name, script:toHex(script), hash:toHex(hash), addr:bech32(HRP,0,hash)};   // bc1… on mainnet, tb1… on signet
}

// ---------- bech32 decoder + unsigned transaction + ready-to-sign payload (pure) ----------
const BECH32M=0x2bc830a3;
// ---------- tip configuration: put the project addresses here (bech32 / bech32m). null = no tip on that network, every tip UI stays hidden ----------
const TIP_ADDRESSES={ mainnet:"bc1qh8a49dff2sjvlqjdtfau8ha6lr84u2pz5jtpmc", signet:"tb1q87kk22qg4jluges4y4mcu5hg2mqvwdntq04u9n" };   // project tip addresses per network; null hides every tip control on that network
const TIP_EFFECTIVE = TIP_ADDRESSES[NET] || null;                // the address for the current network, or null
const tipEnabled = () => !!TIP_EFFECTIVE;
function fromWords(words){let acc=0,bits=0,out=[];for(const w of words){acc=((acc<<5)|w)&0xfff;bits+=5;while(bits>=8){bits-=8;out.push((acc>>bits)&255)}}if(bits>=5||((acc<<(8-bits))&255))throw new Error("bad padding");return new Uint8Array(out)}
function bech32Decode(addr){                                     // -> {hrp, version, program}; v0 = bech32, v1+ = bech32m (BIP-173 / BIP-350)
  if(typeof addr!=="string") throw new Error("not a string");
  if(addr!==addr.toLowerCase() && addr!==addr.toUpperCase()) throw new Error("mixed case");
  const s=addr.toLowerCase(), i=s.lastIndexOf("1");
  if(s.length<8||s.length>90||i<1||i+7>s.length) throw new Error("bad length");
  const hrp=s.slice(0,i), data=[...s.slice(i+1)].map(c=>CH.indexOf(c));
  if(data.includes(-1)) throw new Error("bad character");
  const version=data[0]; if(version>16) throw new Error("bad witness version");
  if(polymod([...hrpExpand(hrp),...data])!==(version===0?1:BECH32M)) throw new Error("bad checksum");
  const program=fromWords(data.slice(1,-6));
  if(program.length<2||program.length>40) throw new Error("bad program length");
  if(version===0&&program.length!==20&&program.length!==32) throw new Error("bad v0 program length");
  return {hrp, version, program};
}
function scriptPubKey(addr){ const {version,program}=bech32Decode(addr); return new Uint8Array([version?0x50+version:0x00, program.length, ...program]); }
function opReturnScript(bytes){ return new Uint8Array([0x6a, ...(bytes.length<=75?[bytes.length]:[0x4c,bytes.length]), ...bytes]); }   // 6a + minimal push
const varint=n=> n<0xfd?[n] : n<=0xffff?[0xfd,n&255,n>>8] : [0xfe,n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255];
const le64=sats=>{ const lo=sats%4294967296, hi=Math.floor(sats/4294967296); return [lo&255,(lo>>8)&255,(lo>>16)&255,(lo>>>24)&255,hi&255,(hi>>8)&255,(hi>>16)&255,(hi>>>24)&255]; };
function serializeUnsignedTx(outputs){                           // version 2, no inputs, no witness, locktime 0 — a wallet funds and signs it
  const b=[0x02,0,0,0, ...varint(0), ...varint(outputs.length)];
  for(const o of outputs) b.push(...le64(o.value), ...varint(o.script.length), ...o.script);
  b.push(0,0,0,0);
  return toHex(new Uint8Array(b));
}
/* self-check (not executed): serializeUnsignedTx([{value:5000, script:scriptPubKey("bc1qrz05qq6tu7senu06nzgkdrhr4dsyn7pd8rrghec0t9h2ktsc27msqvznj2")},{value:0, script:opReturnScript(enc.encode("pizza"))}])
   === "02000000" + "00" + "02"
     + "8813000000000000" + "22" + "0020189f40034be7a199f1fa9891668ee3ab6049f82d38c68be70f596eab2e1857b7"
     + "0000000000000000" + "07" + "6a0570697a7a61"                                     // OP_RETURN push(5) "pizza"
     + "00000000"
   i.e. 0200000000028813000000000000220020189f40034be7a199f1fa9891668ee3ab6049f82d38c68be70f596eab2e1857b70000000000000000076a0570697a7a6100000000 */
function buildPayload({burnAddr, burnSats, statementBytes=null, tipAddr=null, tipSats=0, burnLabel="burn"}){
  const btc=v=>(v/1e8).toFixed(8);
  const outs=[], core=[], electrum=[];
  outs.push({label:burnLabel, addr:burnAddr, sats:burnSats, script:scriptPubKey(burnAddr)});
  core.push(`{"${burnAddr}":${btc(burnSats)}}`); electrum.push(`${burnAddr}, ${burnSats} sat`);
  if(statementBytes && statementBytes.length){
    const dataHex=toHex(statementBytes);
    outs.push({label:"OP_RETURN", addr:"OP_RETURN", sats:0, script:opReturnScript(statementBytes)});
    core.push(`{"data":"${dataHex}"}`); electrum.push(`OP_RETURN ${dataHex}, 0`);
  }
  let tipOmitted=false;
  if(tipSats>0){
    let ts=null; try{ ts=tipAddr?scriptPubKey(tipAddr):null; }catch{ ts=null; }
    if(ts){ outs.push({label:"tip", addr:tipAddr, sats:tipSats, script:ts}); core.push(`{"${tipAddr}":${btc(tipSats)}}`); electrum.push(`${tipAddr}, ${tipSats} sat`); }
    else tipOmitted=true;
  }
  return {
    outputs: outs.map(o=>({label:o.label, addr:o.addr, sats:o.sats, scriptHex:toHex(o.script)})),
    rawHex: serializeUnsignedTx(outs.map(o=>({value:o.sats, script:o.script}))),
    core: {
      createrawtransaction: `bitcoin-cli createrawtransaction '[]' '[${core.join(",")}]'`,
      note: "fundrawtransaction adds inputs and change to a zero-input transaction",
      next: ["bitcoin-cli fundrawtransaction <hex>", "bitcoin-cli signrawtransactionwithwallet <funded hex>", "bitcoin-cli sendrawtransaction <signed hex>"],
    },
    electrum: electrum.join("\n"),
    tipOmitted,
  };
}
// Several burns in one transaction (spec §4): one burn output per entry, then the statements. If every statement joined by 0x1F fits in
// 80 bytes -> one shared OP_RETURN after the burns (relays everywhere); else one OP_RETURN per entry, right after its burn output
// (needs post-Core-30 relay policy). A counter splits each OP_RETURN payload on 0x1F and hands the pieces, in order, to the topic outputs.
function buildBallotPayload(entries, {tipAddr=null, tipSats=0}={}){
  const btc=v=>(v/1e8).toFixed(8);
  const outs=[], core=[], electrum=[];
  const burn=e=>{ const s=scriptPubKey(e.addr); outs.push({label:e.name?"burn · #"+e.name:(e.intent==="feature"?"sponsor":"register")+" · root", addr:e.addr, sats:e.sats, script:s}); core.push(`{"${e.addr}":${btc(e.sats)}}`); electrum.push(`${e.addr}, ${e.sats} sat`); };   // name "" = the root topic: a registration or a sponsorship
  const data=bytes=>{ const hex=toHex(bytes); outs.push({label:"OP_RETURN", addr:"OP_RETURN", sats:0, script:opReturnScript(bytes)}); core.push(`{"data":"${hex}"}`); electrum.push(`OP_RETURN ${hex}, 0`); };
  const stm=entries.map(e=>String(e.statement||"")), any=stm.some(Boolean);
  const joined=enc.encode(stm.join(BALLOT_SEP));
  const shared=joined.length<=80;
  if(shared){ entries.forEach(burn); if(any) data(joined); }
  else{
    const lastWith=stm.reduce((a,s,i)=>s?i:a,-1);
    entries.forEach((e,i)=>{ burn(e); if(i<=lastWith) data(enc.encode(stm[i])); });   // an empty OP_RETURN keeps the piece order for an abstain that has a later voter
  }
  let tipOmitted=false;
  if(tipSats>0){
    let ts=null; try{ ts=tipAddr?scriptPubKey(tipAddr):null; }catch{ ts=null; }
    if(ts){ outs.push({label:"tip", addr:tipAddr, sats:tipSats, script:ts}); core.push(`{"${tipAddr}":${btc(tipSats)}}`); electrum.push(`${tipAddr}, ${tipSats} sat`); }
    else tipOmitted=true;
  }
  return {
    outputs: outs.map(o=>({label:o.label, addr:o.addr, sats:o.sats, scriptHex:toHex(o.script)})),
    rawHex: serializeUnsignedTx(outs.map(o=>({value:o.sats, script:o.script}))),
    core: {
      createrawtransaction: `bitcoin-cli createrawtransaction '[]' '[${core.join(",")}]'`,
      note: "fundrawtransaction adds inputs and change to a zero-input transaction",
      next: ["bitcoin-cli fundrawtransaction <hex>", "bitcoin-cli signrawtransactionwithwallet <funded hex>", "bitcoin-cli sendrawtransaction <signed hex>"],
    },
    electrum: electrum.join("\n"),
    tipOmitted, shared, burns: entries.length,
  };
}

// ---------- transaction panel, one instance per dialog: the wallet block on top, the outputs + raw hex under "Advanced" ----------
// payPanel(prefix): {set(args), paint(), wallet, onpaint}. set() builds the payload, paints the outputs + raw hex and hands it to the wallet block;
// onpaint (set by the page) repaints the dialog footer, whose primary button is the wallet action (walletPrimary).
function payPanel(prefix, opts){
  const pre=$(prefix+"-text"), tipnote=$(prefix+"-tipnote"), copy=$(prefix+"-copy"), wal=$(prefix+"-wallet");
  const wtab=wal?walletTab(prefix,wal,opts):null;
  let last=null;
  const api={wallet:wtab, onpaint:null};
  const paint=()=>{ pre.textContent=last?last.rawHex:"…"; copy.disabled=!last; if(wtab) wtab.paint(); if(api.onpaint) api.onpaint(); };
  copy.onclick=()=>{ if(last) copyText(pre.textContent,copy); };
  const set=args=>{ try{ last=args.entries ? buildBallotPayload(args.entries,{tipAddr:args.tipAddr, tipSats:args.tipSats}) : buildPayload(args); }catch{ last=null; } tipnote.hidden=!(last&&last.tipOmitted); if(wtab) wtab.update(last); paint(); };   // entries: several burns in one transaction (a registration with its first answer)
  api.set=set; api.paint=paint;
  paint();
  return api;
}
const PAY=[];                                          // every panel on the page, repainted together when the wallet changes

// ---------- amount chips: a .seg of presets over a number input; Custom reveals the input, an off-preset value keeps it visible ----------
function amountChips(seg, input, onchange){
  let custom=false, last=null;                              // last: the preset to come back to
  const chips=[...seg.querySelectorAll("[data-sats]")];
  const wrap=document.createElement("span"), x=document.createElement("button");   // Custom: the input with a ✕ stands in for the chips
  wrap.className="amtcustom"; input.before(wrap); wrap.append(input); input.hidden=false; input.style.marginTop="";
  x.type="button"; x.className="amtx"; x.setAttribute("aria-label","Back to the presets"); x.textContent="✕"; wrap.append(x);
  const sync=()=>{
    const v=Number(input.value||0), min=+input.min||0; let hit=null;
    for(const b of chips){ if(b.dataset.sats==="custom") continue; b.disabled=+b.dataset.sats<min; if(!b.disabled&&+b.dataset.sats===v) hit=b; }   // below the minimum: greyed out
    for(const b of chips) b.setAttribute("aria-pressed",String(b===hit || (!hit&&b.dataset.sats==="custom")));
    if(hit) last=hit.dataset.sats;
    const own=custom||!hit; seg.hidden=own; wrap.hidden=!own;
  };
  seg.onclick=e=>{ const b=e.target.closest("[data-sats]"); if(!b||b.disabled) return;
    if(b.dataset.sats==="custom"){ custom=true; sync(); input.focus(); input.select(); return; }
    custom=false; input.value=b.dataset.sats; sync(); onchange(); };
  input.addEventListener("input",sync);
  x.onclick=()=>{ custom=false; const b=chips.find(c=>c.dataset.sats===last&&!c.disabled)||chips.find(c=>c.dataset.sats!=="custom"&&!c.disabled);
    if(b) input.value=b.dataset.sats; sync(); onchange(); (seg.querySelector('[aria-pressed="true"]')||seg).focus?.(); };
  const reset=def=>{ custom=false; input.value=Math.max(+def,+input.min||0); sync(); };   // the default, or the minimum when that is higher
  sync();
  return {sync, reset};
}

// ---------- share cards: 1200×630 (the size link previews use), the ember theme; the receipt and the topic page paint their own content ----------
const CF={D:'"Unbounded",system-ui,sans-serif', B:'"Instrument Sans",system-ui,sans-serif', M:'"JetBrains Mono",ui-monospace,Menlo,monospace'};
function wrapLines(x,text,max){ const out=[]; let line=""; for(const w of text.split(/\s+/)){ const t=line?line+" "+w:w; if(x.measureText(t).width>max&&line){ out.push(line); line=w; } else line=t; } if(line) out.push(line); return out; }
function rr(x,X,Y,W,H,r){ x.beginPath(); x.moveTo(X+r,Y); x.arcTo(X+W,Y,X+W,Y+H,r); x.arcTo(X+W,Y+H,X,Y+H,r); x.arcTo(X,Y+H,X,Y,r); x.arcTo(X,Y,X+W,Y,r); x.closePath(); }
// the frame every card shares: the brand, a word in the corner, the page's address and a right-hand note at the foot; paint(x) draws the rest (y from 170 to 500)
async function drawCard(label, paint, footRight=""){
  const c=document.createElement("canvas"); c.width=1200; c.height=630; const x=c.getContext("2d");
  try{ await Promise.all(['600 56px "Unbounded"','400 26px "Instrument Sans"','400 20px "JetBrains Mono"'].map(f=>document.fonts.load(f))); }catch{}
  x.fillStyle="#0b0a0e"; x.fillRect(0,0,1200,630);
  let g=x.createRadialGradient(1040,60,0,1040,60,720); g.addColorStop(0,"rgba(255,106,26,.30)"); g.addColorStop(1,"rgba(255,106,26,0)"); x.fillStyle=g; x.fillRect(0,0,1200,630);
  g=x.createRadialGradient(120,640,0,120,640,520); g.addColorStop(0,"rgba(255,181,71,.14)"); g.addColorStop(1,"rgba(255,181,71,0)"); x.fillStyle=g; x.fillRect(0,0,1200,630);
  rr(x,40,40,1120,550,30); x.strokeStyle="rgba(255,255,255,.14)"; x.lineWidth=2; x.stroke();
  g=x.createRadialGradient(92,98,2,96,102,20); g.addColorStop(0,"#ffb547"); g.addColorStop(.6,"#ff6a1a"); g.addColorStop(1,"#7a2200"); x.fillStyle=g; x.beginPath(); x.arc(96,102,18,0,6.29); x.fill();
  x.fillStyle="#f3efe9"; x.font=`600 24px ${CF.D}`; x.textBaseline="middle"; x.fillText("Burning Take",128,102);
  x.fillStyle="#ffb547"; x.font=`500 18px ${CF.M}`; x.textAlign="right"; try{ x.letterSpacing="3px"; }catch{} x.fillText(`${label} · ${NET.toUpperCase()}`,1104,102); try{ x.letterSpacing="0px"; }catch{} x.textAlign="left"; x.textBaseline="alphabetic";
  paint(x);
  x.beginPath(); x.moveTo(96,536); x.lineTo(1104,536); x.strokeStyle="rgba(255,255,255,.12)"; x.setLineDash([3,6]); x.stroke(); x.setLineDash([]);
  x.font=`400 18px ${CF.M}`; x.fillStyle="#8a8177"; x.fillText((()=>{ try{ return decodeURIComponent(location.href); }catch{ return location.href; } })().replace(/^https?:\/\//,"").replace(/[?&]burn=[^#&]*/,"").slice(0,64),96,566);   // the address as a person reads it
  x.textAlign="right"; x.fillText(footRight||"burned for good on bitcoin · recount it yourself",1104,566); x.textAlign="left";
  return c;
}
// a horizontal bar of segments (a duel's sides, a poll's race), each [share, color]
function cardBar(x,X,Y,W,H,segs){ rr(x,X,Y,W,H,H/3); x.save(); x.clip(); x.fillStyle="rgba(255,255,255,.07)"; x.fillRect(X,Y,W,H); let at=X; const tot=segs.reduce((a,s)=>a+s[0],0)||1; for(const [v,col] of segs){ const w=W*v/tot; x.fillStyle=col; x.fillRect(at,Y,w,H); at+=w+(w?3:0); } x.restore(); }
// share: the system's share sheet with the image where it takes files, else the text and link copied and the image saved
async function shareCard({title, text, url, canvas, stem}){
  let blob=null; try{ blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error("no image")),"image/png")); }catch{}
  try{ const file=blob&&new File([blob],stem+".png",{type:"image/png"});
    if(file&&navigator.canShare&&navigator.canShare({files:[file]})){ await navigator.share({title, text, url, files:[file]}); return; }
    if(navigator.share){ await navigator.share({title, text, url}); return; } }catch(e){ if(e&&e.name==="AbortError") return; }
  copyText(`${text} ${url}`, document.createElement("span"));
  if(blob) try{ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=stem+".png"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); }catch{}
  if(typeof toast==="function") toast(blob?"Text and link copied · image saved":"Text and link copied");
}

// ---------- copy ----------
function copyText(txt,btn){
  const done=()=>{
    if(btn.classList.contains("icon")){ btn.classList.add("copied"); clearTimeout(btn._ct); btn._ct=setTimeout(()=>btn.classList.remove("copied"),1200); return; }   // icon-only button: swap glyph for a check + tooltip
    const o=btn.textContent;btn.textContent="copied";setTimeout(()=>btn.textContent=o,1200)};
  (navigator.clipboard?.writeText(txt)||Promise.reject()).then(done).catch(()=>{
    const ta=document.createElement("textarea"); ta.value=txt; ta.setAttribute("readonly",""); ta.style.cssText="position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta); ta.select(); let ok=false; try{ ok=document.execCommand("copy"); }catch{} ta.remove();
    if(ok) return done();
    const el=btn.previousElementSibling; if(!el||!el.matches("code,pre")) return;   // a header button (e.g. Copy link) has no text to select
    const r=document.createRange(); r.selectNodeContents(el);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}
document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>copyText(b.dataset.copy,b));

// ---------- .seg toggles: one sliding thumb per group, parked under the aria-pressed="true" button ----------
const RM=matchMedia("(prefers-reduced-motion:reduce)");
const NARROW=matchMedia("(max-width:480px)");   // phone: shorter texts (walletPill); markup uses .more (desktop-only) / .less (phone-only) spans
function segThumbs(){
  const place=seg=>{
    const th=seg._thumb, on=seg.querySelector('button[aria-pressed="true"]'); if(!th) return;
    th.hidden=!on; if(!on||!seg.offsetWidth) return;                 // hidden dialog/step: placed when it becomes visible (ResizeObserver)
    const fresh=!th.style.width; if(fresh) th.style.transition="none";   // first placement snaps, later ones slide
    th.style.left=on.offsetLeft+"px"; th.style.top=on.offsetTop+"px"; th.style.width=on.offsetWidth+"px"; th.style.height=on.offsetHeight+"px";
    if(fresh){ void th.offsetWidth; th.style.transition=""; }
  };
  document.querySelectorAll(".seg").forEach(seg=>{
    if(!seg._thumb){
      const th=document.createElement("i"); th.className="thumb"; seg.prepend(th); seg._thumb=th;
      new MutationObserver(()=>place(seg)).observe(seg,{attributes:true,attributeFilter:["aria-pressed"],subtree:true});
      if("ResizeObserver" in window){ const ro=new ResizeObserver(()=>place(seg)); ro.observe(seg); seg.querySelectorAll("button").forEach(b=>ro.observe(b)); }   // buttons too: a late web font widens them without moving the seg box
    }
    place(seg);
  });
  if(!segThumbs.bound){ segThumbs.bound=true; const all=()=>document.querySelectorAll(".seg").forEach(place); addEventListener("resize",all); document.fonts?.ready.then(all); }
}

// ---------- network chip: shows NET; a tiny menu switches to the other network (host label, else remembered in bv.net) ----------
function netSwitch(to){
  const h=location.hostname, u=new URL(location.href);
  if(/^(mainnet|signet|testnet)\./.test(h)){ u.hostname=h.replace(/^(mainnet|signet|testnet)\./, to+"."); location.href=u.href; return; }   // same path, search and hash
  try{ localStorage.setItem("bv.net",to); }catch{}
  u.searchParams.delete("net");
  if(u.href===location.href) location.reload(); else location.href=u.href;
}
(()=>{
  const pill=$("netpill"), menu=$("netmenu"); if(!pill||!menu) return;
  $("nettxt").textContent=NET; pill.classList.toggle("test",NET!=="mainnet"); pill.title="Bitcoin network: "+NET;
  const close=()=>{ menu.hidden=true; pill.setAttribute("aria-expanded","false"); };
  menu.querySelectorAll("[data-net]").forEach(b=>{ const on=b.dataset.net===NET; b.setAttribute("aria-checked",String(on)); b.onclick=()=>{ close(); if(!on) netSwitch(b.dataset.net); }; });
  pill.onclick=e=>{ e.stopPropagation(); const open=menu.hidden; menu.hidden=!open; pill.setAttribute("aria-expanded",String(open)); if(open) menu.querySelector('[aria-checked="true"]').focus(); };
  document.addEventListener("click",e=>{ if(!menu.hidden&&!menu.contains(e.target)) close(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!menu.hidden){ close(); pill.focus(); } });
})();

// ---------- a small menu under a button (aria-expanded + hidden): closes on outside click and Escape. -> close() ----------
function dropMenu(btn,menu){
  const close=()=>{ menu.hidden=true; btn.setAttribute("aria-expanded","false"); };
  btn.onclick=e=>{ e.stopPropagation(); const open=menu.hidden; menu.hidden=!open; btn.setAttribute("aria-expanded",String(open)); if(open) menu.querySelector("button")?.focus(); };
  document.addEventListener("click",e=>{ if(!menu.hidden&&!menu.contains(e.target)) close(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!menu.hidden){ close(); btn.focus(); } });
  menu.addEventListener("keydown",e=>{                                     // arrow keys walk the items, like a native menu
    const items=[...menu.querySelectorAll('[role="menuitem"]:not([disabled])')], i=items.indexOf(document.activeElement); if(!items.length) return;
    const to = e.key==="ArrowDown"?(i+1)%items.length : e.key==="ArrowUp"?(i-1+items.length)%items.length : e.key==="Home"?0 : e.key==="End"?items.length-1 : -1;
    if(to>=0){ e.preventDefault(); items[to].focus(); }
  });
  return close;
}

// ---------- dialogs ----------
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll("dialog").forEach(d=>{
  d.addEventListener("click",e=>{ if(e.target===d) d.close(); });           // click on the backdrop dismisses (the .dlg card fills the dialog box)
  d.addEventListener("close",()=>document.documentElement.style.overflow="");
  new MutationObserver(()=>{ if(d.open) document.documentElement.style.overflow="hidden"; }).observe(d,{attributes:true,attributeFilter:["open"]});
});
