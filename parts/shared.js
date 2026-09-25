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
// ---------- snapshots: static JSON a host may publish (spec §6), same shape as a finished scan, so a cold page starts from disk instead of the explorer ----------
const SNAPDIR="snapshots/"+NET+"/";
const snapshotKey=async name=>toHex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(name))));   // file name = hex sha256 of the canonical topic name
const snapshotGet=async url=>{ try{ if(typeof fetch!=="function") return null; const r=await fetch(url,{cache:"no-cache"}); if(!r.ok) return null; return await r.json(); }catch{ return null; } };   // any failure = no snapshot
let SNAPIDX=null;                                       // the index is fetched once per page: it says which topics have a snapshot file, so an unsnapshotted topic never 404s
const snapshotIndex=()=>SNAPIDX||(SNAPIDX=snapshotGet(SNAPDIR+"index.json").then(j=>j&&Array.isArray(j.topics) ? j : null));                                            // -> Promise<{height, topics:[{name, sats, votes, active, reg, listings}]} | null>
const snapshotFetch=async name=>{ const idx=await snapshotIndex(); if(idx&&!idx.topics.some(t=>t.name===name)) return null;
  const j=await snapshotGet(SNAPDIR+(await snapshotKey(name))+".json"); return j&&j.net===NET&&Array.isArray(j.votes) ? j : null; };   // -> {name, net, height, count, votes:[{txid,t,sats,h,from}]} | null
// ---------- explorer endpoint: an Esplora API base per network, overridable from the Data source row (index page) ----------
const ESPLORA_PRESETS={ mempool:{mainnet:"https://mempool.space/api", signet:"https://mempool.space/signet/api"}, blockstream:{mainnet:"https://blockstream.info/api", signet:null} };   // null: the preset has no server for that network
const esploraDefault=net=>ESPLORA_PRESETS.mempool[net]||ESPLORA_PRESETS.mempool.signet;
const esploraOverride=()=>{ const v=(LS(NETKEY("bv.endpoint"))||"").trim(); if(!v) return ""; if(ESPLORA_PRESETS[v]) return ESPLORA_PRESETS[v][NET]||""; return /^https?:\/\//.test(v) ? v.replace(/\/+$/,"") : ""; };   // stored: preset id or a full API base URL
const esploraFor=net=>esploraOverride()||esploraDefault(net);                                   // what this page reads the chain through
const esploraSet=v=>{ LS(NETKEY("bv.endpoint"),v||""); globalThis.ESPLORA_OVERRIDE_URL=esploraOverride(); };   // v: "" (mempool default) | "blockstream" | "https://…/api"
globalThis.ESPLORA_OVERRIDE_URL=esploraOverride();                                              // read by wallet.js esploraBase()
// ---------- the chain: every number on every page is read from the explorer above (Esplora API), cached in IndexedDB (db.js) ----------
const API_PAGE=25;                                                     // confirmed transactions per history page (Esplora)
// With no explorer of your own, the default one and then the other public one: whichever answered last goes first (remembered an hour),
// so a blocked or down explorer costs one timeout, not every page. The wallet (wallet.js esploraBase) follows the same choice.
let LIVE_BASE=(()=>{ try{ const j=JSON.parse(LS(NETKEY("bv.livebase"))||"null"); return j&&Date.now()-j.at<3600000 ? j.base : null; }catch{ return null; } })();
const chainBases=()=>{ const own=esploraOverride(); return own ? [own] : [...new Set([LIVE_BASE, ESPLORA_PRESETS.mempool[NET], ESPLORA_PRESETS.blockstream[NET]].filter(Boolean))]; };
async function chainGet(path,{text=false}={}){                         // GET explorer + path -> JSON (or text); throws when no explorer gives an answer
  let err;
  for(const base of chainBases()){
    for(let i=0;i<4;i++){
      if(i) await sleep(800*2**(i-1));                                    // a busy explorer: 0.8 s, 1.6 s, 3.2 s
      let r;
      try{ r=await fetch(base+path, typeof AbortSignal!=="undefined"&&AbortSignal.timeout ? {signal:AbortSignal.timeout(10000)} : {}); }
      catch(e){ err=e; break; }                                          // unreachable (offline, blocked, too slow): the next explorer
      if(r.ok){ if(base!==LIVE_BASE&&!esploraOverride()){ LIVE_BASE=base; LS(NETKEY("bv.livebase"),JSON.stringify({base, at:Date.now()})); if(typeof dispatchEvent==="function") dispatchEvent(new Event("chainbase")); }
        return text ? (await r.text()).trim() : await r.json(); }
      err=new Error(`the explorer answered ${r.status}`); err.status=r.status;
      if(r.status!==429 && r.status<500) throw err;                       // a 4xx is the answer, whoever is asked
    }
  }
  throw err;
}
TIP=+(LS(NETKEY("bv.tip"))||0);                                         // the last tip this browser saw: windows and countdowns work at once, the fresh one lands a moment later
const tipRefresh=async()=>{ try{ const h=+(await chainGet("/blocks/tip/height",{text:true})); if(Number.isInteger(h)&&h>0){ TIP=h; LS(NETKEY("bv.tip"),String(h)); } }catch{} return TIP; };
let TIPP=null, PRICEP=null;
const tipReady=()=>TIPP||(TIPP=tipRefresh());                          // started by loader.js on every app page
const priceReady=()=>PRICEP||(PRICEP=NET!=="mainnet"||chainBases()[0]!==ESPLORA_PRESETS.mempool.mainnet ? Promise.resolve() : chainGet("/v1/prices").then(j=>{ if(+j.USD>0) BTCUSD=+j.USD; },()=>{}));   // only mempool.space serves a USD price: with another explorer the dollar hints stay hidden
const usdOf=sats=>BTCUSD ? "≈ $"+(sats/1e8*BTCUSD).toFixed(2) : "";
// ---------- the mining fee: the explorer's live estimates (Esplora /fee-estimates: {blocks ahead: sat/vB}), one speed chosen per network ----------
// Signet miners have been taking only 2 sat/vB and up while the estimates said 1: a burn at the minimum waited for days. Signet gets a floor of 2.
const FEE_SPEEDS=[["fast","Fast",1],["normal","Normal",6],["eco","Economy",144]];   // [id, label, target in blocks]
const FEE_FLOOR=NET==="signet"?2:1, FEE_FALLBACK=NET==="signet"?{fast:4,normal:3,eco:2}:{fast:5,normal:3,eco:1};   // no estimates: a guess that still confirms
let FEES=null, FEESAT=0, FEEP=null;
const feeRefresh=async()=>{ FEESAT=Date.now();
  try{ const j=await chainGet("/fee-estimates"), ks=Object.keys(j).map(Number).filter(n=>+j[n]>0).sort((a,b)=>a-b); if(!ks.length) return FEES;
    let prev=Infinity; const out={};
    for(const [id,,t] of FEE_SPEEDS){ const k=ks.find(n=>n>=t)??ks[ks.length-1]; out[id]=prev=Math.min(prev, Math.max(FEE_FLOOR, Math.ceil(+j[k]*10)/10)); }   // rounded up, never faster for less
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
try{ const e=new URLSearchParams(location.search).get("endpoint"); if(e!==null) esploraSet(e.trim()); }catch{}   // ?endpoint=https://your-node/api (or blockstream, or empty for the default) sets it for this network and sticks (node.html)
// ---------- watchlist: topics this browser follows, with the count/height last seen (per network) ----------
const watchGet=()=>{ try{ const a=JSON.parse(LS(NETKEY("bv.watch"))||"[]"); return Array.isArray(a)?a.filter(w=>w&&typeof w.name==="string"):[]; }catch{ return []; } };   // -> [{name, seenH, seenCount}]
const watchSave=a=>{ try{ LS(NETKEY("bv.watch"),JSON.stringify(a)); }catch{} };
const watchHas=name=>watchGet().some(w=>w.name===name);
const watchToggle=name=>{ const a=watchGet(), i=a.findIndex(w=>w.name===name); if(i>=0) a.splice(i,1); else a.push({name, seenH:0, seenCount:0}); watchSave(a); return i<0; };   // -> true when now watched
const watchMarkSeen=(name,count,height)=>{ const a=watchGet(), w=a.find(x=>x.name===name); if(!w) return; w.seenCount=count; w.seenH=height; watchSave(a); };
// ---------- ballot: several burns kept aside, paid in one transaction (per network) ----------
const ballotGet=()=>{ try{ const a=JSON.parse(LS(NETKEY("bv.ballot"))||"[]"); return Array.isArray(a)?a.filter(e=>e&&typeof e.name==="string"&&typeof e.addr==="string"):[]; }catch{ return []; } };   // -> [{name, addr, statement, sats, intent}], intent on root burns only: "register" | "feature"
const ballotSave=a=>{ try{ LS(NETKEY("bv.ballot"),JSON.stringify(a)); }catch{} };
const ballotAdd=({name,addr,statement="",sats,intent})=>{ const a=ballotGet(); a.push({name, addr, statement:String(statement||""), sats:Math.max(0,Math.round(+sats||0)), intent:name?undefined:intent==="feature"?"feature":"register"}); ballotSave(a); return a.length; };
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
const label = name => { const p=parseScope(name), tags=[];
  if(p.opts) tags.push("poll · "+esc(p.opts.join(" | "))); if(p.range) tags.push(`number · ${nfc(p.range[0])} – ${nfc(p.range[1])}`);
  if(p.deadline) tags.push(p.deadline>TIP?`closes in ${fmt(p.deadline-TIP)} blocks`:"closed"); if(p.min) tags.push(`min ${fmt(p.min)} sats`);
  return esc(p.q) + tags.map(t=>` <span class="pill" style="padding:1px 7px;font-size:11px">${t}</span>`).join(""); };
const kind = p => p.range ? "number" : p.opts ? (p.opts.length===2?"duel":"poll") : "open";
// ---------- one way to name, count and time a topic, for Explore and the topic page alike ----------
const kindWord = p => { const k=kind(p); return k==="duel" ? (p.opts.join("|")==="yes|no"?"yes-no":"duel") : k==="poll" ? `poll · ${p.opts.length} options` : k; };   // open, yes-no, duel, poll · N options, number
const topicName = (name,hash=true) => { const p=parseScope(name); return (hash?"#":"")+esc(p.q)+(p.opts||p.range?"?":""); };   // "#general", "#paris-cars?"  (escaped HTML)
const numOf = t => { const m=norm(String(t)).match(/^(-?\d+(?:\.\d+)?)([km])?$/); return m ? +m[1]*(m[2]==="k"?1e3:m[2]==="m"?1e6:1) : NaN; };   // spec §5: "150k" = 150000
const untilText = blocks => { const m=Math.max(0,Math.round(blocks*10)), d=Math.floor(m/1440), h=Math.floor(m%1440/60); return d?`${d}d ${h}h`:h?`${h}h ${m%60}m`:`${m}m`; };   // blocks at ~10 min
const ICON_TAKE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>';   // a take: a megaphone, said out loud
// ---------- icon badges (.fi, base.css), one visual language on every page: the shape says what (ICON_TAKE, a megaphone, for any burn's take or answer,
// ✦ a sponsorship, a flame most burned, a clock the latest, a person a burner, # a registration), the tint which kind of burn (ember a take, red most burned, gold a sponsorship, slate a burner, grey a registration) ----------
const svgIcon = (d,fill) => `<svg width="16" height="16" viewBox="0 0 24 24" ${fill?'fill="currentColor"':'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${d}</svg>`;
const ICONS = {
  top: svgIcon('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),   // most burned: a flame
  latest: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),                   // the latest: a clock
  feature: "✦",                                                                                   // a sponsorship (the key keeps the data's word: intent "feature")
  burner: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
  join: svgIcon('<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>'),   // a new burner
  reg: svgIcon('<path d="M10 4 8 20M16 4l-2 16M5 9h15M4 15h15"/>'),                               // a name gets registered
};
const iconBadge = (cls,icon) => `<span class="fi${cls?" "+cls:""}" aria-hidden="true">${icon}</span>`;
// ---------- RECENT, the timeline on Explore (every topic) and on a topic page (that topic alone): the latest events whatever the window, four kinds, each with its icon and its word:
// a take (an answer outside open topics), a new topic (a name's first root burn registers it), a sponsorship (the root burns after it), a new burner (an address's first burn in these topics) ----------
function recentDigest(burns, roots){                         // burns: [{v, name}], roots: rootBurns() (loader.js; reg:true on a registration)
  const H=v=>v.h===null?1e12:v.h, by=(a,b)=>b.at-a.at, first={};
  for(const b of burns) if(b.v.from && !(first[b.v.from] && H(first[b.v.from].v)<=H(b.v))) first[b.v.from]=b;   // each burner's first burn
  return [...burns.map(b=>({kind:"burn", at:H(b.v), ...b})).sort(by).slice(0,3),
    ...roots.map(v=>({kind:v.reg?"reg":"feature", at:H(v), v, name:v.name})).sort(by).slice(0,2),
    ...Object.entries(first).map(([addr,b])=>({kind:"burner", at:H(b.v), ...b, addr})).sort(by).slice(0,2)].sort(by).slice(0,6);   // a digest: every kind gets a place, then time orders them
}
// every take and topic name links to its topic page. o.here: on the topic page a burn names its burner instead of the topic; o.take(html): the take with its top-take star, o.tag(v): late / below min
function recentRow(x, o={}){
  const v=x.v, when=v.h===null?"in the mempool":"block "+fmt(v.h), addr=a=>`<a href="burner.html#${esc(a)}" title="${esc(a)}">${esc(a.slice(0,6)+"…"+a.slice(-4))}</a>`, by=v.from?addr(v.from)+" · ":"";
  const href=`topic.html#${esc(x.name)}`, tn=`<a href="${href}">${topicName(x.name)}</a>`, topic=(html,cls="")=>`<a class="fa${cls}" href="${href}">${html}</a>`;
  const row=(kind,icon,word,meta,what,right="")=>`<div class="fr ${kind}"><span class="fi" aria-hidden="true">${icon}</span><span class="fm"><span class="ft">${word}</span> · ${meta}</span>${right}${what}<b>${fmt(v.sats)} sats</b></div>`;
  if(x.kind==="burn") return row("burn", ICON_TAKE, kind(parseScope(x.name))==="open"?"take":"answer", (o.here?(v.from?addr(v.from):"unknown burner"):tn)+" · "+when+(o.tag?o.tag(v):""),
    o.take?o.take(v,topic):topic(v.t?esc(v.t):"<i>no take</i>"), `<a class="frx" href="receipt.html#${esc(v.txid)}">receipt →</a>`);
  if(x.kind==="reg") return row("reg", ICONS.reg, "new topic", by+when, topic(topicName(x.name)+" registered"));
  if(x.kind==="feature") return row("feature", ICONS.feature, "sponsor", by+when, topic(topicName(x.name)+" sponsored"));
  return row("burner", ICONS.join, "new burner", `first burn in ${tn} · ${when}`, `<a class="fa" href="burner.html#${esc(x.addr)}" title="${esc(x.addr)}">${esc(x.addr.slice(0,6)+"…"+x.addr.slice(-4))} joined</a>`);
}
const satsShort = n => n<1e3 ? String(n) : n<1e4 ? (n/1e3).toFixed(1).replace(/\.0$/,"")+"k" : n<1e6 ? Math.round(n/1e3)+"k" : (n/1e6).toFixed(1).replace(/\.0$/,"")+"M";   // "210k" on buttons
// counted burns of one topic, with the topic page's rules: late and below-minimum burns do not count; poll and number answers
// are kept apart from off-list ones (on:false), and number answers merge by value ("150k" and "150000" are one row)
function tallyOf(name, votes){
  const p=parseScope(name), rows={}; let sats=0, burns=0;
  for(const v of votes){
    if(p.deadline && (v.h===null ? TIP+1>=p.deadline : v.h>=p.deadline)) continue;
    if(p.min && v.sats<p.min) continue;
    let key=norm(v.t), t=v.t, on=true;
    if(p.range){ const x=numOf(v.t); on=Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1]; if(on){ key="n:"+x; t=String(x); } }
    else if(p.opts) on=p.opts.includes(key);
    const r=rows[key]||(rows[key]={t, sats:0, burns:0, on}); r.sats+=v.sats; r.burns++;
    if(on){ sats+=v.sats; burns++; }
  }
  const list=Object.values(rows).sort((a,b)=>b.sats-a.sats);
  return {sats, burns, answers:list.filter(r=>r.on), other:list.filter(r=>!r.on)};
}
const weightedMedian = rows => { const tot=rows.reduce((a,r)=>a+r.sats,0); if(!tot) return null; let acc=0; for(const r of rows.slice().sort((a,b)=>numOf(a.t)-numOf(b.t))){ acc+=r.sats; if(acc>=tot/2) return numOf(r.t); } return null; };

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
const TIP_ADDRESSES={ mainnet:"bc1qh8a49dff2sjvlqjdtfau8ha6lr84u2pz5jtpmc", signet:null };   // project tip addresses per network; null hides every tip control on that network
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
  const set=args=>{ try{ last=buildPayload(args); }catch{ last=null; } tipnote.hidden=!(last&&last.tipOmitted); if(wtab) wtab.update(last); paint(); };
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
