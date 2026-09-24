// ---------- directory: scan the root scope once, then one summary request per scope ----------
let sq="", win=winGet();                                             // the time window: shared.js, remembered in this browser, also used by the topic boards
const inWin = v => v.h===null || v.h >= TIP-WIN[win];
// ponytail: windowed numbers come from the per-scope history scan, not the summary endpoint; stub votes stand in here
const allVotes = name => cache[name] || (cache[name]=stubVotes(name));
const winVotes = name => allVotes(name).filter(inWin);
// counted exactly like the topic page (tallyOf, shared.js), so both pages show the same sats. d.stats only says the summary has arrived
const tally = d => !d.stats ? null : tallyOf(d.name, winVotes(d.name));
const tallyAll = d => !d.stats ? null : tallyOf(d.name, allVotes(d.name));
const loadedAll = () => DIRECTORY.every(d=>d.stats);
const kindLine = name => { const p=parseScope(name), k=kind(p), parts=[kindWord(p)];   // line 2 of a topic row: kind and rules, plain text
  if(k==="duel" && parts[0]==="duel") parts[0]="duel · "+p.opts.join(" | ");
  if(p.range) parts[0]+=` · ${nfc(p.range[0])} – ${nfc(p.range[1])}`;
  if(p.deadline) parts.push(p.deadline>TIP ? "closes in "+untilText(p.deadline-TIP) : "closed");
  if(p.min) parts.push(`min ${fmt(p.min)} sats`);
  return esc(parts.join(" · ")); };
const sqName = () => { const p=parseScope(sq); return {...p, q:p.q.trim().replace(/\s+/g,"-")}; };   // the search spelled like the New topic dialog spells names: spaces become hyphens
const searchMatches = () => { const nq=sqName().q; if(!nq) return [];                          // matches the part before "?"
  const m=DIRECTORY.map(d=>({d, q:parseScope(d.name).q})).filter(x=>x.q.includes(nq)), rank=x=>x.q===nq?0:x.q.startsWith(nq)?1:2, all=d=>tallyOf(d.name, allVotes(d.name)).sats;
  return m.sort((a,b)=>rank(a)-rank(b) || all(b.d)-all(a.d)).map(x=>x.d); };
document.querySelectorAll("#xseg [data-win]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.win===win)); b.onclick=()=>{
  document.querySelectorAll("#xseg [data-win]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  win=b.dataset.win; winSet(win); renderDir();
}; });
function renderDir(){
  const searching=!!sq;
  $("featuredstrip").hidden = searching || !DIRECTORY.length;          // browsing only: a search lists its matches in the rows
  if(!searching) renderFeatured();
  const matches=renderRows();
  $("hotcol").hidden = $("colR").hidden = searching || !DIRECTORY.length;
  $("cols2").classList.toggle("solo", searching);                     // a search: the matches take the full width
  if(!searching){ renderHot(); renderRecent(); renderFeatList(); renderBurners(); balanceHot(); }
  renderCreate(matches);
  renderStrips();
}
// ---------- SPOTLIGHT: three different topics, one per kind of attention, each led by its icon badge: ✦ sponsored, a flame for most burned (window), a clock for the latest burn ----------
// "Most burned" picks first so its label stays true; Sponsored and Latest burn then take the best topics not already shown
function renderFeatured(){
  const W=WINLABEL[win], used=new Set(), pick=list=>{ const d=list.find(x=>x&&!used.has(x.name)); if(d) used.add(d.name); return d; };
  const topD = loadedAll() ? pick(DIRECTORY.filter(d=>tally(d).sats>0).sort((a,b)=>tally(b).sats-tally(a).sats)) : null;   // none before every count is in
  const featD = pick(featuredRank(DIRECTORY.length).map(f=>DIRECTORY.find(d=>d.name===f.name)));
  const recD = pick([...DIRECTORY].sort((a,b)=>b.active-a.active));                     // ties keep directory order, like the home page's hot chips
  const takes=d=>{ const p=parseScope(d.name), T=tally(d);                               // top takes in the window; off-list answers never appear
    return !T ? '<span class="sk" style="width:70%"></span>'
      : !T.answers.length ? `<span class="nt">${win==="all"?"No takes yet":"No burns "+W}</span>`
      : p.range ? `<span class="row3 num"><b>median ${fmt(weightedMedian(T.answers))}</b><span class="m">${fmt(T.sats)}</span></span>`   // a number topic answers with a value, not a podium
      : T.answers.slice(0,3).map((t,j)=>`<span class="row3"><i class="rk">${String(j+1).padStart(2,"0")}</i><b>${esc(t.t)}</b><span class="m">${fmt(t.sats)}</span></span>`).join(""); };
  const card=(d,type,badge,label,big,cap,lead)=>`
    <a class="card fcard sp-${type}" href="topic.html#${esc(d.name)}">
      <span class="fhead">${badge}<span class="ktype">${label}</span><span class="name">${topicName(d.name,false)}</span></span>
      <span class="big">${big}<small><span class="more">${cap}</span><span class="less">sats</span></small></span>
      <span class="lead">${lead}</span>
    </a>`;
  const out=[];
  if(featD) out.push(card(featD,"feat",iconBadge("feature",ICONS.feature),"Sponsored",fmt(featD.reg),"sats · sponsored",takes(featD)));
  out.push(topD ? card(topD,"top",iconBadge("top",ICONS.top),"Most burned",fmt(tally(topD).sats),`sats · ${W}`,takes(topD))
    : `<div class="card fcard ghost"><span class="fhead">${iconBadge("top",ICONS.top)}<span class="ktype">Most burned</span><span class="name"><span class="sk" style="width:55%;height:18px"></span></span></span><span class="big"><span class="sk" style="width:110px;height:22px"></span></span><span class="lead"><span class="sk" style="width:80%"></span></span></div>`);
  if(recD){ const seenT=new Set(), L=allVotes(recD.name).slice().sort((a,b)=>H(b)-H(a)).filter(x=>{ const k=norm(x.t); if(seenT.has(k)) return false; seenT.add(k); return true; }).slice(0,3), v=L[0];   // its newest takes, one line each, the mempool first
    out.push(card(recD,"recent",iconBadge("",ICONS.latest),"Latest burn", v?fmt(v.sats):"—", v?`sats · ${whenH(v.h)}`:"no burns yet",
      L.map(x=>`<span class="row3 lt"><b>${x.t?esc(x.t):"<i>no take</i>"}</b><span class="m">${whenH(x.h)}</span></span>`).join(""))); }
  $("scopegrid").innerHTML=out.join("");
}
// ---------- MOST BURNED (window) while browsing, or the matches of a search (all time) ----------
function renderRows(){
  const host=$("scoperows"), all=loadedAll();
  if(!DIRECTORY.length){ host.innerHTML=`<div class="emptybox">No topics registered yet</div>`; return []; }
  let list, head, sats, ranked;
  if(sq){ list=searchMatches(); sats=tallyAll; ranked=false;
    head=list.length?`<div class="divider">${list.length} matching topic${list.length===1?"":"s"} · all time</div>`:""; }
  else { sats=tally; ranked=all;
    list = all ? DIRECTORY.filter(d=>tally(d).sats>0).sort((a,b)=>tally(b).sats-tally(a).sats) : [...DIRECTORY];   // no 0-sat rows, and no rank before every count is in
    head=`<div class="divider">Most burned · ${WINLABEL[win]}</div>`;
    if(all && !list.length){ host.innerHTML=head+`<p class="quiet">No burns ${WINLABEL[win]}. Pick <button type="button" class="linkbtn" data-win-all>All time</button> to see every burn.</p>`; return []; } }
  const rows=sq?list:list.slice(0,5);                                    // browsing: the top 5; a search: every match
  host.innerHTML = head + rows.map((d,i)=>{ const S=sats(d); return `
    <a class="srow" href="topic.html#${esc(d.name)}">
      <span class="rank">${ranked?String(i+1).padStart(2,"0"):""}</span>
      <span class="nm">${topicName(d.name)}</span>
      <span class="kl">${kindLine(d.name)}</span>
      <span class="sats">${S?fmt(S.sats)+" sats":'<span class="sk" style="width:90px"></span>'}</span>
      <span class="v">${S?S.burns+(S.burns===1?" burn":" burns"):'<span class="sk" style="width:50px;height:9px"></span>'}</span>
    </a>`; }).join("");
  return list;
}
$("scoperows").addEventListener("click",e=>{
  if(e.target.closest("[data-win-all]")) $("xseg").querySelector('[data-win="all"]').click();
});
// ---------- a searched name that is not registered: one line under the matches, or the panel when nothing matches ----------
function renderCreate(matches){
  const cr=$("createrow"), name=unregName(), show=!!sq && !!parseScope(sq).q && !DIRECTORY.some(d=>d.name===name);
  cr.hidden=!show; cr.classList.toggle("compact", show && matches.length>0);
  $("newscope").hidden=show;                                            // one filled button at a time: Register takes over from + New topic
  if(show){ $("createname").innerHTML=topicName(name); $("openunreg").href="topic.html#"+name; }   // a real <a>: script-driven navigation does not work in the hosted viewer
}
// ---------- activity: single burns and sponsorships across topics, inside the window ----------
// ponytail: the root topic's burns (registering and sponsoring are one act) are stubbed from DIRECTORY; the real page reads them from the root scan it already makes
let ROOTB=null;
const rootBurns=()=>ROOTB||(ROOTB=DIRECTORY.flatMap(d=>{
  const rnd=mulberry32(fnv1a("root:"+d.name)), w=Array.from({length:Math.max(1,d.listings)},()=>0.3+rnd()), tw=w.reduce((a,x)=>a+x,0), sats=w.map(x=>Math.round(d.reg*x/tw));
  sats[0]+=d.reg-sats.reduce((a,x)=>a+x,0);                                       // they add up to the sponsor score
  return sats.map((s,i)=>({txid:toHex(Array.from({length:32},()=>Math.floor(rnd()*256))), name:d.name, t:d.name, sats:s, h:i?d.last-1-Math.floor(rnd()*6000):d.last, from:burners()[Math.floor(rnd()*40)]}));
}));
const short=a=>a.slice(0,6)+"…"+a.slice(-4), whenH=h=>h===null?"in the mempool":"block "+fmt(h), H=v=>v.h===null?1e12:v.h;
const listCol=(head,rows,hint="")=>{ const h=`<div class="divider">${head} · ${WINLABEL[win]}</div>`;   // hint: a link at the heading's right end
  return `<div class="burnercol">${hint?`<div class="striphead">${h}${hint}</div>`:h}${rows.join("")||`<span class="note">none ${WINLABEL[win]}</span>`}</div>`; };
// ---------- HOTTEST TAKES: each topic's leading take in the window, ranked by its sats (one row per topic), drawn for its kind ----------
function renderHot(){
  const rows=DIRECTORY.map(d=>{ const T=tallyOf(d.name, winVotes(d.name)); return T.answers.length&&{d, T}; })
    .filter(Boolean).sort((a,b)=>b.T.answers[0].sats-a.T.answers[0].sats).slice(0, ONE_COLUMN.matches?5:DIRECTORY.length);   // desktop: every topic, trimmed by balanceHot to the right column's height
  $("hotcol").innerHTML = listCol("Hottest takes", rows.map(hotRow));
}
// the row says the take, the bar where it stands: its share (open), the split (duel), every option (poll), its place in the range (number)
function hotRow({d,T}){
  const p=parseScope(d.name), k=kind(p), t=T.answers[0], pc=s=>T.sats?s/T.sats*100:0, lead=p.opts?norm(t.t):t.t;
  let text=esc(lead), bar;
  if(k==="number"){ const x=numOf(t.t), [lo,hi]=p.range;
    text=`${x.toLocaleString("en-US")}<span class="vs"> in ${nfc(lo)} – ${nfc(hi)}</span>`;
    bar=`<span class="viz num" title="${fmt(x)} on ${fmt(lo)} – ${fmt(hi)}"><i style="left:${hi>lo?(x-lo)/(hi-lo)*100:50}%"></i></span>`; }
  else if(k==="open") bar=`<span class="viz"><i style="width:${pc(t.sats)}%"></i></span>`;
  else { if(k==="duel") text+=`<span class="vs"> vs ${esc(p.opts.find(o=>o!==lead))}</span>`;   // T.answers: the options that got burns, the leader first
    bar=`<span class="viz" title="${esc(T.answers.map(r=>`${norm(r.t)} ${pc(r.sats).toFixed(0)}%`).join(" · "))}">${T.answers.map((r,i)=>`<i${i?' class="b"':""} style="flex:${r.sats}"></i>`).join("")}</span>`; }
  return `<div class="bchip lb ic hk">${iconBadge("",ICON_TAKE)}<a class="lbt" href="topic.html#${esc(d.name)}">${text}</a><b>${fmt(t.sats)} sats</b>
    <span class="m">${topicName(d.name)} · ${t.burns} burn${t.burns===1?"":"s"}</span><span class="hv" title="its share of the topic's sats">${bar}${pc(t.sats).toFixed(0)}%</span></div>`;
}
// the left column (hottest takes, most burned) ends where the right one (biggest sponsorships, recent, top burners) ends: hottest takes gives up rows, never below 5
const ONE_COLUMN=matchMedia("(max-width:860px)");
function balanceHot(){
  if(ONE_COLUMN.matches) return;
  const rows=[...$("hotcol").querySelectorAll(".bchip")], L=$("colL"), R=$("colR");
  for(let n=rows.length; n>5 && L.offsetHeight>R.offsetHeight+6; ) rows[--n].remove();
}
ONE_COLUMN.addEventListener("change",()=>renderDir());
// ---------- RECENT: a timeline of what just happened (not windowed), three kinds of entries, each with its icon and its word ----------
function renderRecent(){
  const by=(a,b)=>b.at-a.at, first={};                                                  // the latest events, whatever the window: a timeline is already ordered by time
  const burns=DIRECTORY.flatMap(d=>allVotes(d.name).map(v=>({kind:"burn", at:H(v), v, name:d.name}))).sort(by);
  const feats=rootBurns().map(v=>({kind:"feature", at:H(v), v, name:v.name})).sort(by);
  for(const d of DIRECTORY) for(const v of allVotes(d.name)) if(v.from && !(first[v.from] && H(first[v.from].v)<=H(v))) first[v.from]={v, name:d.name};   // each burner's first burn ever
  const joins=Object.entries(first).map(([addr,f])=>({kind:"burner", at:H(f.v), v:f.v, name:f.name, addr})).sort(by);
  const items=[...burns.slice(0,3), ...feats.slice(0,2), ...joins.slice(0,2)].sort(by).slice(0,6);   // a digest: every kind gets a place, then time orders them
  const row=x=>{ const v=x.v, when=whenH(v.h);   // a timeline entry: kind and time first, then what happened and its sats
    if(x.kind==="burn") return `<div class="fr burn"><span class="fi">${ICON_TAKE}</span>
      <span class="fm"><span class="ft">burn</span> · ${topicName(x.name)} · ${when}</span><a class="frx" href="receipt.html#${esc(v.txid)}">receipt →</a>
      <a class="fa" href="topic.html#${esc(x.name)}">${v.t?esc(v.t):"<i>no take</i>"}</a><b>${fmt(v.sats)} sats</b></div>`;
    if(x.kind==="feature") return `<div class="fr feature"><span class="fi" aria-hidden="true">✦</span>
      <span class="fm"><span class="ft">sponsor</span> · ${v.from?`<a href="burner.html#${esc(v.from)}" title="${esc(v.from)}">${esc(short(v.from))}</a> · `:""}${when}</span>
      <a class="fa" href="topic.html#${esc(x.name)}">${topicName(x.name)} sponsored</a><b>${fmt(v.sats)} sats</b></div>`;
    return `<div class="fr burner"><span class="fi">${ICONS.join}</span>
      <span class="fm"><span class="ft">new burner</span> · first burn in ${topicName(x.name)} · ${when}</span>
      <a class="fa" href="burner.html#${esc(x.addr)}" title="${esc(x.addr)}">${esc(short(x.addr))} joined</a><b>${fmt(v.sats)} sats</b></div>`; };
  $("recentcol").innerHTML = `<div class="burnercol"><div class="divider"><span class="hot" title="Live: each new block adds its burns here">Recent</span></div>${items.length ? `<div class="tl">${items.map(row).join("")}</div>` : `<span class="note">nothing yet</span>`}</div>`;
}
// ---------- BIGGEST SPONSORSHIPS: the largest single burns to the root topic in the window ----------
function renderFeatList(){
  const featRow=v=>`<div class="bchip lb ic">${iconBadge("feature",ICONS.feature)}<a class="lbt" href="topic.html#${esc(v.name)}">${topicName(v.name)}</a><b>${fmt(v.sats)} sats</b><span class="m">${v.from?`<a href="burner.html#${esc(v.from)}" title="${esc(v.from)}">${esc(short(v.from))}</a> · `:""}${whenH(v.h)}</span></div>`;
  $("featcol").innerHTML = listCol("Biggest sponsorships", rootBurns().filter(inWin).sort((a,b)=>b.sats-a.sats).slice(0,5).map(featRow), `<a class="hint" href="spec.html#featured">✦ how sponsoring works</a>`);
}
// ---------- TOP BURNERS inside the window (new and latest burners live in Recent) ----------
function renderBurners(){
  const by={};
  for(const d of DIRECTORY) for(const v of winVotes(d.name)){ if(!v.from) continue; const b=by[v.from]||(by[v.from]={addr:v.from,sats:0,burns:0}); b.sats+=v.sats; b.burns++; }
  $("topburners").innerHTML = listCol("Top burners", Object.values(by).sort((a,b)=>b.sats-a.sats).slice(0,5).map(b=>`<a class="bchip br ic" href="burner.html#${esc(b.addr)}" title="${esc(b.addr)}">${iconBadge("burner",ICONS.burner)}<span class="ad">${esc(short(b.addr))}</span><span class="m">${b.burns} burn${b.burns===1?"":"s"}</span><b>${fmt(b.sats)} sats</b></a>`));
}
// ---------- Watching strip over the search bar: this browser's watchlist, with the burns since the last visit ----------
function renderStrips(){
  const w=watchGet();                                                 // [{name, seenH, seenCount}], newest last
  $("watching").hidden = !w.length;
  $("watchline").innerHTML = w.slice().reverse().map(x=>{
    const d=DIRECTORY.find(t=>t.name===x.name), cnt=d&&d.stats?d.stats.votes:null;   // the summary count (snapshot index / cache / scan); unknown for an unregistered name
    const unread= cnt===null ? 0 : Math.max(0,cnt-(x.seenCount||0));
    return `<span class="wchip${d?"":" unreg"}" title="${d?esc(x.name):"not registered · "+esc(x.name)}"><a href="topic.html#${esc(x.name)}"><span>${topicName(x.name)}</span>${unread?`<b class="new" title="${unread} burn${unread===1?"":"s"} since your last visit">+${fmt(unread)}</b>`:""}</a><button type="button" class="x" data-unwatch="${esc(x.name)}" aria-label="Stop watching ${topicName(x.name)}">✕</button></span>`;
  }).join("");
}
$("watchline").onclick=e=>{ const b=e.target.closest("[data-unwatch]"); if(!b) return; watchToggle(b.dataset.unwatch); renderDir(); toast("No longer watching"); };
const unregName=()=>canonical(sqName());                        // the searched name as the topic page will spell it (one question, one address)
addEventListener("storage",e=>{ if(e.key===NETKEY("bv.watch")) renderDir(); });   // watched from the topic page in another tab
$("sq").oninput=e=>{sq=e.target.value.trim().toLowerCase(); renderDir()};
if(matchMedia("(max-width:480px)").matches) $("sq").placeholder="Search or name a topic";
renderDir();
// sync line under the title, same voice as the topic page: root scan, then one summary request per topic
let warmDir=false; summaryWarm().then(w=>{ warmDir=w; if(w){ renderDir(); dirStatus(); } });   // snapshot index, else the last known totals: no skeletons
let dirDone=0;
const dirStatus=()=>{
  const n=DIRECTORY.length;
  $("dirstatus").innerHTML = dirDone<n
    ? (warmDir ? `<span class="dot"></span> synced · block ${fmt(TIP)} · ${n} topics` : `<span class="spin"></span> counting · ${dirDone} of ${n} topics`)   // warm: the counts are already in
    : `<span class="dot"></span> synced · block ${fmt(TIP)} · ${n} topics`;
};
dirStatus();
DIRECTORY.forEach(async d=>{ await sleep(250+Math.random()*900); d.stats=STATS[d.name]; dirDone++; renderDir(); summarySave(); dirStatus(); });   // then refresh quietly
const spay=payPanel("spay"); PAY.push(spay);
const nfm=x=>Math.abs(+x)>=10000?fmt(+x):String(x);   // separators for big numbers, years/percentages stay bare
$("listtipaddr").textContent=TIP_EFFECTIVE || "not set yet · left out"; $("copylisttip").dataset.copy=TIP_EFFECTIVE||""; $("copylisttip").disabled=!TIP_EFFECTIVE;
// effective registration amounts: burn checkbox off = no registration output, tip checkbox off = no tip output
const regSats=()=>REG_SATS;   // shared.js: a fixed registration burn; the amount is chosen when sponsoring
const regTipSats=()=>TIP_EFFECTIVE&&$("listtipon").checked ? Number($("listtip").value||0) : 0;   // no tip address on this network → never a tip output
function updateList(){
  const n=$("listname").value.trim().toLowerCase();
  const data=enc.encode(n);
  $("listhex").textContent=toHex(opReturnScript(data));
  const ton=!!TIP_EFFECTIVE&&$("listtipon").checked, t=regTipSats();
  $("listtip").hidden=!ton; $("listtipoff").hidden=ton;
  $("listtipusd").textContent=t?"≈ $"+(t/1e8*BTCUSD).toFixed(2):"skipped";
  $("listtiprow").hidden=!t;
  spay.set({burnAddr:$("rootaddr").textContent, burnSats:regSats(), statementBytes:data, tipAddr:TIP_EFFECTIVE, tipSats:t});   // "…" until the root address is derived
}
$("listtipon").checked = !!TIP_EFFECTIVE && LS(NETKEY("bv.scope.tip"))!=="0";   // default: tip on — restored before the first updateList
if(!tipEnabled()){ $("listtipon").disabled=true; $("listtipoff").textContent="no tip address yet on "+NET; $("listtipf").hidden=true; $("listtiprow").hidden=true; }   // no tip address on this network: every tip control disappears (regTipSats() is 0)
deriveScope("").then(r=>{ $("rootaddr").textContent=r.addr; updateList(); });
$("listtip").oninput=updateList;
$("copyroot").onclick=()=>copyText($("rootaddr").textContent,$("copyroot"));
updateList();
$("copylisthex").onclick=()=>copyText($("listhex").textContent,$("copylisthex"));

// ---------- new scope dialog ----------
let sqtype="open";
let sqStep=1, sqMax=1, sqReg=false, sqSeen=new Set([1]);        // current step, highest step reached, register mode, steps visited
const sqSpec=()=>{
  const q=$("sqq").value.trim().toLowerCase().replace(/[?|@!]/g,"").replace(/\s+/g,"-");
  const p={q, opts:null, range:null, deadline:null, min:null};
  if (sqtype==="opts"){ const o=[...new Set($("sqopts").value.split(/\n|,/).map(norm).filter(Boolean))]; if(o.length>1) p.opts=o; }
  if (sqtype==="range" && $("sqlo").value!=="" && $("sqhi").value!==""){ p.range=[+$("sqlo").value,+$("sqhi").value].sort((a,b)=>a-b); }
  const dl=+$("sqdl").value; if (dl) p.deadline=TIP+dl;
  const mn=+$("sqmin").value; if (mn>0) p.min=mn;
  return p;
};
function sqValid(n){
  const p=sqSpec();
  if(n===1) return !!p.q && $("sqq").value.trim().length<=40;   // the question label is capped at 40 chars (maxlength); options and modifiers may still push the name past it
  if(n===2) return sqtype==="open" || (sqtype==="opts"&&!!p.opts) || (sqtype==="range"&&!!p.range&&p.range[0]!==p.range[1]);
  return true;                                   // 3 Review and 4 Transaction: nothing to fill in
}
const sqCanReach=n=>{ for(let k=1;k<n;k++) if(!sqValid(k)) return false; return n<=sqMax; };
function sqGo(n){
  if(n===2 && !sqTouched && sqSug) applySuggestion(sqSug);          // untouched answers: take the guess, the user can still change it
  sqStep=n; sqMax=Math.max(sqMax,n); sqSeen.add(n);
  for(let k=1;k<=4;k++) $("sqstep-"+k).hidden=k!==n;
  sqPaint(); segThumbs();                                              // a seg inside the revealed step gets its thumb placed now
  $("scopedlg").querySelector(".dlg").scrollTop=0;
  const first=[...$("sqstep-"+n).querySelectorAll("input:not([type=hidden]):not(:disabled),textarea,select")].find(el=>!el.closest("[hidden]"));
  (first||$("sqfoot").querySelector(".primary:not([hidden])")||$("sqback")).focus({preventScroll:true});
}
const setDisabled=(a,off)=>{ a.classList.toggle("disabled",off); a.setAttribute("aria-disabled",String(off)); };   // anchors have no .disabled
function sqPaint(){                              // stepper + footer, idempotent, called by sqRender and sqGo
  document.querySelectorAll("#sqsteps li").forEach((li,i)=>{ const k=i+1, b=li.firstElementChild;
    li.dataset.state = k===sqStep?"current" : sqSeen.has(k)&&sqValid(k)&&sqCanReach(k)?"done":"todo";
    if(k===sqStep) b.setAttribute("aria-current","step"); else b.removeAttribute("aria-current");
    const off=k!==sqStep&&!sqCanReach(k); b.setAttribute("aria-disabled",String(off)); b.tabIndex=off?-1:0;
  });
  $("sqback").hidden=sqStep===1;
  $("sqnext").hidden=sqStep>=3; $("sqnext").disabled=!sqValid(sqStep);
  const tooLong=enc.encode(canonical(sqSpec())).length>80;   // root-scope statements are OP_RETURN payloads: 80 bytes. The Transaction step says so and its Done stays disabled
  $("openscope").hidden=sqStep!==3; setDisabled($("openscope"),!canonical(sqSpec())||!sqValid(3));   // Transaction step: Add to batch takes its place
  $("togglereg").hidden=sqStep!==3;
  const regPrimary=sqReg&&sqStep===3, reg4=sqStep===4;   // register mode: on Review the primary action is Register; on Transaction it is the wallet action
  $("togglereg").classList.toggle("primary",regPrimary); $("togglereg").textContent=regPrimary?"Register →":"Register on the root topic"; $("sqfoot").insertBefore($("togglereg"), regPrimary?$("sqnext"):$("openscope"));   // the primary is always the last footer button
  $("openscope").classList.toggle("primary",!regPrimary);
  $("openscope").textContent= regPrimary?"Open without registering":"Open topic →";
  $("sqsend").hidden=!reg4; if(reg4) walletPrimary($("sqsend"), spay.wallet, ()=>$("scopedlg").close(), sqValid(4)&&!tooLong);   // Connect a wallet / Unlock wallet / Sign & broadcast / Done
  const wst=spay.wallet.status(); $("sqballot").hidden=!reg4 || !!(wst&&wst.kind!=="err"); $("sqballot").disabled=!sqValid(4) || tooLong || $("rootaddr").textContent.length<20;   // the other way out of Transaction: keep the registration aside, cast several burns at once
}
$("sqballot").onclick=()=>{                                          // registering = a burn to the root topic (name "") with the topic name as the statement
  const n=ballotAdd({name:"", addr:$("rootaddr").textContent, statement:$("listname").value.trim(), sats:regSats(), intent:"register"});
  $("scopedlg").close(); ballotPill(); toast(`Added to your batch · ${n} burn${n===1?"":"s"}`);
};
async function sqRender(){
  { const p=sqSpec(), parts=[], short=[]; if(p.deadline){ parts.push(`closes ${dlDate(p.deadline-TIP)}`); short.push(dlDate(p.deadline-TIP)); } if(p.min){ parts.push(`min ${fmt(p.min)} sats`); short.push(`${fmt(p.min)} sats`); } $("sqadvsum").innerHTML=`Advanced<span class="more"> · ${parts.length?parts.join(" · "):"no deadline · no minimum"}</span>${short.length?`<span class="less"> · ${short.join(" · ")}</span>`:""}`; }
  const p=sqSpec(), name=canonical(p), ql=$("sqq").value.trim().length, nb=enc.encode(name).length;
  $("sqqn").textContent=ql+" / 40"; $("sqqn").classList.toggle("over",ql>40);
  $("sqtoolong").hidden=$("sqtoolong2").hidden=nb<=80; $("sqtoolong").textContent=$("sqtoolong2").textContent=`Name is ${nb} bytes; 80 is the most that can be registered. Shorten the question or options.`;
  $("sqkind").textContent={open:"free text",opts:p.opts?(p.opts.length===2?"duel":"poll"):"needs 2+ options",range:p.range?"number":"needs a range"}[sqtype];
  $("sqoptsf").hidden=sqtype!=="opts"; $("sqrangef").hidden=sqtype!=="range";
  $("sqdlhint").textContent=p.deadline?`≈ ${dlDate(p.deadline-TIP)}`:"never";
  $("sqname").textContent=name||"…";
  const typed=$("sqq").value.trim(), slash=typed.lastIndexOf("/");
  $("sqrq").textContent=typed||"…";
  $("sqrans").textContent= p.opts ? (p.opts.length===2 ? p.opts.join(" or ") : "one of: "+p.opts.join(", ")) : p.range ? `a number from ${nfm(p.range[0])} to ${nfm(p.range[1])}` : sqtype==="opts" ? "pick one · needs 2+ options" : sqtype==="range" ? "a number · needs a range" : "free text";
  $("sqrclosesk").hidden=$("sqrcloses").hidden=!p.deadline; $("sqrcloses").textContent= p.deadline ? `≈ ${dlDate(p.deadline-TIP)} · block ${fmt(p.deadline)}` : "";   // rules left unset are not listed
  $("sqrmink").hidden=$("sqrmin").hidden=!p.min; $("sqrmin").textContent= p.min ? `${fmt(p.min)} sats` : "";
  $("sqrfolderk").hidden=$("sqrfolder").hidden=slash<=0; $("sqrfolder").textContent=slash>0?typed.slice(0,slash):"";
  $("sqlink").textContent=new URL("topic.html",location.href).href+"#"+name;
  $("openscope").href="topic.html#"+name;                        // the footer control is a real link (see A: hosted viewer)
  $("listname").value=name; updateList(); sqPaint();            // sync first so Next enables without waiting for the SHA-256
  $("saddr").textContent=name?(await deriveScope(name)).addr:"…";
  sqPaint();
}
let sqOpener=null; $("scopedlg").addEventListener("close",()=>{ sqOpener?.focus?.({preventScroll:true}); sqOpener=null; });
function openScopeDialog(prefill, reg=false){
  const p=parseScope((prefill||"").toLowerCase());
  $("sqq").value=p.q||""; sqtype=p.range?"range":p.opts?"opts":"open";
  $("sqopts").value=(p.opts||[]).join("\n"); $("sqlo").value=p.range?p.range[0]:""; $("sqhi").value=p.range?p.range[1]:"";
  $("sqdl").querySelector("option[data-auto]")?.remove(); $("sqdl").value="0"; $("sqmin").value=p.min||"";
  document.querySelectorAll("[data-sqtype]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.sqtype===sqtype)));
  sqTouched=!!(p.opts||p.range||p.min); sqSug=null; $("sqhint").hidden=true; if(!sqTouched) sqHint();
  $("sqadv").open=false; document.querySelector("#sqstep-3 details.tech").open=false;   // both collapsed on every open
  sqReg=!!reg; $("sqtitle").textContent=reg?"Register topic":"New topic";
  $("sqregtag").textContent=reg?"required":"optional"; $("sqregtag").classList.toggle("req",reg);
  $("listtipon").checked = !!TIP_EFFECTIVE && LS(NETKEY("bv.scope.tip"))!=="0";
  sqMax=1; sqSeen=new Set([1]); sqRender(); updateList();
  const start = reg && sqValid(1) ? 3 : 1;
  if(start===3){ sqMax=4; sqSeen=new Set([1,2,3]); }             // register mode: 1–2 already done and clickable, 4 reachable
  sqOpener=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:$("newscope");
  $("scopedlg").showModal(); sqGo(start);
}
// ---------- guess the answer shape from the question (a suggestion, never silent) ----------
const YN=/^(should|is|are|do|does|can|could|will|would|has|have|did|was|were|shall|must)\b/;
const NUMQ=/^(how (many|much|long|old|far|big|high|low)|what (price|year|number|percentage|age|size|amount)|at what|when will|which year|in which year)\b/;
function suggest(raw){
  const t=raw.trim().toLowerCase().replace(/[?!.]+$/,"").trim(); if(!t) return null;
  const words=x=>x.trim().split(/\s+/).filter(Boolean).length;
  let m, deadline=null;
  if((m=t.match(/\b(by|before|until)\s+(?:the\s+)?(end\s+of\s+)?(\d{4})(-\d{2}-\d{2})?\b/))){
    const d = m[4] ? new Date(m[3]+m[4]) : new Date(+m[3]+(m[2]||m[1]==="until"?1:0),0,1);
    const blocks=Math.round((d-Date.now())/600000); if(blocks>0) deadline=blocks;
  }
  const withDl=o=>Object.assign(o,{deadline});
  if(/\btrue or false\b/.test(t)) return withDl({kind:"opts",opts:["true","false"],label:"true or false"});
  if(/\b(yes\s*\/\s*no|y\/n|or not)\b/.test(t) || YN.test(t)) return withDl({kind:"opts",opts:["yes","no"],label:"yes or no"});
  if((m=t.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/)) && words(m[1])<=3 && words(m[2])<=3) return withDl({kind:"opts",opts:[m[1],m[2]],label:"a duel"});
  if((m=t.match(/(?:between\s+|from\s+)?(-?\d+(?:\.\d+)?)\s*(?:to|-|–|and)\s*(-?\d+(?:\.\d+)?)\b/))) return withDl({kind:"range",range:[+m[1],+m[2]].sort((a,b)=>a-b),label:"a number"});
  if(/%|\bpercent/.test(t)) return withDl({kind:"range",range:[0,100],label:"a percentage"});
  if(NUMQ.test(t)) return withDl(/\byear\b|^when will/.test(t) ? {kind:"range",range:[new Date().getFullYear(),2100],label:"a year"} : {kind:"range",range:null,label:"a number"});
  const list=t.replace(/^(which|what)\b[^,:]*[,:]\s*/,"");
  const parts=[...new Set(list.split(/\s*,\s*|\s+or\s+|\s+\/\s+/).map(x=>x.trim()).filter(Boolean))];
  if(parts.length>=2 && parts.every(x=>words(x)<=3)) return withDl({kind:"opts",opts:parts,label:parts.length===2?"a pick between two":"a pick-one"});
  if(deadline) return {kind:null,deadline,label:"a deadline"};
  return null;
}
let sqTouched=false, sqSug=null;
const dlDate=b=>new Date(Date.now()+b*600000).toLocaleDateString();
function sqHint(){
  sqSug=suggest($("sqq").value);
  const show=!!sqSug && !sqTouched;
  $("sqhint").hidden=!show; if(!show) return;
  const d=sqSug.kind==="opts"?": "+sqSug.opts.join(" or "):sqSug.kind==="range"&&sqSug.range?`: ${sqSug.range[0]} – ${sqSug.range[1]}`:"";
  $("sqhinttxt").textContent=`Looks like ${sqSug.kind==="opts"?"a choice":sqSug.label}${d}${sqSug.deadline?` · closes ${dlDate(sqSug.deadline)}`:""}`;
}
function applySuggestion(sg){
  if(!sg) return;
  if(sg.kind){
    sqtype=sg.kind; document.querySelectorAll("[data-sqtype]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.sqtype===sqtype)));
    if(sg.kind==="opts") $("sqopts").value=sg.opts.join("\n");
    if(sg.kind==="range"){ $("sqlo").value=sg.range?sg.range[0]:""; $("sqhi").value=sg.range?sg.range[1]:""; }
  }
  if(sg.deadline){
    let o=$("sqdl").querySelector("option[data-auto]"); if(!o){ o=document.createElement("option"); o.dataset.auto="1"; $("sqdl").appendChild(o); }
    o.value=String(sg.deadline); o.textContent="by "+dlDate(sg.deadline); $("sqdl").value=String(sg.deadline);
  }
  sqTouched=true; $("sqhint").hidden=true; sqRender();
}
$("sqhintuse").onclick=()=>{ applySuggestion(sqSug); if(!sqValid(1)) return; if(sqValid(2)){ sqSeen.add(2); sqGo(3); } else sqGo(2); };   // use it = take the guess and go to Review; Answers first when the guess still needs values
$("sqq").oninput=()=>{ sqRender(); sqHint(); };
["sqopts","sqlo","sqhi","sqdl","sqmin"].forEach(id=>$(id).oninput=()=>{ sqTouched=true; $("sqhint").hidden=true; sqRender(); });
document.querySelectorAll("[data-sqtype]").forEach(b=>b.onclick=()=>{ sqtype=b.dataset.sqtype; sqTouched=true; $("sqhint").hidden=true; document.querySelectorAll("[data-sqtype]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); sqRender(); });
$("openscope").onclick=e=>{ if($("openscope").getAttribute("aria-disabled")==="true") e.preventDefault(); };   // keyboard guard; pointer-events:none covers the mouse
$("togglereg").onclick=()=>{ updateList(); sqGo(4); };
$("sqnext").onclick=()=>{ if(sqValid(sqStep)) sqGo(sqStep+1); };
$("sqback").onclick=()=>sqGo(Math.max(1,sqStep-1));
document.querySelectorAll("#sqsteps [data-step]").forEach(b=>b.onclick=()=>{ const n=+b.dataset.step; if(n!==sqStep&&sqCanReach(n)) sqGo(n); });
$("listtipon").onchange=()=>{ LS(NETKEY("bv.scope.tip"),$("listtipon").checked?"1":"0"); updateList(); if($("listtipon").checked) $("listtip").focus({preventScroll:true}); };
$("scopedlg").addEventListener("keydown",e=>{ if(e.key==="Enter"&&e.target.matches("input:not([type=checkbox])")&&!$("sqnext").hidden&&!$("sqnext").disabled){ e.preventDefault(); $("sqnext").click(); } });
$("copysqname").onclick=()=>copyText($("sqname").textContent,$("copysqname"));
$("copysaddr").onclick=()=>copyText($("saddr").textContent,$("copysaddr"));
$("sharescope").onclick=()=>copyText($("sqlink").textContent,$("sharescope"));
spay.onpaint=()=>{ if(sqStep===4) sqPaint(); };      // the wallet block repaints (wallet created, unlocked, balance in) → the footer primary follows
$("newscope").onclick=()=>openScopeDialog("",false);
$("regunreg").onclick=()=>openScopeDialog(sq,true);
segThumbs();

