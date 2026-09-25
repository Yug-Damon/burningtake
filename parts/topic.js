// ---------- leaderboard ----------
const list=$("list"), status=$("status");
try{ Object.keys(localStorage).filter(k=>k.startsWith("bv.cache.")).forEach(k=>localStorage.removeItem(k)); }catch{}
let S=[], agg={}, q="", seq=0, win=winGet();                // win: the time window shared with Explore (shared.js winGet / winSet)
// (the IndexedDB cache lives in db.js: DB.sync / votes / put / putPending / byTx, shared with the ballot and the receipt page)
let late={sats:0,votes:0}, dust={sats:0,votes:0};
let SEEN=[], BUCKET=new Map(), BURN={};                  // every burn seen this scan, txid -> "late"|"dust" for the ones not counted, burner address -> {sats, votes} (counted only)
function addVote(v){ SEEN.push(v); countVote(v); }
function recount(){ agg={}; late={sats:0,votes:0}; dust={sats:0,votes:0}; BUCKET=new Map(); BURN={}; SEEN.forEach(countVote); S=Object.values(agg); render(); }   // the window changed: count again from every burn seen
function countVote(v){                                       // only burns inside the time window count; the header's 30-day strip still reads every burn
  const p=scope.spec||{};
  if (win!=="all" && v.h!==null && v.h < TIP-WIN[win]) { BUCKET.set(v.txid,"window"); return; }
  if (p.deadline && (v.h===null ? TIP+1>=p.deadline : v.h>=p.deadline)) { late.sats+=v.sats; late.votes++; BUCKET.set(v.txid,"late"); return; }
  if (p.min && v.sats<p.min) { dust.sats+=v.sats; dust.votes++; BUCKET.set(v.txid,"dust"); return; }
  let k=norm(v.t), t=v.t;
  if (p.range){ const x=numOf(v.t); if(Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1]){ k="n:"+x; t=String(x); } }   // number answers merge by value: "150k" and "150000" are one row
  const a=agg[k]||(agg[k]={t,sats:0,votes:0,last:0});
  a.sats+=v.sats; a.votes++; a.last=Math.max(a.last, v.h??Infinity);
  if (v.from){ const b=BURN[v.from]||(BURN[v.from]={sats:0,votes:0}); b.sats+=v.sats; b.votes++; }
}
const bucketsHtml=()=>{                                       // muted lines, only when a bucket holds burns; hidden during a search
  if(q) return "";
  const line=(label,b)=>`<div class="bucket">${label} · not counted · ${fmt(b.sats)} sats in ${b.votes} burn${b.votes===1?"":"s"}</div>`;
  return (late.votes?line("Late",late):"") + (dust.votes?line("Below minimum",dust):"");

};
const PHONE=matchMedia("(max-width:480px)");
const isClosed=()=>{ const p=scope.spec||{}; return !!(p.deadline&&p.deadline<=TIP); };
const shareOf=s=>s.total?s.sats/s.total*100:0;
const rowHtml=(s,i,cls="")=>{ const sh=shareOf(s); return `
    <div class="st ${cls}" data-vote-row="${esc(s.t)}">
      <span class="rank">${typeof i==="number"?String(i+1).padStart(2,"0"):i}</span>
      <span class="txt">${esc(s.disp??s.t)}</span>
      <span class="sats">${fmt(s.sats)}<small> sats</small></span>
      <span class="votes">${s.votes} burn${s.votes===1?"":"s"}</span>
      <span class="act">${isClosed()?"":`<button class="btn sm" data-vote="${esc(s.t)}">Burn for it</button>`}</span>
      <span class="plus" aria-hidden="true">${isClosed()?"":"+"}</span>
      <span class="bar" style="width:${sh.toFixed(1)}%"></span>
    </div>`; };
// ---- smooth updates: rows are keyed by norm(statement) and patched in place; numbers tween, bars transition, reorders FLIP ----
const ROWS=new Map(); let DUEL=null;                    // persistent row elements (open/poll/duel "other"), the duel block
const htmlEl=h=>{ const t=document.createElement("template"); t.innerHTML=h.trim(); return t.content.firstElementChild; };
const htmlEls=h=>{ const t=document.createElement("template"); t.innerHTML=h; return [...t.content.children]; };
function tween(host,key,to,paint){                      // host[key] = target, host[key+"_cur"] = value currently painted; eases to `to` over ~350ms
  const from=host[key+"_cur"]??host[key]??to; host[key]=to; cancelAnimationFrame(host[key+"_raf"]);
  const show=v=>{ host[key+"_cur"]=v; paint(v); };
  if(RM.matches||from===to){ show(to); return; }
  const t0=performance.now();
  const step=now=>{ const p=Math.min(1,(now-t0)/350), e=1-Math.pow(1-p,3); show(from+(to-from)*e); if(p<1) host[key+"_raf"]=requestAnimationFrame(step); };
  host[key+"_raf"]=requestAnimationFrame(step);
}
function rowEl(s,i,cls){                                // s carries total (for the share); returns the row for this statement, created or patched
  const k=norm(s.t), sh=shareOf(s);
  let r=ROWS.get(k);
  if(!r){ r=htmlEl(rowHtml(s,i,cls)); r.dataset.key=k; r._t=s.t; r._sats=s.sats; ROWS.set(k,r); return r; }
  r.className="st "+cls; r.querySelector(".rank").textContent= typeof i==="number"?String(i+1).padStart(2,"0"):i;
  if(r._t!==s.t){ r._t=s.t; r.querySelector(".txt").textContent=s.disp??s.t; r.dataset.voteRow=s.t; const b=r.querySelector("[data-vote]"); if(b) b.dataset.vote=s.t; }
  r.querySelector(".votes").textContent=`${s.votes} burn${s.votes===1?"":"s"}`;
  const sats=r.querySelector(".sats");
  tween(r,"_sats",s.sats,v=>{ sats.firstChild.nodeValue=fmt(Math.round(v)); });
  r._barW=sh.toFixed(1)+"%";                           // applied in commit(), after the DOM move, so the width transition runs
  return r;
}
const snapshot=()=> RM.matches ? null : new Map([...list.querySelectorAll(".st[data-key]")].map(r=>[r,r.getBoundingClientRect().top]));   // FLIP: first
function commit(order,before){                           // order: top-to-bottom children; persistent rows glide to their new slot
  for(const [k,r] of ROWS) if(!order.includes(r)) ROWS.delete(k);
  list.replaceChildren(...order);
  const moved=[];
  if(before) for(const r of order){ const t=before.get(r); if(t===undefined) continue; const d=t-r.getBoundingClientRect().top; if(Math.abs(d)<1) continue; r.style.transition="none"; r.style.transform=`translateY(${d}px)`; moved.push(r); }
  void list.offsetHeight;                                // re-inserted nodes need a computed style before a change can transition
  for(const r of ROWS.values()) if(r._barW){ r.querySelector(".bar").style.width=r._barW; r._barW=null; }
  if(DUEL&&DUEL._w){ const [a,b]=DUEL._w; DUEL.querySelector(".duel-bar div.a").style.width=a.toFixed(1)+"%"; DUEL.querySelector(".duel-bar div.b").style.width=b.toFixed(1)+"%"; DUEL._w=null; }
  for(const r of moved){ r.style.transition="transform .3s ease"; r.style.transform=""; }
  if(moved.length) setTimeout(()=>moved.forEach(r=>{ r.style.transition=""; r.style.transform=""; }),320);
}
function duelEl(A,B,pa,tot){
  const nA=!!tot&&pa<12, nB=!!tot&&100-pa<12, pct=v=>v.toFixed(0)+"%", vt=x=>`${x.votes} burn${x.votes===1?"":"s"}`, key=[!!tot,nA,nB,isClosed()].join();
  if(!DUEL||DUEL._key!==key){                             // the layout changes (empty, a narrow side, closed): build it again; otherwise patch and tween
    DUEL=htmlEl(`
    <div class="duel${tot?"":" empty"}">
      <div class="duel-head"><span class="a">${esc(A.t)}<b class="side pa">${nA?pct(pa):""}</b></span><span class="b"><b class="side pb">${nB?pct(100-pa):""}</b>${esc(B.t)}</span></div>
      <div class="duel-bar"><div class="a" style="width:${pa.toFixed(1)}%"></div><div class="b" style="width:${(100-pa).toFixed(1)}%"></div><span class="pct a">${tot&&!nA?pct(pa):""}</span><span class="pct b">${tot&&!nB?pct(100-pa):""}</span></div>
      <div class="duel-foot">
        <div><b>${fmt(A.sats)}</b> <span class="va">sats · ${vt(A)}</span><br><button class="btn sm dbtn da" data-vote="${esc(A.t)}">Burn for ${esc(A.t)}</button></div>
        <div style="text-align:right"><b>${fmt(B.sats)}</b> <span class="vb">sats · ${vt(B)}</span><br><button class="btn sm dbtn db" data-vote="${esc(B.t)}">Burn for ${esc(B.t)}</button></div>
      </div>
    </div>`);
    DUEL._key=key; DUEL._pa=pa; DUEL._a=A.sats; DUEL._b=B.sats; return DUEL;
  }
  const q=sel=>DUEL.querySelector(sel);
  if(tot) tween(DUEL,"_pa",pa,v=>{ q(nA?".side.pa":".pct.a").textContent=pct(v); q(nB?".side.pb":".pct.b").textContent=pct(100-v); });
  tween(DUEL,"_a",A.sats,v=>q(".duel-foot b").textContent=fmt(Math.round(v)));
  tween(DUEL,"_b",B.sats,v=>q(".duel-foot div:last-child b").textContent=fmt(Math.round(v)));
  q(".va").textContent=`sats · ${vt(A)}`; q(".vb").textContent=`sats · ${vt(B)}`;
  DUEL._w=[pa,100-pa];                                  // applied in commit(), after the DOM move
  return DUEL;
}
function render(){ renderList(); renderStand(); renderBurners(); }
let synced=false, boardAll=false, othersOpen=false;       // synced: the first full load of this topic is done; boardAll: the board past its first rows; othersOpen: the off-list line expanded
const capBoard=rows=>{ const cap=PHONE.matches?5:10, word=kind(scope.spec||{})==="open"?"takes":"answers";   // 10 rows on desktop, 5 on phone, "Show all" expands in place
  if(q || rows.length<=cap) return [rows,""];
  return boardAll ? [rows,`<button type="button" class="showall" data-showall>Show fewer</button>`] : [rows.slice(0,cap),`<button type="button" class="showall" data-showall>Show all ${rows.length} ${word}</button>`]; };
const othersHtml=other=>{ if(!other.length) return "";   // off-list answers: one muted line, not part of the result
  const tot=other.reduce((a,s)=>a+s.sats,0), n=other.reduce((a,s)=>a+s.votes,0), top=other.slice().sort((a,b)=>b.sats-a.sats);
  return `<details class="others"${othersOpen?" open":""}><summary>Other answers · not in the result · ${fmt(tot)} sats in ${n} burn${n===1?"":"s"}</summary><div class="orows">${top.slice(0,5).map(s=>`<div class="orow"><span>${esc(s.t)}</span><span>${fmt(s.sats)} sats</span></div>`).join("")}${top.length>5?`<div class="orow more">+ ${top.length-5} more</div>`:""}</div></details>`; };
const quietHtml=()=>`<div class="emptybox quietbox">No burns ${WINLABEL[win]}. <button type="button" class="linkbtn" data-win-all>All time</button></div>`;
function renderList(){
  const bySort=(a,b)=>b.sats-a.sats;                          // always by sats: the time window decides which burns count
  const p=scope.spec||{}, k=kind(p), matches=s=>(s.disp??s.t).toLowerCase().includes(q)||s.t.toLowerCase().includes(q);
  $("numtop").hidden=k!=="number"||!synced&&!S.length; if(k!=="number") $("numtop").innerHTML="";   // number topics: tiles + histogram sit above the board
  if(synced && !SEEN.length){                                 // no burn at all: one dashed box; the window, search, notes and lists go
    ROWS.clear(); DUEL=null; $("numtop").hidden=true;
    list.innerHTML=`<div class="emptybox">No ${k==="open"?"takes":"answers"} yet · <button type="button" class="linkbtn" data-first>burn the first one</button></div>`; return; }
  if (k==="duel"){
    if(synced && !S.length){ ROWS.clear(); DUEL=null; list.innerHTML=quietHtml()+bucketsHtml(); return; }
    const before=snapshot();
    const [A,B]=p.opts.map(o=>S.find(s=>norm(s.t)===o)||{t:o,sats:0,votes:0,last:0});
    const tot=A.sats+B.sats, pa=tot?A.sats/tot*100:50;
    const other=S.filter(s=>!p.opts.includes(norm(s.t)));
    commit([duelEl(A,B,pa,tot), ...htmlEls(othersHtml(other)+bucketsHtml())], before);
    return;
  }
  if (k==="number"){
    const [lo,hi]=p.range, ints=Number.isInteger(lo)&&Number.isInteger(hi);
    const valid=S.map(s=>({...s,x:numOf(s.t)})).filter(s=>Number.isFinite(s.x)&&s.x>=lo&&s.x<=hi);
    const other=S.filter(s=>{const x=numOf(s.t);return !(Number.isFinite(x)&&x>=lo&&x<=hi)});
    const tot=valid.reduce((a,s)=>a+s.sats,0);
    const mean=tot?valid.reduce((a,s)=>a+s.x*s.sats,0)/tot:null, median=weightedMedian(valid);
    const nf=x=>x===null?"—":x.toLocaleString("en-US",{maximumFractionDigits:ints?0:2});   // mean and median rounded the same way
    const bins=Array(10).fill(0); for(const s of valid){ const i=Math.min(9,Math.floor((s.x-lo)/((hi-lo)||1)*10)); bins[i]+=s.sats; }
    const bmax=Math.max(1,...bins), peak=bins.indexOf(Math.max(...bins)), pos=x=>Math.max(0,Math.min(100,(x-lo)/((hi-lo)||1)*100)).toFixed(1);
    const near=mean!==null&&Math.abs(pos(mean)-pos(median))<9;   // mean and median too close for two labels: one tick
    $("numtop").innerHTML=`
    <div class="numstats">
        <div><b>${nf(mean)}</b><span>mean<span class="more"> · weighted by sats</span></span></div>
        <div><b>${nf(median)}</b><span>median</span></div>
        <div><b>${fmt(tot)}</b><span>sats · ${valid.length} value${valid.length===1?"":"s"}</span></div>
    </div>
    <div class="numview">
      <div class="hist">${tot ? bins.map((b,i)=>`<div title="${nf(lo+(hi-lo)*i/10)} – ${nf(lo+(hi-lo)*(i+1)/10)}: ${fmt(b)} sats"><i style="height:${(b/bmax*100).toFixed(0)}%">${i===peak?`<b>${satsShort(b)}</b>`:""}</i></div>`).join("") : `<p class="histempty">No values burned ${win==="all"?"yet":WINLABEL[win]}</p>`}</div>
      ${tot ? `<div class="hist-ticks">${near?`<i style="left:${pos(mean)}%">mean · median</i>`:`<i style="left:${pos(mean)}%">mean</i><i style="left:${pos(median)}%">median</i>`}</div>` : ""}
      <div class="hist-axis"><span>${nf(lo)}</span><span>${nf((lo+hi)/2)}</span><span>${nf(hi)}</span></div>
    </div>`;
    ROWS.clear();                                        // the number view repaints instantly
    const [shown,more]=capBoard(valid.filter(matches).sort(bySort).map(s=>({...s,total:tot,disp:s.x.toLocaleString("en-US",{maximumFractionDigits:2})})));
    list.innerHTML = (synced&&!S.length ? quietHtml() : shown.map((s,i)=>rowHtml(s,i)).join("")+more) + othersHtml(other.filter(matches)) + bucketsHtml();
    return;
  }
  if (k==="poll"){
    if(synced && !S.length){ ROWS.clear(); list.innerHTML=quietHtml()+bucketsHtml(); return; }
    const before=snapshot();
    const main=p.opts.map(o=>S.find(s=>norm(s.t)===o)||{t:o,sats:0,votes:0,last:0}).sort(bySort);   // stable: options nobody burned for keep their order, ranked "·"
    const total=main.reduce((a,s)=>a+s.sats,0), other=S.filter(s=>!p.opts.includes(norm(s.t)));
    const [shown,more]=capBoard(main.filter(matches).map((s,i)=>({...s,total,rank:s.sats?i:"·"})));
    commit([...shown.map(s=>rowEl(s,s.rank,"")), ...htmlEls(more+othersHtml(other)+bucketsHtml())], before);
    return;
  }
  const total=S.reduce((a,s)=>a+s.sats,0), rows = S.filter(matches).sort(bySort).map(s=>({...s,total}));
  if (rows.length){ const before=snapshot(); const [shown,more]=capBoard(rows); commit([...shown.map((s,i)=>rowEl(s,i)), ...htmlEls(more+bucketsHtml())], before); return; }
  ROWS.clear();
  const raw=$("q").value.trim();
  list.innerHTML = (raw ? `
    <div class="st newrow" data-vote-row="${esc(raw)}" data-new>
      <span class="rank">new</span>
      <span class="txt">${esc(raw)}</span>
      <span class="sats">0<small> sats</small></span>
      <span class="votes">nobody yet</span>
      <span class="act"><button class="btn sm primary" data-vote="${esc(raw)}" data-new>Burn for it</button></span>
      <span class="plus" aria-hidden="true">+</span>
    </div>` : synced ? quietHtml() : "") + bucketsHtml();
}
// the standings head: what the board totals in this window, and the window itself
function renderStand(){
  const p=scope.spec||{}, k=kind(p), none=synced&&!SEEN.length;
  $("standings").hidden=none;
  $("q").hidden = k!=="open" || !SEEN.length;                 // the search: open topics with takes
  const on=k==="open" ? S : k==="number" ? S.filter(s=>{const x=numOf(s.t); return Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1];}) : S.filter(s=>p.opts.includes(norm(s.t)));
  const sats=on.reduce((a,s)=>a+s.sats,0), n=on.filter(s=>s.sats>0).length, word=k==="open"?"take":"answer";
  $("standsum").textContent=[isClosed()?`Final · block ${fmt(p.deadline)}`:null, k==="duel"?null:`${fmt(n)} ${word}${n===1?"":"s"}`, `${fmt(sats)} sats`, WINLABEL[win]].filter(Boolean).join(" · ");
}
const ghostFor = k => k==="duel"                               // loading: the final shape of each kind, unranked, at its final height
  ? `<div class="duel ghost"><div class="duel-head"><span class="sk" style="width:70px;height:16px"></span><span class="sk" style="width:70px;height:16px"></span></div><div class="duel-bar"></div><div class="duel-foot"><span class="sk" style="width:120px"></span><span class="sk" style="width:120px"></span></div></div>`
  : Array.from({length:4},()=>`
    <div class="st ghost"><span class="rank"></span><span class="txt"><span class="sk" style="width:${40+Math.random()*40}%"></span></span>
    <span class="sats"><span class="sk" style="width:80px"></span></span><span class="votes"><span class="sk" style="width:50px"></span></span><span class="act"></span></div>`).join("");
const numGhost = () => `<div class="numstats">${'<div><b><span class="sk" style="width:90px;height:18px"></span></b><span class="sk" style="width:60px;height:9px"></span></div>'.repeat(3)}</div><div class="numview"><div class="hist">${'<div></div>'.repeat(10)}</div><div class="hist-axis"><span>&nbsp;</span></div></div>`;

async function loadScope(name){
  const my=++seq;
  S=[]; agg={}; late={sats:0,votes:0}; dust={sats:0,votes:0}; ROWS.clear(); DUEL=null; SEEN=[]; BUCKET=new Map(); BURN={};   // a new scope starts from fresh rows
  synced=false; boardAll=false; othersOpen=false; $("burners").hidden=true;
  const k0=kind(scope.spec||{}); list.innerHTML=ghostFor(k0); $("numtop").hidden=k0!=="number"; $("numtop").innerHTML=k0==="number"?numGhost():"";   // a skeleton of this kind, never the previous topic's
  renderStand();
  const spin=`<span class="spin"></span>`, dot=`<span class="dot"></span>`;
  const r=await loadVotes(name,{                             // loader.js: IndexedDB → snapshot → explorer; this page only paints
    addr:scope.addr, cancelled:()=>my!==seq,
    onPage:votes=>{ votes.forEach(addVote); S=Object.values(agg); render(); },
    onPhase:p=>{ status.innerHTML=
      p.phase==="cache" ? (p.source ? `${spin} ${p.count} burn${p.count===1?"":"s"} from cache<span class="more"> · checking for burns after ${p.lastTx?p.lastTx.slice(0,8)+"…":"start"}</span>` : `${spin} opening cache…`)
    : p.phase==="snapshot" ? (p.source ? `${spin} ${p.count} burn${p.count===1?"":"s"} from snapshot · block ${fmt(p.height)}<span class="more"> · checking newer burns</span>` : `${spin} looking for a snapshot…`)
    : p.phase==="scan" ? `${spin} scanning<span class="more"> ${scope.addr.slice(0,14)}…</span> · request ${p.page} · ${p.count} burn${p.count===1?"":"s"}`
    : p.phase==="error" ? `the explorer did not answer${p.count?` · ${p.count} burn${p.count===1?"":"s"} known to this browser`:""} · <button type="button" class="linkbtn" data-retry>retry</button>`
    : !p.count ? `${dot} synced · block ${fmt(TIP)} · no burns yet`
    : `${dot} synced · block ${fmt(TIP)} · ${p.count} burn${p.count===1?"":"s"}`; },   // synced: block and burns only; source and requests show while loading
  });
  if(!r) return;
  SEEN=r.votes.slice(); synced=true; recount();              // the loader's list is the whole truth: the mempool as the explorer lists it now
  watchMarkSeen(name,r.votes.length,TIP);                   // a watched topic: what this browser has now seen, so the watchlist can say "N new burns"
}
// a burn signed in this browser (single or ballot) lands on the board at once as pending; the explorer takes over on the next scan
globalThis.addPending=(name,votes)=>{ if(name===""){ dirAddPending(votes.map(cleanVote).filter(Boolean)); headMeta(); return; } if(name!==scope.name) return; (cache[name]||(cache[name]=[])).unshift(...votes); votes.forEach(addVote); S=Object.values(agg); render(); };
status.addEventListener("click",e=>{ if(e.target.closest("[data-retry]")) go(); });   // the explorer did not answer: another try, when the reader asks
list.addEventListener("toggle",e=>{ if(e.target.matches("details.others")) othersOpen=e.target.open; },true);   // the off-list line stays as the reader left it
PHONE.addEventListener("change",()=>render());                                // 10 rows on desktop, 5 on phone
document.querySelectorAll("#tseg [data-win]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.win===win)); b.onclick=()=>{
  if(b.dataset.win===win) return;
  document.querySelectorAll("#tseg [data-win]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  win=b.dataset.win; winSet(win); recount();                 // remembered: Explore opens on the same window
}; });
$("q").oninput=e=>{q=e.target.value.toLowerCase();render()};
list.addEventListener("click",e=>{
  if(e.target.closest("[data-showall]")){ boardAll=!boardAll; render(); return; }
  if(e.target.closest("[data-win-all]")){ $("tseg").querySelector('[data-win="all"]').click(); return; }
  if(e.target.closest("[data-first]")){ $("burnbtn").click(); return; }
  let b=e.target.closest("[data-vote]");
  if(!b && PHONE.matches && !isClosed() && !e.target.closest("summary,a")){ const r=e.target.closest("[data-vote-row]"); if(r) b={dataset:{vote:r.dataset.voteRow}, hasAttribute:x=>r.hasAttribute(x)}; }   // phone: the row is the target
  if(!b) return;
  vOther=false; stmt.value=b.dataset.vote;
  if(scope.spec?.range && Number.isFinite(+b.dataset.vote)) $("num").value=b.dataset.vote;   // keep the number input in step with the row clicked
  update();
  openVote(!b.hasAttribute("data-new"), false, 2);                  // Burn for it: the take is chosen, straight to the amount                // an existing statement/option/number opens locked; the synthetic "new" row does not
});

let scope={name:"general",addr:"…",poll:null};

const vpay=payPanel("vpay",{speed:false}); PAY.push(vpay);   // the fee speed sits in the amount view (Advanced), not in the transaction
$("vfeehost").innerHTML=feeSegHtml("vfeeseg"); feeSegWire($("vfeeseg"));
const nfm=x=>Math.abs(+x)>=10000?fmt(+x):String(x);
$("tipaddr").textContent=TIP_EFFECTIVE || "not set yet · left out"; $("copytip").dataset.copy=TIP_EFFECTIVE||""; $("copytip").disabled=!TIP_EFFECTIVE;

// ---------- vote builder: real OP_RETURN script hex ----------
const stmt=document.getElementById("stmt"), amt=document.getElementById("amt"),
      bytesEl=document.getElementById("bytes"), hexEl=document.getElementById("hex"), usd=document.getElementById("usd");
const vAmt=amountChips($("vamtseg"), amt, ()=>update());   // presets over #amt; reset per topic in openScope (330 or the topic minimum)
const burnTitle=()=>{ const t=stmt.value.trim(), topic="#"+scope.q+(scope.spec&&(scope.spec.opts||scope.spec.range)?"?":"");   // a new take: the topic it burns for; an existing one (Burn for it): that take
  return vLocked&&t ? `Burn for “${kind(scope.spec||{})==="number"&&Number.isFinite(+t)?nfmt(t):t}”` : `Burn for ${topic}`; };
const amtLabelText=()=>featureMode ? "Amount to burn to sponsor" : `Amount to burn for this ${kind(scope.spec||{})==="open"?"take":"answer"}${scope.spec&&scope.spec.min?` · min ${fmt(scope.spec.min)}`:""}`;
function update(){
  if(!featureMode&&typeof scope!=="undefined"&&scope.spec) $("votehead").textContent=burnTitle();
  const payload=stmt.value.trim();
  const data=enc.encode(payload);
  const n=data.length;
  bytesEl.textContent=n; bytesEl.classList.toggle("over",n>80);
  hexEl.textContent=toHex(opReturnScript(data));                 // 6a + direct push (<=75) or OP_PUSHDATA1
  const b=burnSats();
  usd.textContent="sats"+(usdOf(b)?" · "+usdOf(b):"");
  const t=tipSats();
  $("tipusd").textContent=t?usdOf(t):"";
  $("tiprow").hidden=!t; amt.setAttribute("aria-invalid",String(!vValid2()));
  vpay.set({burnAddr:featureMode&&ROOT?ROOT.addr:scope.addr, burnSats:b, statementBytes:data, tipAddr:TIP_EFFECTIVE, tipSats:t});
  syncPollUI(); vPaint();
}
// effective amounts: the burn is the vote (never optional); tip only when ticked
const burnSats=()=>regMode ? REG_SATS : Number(amt.value||0);   // registering burns the fixed amount; the amount chips stay as they were for the next burn
const tipSats=()=>TIP_EFFECTIVE ? Math.max(0,Math.round(Number($("tip").value||0))) : 0;   // "No tip" is 0; no tip address on this network → never a tip output
const vTipSave=()=>{ if(tipEnabled()) LS(NETKEY("bv.vote.tipsats"),$("tip").value); };   // the tip chosen here is the next burn's (the batch shares it)
const vTip=amountChips($("vtipseg"), $("tip"), ()=>{ vTipSave(); update(); });
$("tip").oninput=()=>{ vTipSave(); update(); };
$("opts").onclick=e=>{const b=e.target.closest("[data-opt]"); if(!b||b.getAttribute("aria-disabled")==="true") return; vOther=false; stmt.value=b.dataset.opt; update();};
$("num").oninput=()=>{ stmt.value=$("num").value; update(); };
$("numrange").oninput=()=>{ $("num").value=$("numrange").value; stmt.value=$("num").value; update(); };
$("otherans").onclick=()=>{ vOther=true; stmt.value=""; update(); stmt.focus(); };   // off-list answer for a duel/poll: reveal the text field
let vStep=1, vOther=false, vLocked=false, featureMode=false, regMode=false, vEdit=false, ROOT=null;   // vEdit: the amount view stands in for the take (the price's edit)   // regMode: featureMode on a topic nobody registered yet (fixed REG_SATS, no amount step)   // featureMode: burn to the root topic with this topic's name (= registering, = sponsoring)
deriveScope("").then(r=>{ ROOT=r; });              // vLocked: opened from a row, the answer control is read-only until "change"; vote dialog step (1 Your vote, 2 Transaction); "other answer…" clicked: the text field stays visible even while it matches an option
const nfmt=x=>Number.isFinite(+x)&&String(x).trim()!==""?(+x).toLocaleString("en-US",{maximumFractionDigits:2}):"—";
function syncPollUI(){
  if(featureMode){ $("stmtfield").hidden=false; $("optfield").hidden=true; $("numfield").hidden=true; return; }
  $("stmtlabel").textContent=vOther?"Other answer":"Your take";
  if(scope.spec?.range){
    $("numrange").value=$("num").value; $("numbig").textContent=nfmt($("num").value);
    const numeric=Number.isFinite(+stmt.value.trim());
    $("stmtfield").hidden=numeric;
    const ok=numInRange(), [lo,hi]=scope.spec.range;
    $("numhint").textContent= ok ? `${nfm(lo)} – ${nfm(hi)}` : `must be between ${nfm(lo)} and ${nfm(hi)}`;
    $("numhint").classList.toggle("over",!ok); $("num").setAttribute("aria-invalid",String(!ok));
    return;
  }
  if(!scope.poll){ $("stmtfield").hidden=false; return; }
  const on=scope.poll.includes(norm(stmt.value));
  $("stmtfield").hidden=!vOther&&(on||!stmt.value.trim());   // nothing picked yet: chips only
  $("otherans").hidden=!$("stmtfield").hidden||vLocked;
  document.querySelectorAll("#opts [data-opt]").forEach(b=>{ const sel=b.dataset.opt===norm(stmt.value); b.classList.toggle("primary",sel); b.setAttribute("aria-pressed",String(sel)); });
}
vTip.reset(+LS(NETKEY("bv.vote.tipsats"))||0);   // default: no tip
if(!tipEnabled()){ $("vtipf").hidden=true; $("tiprow").hidden=true; }   // no tip address on this network: every tip control disappears (tipSats() is 0)
vpay.onpaint=vPaint;                                    // the wallet block repaints (wallet created, unlocked, balance in) → the footer primary follows
stmt.oninput=update; amt.oninput=update; update();

copyhex.onclick=()=>copyText(hexEl.textContent,copyhex);

async function openScope(n){
  n=(n||"general").trim().toLowerCase();
  const raw=new RegExp("^"+HRP+"1q[02-9ac-hj-np-z]{58}$").test(n);   // a raw P2WSH address of this network
  if(!raw) n=canonical(parseScope(n));                       // one question, one spelling, one address
  scope= raw ? {name:n.slice(0,8)+"…"+n.slice(-6), addr:n, script:"?", hash:"?"} : await deriveScope(n);
  scope.spec = raw ? {} : parseScope(scope.name);
  scope.poll = scope.spec.opts||null;
  scope.q = raw ? scope.name : scope.spec.q; const addrNow=scope.addr;
  $("q").value=""; q="";                                    // a new scope starts with an empty search (the page re-renders in place on hashchange)
  loadScope(scope.name); if($("votedlg").open) $("votedlg").close();
  $("addr").textContent=scope.addr;
  $("votehead").textContent=burnTitle();
  const k=kind(scope.spec); vOther=false;
  $("optfield").hidden=!scope.poll;
  $("opts").className="choice "+(k==="duel"?"pair":k);
  $("opts").innerHTML= scope.poll ? scope.poll.map(o=>`<button type="button" class="btn${k==="duel"?" big":""}" data-opt="${esc(o)}">${esc(o)}</button>`).join("") : "";
  $("opthint").textContent= k==="duel" ? "pick a side" : "pick one";
  const sp=scope.spec;
  const dl=sp.deadline?(sp.deadline>TIP?`closes ≈ ${new Date(Date.now()+(sp.deadline-TIP)*600000).toLocaleDateString()}`:"closed"):null;
  scope.rules=[sp.min?`min ${fmt(sp.min)} sats`:null, dl].filter(Boolean);   // what still matters when the take is given
  $("votesub").textContent=scope.sub=[k==="open"?"free text, 80 bytes max":k==="number"?`a number, ${nfm(sp.range[0])} – ${nfm(sp.range[1])}`:k==="duel"?"pick a side":`pick one of ${scope.poll.length}`, sp.min?`min ${fmt(sp.min)} sats`:null, dl].filter(Boolean).join(" · ");
  $("numfield").hidden=!sp.range;
  if (sp.range){
    const [lo,hi]=sp.range, r=$("numrange"), both=Number.isInteger(lo)&&Number.isInteger(hi);
    let step=Math.pow(10,Math.floor(Math.log10(Math.max((hi-lo)/100,1e-9)))); if(both) step=Math.max(1,step);   // a round step: 50000..500000 → 1000, 0..100 → 1
    r.min=lo; r.max=hi; r.step=step; $("num").min=lo; $("num").max=hi; $("num").value=lo; stmt.value=String(lo);
  } else stmt.value="";
  amt.min=sp.min||330; vAmt.reset(330);
  $("amtlabel").textContent=amtLabelText();
  $("closednote").hidden=!(sp.deadline && sp.deadline<=TIP);
  update();
  $("boardtitle").textContent= kind(scope.spec)==="open" ? `Hottest takes on #${scope.q}` : `${scope.q}?`;
  document.title=scope.q+" · Burning Take";
  headMeta(); Promise.all([tipReady(),dirLoad()]).then(()=>{ if(scope.addr===addrNow){ headMeta(); renderBurners(); } });   // the sponsor score and the countdown need the directory and the tip
  if(hashText()!==n) history.replaceState(null,"","#"+n);
}
$("copyaddr").onclick=()=>copyText($("addr").textContent,$("copyaddr"));

// ---------- vote dialog: view 2 is the take (or the amount in its place: the price's edit; sponsoring: the amount), view 4 the transaction ----------
function numInRange(){ const r=scope.spec?.range; if(!r) return true; const v=+stmt.value.trim(); return Number.isFinite(v) && v>=r[0] && v<=r[1]; }   // hoisted like vValid: a number scope only takes numbers inside its range
function vValid1(){ if(featureMode) return true; const raw=stmt.value.trim(); if(!raw) return false; if(!scope.spec?.range) return true; return Number.isFinite(+raw) ? numInRange() : vLocked; }   // a number topic takes in-range numbers, or an existing off-list row opened from the board
function vValid2(){ return burnSats()>=+(amt.min||330); }
function vValid(n=vStep){ return n<=1 ? vValid1() : vValid1()&&vValid2(); }   // step n reachable when everything before it holds   // hoisted: update() runs at load, before this section
function vPaint(){
  const first=2, sign=vStep>=first, s=vpay.wallet.status(), amtView=vStep===2&&(featureMode&&!regMode||vEdit);   // the first view: the take, or the amount in its place; the primary signs
  const sent=!!(s&&s.kind==="sent"), editing=vStep===2&&vEdit&&!featureMode; $("vprice").hidden=sent;   // editing: the amount in place of the take, Apply or Cancel
  $("vcancel").hidden=$("vapply").hidden=!editing; $("vapply").disabled=!vValid2();
  $("vsendwrap").hidden=!sign||editing; const t=tipSats();
  const edit=!regMode&&!amtView&&!(s&&(s.kind==="sent"||s.kind==="busy"));   // edit: the amount and the fee speed, in place of the view
  dlgPrice($("vprice"), burnSats(), (regMode?"registration":featureMode?"sponsorship":"burn")+(edit?` <button type="button" class="linkbtn" data-editamt>edit</button>`:""), vpay.wallet.fee(), t?[`+${fmt(t)} sats tip`]:[]);
  feeSegPaint($("vfeeseg"), !!(s&&s.kind!=="err"), $("vfeesum"));
  if(sign) signMenu($("vsend"), $("vsendmenu"), vpay.wallet, {label: regMode?"Validate topic":featureMode?"Validate sponsorship":kind(scope.spec||{})==="open"?"Validate take":"Validate answer",
    ok:vValid(4)&&scope.addr.length>=20, show:()=>{ if(vStep!==4) vGo(4); }, batch:vBatch, tx: vStep!==4 ? ()=>vGo(4) : null, done:()=>$("votedlg").close()});
}
function vGo(n){
  n=Math.max(n,2); vStep=n; const amtView=featureMode&&!regMode||vEdit;   // view 2: the take (none when Burn for it), or the amount in its place (edit; sponsoring asks nothing else; registering, a fixed 330: nothing)
  $("vstep-4").hidden=n!==4; $("vstep-2").hidden=n!==2||!amtView; $("vstep-1").hidden=n!==2||amtView||vLocked; vPaint(); segThumbs();
  $("votedlg").querySelector(".dlg").scrollTop=0;
  const first=[...document.querySelectorAll(`#vstep-1 :is(input,button.primary),#vstep-${n} :is(input,button.primary)`)].find(el=>!el.closest("[hidden]")&&!el.disabled&&!el.readOnly&&el.type!=="hidden"&&el.type!=="checkbox");
  (n===2&&amtView ? ($("vamtseg").hidden?amt:$("vamtseg").querySelector('[aria-pressed="true"]'))||amt : first||$("vsend")).focus({preventScroll:true});
}
let vSnap=null;                                              // what the amount view started from: Cancel puts it back
$("vprice").onclick=e=>{ if(!e.target.closest("[data-editamt]")) return; if(!featureMode){ vSnap={amt:amt.value, tip:$("tip").value, fee:feeSpeed()}; vEdit=true; } vGo(2); };   // sponsoring: its amount is its first view
$("vapply").onclick=()=>{ if(!vValid2()) return; vEdit=false; vGo(2); };
$("vcancel").onclick=()=>{ const s=vSnap; vSnap=null; if(s){ vAmt.reset(s.amt); vTip.reset(s.tip); vTipSave(); LS(NETKEY("bv.fee"),s.fee); } vEdit=false; update(); PAY.forEach(p=>p.paint()); vGo(2); };
function vLock(){                                      // per-row Burn +: the chosen answer is fixed until "change" is clicked; never blocks Next
  const k=kind(scope.spec||{}), v=norm(stmt.value), raw=stmt.value.trim();
  const onList = k==="number" ? raw!==""&&Number.isFinite(+raw) : !!scope.poll && scope.poll.includes(v);
  const textLock = vLocked && (k==="open" || !onList);  // open kind, or an off-list answer of a poll/number: the text field itself is locked
  stmt.readOnly=textLock; stmt.classList.toggle("locked",textLock);
  document.querySelectorAll("#opts [data-opt]").forEach(b=>{ const off=vLocked && b.dataset.opt!==v; b.setAttribute("aria-disabled",String(off)); b.tabIndex=off?-1:0; });
  $("num").disabled=$("numrange").disabled= vLocked && k==="number" && onList;
  if(k==="number") $("numfield").hidden=textLock;   // off-list text locked: one control, not two
  $("otherans").hidden=vLocked || !$("stmtfield").hidden;
  const host = textLock ? $("stmtfield") : k==="number" ? $("numfield") : $("optfield");
  host.querySelector("label > span").appendChild($("unlock")); $("unlock").hidden=!vLocked;
}
$("unlock").onclick=()=>{
  vLocked=false; vLock(); update();
  const k=kind(scope.spec||{});
  (!stmt.readOnly&&!$("stmtfield").hidden ? stmt : k==="number" ? $("num") : $("opts").querySelector("[data-opt]")||stmt).focus({preventScroll:true});
};
let vOpener=null; $("votedlg").addEventListener("close",()=>{ vOpener?.focus?.({preventScroll:true}); vOpener=null; });
function openVote(locked=false, feature=false, start=1){   // start 2: the take is known (Burn for it), straight to the amount
  featureMode=!!feature; regMode=featureMode && !featureScore(scope.name);
  $("votehead").textContent = regMode ? "Register #"+scope.q : featureMode ? "Sponsor #"+scope.q : burnTitle();
  if(regMode){ $("votesub").textContent=`Nobody has registered this topic yet. Registering burns ${fmt(REG_SATS)} sats so it appears in Explore. Sponsoring it later ranks it higher.`; amt.min=330; }
  else if(featureMode){ $("votesub").textContent=`Ranks it on Home and in Explore · ${fmt(featureScore(scope.name))} sats so far.`; amt.min=330; }
  else { amt.min=(scope.spec&&scope.spec.min)||330; $("votesub").textContent=scope.sub||""; }   // a plain burn: the topic's own line, not the one a sponsoring left
  update();                                                  // the payload follows the mode at once (root address and minimum when sponsoring)
  $("addr").textContent = featureMode&&ROOT ? ROOT.addr : scope.addr;
  vOpener=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:$("burnbtn");
  vLocked=!!locked; vLock(); if(!featureMode){ $("votehead").textContent=burnTitle(); $("votesub").textContent= vLocked ? ["in #"+scope.q+(scope.spec&&(scope.spec.opts||scope.spec.range)?"?":""), ...(scope.rules||[])].join(" · ") : scope.sub||""; }   // a given take: the topic it goes to, not the typing hint
  $("amtlabel").textContent=amtLabelText();
  vEdit=false; vSnap=null; $("vfeeadv").open=false; $("votedlg").showModal(); vGo(2); }   // sponsoring: the statement is the topic name, nothing to ask, straight to the amount
$("copylink").onclick=()=>copyText(location.href,$("copylink"));
$("featurebtn").onclick=()=>{                          // register / sponsor = burn to the root topic with this topic's name, locked
  vOther=false; stmt.value=scope.name; openVote(true,true);
};
$("burnbtn").onclick=()=>{                             // + New take / + New answer: a fresh burn for this topic's kind
  vOther=false;
  if(scope.spec?.range){ $("num").value=scope.spec.range[0]; stmt.value=String(scope.spec.range[0]); }
  else stmt.value="";
  update(); openVote();
};
const hashScope=()=>hashText();
const go=()=>openScope(hashScope());
addEventListener("hashchange",go);
go();
segThumbs();

// ---------- header: kind, badges, live countdown, actions ----------
const T0=Date.now();                                          // blocks → time at 10 min from the moment the page opened: the countdown ticks between block heights
// (featureScore lives in shared.js: the sats burned to the root topic with this name; explore and index rank by it)
function headMeta(){                                          // the static part: from the name alone, before any burn is known
  const p=scope.spec||{}, fs=featureScore(scope.name), closed=isClosed();
  $("hkind").textContent=kindWord(p);
  $("hmin").hidden=!p.min; if(p.min) $("hmin").textContent=`min ${fmt(p.min)} sats`;
  $("hrange").hidden=!p.range; if(p.range) $("hrange").textContent=`${nfc(p.range[0])} – ${nfc(p.range[1])}`;
  $("hreg").hidden=!!fs || scope.name==="";
  $("hcount").hidden=!p.deadline; $("hcount").classList.toggle("done",closed); headTick();
  $("hmeta").hidden=[...$("hmeta").children].every(b=>b.hidden);   // no rules and registered: no badge line at all
  $("thead").classList.toggle("closed",closed);
  $("featurebtn").hidden=scope.name==="";
  $("featurebtn").textContent= fs ? `✦ Sponsor · ${satsShort(fs)}` : "Register";
  $("featurebtn").title= fs ? `Sponsor this topic: burn to the root topic with its name · ${fmt(fs)} sats so far` : "Register this topic so it appears in Explore";   // same act, the first one lists it
  $("burnbtn").textContent= kind(p)==="open" ? "+ New take" : "+ New answer"; $("qrow").hidden=kind(p)==="duel";   // beside the search, like Explore's + New topic; a duel burns from its two sides
  watchPaint();
}
function headTick(){                                          // every minute: the deadline as a distance in time, and the block it lands on
  const p=scope.spec||{}; if(!p.deadline) return;
  if(p.deadline<=TIP){ $("hcounttxt").textContent=`closed · block ${fmt(p.deadline)}`; $("hcount").title="Late burns are shown but not counted"; return; }
  const left=(p.deadline-TIP)*600000-(Date.now()-T0);
  $("hcounttxt").innerHTML=`closes in ${untilText(left/600000)}<span class="more"> · block ${fmt(p.deadline)}</span>`;
  $("hcount").title=`≈ ${new Date(Date.now()+left).toLocaleString()} · block ${fmt(p.deadline)} · ${fmt(p.deadline-TIP)} blocks to go`;
}
setInterval(headTick,60000);
// ---- watch ★ ----
function watchPaint(){ const on=watchHas(scope.name); $("watchbtn").setAttribute("aria-pressed",String(on)); $("watchbtn").classList.toggle("on",on); $("watchlbl").textContent=on?"Watching":"Watch"; $("watchbtn").title=on?"Stop watching this topic":"Watch this topic in this browser"; }
$("watchbtn").onclick=()=>{ const on=watchToggle(scope.name); if(on) watchMarkSeen(scope.name,SEEN.length,TIP); watchPaint(); toast(on?"Watching · kept in this browser":"No longer watching"); };
// ---- export: the counted burns and the buckets, as a file or on the clipboard ----
const exportData=()=>({
  topic:scope.name, network:NET, address:scope.addr, height:TIP, exportedAt:new Date().toISOString(),
  statements:Object.values(agg).sort((a,b)=>b.sats-a.sats).map(a=>({statement:a.t, sats:a.sats, votes:a.votes})),
  buckets:{late:{...late}, belowMinimum:{...dust}},
  votes:SEEN.map(v=>({txid:v.txid, height:v.h, statement:v.t, sats:v.sats, from:v.from||null, counted:!BUCKET.has(v.txid), bucket:BUCKET.get(v.txid)||null})),
});
const exportCsv=()=>{ const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"'; return ["txid,height,statement,sats,from,counted,bucket",...exportData().votes.map(v=>[v.txid,v.height??"",q(v.statement),v.sats,v.from??"",v.counted,v.bucket??""].join(","))].join("\n"); };
const fileStem=()=>"burning-take-"+scope.name.replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"")+"-"+NET+"-"+TIP;
// ---- More menu: export (JSON, CSV, copy) and embed. download() lives in ballotui.js, dropMenu() in shared.js (the burner page exports the same way) ----
const moreClose=dropMenu($("morebtn"),$("moremenu"));
const morePick=fn=>()=>{ moreClose(); $("morebtn").focus({preventScroll:true}); fn(); };   // focus back on "More": a dialog opened from the menu returns there when it closes
$("expjson").onclick=morePick(()=>download(fileStem()+".json", JSON.stringify(exportData(),null,2), "application/json"));
$("expcsv").onclick=morePick(()=>download(fileStem()+".csv", exportCsv(), "text/csv"));
$("expcopy").onclick=morePick(()=>{ copyText(JSON.stringify(exportData(),null,2), document.createElement("span")); toast("JSON copied"); });   // detached target: the menu item keeps its icon
// ---- embed: an iframe of embed.html#<name> on this host, same network ----
const embedSnippet=()=>{ const u=new URL("embed.html",location.href); if(NET!=="mainnet") u.searchParams.set("net",NET); u.hash=scope.name; return `<iframe src="${u.href}" width="100%" height="220" style="border:0" title="Burning Take · #${esc(scope.q)}"></iframe>`; };   // pasted into other sites: the name is text there too
$("embedbtn").onclick=morePick(()=>{ $("em-code").textContent=embedSnippet(); $("embeddlg").showModal(); });
$("em-copy").onclick=()=>copyText($("em-code").textContent,$("em-copy"));
$("em-copy2").onclick=()=>copyText($("em-code").textContent,$("em-copy2"));
// ---- ballot: keep this burn aside (shared.js ballotAdd), cast several in one transaction from the nav pill ----
function vBatch(){ const n=ballotAdd(featureMode&&ROOT ? {name:"", addr:ROOT.addr, statement:scope.name, sats:burnSats(), intent:regMode?"register":"feature"} : {name:scope.name, addr:scope.addr, statement:stmt.value.trim(), sats:burnSats()}); $("votedlg").close(); ballotPill(); toast(`Added to your batch · ${n} burn${n===1?"":"s"}`); }
// ---- receipts: a burn signed here is on disk at once as pending (h:null, from = this wallet), so receipt.html#<txid> can show it before the explorer does ----
// a burn sent from here: pending on disk and on the board at once; registered or sponsored, the header follows at once too
vpay.wallet.onsent=({txid})=>{ const v={txid, t:stmt.value.trim(), sats:burnSats(), h:null, from:WALLET?WALLET.addr:"", tx:txid.slice(0,6)+"…"+txid.slice(-4), vout:0}; if(featureMode){ DB.putPending("",[v]); dirAddPending([cleanVote({...v, at:Date.now()})]); headMeta(); renderBurners(); return; } DB.putPending(scope.name,[v]); addPending(scope.name,[v]); };
const STAR='<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';   // the top take of the topic, in Recent
// ---- under the board: [biggest burns (window)] | [recent (this topic's timeline, whatever the window), top burners (window)] ----
function renderBurners(){
  const host=$("burners"), short=a=>a.slice(0,6)+"…"+a.slice(-4), tag={late:" · late",dust:" · below min"}, when=h=>h===null?"in the mempool":"block "+fmt(h), W=WINLABEL[win];
  const seen=SEEN.filter(v=>BUCKET.get(v.txid)!=="window");
  host.hidden=!synced || !SEEN.length || !!q; if(host.hidden) return;   // after the first sync, and not during a search
  const top=Object.entries(BURN).sort((a,b)=>b[1].sats-a[1].sats).slice(0,5);   // counted sats only
  const burnRow=v=>`<div class="bchip lb ic">${iconBadge("",ICON_TAKE)}<span class="lbt">${v.t?esc(v.t):"<i>no take</i>"}</span><b>${fmt(v.sats)} sats</b>
      <span class="m">${v.from?`<a href="burner.html#${esc(v.from)}" title="${esc(v.from)}">${esc(short(v.from))}</a>`:"unknown burner"} · ${when(v.h)}${tag[BUCKET.get(v.txid)]||""}</span><a class="m" href="receipt.html#${esc(v.txid)}">receipt →</a></div>`;
  const burnerRow=(addr,sats,meta)=>`<a class="bchip br ic" href="burner.html#${esc(addr)}" title="${esc(addr)}">${iconBadge("burner",ICONS.burner)}<span class="ad">${esc(short(addr))}</span><span class="m">${meta}</span><b>${fmt(sats)} sats</b></a>`;
  const col=(head,rows,empty)=>`<div class="burnercol"><div class="divider">${head}</div>${rows.join("")||`<span class="note">${empty}</span>`}</div>`;
  const p=scope.spec||{}, word=kind(p)==="open"?"take":"answer";   // the board's 01: counted like countVote, off-list answers never rank
  const keyOf=v=>{ if(!p.range) return norm(v.t); const x=numOf(v.t); return Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1] ? "n:"+x : null; };
  const lead=Object.entries(agg).filter(([k])=>p.range?k.startsWith("n:"):p.opts?p.opts.includes(k):true).sort((a,b)=>b[1].sats-a[1].sats)[0], leadKey=lead&&lead[1].sats>0?lead[0]:null;
  const take=(v,link)=>{ const rk=!!v.t&&leadKey!==null&&keyOf(v)===leadKey; return link(!v.t?"<i>no take</i>":rk?`<span>${esc(v.t)}</span><span class="rk1" role="img" aria-label="Top ${word}" title="The top ${word} in this topic · ${W}">${STAR}</span>`:esc(v.t), rk?" has-rk":""); };   // link: recentRow's, to the topic page
  const items=recentDigest(SEEN.map(v=>({v, name:scope.name})), rootBurns().filter(v=>v.name===scope.name));   // shared.js, Explore's Recent for this topic alone
  const right = `<div class="burnercol"><div class="divider"><span class="hot" title="Live: each new block adds its burns here">Recent</span></div><div class="tl">${items.map(x=>recentRow(x,{here:true, take, tag:v=>tag[BUCKET.get(v.txid)]||""})).join("")}</div></div>`
    + col(`<span title="by first-input address">Top burners · ${W}</span>`, top.map(([a,b])=>burnerRow(a,b.sats,`${b.votes} burn${b.votes===1?"":"s"}`)), "none counted "+W);
  host.innerHTML = `<div class="col cl">${col(`Biggest burns · ${W}`, [...seen].sort((a,b)=>b.sats-a.sats).slice(0,ONE_COL.matches?5:20).map(burnRow), "none "+W)}</div><div class="col cr">${right}</div>`;
  if(!ONE_COL.matches){ const L=host.querySelector(".cl"), R=host.querySelector(".cr"), rows=[...L.querySelectorAll(".bchip")];   // Biggest burns grows to the right column's height, never below 5
    for(let n=rows.length; n>5 && L.offsetHeight>R.offsetHeight+6; ) rows[--n].remove(); }
}
const ONE_COL=matchMedia("(max-width:860px)"); ONE_COL.addEventListener("change",()=>renderBurners());
// ---------- live: the open topic is read again every minute (cache first: one request when nothing changed), new blocks and mempool burns alike ----------
setInterval(async()=>{
  if(document.hidden||!synced) return;
  const my=seq; await tipRefresh();
  const r=await loadVotes(scope.name,{addr:scope.addr, cancelled:()=>my!==seq}); if(!r||r.error||my!==seq) return;
  SEEN=r.votes.slice(); recount(); headTick();
  dirLoad(true).then(()=>{ if(my===seq){ headMeta(); renderBurners(); } });   // the root topic too: sponsorships land in the header and in Recent
  const n=r.votes.length; status.innerHTML=`<span class="dot"></span> synced · block ${fmt(TIP)} · ${n?`${n} burn${n===1?"":"s"}`:"no burns yet"}`;
},60000);
