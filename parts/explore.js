// ---------- directory: the root topic's registrations (dirLoad), then every topic counted (dirTopics), both in loader.js ----------
const URLQ=(()=>{ try{ return new URLSearchParams(location.search); }catch{ return new URLSearchParams(); } })();   // ?q= a search (a folder: "food/"), ?new= a name to register, ?create= a kind to start from
let sq=(URLQ.get("q")||"").trim().toLowerCase(), win=winGet(), DIRREADY=false, kindF=(()=>{ try{ return sessionStorage.getItem("bv.kindf")||"all"; }catch{ return "all"; } })(), showAll=false;   // DIRREADY: the root topic has answered; kindF: the type chips' filter; showAll: Most burned past its top 5
if(sq) $("sq").value=sq;
const inWin = v => v.h===null || v.h >= TIP-WIN[win];
const allVotes = name => cache[name] || [];
const winVotes = name => allVotes(name).filter(inWin);
// counted exactly like the topic page (tallyOf, shared.js), so both pages show the same sats. d.stats says the topic has been counted
const tally = d => !d.stats ? null : tallyOf(d.name, winVotes(d.name));
const tallyAll = d => !d.stats ? null : tallyOf(d.name, allVotes(d.name));
const callT = d => kind(parseScope(d.name))==="open" ? tally(d) : tallyAll(d);   // a result with fixed answers counts all time, like its topic page; an open wall follows the window
const kindOK = d => kindF==="all" || kindKey(parseScope(d.name))===kindF;
const visible = d => !HIDE.topics.has(d.name);
// line 2 of a topic row: its kind, its current call, its rules, plain text
const kindLine = d => { const p=parseScope(d.name), k=kindKey(p), T=callT(d), call=T&&callOf(d.name,T), parts=[k==="poll"?"poll":kindWord(p)];
  if(k==="open"){ if(T&&T.answers.length) parts.push(`${fmt(T.answers.length)} take${T.answers.length===1?"":"s"}`); if(call) parts.push(call); }
  else if(k==="poll") parts.push(call ? `${call} · ${p.opts.length} options` : p.opts.join(" | "));
  else if(k==="duel") parts.push(call || p.opts.join(" | "));
  else if(k==="yes-no"){ if(call) parts.push(call); }
  else { parts.push(`${nfc(p.range[0])} – ${nfc(p.range[1])}`); if(call) parts.push("median "+nfc(Math.round(weightedMedian(T.answers)))); }
  const st=closeState(p); if(st) parts.push(st.short);
  if(p.min) parts.push(`min ${fmt(p.min)} sats`);
  return esc(parts.join(" · ")); };
const sqName = () => { const p=parseScope(sq); return {...p, q:p.q.trim().replace(/\s+/g,"-")}; };   // the search spelled like the New topic dialog spells names: spaces become hyphens
const searchMatches = () => { const nq=sqName().q; if(!nq) return [];                          // matches the part before "?"; a search ending in "/" is a folder
  const m=DIRECTORY.filter(visible).map(d=>({d, q:parseScope(d.name).q})).filter(x=>nq.endsWith("/")?x.q.startsWith(nq):x.q.includes(nq)), rank=x=>x.q===nq?0:x.q.startsWith(nq)?1:2, all=d=>tallyOf(d.name, allVotes(d.name)).sats;
  return m.sort((a,b)=>rank(a)-rank(b) || all(b.d)-all(a.d)).map(x=>x.d); };
document.querySelectorAll("#xseg [data-win]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.win===win)); b.onclick=()=>{
  document.querySelectorAll("#xseg [data-win]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  win=b.dataset.win; winSet(win); renderDir();
}; });
document.querySelectorAll("#kindchips [data-kind]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.kind===kindF)); b.onclick=()=>{   // browse by type: the Spotlight, Hottest takes and Most burned follow
  kindF=b.dataset.kind; try{ sessionStorage.setItem("bv.kindf",kindF); }catch{}
  document.querySelectorAll("#kindchips [data-kind]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); renderDir(); }; });
// a paint only when what it shows changed: a pass that changes nothing repaints nothing, so keyboard focus and a finger on a row stay put
let DIRSIG="", RDT=0;
const dirSig=()=>JSON.stringify([sq,win,kindF,showAll,DIRREADY,DIRERR,DIRFRESH,ROOTH,TIP,dirPhase,ONE_COLUMN.matches,LS(NETKEY("bv.watch")),[...HIDE.mine].length,HIDE.site.size,HIDE.topics.size,ROOTV.map(v=>v.txid+":"+v.h),DIRECTORY.map(d=>[d.name,d.stats&&d.stats.sats,d.stats&&d.stats.votes,d.active,d.reg])]);
const renderSoon=()=>{ if(!RDT) RDT=setTimeout(()=>{ RDT=0; renderDir(); },150); };   // counts landing together: one paint (a timer, not a frame: a background tab keeps counting)
function renderDir(){
  const sig=dirSig(); if(sig===DIRSIG) return; DIRSIG=sig;
  const rows=$("scoperows"), before=RM.matches?null:new Map([...rows.querySelectorAll("a.srow")].map(a=>[a.getAttribute("href"),a.getBoundingClientRect().top]));   // rows glide to a new rank instead of jumping
  const ae=document.activeElement, fh=ae&&ae.closest&&ae.closest("#colL a[href],#colR a[href],#scopegrid a[href],#scoperows a[href]")?ae.getAttribute("href"):null;   // the link that had focus gets it back
  const searching=!!sq;
  $("featuredstrip").hidden = searching || DIRREADY&&!DIRECTORY.length;   // browsing only: a search lists its matches in the rows; placeholders until the directory answers
  $("kindchips").hidden = searching || !DIRECTORY.length;
  if(!searching) renderFeatured();
  const matches=renderRows();
  $("hotcol").hidden = $("colR").hidden = $("closingcol").hidden = searching || !DIRECTORY.length;
  $("cols2").classList.toggle("solo", searching || !DIRECTORY.length);                     // a search: the matches take the full width
  if(!searching){ renderHot(); renderClosing(); renderRecent(); renderFeatList(); renderBurners(); balanceHot(); }
  renderCreate(matches);
  renderStrips();
  if(before){ const moved=[]; for(const a of rows.querySelectorAll("a.srow")){ const t=before.get(a.getAttribute("href")); if(t===undefined) continue; const d=t-a.getBoundingClientRect().top; if(Math.abs(d)<1) continue; a.style.transition="none"; a.style.transform=`translateY(${d}px)`; moved.push(a); }
    if(moved.length){ void rows.offsetHeight; for(const a of moved){ a.style.transition="transform .3s ease"; a.style.transform=""; } } }   // measured after balanceHot, which moves the rows above them
  if(fh){ const q=CSS.escape(fh), el=document.querySelector(`#colL a[href="${q}"],#colR a[href="${q}"],#scopegrid a[href="${q}"],#scoperows a[href="${q}"]`); if(el) el.focus({preventScroll:true}); }
}
// a take as a list shows it: its words, or who hid them (its sats and bar stay, so rankings stay true)
const takeTxt=(name,t)=>{ const by=hiddenBy(name,t); return by ? `<i class="hid">${hiddenTxt(by)}</i>` : esc(shownT(parseScope(name),t)); };
// the split of a two-sided topic, drawn in its sides' colors (yes on the left for a yes-no), and its percentages "73–27"
const sides = (p,T) => { const ia=kindKey(p)==="yes-no"?p.opts.indexOf("yes"):0, s=o=>(T.answers.find(r=>r.key===o)||{t:o,key:o,sats:0}); return [s(p.opts[ia]),s(p.opts[1-ia])]; };
const splitBar = (A,B) => `<span class="viz two"><i style="flex:${A.sats||0.0001}"></i><i class="b" style="flex:${B.sats||0.0001}"></i></span>`;
// ---------- SPOTLIGHT: three different topics, one per kind of attention, each led by its icon badge: ✦ sponsored, a flame for most burned (window), a clock for the latest burn ----------
// "Most burned" picks first so its label stays true; Sponsored and Latest burn then take the best topics not already shown
// a spotlight card while its numbers load: the badge and the word, bars for the rest
const ghostCard=(badge,label)=>`<div class="card fcard ghost" aria-hidden="true"><span class="fhead">${badge}<span class="ktype">${label}</span><span class="name"><span class="sk" style="width:55%;height:18px"></span></span></span><span class="big"><span class="sk" style="width:110px;height:22px"></span></span><span class="lead"><span class="sk" style="width:80%"></span></span></div>`;
function renderFeatured(){
  if(!DIRREADY){ $("scopegrid").innerHTML=ghostCard(iconBadge("feature",ICONS.feature),"Sponsored")+ghostCard(iconBadge("top",ICONS.top),"Most burned")+ghostCard(iconBadge("",ICONS.latest),"Latest burn"); return; }   // the directory is on its way
  const dirs=DIRECTORY.filter(d=>visible(d)&&kindOK(d)), W=WINLABEL[win], used=new Set(), pick=list=>{ const d=list.find(x=>x&&!used.has(x.name))||list.find(Boolean); if(d) used.add(d.name); return d; };   // another topic per card while there are enough, the same one again when there are not
  const topD = pick(dirs.filter(d=>d.stats&&tally(d).sats>0).sort((a,b)=>tally(b).sats-tally(a).sats));   // from the topics that have numbers
  const spons=new Map(); for(const v of rootBurns()) if(inWin(v)&&dirs.some(d=>d.name===v.name)) spons.set(v.name,(spons.get(v.name)||0)+v.sats);   // sponsor score inside the window
  const featTop=[...spons].sort((a,b)=>b[1]-a[1])[0], featD=featTop&&dirs.find(d=>d.name===featTop[0]); if(featD) used.add(featD.name);   // the biggest, even when another card shows it too
  const recD = pick([...dirs].filter(d=>d.active).sort((a,b)=>b.active-a.active));                     // ties keep directory order, like the home page's hot chips
  // each card's lead drawn for its kind: a podium of takes, a race, the two sides, the forecast, the estimate
  const lead=d=>{ const p=parseScope(d.name), k=kindKey(p), T=callT(d);
    if(!T) return '<span class="sk" style="width:70%"></span>';
    if(!T.answers.length) return `<span class="nt">${k==="open"?(win==="all"?"No takes yet":"No burns "+W):"No answers yet"}</span>`;
    const tot=T.shareSats, pc=s=>Math.round(s.sats/tot*100)+"%";
    if(k==="number"){ const m=weightedMedian(T.answers); return `<span class="row3 num"><b>≈ ${numU(m,p)} estimate</b><span class="m">${T.answers.reduce((a,r)=>a+r.burns,0)} answers</span></span>`; }
    if(k==="duel"||k==="yes-no"){ const [A,B]=sides(p,T), L=s=>k==="yes-no"?s.key.toUpperCase():esc(s.t);
      return `<span class="row3 duo"><b class="a">${L(A)} ${k==="yes-no"?pc(A):fmt(A.sats)}</b>${splitBar(A,B)}<b class="b">${k==="yes-no"?pc(B):fmt(B.sats)} ${L(B)}</b></span>${p.deadline&&k==="yes-no"?`<span class="nt">${esc(closeState(p).short)}</span>`:""}`; }
    const rk=j=>String(T.answers.findIndex(r=>r.sats===T.answers[j].sats)+1).padStart(2,"0");   // equal sats share a rank, like the board
    const rows=T.answers.slice(0,3).map((t,j)=>`<span class="row3"><i class="rk">${rk(j)}</i><b>${takeTxt(d.name,t.t)}</b><span class="m">${k==="poll"?pc(t):fmt(t.sats)}</span></span>`).join("");
    const zero=k==="poll"?p.opts.filter(o=>!T.answers.some(r=>r.key===o)):[];
    return (k==="poll"?`<span class="viz race">${T.answers.map((r,i)=>`<i class="s${Math.min(i,3)}" style="flex:${r.sats}"></i>`).join("")}</span>`:"")+rows+(zero.length?`<span class="nt">+ ${esc(zero.join(", "))}</span>`:""); };
  const card=(d,type,badge,label,big,cap,body)=>`
    <a class="card fcard sp-${type}" href="topic.html#${esc(d.name)}">
      <span class="fhead">${badge}<span class="ktype">${label}</span><span class="name">${topicName(d.name,false)}</span></span>
      <span class="big">${big}<small>sats</small>${cap?`<span class="per">${cap}</span>`:""}</span>
      <span class="lead">${body}</span>
    </a>`;
  const out=[];
  if(featD) out.push(card(featD,"feat",iconBadge("feature",ICONS.feature),"Sponsored",fmt(featTop[1]),W,lead(featD)));
  if(topD) out.push(card(topD,"top",iconBadge("top",ICONS.top),"Most burned",fmt(tally(topD).sats),W,lead(topD)));
  else if(!DIRECTORY.some(d=>d.stats)) out.push(ghostCard(iconBadge("top",ICONS.top),"Most burned"));   // nothing counted yet
  if(recD){ const v=allVotes(recD.name).slice().sort((a,b)=>H(b)-H(a))[0];   // the big number is its newest burn (the mempool first); the rows its podium, like the other cards
    out.push(card(recD,"recent",iconBadge("",ICONS.latest),"Latest burn", v?fmt(v.sats):"—", v?"":"no burns yet", lead(recD))); }
  $("scopegrid").innerHTML=out.join("")||`<div class="emptybox">No ${esc({open:"open topics","yes-no":"yes-no topics",duel:"duels",poll:"polls",number:"number topics"}[kindF]||"topics")} yet</div>`;
}
// ---------- MOST BURNED (window) while browsing, or the matches of a search (all time) ----------
function renderRows(){
  const host=$("scoperows");
  if(!DIRECTORY.length){ host.innerHTML= !DIRREADY   // the directory is on its way: the rows' shape, bars for the text
    ? `<div class="divider">Most burned · ${WINLABEL[win]}</div>`+[46,62,38,54,42].map(w=>`<div class="srow ghost" aria-hidden="true"><span class="rank"></span><span class="nm"><span class="sk" style="width:${w}%"></span></span><span class="kl"><span class="sk" style="width:${w/2}%;height:9px"></span></span><span class="sats"><span class="sk" style="width:80px"></span></span><span class="v"><span class="sk" style="width:44px;height:9px"></span></span></div>`).join("")
    : `<div class="emptybox">${DIRERR ? `The explorer did not answer. <button type="button" class="linkbtn" data-retry>Retry</button>` : "No topics registered yet"}</div>`; return []; }
  let list, head, sats, ranked;
  if(sq){ list=searchMatches(); sats=tallyAll; ranked=false;
    head=list.length?`<div class="divider">${sq.endsWith("/")?`${list.length} topic${list.length===1?"":"s"} in ${esc(sqName().q)}`:`${list.length} matching topic${list.length===1?"":"s"} · all time`}</div>`:""; }
  else { sats=tally; ranked=true;
    list = DIRECTORY.filter(d=>visible(d)&&kindOK(d)).sort((a,b)=>(!!b.stats-!!a.stats) || (a.stats?tally(b).sats-tally(a).sats:0) || b.first-a.first);   // every topic with numbers ranked, then the ones not counted yet, unranked, newest first
    head=`<div class="divider">Most burned · ${WINLABEL[win]}</div>`; }
  const rows=sq||showAll?list:list.slice(0,5);                             // browsing: the top 5, all of them a click away; a search: every match
  host.innerHTML = head + rows.map((d,i)=>{ const S=sats(d); return `
    <a class="srow" href="topic.html#${esc(d.name)}">
      <span class="rank">${ranked&&d.stats?String(i+1).padStart(2,"0"):""}</span>
      <span class="nm">${topicName(d.name)}</span>
      <span class="kl">${kindLine(d)}${d.first>TIP?" · in the mempool":""}${S?`<span class="klv"> · ${S.burns} burn${S.burns===1?"":"s"}</span>`:""}</span>
      <span class="sats">${S?fmt(S.sats)+" sats":'<span class="sk" style="width:90px"></span>'}</span>
      <span class="v">${S?S.burns+(S.burns===1?" burn":" burns"):'<span class="sk" style="width:50px;height:9px"></span>'}</span>
    </a>`; }).join("") + (!sq&&list.length>5 ? `<button type="button" class="showall" data-showall>${showAll?"Show the top 5":`Show all ${fmt(list.length)} topics`}</button>` : "");
  return list;
}
$("scoperows").addEventListener("click",e=>{
  if(e.target.closest("[data-win-all]")) $("xseg").querySelector('[data-win="all"]').click();
  if(e.target.closest("[data-showall]")){ showAll=!showAll; renderDir(); }
  if(e.target.closest("[data-retry]")&&!BUSY){ chainReset(); dirSync({fresh:true}); }
});
// ---------- a searched name that is not registered: one line under the matches, or the panel when nothing matches ----------
function renderCreate(matches){
  const cr=$("createrow"), name=unregName(), show=!!sq && !!parseScope(sq).q && !sq.endsWith("/") && !DIRECTORY.some(d=>d.name===name);
  cr.hidden=!show; cr.classList.toggle("compact", show && matches.length>0);
  $("newscope").hidden=show;                                            // one filled button at a time: Register takes over from + New topic
  if(!show) return;
  $("createname").innerHTML=topicName(name); $("openunreg").href="topic.html#"+name;
  $("createstate").textContent= DIRFRESH ? "is not registered yet" : `is not in the directory as of block ${fmt(ROOTH)} · checking`;   // "not registered" only from a directory read on this visit   // a real <a>: script-driven navigation does not work in the hosted viewer
  const twin=lookalike(name), ri=regIssue(name);                        // the same question with other rules is another topic: said before paying
  $("createwhy").innerHTML= ri ? ` It can't be registered: ${esc(ri)}.` : twin ? ` ${twinText(name,twin)}` : `<span class="why">. You can open it now, or register it so others find it in Explore</span>.`;
  $("regunreg").disabled=!!ri; $("regunreg").classList.toggle("primary",!twin); $("openunreg").classList.toggle("primary",!!twin);
  if(twin){ $("openunreg").href="topic.html#"+twin.name; $("openunreg").textContent="Open it"; } else $("openunreg").textContent="Open topic";
}
// the registered topic a new name would be mistaken for: the same question (and the same options, in any order), whatever the rules
function lookalike(name){ const p=parseScope(name), set=p.opts?[...p.opts].sort().join("|"):null;
  const same=DIRECTORY.filter(d=>d.name!==name&&parseScope(d.name).q===p.q); return same.find(d=>{ const o=parseScope(d.name).opts; return set&&o&&[...o].sort().join("|")===set; })||same[0]||null; }
const twinText=(name,twin)=>{ const t=parseScope(twin.name), sats=twin.stats?` · ${fmt(twin.stats.sats)} sats`:"";
  return t.opts&&parseScope(name).opts&&[...t.opts].sort().join()===[...parseScope(name).opts].sort().join() ? `${topicName(twin.name)} already asks this with the same options${sats}.`
    : `${topicName(twin.name)} already exists as ${kindKey(t)==="open"?"an open topic":kindWord(t)==="yes-no"?"a yes-no":"a "+kindWord(t)}${t.opts&&kindKey(t)!=="yes-no"?` (${esc(t.opts.join(" | "))})`:""}${sats}. Different rules make a separate topic with its own address and its own burns.`; };
// ---------- activity: single burns and sponsorships across topics, inside the window ----------
const short=a=>a.slice(0,6)+"…"+a.slice(-4), H=v=>v.h===null?1e12:v.h;
const listCol=(head,rows,hint="",empty=`none ${WINLABEL[win]}`)=>{ const h=`<div class="divider">${head}${head.includes("·")?"":` · ${WINLABEL[win]}`}</div>`;   // hint: a link at the heading's right end
  return `<div class="burnercol">${hint?`<div class="striphead">${h}${hint}</div>`:h}${rows.join("")||`<span class="note">${empty}</span>`}</div>`; };
// ---------- HOTTEST TAKES: each topic's leading take in the window, ranked by its sats (one row per topic), drawn for its kind ----------
const heat=(d,T)=>{ const p=parseScope(d.name); if(!p.range) return T.answers[0].sats;   // a number topic: the sats around its estimate (its bin), not one exact value
  const B=binsOf(p.range[0],p.range[1]), bin=x=>Math.floor((x-B.start)/B.step), m=bin(weightedMedian(T.answers)); return T.answers.filter(r=>bin(numOf(r.t))===m).reduce((a,r)=>a+r.sats,0); };
function renderHot(){
  const rows=DIRECTORY.filter(d=>visible(d)&&kindOK(d)).map(d=>{ const T=tallyOf(d.name, winVotes(d.name)); return T.answers.length&&{d, T}; })
    .filter(Boolean).sort((a,b)=>heat(b.d,b.T)-heat(a.d,a.T)).slice(0, ONE_COLUMN.matches?5:DIRECTORY.length);   // desktop: every topic, trimmed by balanceHot to the right column's height
  $("hotcol").innerHTML = listCol("Hottest takes", rows.map(hotRow));
}
// the row says the take, the bar where it stands: its share (open), the split (duel, yes-no), every option (poll), the estimate on the range (number)
function hotRow({d,T}){
  const p=parseScope(d.name), k=kindKey(p), t=T.answers[0], tot=T.shareSats, pc=s=>tot?Math.round(s/tot*100):0, burns=T.answers.reduce((a,r)=>a+r.burns,0), st=closeState(p);
  const meta=[topicName(d.name), k==="open"?`leads ${fmt(T.answers.length)} take${T.answers.length===1?"":"s"}`:k==="poll"?`leads ${p.opts.length} options`:null, st?esc(st.short):null, `${burns} burn${burns===1?"":"s"}`].filter(Boolean).join(" · ");
  let text, bar, right, sats=t.sats, hide="";
  if(k==="number"){ const [lo,hi]=p.range, m=weightedMedian(T.answers), q1=weightedQuantile(T.answers,.25), q3=weightedQuantile(T.answers,.75), x=v=>hi>lo?(v-lo)/(hi-lo)*100:50;
    text=`≈ ${numU(m,p)}<span class="vs"> in ${nfc(lo)} – ${nfc(hi)}</span>`; sats=heat(d,T);
    bar=`<span class="viz num" title="estimate ${numU(m,p)}; middle half ${numU(q1,p)} – ${numU(q3,p)}"><b style="left:${x(q1)}%;width:${Math.max(1,x(q3)-x(q1))}%"></b><i style="left:${x(m)}%"></i></span>`; right="median"; }
  else if(k==="duel"||k==="yes-no"){ const [A,B]=sides(p,T), tie=A.sats===B.sats, lead=A.sats>=B.sats?A:B, other=lead===A?B:A;
    text= k==="yes-no" ? esc(niceQ(d.name)) : tie ? `${esc(A.t)}<span class="vs"> ties with ${esc(B.t)}</span>` : `${esc(lead.t)}<span class="vs"> leads ${esc(other.t)}</span>`;
    bar=splitBar(A,B); right= k==="yes-no" ? `${pc(A.sats)}% yes` : `${pc(A.sats)}–${pc(B.sats)}`; sats=A.sats+B.sats; }
  else { text=takeTxt(d.name,t.t); const by=hiddenBy(d.name,t.t);
    hide= by==="you" ? `<button type="button" class="hidex" data-unhide="${esc(d.name)}" data-take="${esc(t.t)}">show</button>` : by ? "" : k==="open" ? `<button type="button" class="hidex" data-hide="${esc(d.name)}" data-take="${esc(t.t)}" title="Hide this take in this browser">Hide this take</button>` : "";
    bar= k==="open" ? `<span class="viz"><i style="width:${pc(t.sats)}%"></i></span>` : `<span class="viz race">${T.answers.map((r,i)=>`<i class="s${Math.min(i,3)}" style="flex:${r.sats}"></i>`).join("")}</span>`; right=`${pc(t.sats)}%`; }
  const title=k==="poll"?T.answers.map(r=>`${r.t} ${pc(r.sats)}%`).join(" · "):"";
  return `<div class="bchip lb ic hk">${iconBadge("",ICON_TAKE)}<a class="lbt" href="topic.html#${esc(d.name)}">${text}</a><b>${fmt(sats)} sats</b>
    <span class="m">${meta}${hide}</span><span class="hv"${title?` title="${esc(title)}" aria-label="${esc(title)}"`:""}>${right}${bar}</span></div>`;
}
$("hotcol").addEventListener("click",e=>{ const h=e.target.closest("[data-hide],[data-unhide]"); if(!h) return; hideMine(h.dataset.hide||h.dataset.unhide, h.dataset.take, !!h.dataset.hide); renderDir(); toast(h.dataset.hide?"Hidden in this browser · its sats still count":"Shown again"); });
// ---------- CLOSING SOON: the deadlines of the next week, soonest first, each with its current call; NEW: registered topics nobody burned for yet ----------
function renderClosing(){
  const soon=DIRECTORY.filter(d=>visible(d)&&kindOK(d)).map(d=>({d, p:parseScope(d.name)})).filter(x=>x.p.deadline&&TIP&&!closedAt(x.p)&&blocksTo(x.p.deadline)<=1008).sort((a,b)=>a.p.deadline-b.p.deadline).slice(0,5);
  const fresh=dirPhase==="done"&&!dirErrs ? DIRECTORY.filter(d=>visible(d)&&kindOK(d)&&d.stats&&!d.stats.votes).sort((a,b)=>b.first-a.first).slice(0,5) : [];   // "waiting for a first burn" only from a pass where every topic answered
  const row=(d,meta)=>`<a class="bchip lb ic" href="topic.html#${esc(d.name)}">${iconBadge("reg",ICONS.reg)}<span class="lbt">${topicName(d.name)}</span><b></b><span class="m">${meta}</span></a>`;
  $("closingcol").innerHTML=(soon.length?`<div class="burnercol"><div class="divider">Closing soon</div>${soon.map(x=>{ const T=callT(x.d), c=T&&callOf(x.d.name,T); return row(x.d, esc([c, closeState(x.p).short].filter(Boolean).join(" · "))); }).join("")}</div>`:"")
    +(fresh.length?`<div class="burnercol"><div class="divider">New topics</div>${fresh.map(d=>row(d,"New · waiting for a first burn · <span class=\"go\">Burn the first one →</span>")).join("")}</div>`:"");
}
// the left column (hottest takes, most burned, closing soon) ends where the right one (biggest sponsorships, recent, top burners) ends: hottest takes gives up rows, never below 5
const ONE_COLUMN=matchMedia("(max-width:860px)");
function balanceHot(){
  if(ONE_COLUMN.matches) return;
  const rows=[...$("hotcol").querySelectorAll(".bchip")], L=$("colL"), R=$("colR");
  for(let n=rows.length; n>5 && L.offsetHeight>R.offsetHeight+6; ) rows[--n].remove();
}
ONE_COLUMN.addEventListener("change",()=>renderDir());
// ---------- RECENT: a timeline of what just happened (not windowed): burns, new topics, sponsorships, new burners ----------
function renderRecent(){
  const items=recentDigest(DIRECTORY.filter(visible).flatMap(d=>allVotes(d.name).map(v=>({v, name:d.name}))), rootBurns().filter(v=>!HIDE.topics.has(v.name)));   // recentDigest / recentRow: shared.js, the topic page's Recent too
  $("recentcol").innerHTML = `<div class="burnercol"><div class="divider"><span class="hot" title="Live: each new block adds its burns here">Recent</span></div>${items.length ? `<div class="tl">${items.map(x=>recentRow(x,{take:(v,link)=>link(v.t?takeTxt(x.name,v.t):"<i>no take</i>")})).join("")}</div>` : `<span class="note">nothing yet</span>`}</div>`;
}
// ---------- BIGGEST SPONSORSHIPS: the largest single burns to the root topic in the window ----------
function renderFeatList(){
  const featRow=v=>`<div class="bchip lb ic">${iconBadge("feature",ICONS.feature)}<a class="lbt" href="topic.html#${esc(v.name)}">${topicName(v.name)}</a><b>${fmt(v.sats)} sats</b><span class="m">${v.from?`<a href="burner.html#${esc(v.from)}" title="${esc(v.from)}">${esc(short(v.from))}</a> · `:""}${whenOf(v)}</span></div>`;
  $("featcol").innerHTML = listCol("Biggest sponsorships", rootBurns().filter(v=>inWin(v)&&!HIDE.topics.has(v.name)).sort((a,b)=>b.sats-a.sats).slice(0,5).map(featRow), `<a class="hint" href="spec.html#registration">✦ how sponsoring works</a>`);
}
// ---------- TOP BURNERS inside the window (new and latest burners live in Recent) ----------
function renderBurners(){
  const by={};
  for(const d of DIRECTORY) for(const v of winVotes(d.name)){ if(!v.from) continue; const b=by[v.from]||(by[v.from]={addr:v.from,sats:0,burns:0}); b.sats+=v.sats; b.burns++; }
  $("topburners").innerHTML = listCol("Top burners", Object.values(by).sort((a,b)=>b.sats-a.sats).slice(0,5).map(b=>`<a class="bchip br ic" href="burner.html#${esc(b.addr)}" title="${esc(b.addr)}">${iconBadge("burner",ICONS.burner)}<span class="ad">${esc(short(b.addr))}</span><span class="m">${b.burns} burn${b.burns===1?"":"s"}</span><b>${fmt(b.sats)} sats</b></a>`));
}
// ---------- Watching strip over the search bar: this browser's watchlist, with what changed since the last visit (shared.js watchNews) ----------
function renderStrips(){
  const w=watchGet();                                                 // [{name, seenH, seenCount, seenCall, seenAt}], newest last
  $("watching").hidden = !w.length;
  $("watchline").innerHTML = w.slice().reverse().map(x=>{
    const d=DIRECTORY.find(t=>t.name===x.name), T=d&&d.stats?tallyAll(d):null, news=T?watchNews(x, allVotes(x.name), T):null;   // unknown for an unregistered or uncounted name
    return `<span class="wchip${d?"":" unreg"}" title="${d?esc(x.name):"not registered · "+esc(x.name)}"><a href="topic.html#${esc(x.name)}"><span>${topicName(x.name)}</span>${news?`<b class="new" title="since your last visit">${esc(news)}</b>`:""}</a><button type="button" class="x" data-unwatch="${esc(x.name)}" aria-label="Stop watching ${topicName(x.name)}">✕</button></span>`;
  }).join("");
}
$("watchline").onclick=e=>{ const b=e.target.closest("[data-unwatch]"); if(!b) return; watchToggle(b.dataset.unwatch); renderDir(); toast("No longer watching"); };
const unregName=()=>canonical(sqName());                        // the searched name as the topic page will spell it (one question, one address)
addEventListener("storage",e=>{ if(e.key===NETKEY("bv.watch")||e.key===NETKEY("bv.hide")) renderDir(); });   // watched or hidden from another tab
$("sq").oninput=e=>{sq=e.target.value.trim().toLowerCase(); renderDir()};
if(matchMedia("(max-width:480px)").matches) $("sq").placeholder="Search or name a topic";
hideReady().then(()=>{ DIRSIG=""; renderDir(); });
// sync line under the title, same voice as the topic page (shared.js syncLine): "synced" only when the root, every topic and the tip answered on this pass
let dirPhase="root", dirErrs=0, DIRLOW=0, DIRWASFAILED=false, BUSY=false, COUNTED_TIP=0, LASTTICK=Date.now();   // dirErrs: topics the last pass could not read; DIRLOW: the lowest block the numbers on screen are as of; BUSY: a pass is running; COUNTED_TIP: the tip the last full count ran at
const dirStatus=()=>{ const n=DIRECTORY.length, s=n===1?"":"s", failed=DIRERR||dirPhase==="done"&&(ROOTERR||dirErrs>0||TIPERR);
  $("dirstatus").innerHTML = failed ? syncLine({state:"failed", height:DIRLOW})
    : dirPhase!=="done" ? syncLine({state:"updating", height:DIRLOW})
    : syncLine({state:"fresh", height:TIP, tail:`${n} topic${s}`});
  if(failed!==DIRWASFAILED){ DIRWASFAILED=failed; announce(failed?"The explorer did not answer":"Synced"); } };
async function dirSync({fresh=false,quiet=false}={}){                 // quiet: a new block, counted behind the numbers already on screen
  BUSY=true;
  try{
    if(!quiet){ dirPhase="root"; dirStatus(); }
    await dirLoad(fresh); DIRREADY=true; if(!quiet) dirPhase="topics"; renderDir(); dirStatus();
    COUNTED_TIP=TIP; const r=await dirTopics({onTopic:renderSoon});
    await tipFresh(); dirErrs=r.errors; const hs=[ROOTH,r.low].filter(h=>h>0); DIRLOW=hs.length?Math.min(...hs):0;
    dirPhase="done"; renderDir(); dirStatus();
  } finally{ BUSY=false; LASTTICK=Date.now(); }
}
renderDir();                                                            // placeholders at once
(async()=>{ const h=await dirFromDisk(); if(DIRECTORY.length){ DIRREADY=true; DIRLOW=h; renderDir(); dirStatus(); } dirSync(); })();   // a returning visit paints what this browser knows at once; first visits keep the placeholders
$("dirstatus").addEventListener("click",e=>{ if(e.target.closest("[data-retry]")&&!BUSY){ chainReset(); dirSync({fresh:true}); } });
// every minute while visible, one pass at a time: a new block (or a pass that failed) counts every topic again; between blocks, the root topic alone,
// so a topic registered anywhere shows within a minute. A tab back after a minute away checks at once
async function dirTick(){ if(document.hidden||BUSY) return; BUSY=true; let again=false;
  try{ await tipRefresh(); again=TIP>COUNTED_TIP||dirErrs>0||ROOTERR;
    if(!again){ await dirLoad(true); renderDir(); await dirTopics({only:d=>!d.stats, onTopic:renderSoon}); dirStatus(); } }
  finally{ BUSY=false; LASTTICK=Date.now(); }
  if(again) dirSync({fresh:true, quiet:true}); }
setInterval(dirTick,60000);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden&&Date.now()-LASTTICK>60000) dirTick(); });
const spay=payPanel("spay",{speed:false}); PAY.push(spay);   // the fee speed sits in the fee view (Advanced)
$("sqfeehost").innerHTML=feeSegHtml("sqfeeseg",true); feeSegWire($("sqfeeseg"));
$("listtipaddr").textContent=TIP_EFFECTIVE || "not set yet · left out"; $("copylisttip").dataset.copy=TIP_EFFECTIVE||""; $("copylisttip").disabled=!TIP_EFFECTIVE;
// effective registration amounts: burn checkbox off = no registration output, tip checkbox off = no tip output
const regSats=()=>Math.max(REG_SATS, Math.round(+$("sqamt").value||REG_SATS));   // 330 registers; more is an initial sponsorship (the footer's Sponsor)
const regTipSats=()=>TIP_EFFECTIVE ? Math.max(0,Math.round(Number($("listtip").value||0))) : 0;   // "No tip" is 0; no tip address on this network → never a tip output
let SQFIRST="", SQADDR=null;                                     // the first answer burned with the registration, and the new topic's address (derived when asked for)
const sqFirstFits=()=>enc.encode($("listname").value.trim()+BALLOT_SEP+SQFIRST).length<=80;   // both statements in one OP_RETURN: 80 bytes, or it may not relay
function updateList(){
  const n=$("listname").value.trim().toLowerCase();
  const data=enc.encode(n);
  $("listhex").textContent=toHex(opReturnScript(data));
  const t=regTipSats();
  $("listtipusd").textContent=t?usdOf(t):"";
  $("listtiprow").hidden=!t;
  $("spay-outputs").hidden=!!(SQFIRST&&SQADDR&&SQADDR.name===n&&sqFirstFits());   // two burns: the raw transaction below carries both
  if(SQFIRST&&SQADDR&&SQADDR.name===n&&sqFirstFits()) spay.set({entries:[{name:"", addr:$("rootaddr").textContent, statement:n, sats:regSats(), intent:"register"}, {name:n, addr:SQADDR.addr, statement:SQFIRST, sats:REG_SATS}], tipAddr:TIP_EFFECTIVE, tipSats:t});
  else spay.set({burnAddr:$("rootaddr").textContent, burnSats:regSats(), statementBytes:data, tipAddr:TIP_EFFECTIVE, tipSats:t});   // "…" until the root address is derived
}
const sqTipSave=()=>tipPrefSave($("listtip").value), sqTipDefault=tipPref;   // the tip every amount dialog shares: 1,000 until another is chosen
const sqTip=amountChips($("listtipseg"), $("listtip"), ()=>{ sqTipSave(); updateList(); sqPaint(); }); sqTip.reset(sqTipDefault());
if(!tipEnabled()){ $("listtipf").hidden=true; $("listtiprow").hidden=true; }   // no tip address on this network: every tip control disappears (regTipSats() is 0)
deriveScope("").then(r=>{ $("rootaddr").textContent=r.addr; updateList(); });
$("listtip").oninput=()=>{ sqTipSave(); updateList(); sqPaint(); };
$("copyroot").onclick=()=>copyText($("rootaddr").textContent,$("copyroot"));
updateList();
$("copylisthex").onclick=()=>copyText($("listhex").textContent,$("copylisthex"));

// ---------- new scope dialog: the question, its kind (five chips, the guess preselected), the kind's own fields; deadline and minimum in their own view ----------
let sqk="open", sqStep=1, sqUnit="", sqUnitCustom=false, sqAuto=false, sqStem=null, sqTouched=false, sqDLTouched=false;   // sqk: the kind chip; sqUnit: a number's unit token; sqAuto: the kind was read from the question, untouched; sqStem: the question without the list its options came from
// the deadline picked: a preset or a guessed span (blocks from the tip), a date, or a searched name's block. Its block is fixed the first time a tip
// read on this visit is known, so the name never drifts while the dialog is open and a copied transaction matches the one broadcast later
let sqDL={kind:null};                                            // {kind:null} | {kind:"rel", blocks, abs} | {kind:"date", at (ms, 00:00 UTC), abs} | {kind:"abs", abs}
const sqDLBlock=()=>{ if(!sqDL.kind||sqDL.abs) return sqDL.abs||null; if(!TIPLIVE||sqDL.kind==="date"&&!sqDL.at) return null;   // no tip yet: no guess (a tipless deadline would be block 1,008, closed in 2009)
  return sqDL.abs = sqDL.kind==="date" ? TIP+Math.round((sqDL.at-TIPAT)/600000) : tipEst()+sqDL.blocks; };
const optClean=o=>norm(o).replace(/[?|@!]/g,"").replace(/\s+/g,"-");   // an option as a name writes it: no grammar characters, hyphens for spaces (the directory lists no name with a space)
const PLACE={open:"e.g. best sci-fi novel", "yes-no":"e.g. will btc hit 200k in 2026", duel:"e.g. tabs vs spaces", poll:"e.g. best lightning wallet", number:"e.g. btc price end of 2026"};
const pollInputs=()=>[...$("sqpollopts").querySelectorAll("input")];
function pollFields(vals=[]){ const v=vals.slice(); while(v.length<3) v.push("");
  $("sqpollopts").innerHTML=v.map((x,i)=>`<input class="mono" placeholder="Option ${i+1}" value="${esc(x)}" autocomplete="off" spellcheck="false" aria-label="Option ${i+1}">`).join(""); }
const sqSpec=()=>{
  let q=(sqAuto&&sqStem?sqStem:$("sqq").value).trim().toLowerCase().replace(/[?|@!]/g,"").replace(/\s+/g,"-");   // a guessed list moves out of the question into the options
  if(sqk==="number"&&sqUnit&&q&&!q.endsWith(sqUnit)) q+=sqUnit;   // the unit is part of the name: everyone reads the same number
  const p={q, opts:null, range:null, deadline:sqDLBlock(), min:null};
  if(sqk==="yes-no") p.opts=["yes","no"];
  if(sqk==="duel"){ const o=[...new Set([$("sqa").value,$("sqb").value].map(optClean).filter(Boolean))]; if(o.length===2) p.opts=o; }
  if(sqk==="poll"){ const o=[...new Set(pollInputs().map(i=>optClean(i.value)).filter(Boolean))]; if(o.length>=3) p.opts=o; }
  if(sqk==="number"&&$("sqlo").value!==""&&$("sqhi").value!==""){ const r=[+$("sqlo").value,+$("sqhi").value].sort((a,b)=>a-b); if(r[0]!==r[1]) p.range=r; }
  const mn=Math.floor(+$("sqmin").value); if(mn>0) p.min=mn;      // whole sats: "!100.5" would read back as another name
  return p;
};
const minBad=()=>{ const m=+$("sqmin").value; return m>0&&m<330; };   // a minimum under 330 would ask for dust
// what stops this name from registering, in the reader's words (null: it registers)
const sqIssue=()=>{ const p=sqSpec(); if(!p.q) return "it has no name";
  if(sqk==="duel"&&!p.opts) return "name both sides"; if(sqk==="poll"&&!p.opts) return "add at least 3 options"; if(sqk==="number"&&!p.range) return "set a lowest and a highest number";
  if(minBad()) return "a minimum is 330 sats or more"; if(sqDL.kind==="date"&&!sqDL.at) return "pick a date for the deadline"; if(sqDL.kind&&!p.deadline) return "waiting for the chain tip to set the deadline"; return regIssue(canonical(p)); };
function sqValid(n){
  if(n===1) return !sqIssue();
  if(n===2) return !minBad()&&!(sqDL.kind==="date"&&!sqDL.at);
  if(n===3) return +$("sqamt").value>=REG_SATS;   // the fee view: at least the registration
  return true;                                   // 4 Transaction: nothing to fill in
}
function sqGo(n){
  sqStep=n;
  for(const k of [1,2,3,4]) $("sqstep-"+k).hidden=k!==n;
  sqPaint(); segThumbs();                                              // a seg inside the revealed step gets its thumb placed now
  $("scopedlg").querySelector(".dlg").scrollTop=0;
  const first=[...$("sqstep-"+n).querySelectorAll("input:not([type=hidden]):not(:disabled),textarea,select")].find(el=>!el.closest("[hidden]"));
  (n===3 ? $("sqamtseg").querySelector('[aria-pressed="true"]')||$("sqamt") : n===2 ? $("sqdl") : first||$("sqfoot").querySelector(".primary:not([hidden])")||$("sqback")).focus({preventScroll:true});
}
// under the fields: what gets registered, as the topic page will name it, then the name itself with its byte budget, then why it can't register when it can't
function sqRegLine(){
  const p=sqSpec(), name=canonical(p), nb=enc.encode(name).length, issue=p.q?sqIssue():null, k=p.opts||p.range?kindWord(p):sqk;   // the chip's kind, even before its fields are filled
  const rules=[p.opts&&sqk!=="yes-no"?p.opts.join(" | "):null, p.range?`${nfc(p.range[0])} – ${nfc(p.range[1])}`:null, p.deadline?`closes ≈ ${dlDate(blocksTo(p.deadline))}`:sqDL.kind?"closes · date pending":null, p.min?`min ${fmt(p.min)} sats`:null].filter(Boolean);
  const edit=`<button type="button" class="linkbtn" data-editrules>Deadline & minimum</button>`;
  const nudge=!sqDL.kind&&(sqk==="yes-no"||sqk==="number"&&/\b(19|20)\d\d\b/.test(p.q));   // a prediction with no deadline
  $("sqrulesline").innerHTML = !p.q ? edit
    : `<span class="rl1">Registers as <b>${topicName(name)}</b> · ${esc([k.toUpperCase(),...rules].join(" · "))} ${edit}</span>
      <span class="rl2${issue||nb>80?" bad":nb>=70?" warn":""}"><code>${esc(name)}</code> · ${nb} / 80 bytes</span>
      <span class="rl3${issue?" bad":""}">${issue ? `Can't be registered yet: ${esc(issue)}.` : nudge ? `Predictions work best with a deadline. <button type="button" class="linkbtn" data-editrules>Set one</button>` : "Lowercase, hyphens, permanent. Different rules make a different topic."}</span>`;
}
function sqPaint(){                              // the footer, idempotent, called by sqRender and sqGo
  const s=spay.wallet.status(), editing=sqStep===2||sqStep===3, sent=!!(s&&s.kind==="sent");   // the rules and the fee views: Cancel or Apply, back to the topic
  $("sqback").hidden=sqStep!==4||sent;                           // the transaction only
  const more=regSats()-REG_SATS, tip=regTipSats();               // 330 registers, more sponsors it at once; the tip, visible; it changes in the edit view only (no ✕: removing it takes a step)
  $("sqprice").hidden=sqStep!==1&&sqStep!==3; dlgPrice($("sqprice"), REG_SATS, "registration"+(sqStep===1?` <button type="button" class="linkbtn" data-regfee>edit</button>`:""), spay.wallet.fee(),
    [more>0?`+${fmt(more)} sats sponsorship`:null, SQFIRST&&sqFirstFits()?`+${fmt(REG_SATS)} sats first answer`:null, tip?`+${fmt(tip)} sats tip`:null].filter(Boolean));   // walletui.js; edit opens the fee view
  $("sqcancel").hidden=$("sqapply").hidden=!editing; $("sqapply").disabled=!sqValid(sqStep);
  feeSegPaint($("sqfeeseg"), !!(s&&s.kind!=="err"), $("sqfeesum"), tipEnabled()?regTipSats():null);
  sqRegLine();
  $("sqdone").hidden=!sent; if(sent) paintDone();
  $("sqsendwrap").hidden=editing;
  signMenu($("sqsend"), $("sqsendmenu"), spay.wallet, {label:"Validate topic", ok:!sqIssue()&&$("rootaddr").textContent.length>=20,   // the reason shows in the Registers as line
    show:()=>{ if(sqStep!==4){ updateList(); sqGo(4); } }, batch:sqBatch, tx: sqStep!==4 ? ()=>{ updateList(); sqGo(4); } : null, done:()=>$("scopedlg").close()});
}
// registered: the way to the new topic, and to its first burn, so it does not open empty
function paintDone(){ const name=$("listname").value.trim(), k=kindKey(parseScope(name)), h=`<p>${topicName(name)} is registered · in the mempool · listed in Explore now, confirmed in ~10 min</p><div class="acts"><a class="btn sm primary" href="topic.html#${esc(name)}">Open topic</a><button type="button" class="btn sm" data-copyname="${esc(name)}">Copy link</button></div><p>${SQFIRST?`Its first answer, ${esc(SQFIRST)}, is in the same transaction.`:`<a class="linkbtn" href="topic.html#${esc(name)}">Burn the first ${k==="open"?"take":"answer"} so it doesn't open empty →</a>`}</p>`;
  if($("sqdone")._h!==h){ $("sqdone")._h=h; $("sqdone").innerHTML=h; } }
$("sqdone").addEventListener("click",e=>{ const b=e.target.closest("[data-copyname]"); if(b) copyText(new URL("topic.html#"+b.dataset.copyname,location.href).href,b); });
function sqBatch(){                                                 // registering = a burn to the root topic (name "") with the topic name as the statement
  const e={name:"", addr:$("rootaddr").textContent, statement:$("listname").value.trim(), sats:regSats(), intent:"register"}, i=ballotFind(e.addr);
  if(i>=0) return batchConflict($("sqbatchnote"), i, e, ()=>{ $("scopedlg").close(); ballotPill(); toast("Batch updated"); });   // one root burn per transaction (ballotui.js)
  const n=ballotAdd(e); $("scopedlg").close(); ballotPill(); toast(`Added to your batch · ${n} burn${n===1?"":"s"}`);
}
function sqRender(){
  const p=sqSpec(), name=canonical(p), nb=enc.encode(name).length;
  document.querySelectorAll("#sqkinds [data-k]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.k===sqk)));
  document.querySelectorAll("#squnit [data-u]").forEach(b=>b.setAttribute("aria-pressed",String(sqUnitCustom?b.dataset.u==="custom":b.dataset.u===sqUnit))); $("squnitc").hidden=!sqUnitCustom;
  $("sqblurb").textContent=KINDS[sqk].blurb; $("sqq").placeholder=PLACE[sqk];
  $("sqduelf").hidden=sqk!=="duel"; $("sqpollf").hidden=sqk!=="poll"; $("sqnumf").hidden=sqk!=="number";
  $("sqdetect").innerHTML= sqAuto&&$("sqq").value.trim() ? `Detected from your question · <button type="button" class="linkbtn" data-kchange>change</button>` : "";
  $("sqtoolong").hidden=$("sqtoolong2").hidden=nb<=80; $("sqtoolong").textContent=$("sqtoolong2").textContent=`Name is ${nb} bytes; 80 is the most that can be registered. Shorten the question or options.`;
  $("sqdlhint").textContent= p.deadline ? `≈ ${dlDate(blocksTo(p.deadline))}` : sqDL.kind==="date"&&!sqDL.at ? "pick a date" : sqDL.kind ? "waiting for the chain tip" : "never";
  $("sqdatef").hidden=sqDL.kind!=="date"; $("sqdatenote").textContent= sqDL.kind==="date"&&p.deadline ? `≈ block ${fmt(p.deadline)} · blocks average about 10 minutes, so the close can land a day or more away from this date` : "";
  const exact=p.q&&DIRECTORY.find(d=>d.name===name), tw=p.q&&!exact?lookalike(name):null;   // the same topic, or the same question under other rules: said before paying (Explore's lookalike)
  $("sqtwin").hidden=!exact&&!tw;
  if(exact) $("sqtwin").innerHTML=`${topicName(name)} is already registered${exact.stats?` · ${fmt(exact.stats.sats)} sats`:""}. Registering again sponsors it. <a class="linkbtn" href="topic.html#${esc(name)}">Open it →</a>`;
  else if(tw) $("sqtwin").innerHTML=`${twinText(name,tw)} <a class="linkbtn" href="topic.html#${esc(tw.name)}">Open it →</a>`;
  // the first answer: offered for topics with fixed answers, one of them picked, both statements in one OP_RETURN
  const fixed=!!p.opts; $("sqfirstf").hidden=!fixed; if(!fixed){ $("sqfirst").checked=false; SQFIRST=""; }
  $("sqfirstopts").hidden=!$("sqfirst").checked; if(!p.opts||!p.opts.includes(SQFIRST)) SQFIRST="";
  if($("sqfirst").checked&&p.opts){ const h=p.opts.map(o=>`<button type="button" class="btn${SQFIRST===o?" primary":""}" data-first="${esc(o)}" aria-pressed="${SQFIRST===o}">${esc(sqk==="yes-no"?o.toUpperCase():o)}</button>`).join(""); if($("sqfirstopts")._h!==h){ $("sqfirstopts")._h=h; $("sqfirstopts").innerHTML=h; } $("sqfirstopts").className="choice "+(p.opts.length===2?"pair":"poll"); }
  $("listname").value=name;
  const fits=!SQFIRST||sqFirstFits(); $("sqfirstnote").hidden=fits; if(!fits) $("sqfirstnote").textContent="The name and this answer don't fit one 80-byte OP_RETURN together: register first, then burn your answer.";
  if(SQFIRST&&(!SQADDR||SQADDR.name!==name)) deriveScope(name).then(r=>{ if($("listname").value===name){ SQADDR={name, addr:r.addr}; updateList(); sqPaint(); } });
  updateList(); sqPaint();
}
let sqOpener=null; $("scopedlg").addEventListener("close",()=>{ sqOpener?.focus?.({preventScroll:true}); sqOpener=null; });
function openScopeDialog(prefill, reg=false, kindHint=null){     // kindHint: a kind to start from (Home's "Start one →")
  const p=parseScope((prefill||"").toLowerCase()), um=p.q.match(/-(in-usd|in-eur|in-sats|percent)$/)||(p.range?p.q.match(/-(in-\p{L}[\p{L}\p{N}]*)$/u):null);   // a custom unit only on a number: "best-pizza-in-rome" keeps its words
  sqUnit=um?"-"+um[1]:""; sqUnitCustom=!!um&&!/^(in-usd|in-eur|in-sats|percent)$/.test(um[1]); $("squnitc").value=sqUnitCustom?um[1].slice(3):""; $("sqq").value=um?p.q.slice(0,-um[0].length):p.q||"";
  sqk=kindHint||(p.range?"number":p.opts?(isYesNo(p)?"yes-no":p.opts.length===2?"duel":"poll"):"open");
  $("sqa").value=p.opts&&p.opts.length===2&&!isYesNo(p)?p.opts[0]:""; $("sqb").value=p.opts&&p.opts.length===2&&!isYesNo(p)?p.opts[1]:"";
  pollFields(p.opts&&p.opts.length>2?p.opts:[]); $("sqlo").value=p.range?p.range[0]:""; $("sqhi").value=p.range?p.range[1]:"";
  $("sqdl").querySelector("option[data-auto]")?.remove(); $("sqdl").value="0"; $("sqdate").value=""; $("sqdate").min=new Date(Date.now()+86400000).toISOString().slice(0,10);
  sqDL={kind:null}; sqDLTouched=!!p.deadline; if(p.deadline) sqDLAuto({kind:"abs", abs:p.deadline}, `block ${fmt(p.deadline)}`);   // a searched name keeps its deadline
  sqMin.reset(p.min||0);
  sqTouched=!!(p.opts||p.range||kindHint); sqAuto=false; sqStem=null; if(!sqTouched) sqDetect();
  $("sqfirst").checked=false; SQFIRST=""; SQADDR=null;
  $("sqtitle").textContent=reg?"Register topic":"New topic"; $("sqbatchnote").hidden=true;
  sqTip.reset(sqTipDefault());
  sqAmt.reset(REG_SATS); sqSnap=null; $("sqfeeadv").open=false;   // every open: the plain 330 until its edit is asked for
  sqRender(); updateList();
  sqOpener=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:$("newscope");
  $("scopedlg").showModal(); sqGo(1);
  tipFresh().then(()=>{ if($("scopedlg").open) sqRender(); });   // a deadline is only set from a tip read on this visit
}
// ---------- read the kind from the question (a guess, shown and changeable, never silent) ----------
const YN=/^(should|is|are|do|does|can|could|will|would|has|have|did|was|were|shall|must)\b/;
const NUMQ=/^(how (many|much|long|old|far|big|high|low)|what (price|year|number|percentage|age|size|amount)|at what|when will|which year|in which year)\b/;
const MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
function suggest(raw){
  const t=raw.trim().toLowerCase().replace(/[?!.]+$/,"").trim(); if(!t) return null;
  const words=x=>x.trim().split(/\s+/).filter(Boolean).length;
  let m, when=null, deadline=null;                                 // when: the date the question resolves, then blocks from now
  if((m=t.match(/\b(by|before|until|end of)\s+(?:the\s+end\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/))) when=new Date(+m[3], MONTHS.indexOf(m[2])+(m[1]==="before"?0:1), 1);   // "before march 2027": March 1; "by", "until", "end of": the month's end
  else if((m=t.match(/\b(by|before|until)\s+(?:the\s+)?(end\s+of\s+)?(\d{4})(-\d{2}-\d{2})?\b/))) when = m[4] ? new Date(m[3]+m[4]) : new Date(+m[3]+(m[2]||m[1]==="until"?1:0),0,1);
  else if((m=t.match(/\b(?:end of|in)\s+(\d{4})\b/))) when=new Date(+m[1]+1,0,1);   // "in 2026", "end of 2026": resolved when the year is over
  else if(/\bthis year\b/.test(t)) when=new Date(new Date().getFullYear()+1,0,1);
  if(when){ const blocks=Math.round((when-Date.now())/600000); if(blocks>0) deadline=blocks; }
  const withDl=o=>Object.assign(o,{deadline});
  if(/\btrue or false\b/.test(t)) return withDl({kind:"opts",opts:["true","false"]});
  if(/\b(yes\s*\/\s*no|y\/n|or not)\b/.test(t) || YN.test(t)) return withDl({kind:"opts",opts:["yes","no"]});
  if((m=t.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/)) && words(m[1])<=3 && words(m[2])<=3) return withDl({kind:"opts",opts:[m[1],m[2]]});
  if((m=t.match(/(?:between\s+|from\s+)?(-?\d+(?:\.\d+)?)\s*(?:to|-|–|and)\s*(-?\d+(?:\.\d+)?)\b/))) return withDl({kind:"range",range:[+m[1],+m[2]].sort((a,b)=>a-b)});
  if(/%|\bpercent/.test(t)) return withDl({kind:"range",range:[0,100]});
  if(NUMQ.test(t)) return withDl(/\byear\b|^when will/.test(t) ? {kind:"range",range:[new Date().getFullYear(),2100]} : {kind:"range",range:null});
  if(/\bprice\b/.test(t)) return withDl({kind:"range",range:null});   // "btc price end of 2026": a number, and its deadline
  const ci=t.indexOf(":"), wm=ci<0&&t.match(/^((?:which|what)\b[^,]*?),\s*/);   // "best wallet: a, b or c", "which is best, a, b or c": the question, then its options
  const list= ci>=0 ? t.slice(ci+1) : wm ? t.slice(wm[0].length) : t, stem= ci>0 ? t.slice(0,ci).trim() : wm ? wm[1].trim() : null;
  const parts=[...new Set(list.split(/\s*,\s*|\s+or\s+|\s+\/\s+/).map(x=>x.trim()).filter(Boolean))];
  if(parts.length>=2 && parts.every(x=>words(x)<=3)) return withDl({kind:"opts",opts:parts,stem});   // stem: the question without its list, so the name does not carry the options twice
  if(deadline) return {kind:null,deadline};
  return null;
}
const dlDate=b=>new Date(Date.now()+b*600000).toLocaleDateString(undefined,{dateStyle:"medium"});
// the kind the question reads as, preselected (and its fields filled) until a chip or a field is touched
function sqDetect(){
  if(sqTouched) return;
  const sg=suggest($("sqq").value); sqAuto=false; sqStem=null; sqk="open";
  if(sg&&sg.kind==="opts"){ const o=sg.opts; sqAuto=true; sqStem=sg.stem||null;
    if(o.length===2&&o.includes("yes")&&o.includes("no")) sqk="yes-no"; else if(o.length===2){ sqk="duel"; $("sqa").value=o[0]; $("sqb").value=o[1]; } else { sqk="poll"; pollFields(o); } }
  if(sg&&sg.kind==="range"){ sqAuto=true; sqk="number"; $("sqlo").value=sg.range?sg.range[0]:""; $("sqhi").value=sg.range?sg.range[1]:""; }
  if(!sqDLTouched){ if(sg&&sg.deadline) sqDLAuto({kind:"rel", blocks:sg.deadline, abs:null}, "by "+dlDate(sg.deadline)); else { $("sqdl").querySelector("option[data-auto]")?.remove(); $("sqdl").value="0"; sqDL={kind:null}; } }
}
// a deadline the dialog proposes (a guess, a searched name's block): one extra option in Closes, selected
function sqDLAuto(dl, text){
  let o=$("sqdl").querySelector("option[data-auto]"); if(!o){ o=document.createElement("option"); o.dataset.auto="1"; $("sqdl").appendChild(o); }
  o.value=dl.kind==="abs"?"abs":String(dl.blocks); o.dataset.abs=dl.abs||""; o.textContent=text; $("sqdl").value=o.value; sqDL=dl;
}
$("sqq").oninput=()=>{ sqDetect(); sqRender(); };
$("sqfirst").onchange=()=>{ if(!$("sqfirst").checked) SQFIRST=""; sqRender(); };
$("sqfirstopts").onclick=e=>{ const b=e.target.closest("[data-first]"); if(!b) return; SQFIRST=b.dataset.first; sqRender(); };
const sqTouch=()=>{ if(sqAuto&&sqStem&&!$("sqq").value.includes(":")) $("sqq").value=sqStem; sqTouched=true; sqAuto=false; sqStem=null; };   // the guess becomes the reader's
document.querySelectorAll("#sqkinds [data-k]").forEach(b=>b.onclick=()=>{ sqTouch(); sqk=b.dataset.k; if(sqk==="poll"&&!pollInputs().length) pollFields(); sqRender();
  ($(sqk==="duel"?"sqa":sqk==="number"?"sqlo":"sqq")||$("sqq")).focus({preventScroll:true}); if(sqk==="poll") pollInputs().find(i=>!i.value)?.focus(); });
$("sqdetect").onclick=e=>{ if(e.target.closest("[data-kchange]")){ sqTouch(); sqRender(); $("sqkinds").querySelector('[aria-pressed="true"]').focus(); } };
["sqa","sqb","sqlo","sqhi"].forEach(id=>$(id).addEventListener("input",()=>{ sqTouch(); sqRender(); }));
$("sqpollopts").addEventListener("input",()=>{ sqTouch(); sqRender(); });
$("sqaddopt").onclick=()=>{ const n=pollInputs().length; $("sqpollopts").insertAdjacentHTML("beforeend",`<input class="mono" placeholder="Option ${n+1}" autocomplete="off" spellcheck="false" aria-label="Option ${n+1}">`); pollInputs()[n].focus(); };
const sqUnitIn=()=>{ const w=$("squnitc").value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"").replace(/^\p{N}+/u,""); return w?"-in-"+w:""; };   // Custom: one word, a letter first ("km/h" → "-in-kmh")
document.querySelectorAll("#squnit [data-u]").forEach(b=>b.onclick=()=>{ sqUnitCustom=b.dataset.u==="custom"; sqUnit=sqUnitCustom?sqUnitIn():b.dataset.u; sqRender(); if(sqUnitCustom) $("squnitc").focus(); });
$("squnitc").oninput=()=>{ sqUnit=sqUnitIn(); sqRender(); };
const sqDateAt=()=>{ const v=$("sqdate").value; return v ? Date.parse(v+"T00:00:00Z")||0 : 0; };
$("sqdl").onchange=()=>{ const v=$("sqdl").value, o=$("sqdl").selectedOptions[0];
  sqDL= v==="date" ? {kind:"date", at:sqDateAt(), abs:null} : v==="abs" ? {kind:"abs", abs:+o.dataset.abs} : +v ? {kind:"rel", blocks:+v, abs:null} : {kind:null}; sqDLTouched=true;
  if(sqDL.kind&&!TIPLIVE) tipFresh().then(()=>{ if($("scopedlg").open) sqRender(); });
  sqRender(); if(v==="date") $("sqdate").focus(); };
$("sqdate").oninput=()=>{ sqDL={kind:"date", at:sqDateAt(), abs:null}; sqDLTouched=true; sqRender(); };
$("sqrulesline").onclick=e=>{ if(e.target.closest("[data-editrules]")){ sqSnap=sqRulesSnap(); sqGo(2); } };   // the deadline and the minimum, in their own view
// the rules and the fee views change the values live; Cancel puts back what the view started from, Apply keeps them
let sqSnap=null;
const sqRulesSnap=()=>({dl:$("sqdl").innerHTML, dlv:$("sqdl").value, dlk:JSON.stringify(sqDL), date:$("sqdate").value, min:$("sqmin").value, dlt:sqDLTouched});
function sqRulesPut(s){ $("sqdl").innerHTML=s.dl; $("sqdl").value=s.dlv; sqDL=JSON.parse(s.dlk); $("sqdate").value=s.date; sqMin.reset(s.min); sqDLTouched=s.dlt; sqRender(); }
const sqFeeSnap=()=>({amt:$("sqamt").value, tip:$("listtip").value, fee:feeSpeed()});
function sqFeePut(s){ sqAmt.reset(s.amt); sqTip.reset(s.tip); sqTipSave(); LS(NETKEY("bv.fee"),s.fee); $("sqamtusd").textContent=usdOf(regSats()); updateList(); PAY.forEach(p=>p.paint()); }
$("sqapply").onclick=()=>{ if(!sqValid(sqStep)) return; sqSnap=null; sqGo(1); };
$("sqcancel").onclick=()=>{ const s=sqSnap; sqSnap=null; if(s) (sqStep===2?sqRulesPut:sqFeePut)(s); sqGo(1); };
const sqMin=amountChips($("sqminseg"), $("sqmin"), ()=>sqRender());   // None, 1,000, 5,000, 10,000 or a custom whole number of 330 and up
$("sqmin").addEventListener("input",()=>sqRender());
const sqAmt=amountChips($("sqamtseg"), $("sqamt"), ()=>{ $("sqamtusd").textContent=usdOf(regSats()); updateList(); sqPaint(); });   // the initial sponsorship: 330 registers, more ranks it at once
$("sqamt").addEventListener("input",()=>{ $("sqamtusd").textContent=usdOf(regSats()); updateList(); sqPaint(); });
$("sqprice").onclick=e=>{ if(e.target.closest("[data-regfee]")){ sqSnap=sqFeeSnap(); sqGo(3); } };
$("sqback").onclick=()=>sqGo(1);
spay.onpaint=()=>sqPaint();   // the fee under the price follows the wallet
// a topic just registered here shows at once, in the mempool: the directory takes the burn, the topic is counted, the explorer confirms it later
const dirMine=vs=>{ dirAddPending(vs.map(cleanVote).filter(Boolean)); renderDir(); dirTopics({only:d=>!d.stats, onTopic:renderSoon}); };
spay.wallet.onsent=({txid})=>{ const v={txid, t:$("listname").value.trim(), sats:regSats(), h:null, from:WALLET?WALLET.addr:"", vout:0, at:Date.now()}; DB.putPending("",[v]); dirMine([v]);
  if(SQFIRST&&SQADDR&&SQADDR.name===v.t&&sqFirstFits()) DB.putPending(v.t,[{...v, t:SQFIRST, sats:REG_SATS, vout:1}]); };   // the first answer too: the topic opens with it, in the mempool
globalThis.addPending=(name,vs)=>{                        // the batch (ballotui.js): root burns register or sponsor, the others are takes in a listed topic
  if(name===""){ dirMine(vs); return; }
  const d=DIRECTORY.find(x=>x.name===name); if(!d) return;
  dirCount(d,[...vs.map(cleanVote).filter(Boolean), ...(cache[name]||[])]); renderDir(); };      // the wallet block repaints (wallet created, unlocked, balance in) → the footer primary follows
$("newscope").onclick=()=>openScopeDialog("",false);
{ const n=URLQ.get("new"), c=URLQ.get("create"); if(n) openScopeDialog(n,true); else if(c&&c in KINDS) openScopeDialog("",false,c); }   // a link that asks to register a name (a poll that outgrew its options) or to start from a kind (Home's cards)
$("regunreg").onclick=()=>openScopeDialog(sq,true);
segThumbs();

