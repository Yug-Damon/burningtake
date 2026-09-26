// ---------- embed: one compact card of a topic for any page (embed.html#<name>[?net=signet][&theme=light]) ----------
// Same data path as the topic page (loader.js: IndexedDB → snapshot → explorer), the same counting (tallyOf), the same buckets, drawn for the topic's kind. No dialogs, no wallet.
// The host sizes the iframe from the {bvHeight} message this page posts whenever its height changes.
{ const th=new URLSearchParams(location.search).get("theme"); if(th==="light") document.documentElement.dataset.theme="light"; }
const post=()=>{ try{ if(parent!==window) parent.postMessage({bvHeight:Math.ceil($("card").getBoundingClientRect().height), topic:scope?scope.name:""},"*"); }catch{} };
if("ResizeObserver" in window) new ResizeObserver(post).observe(document.body);
let scope=null, VOTES=[], FRESH=false, seq=0;
const pageUrl=(extra)=>{ const u=new URL("topic.html",location.href); if(NET!=="mainnet") u.searchParams.set("net",NET); if(extra) for(const [k,v] of Object.entries(extra)) u.searchParams.set(k,v); u.hash=scope.name; return u.href; };
function tick(){                                            // the deadline's state, one wording with the topic page (shared.js closeState)
  const p=scope.spec, el=$("ecount"), st=closeState(p); el.hidden=!st; if(!st) return;
  el.classList.toggle("closed",!["open","soon","last","checking"].includes(st.k)); $("ecounttxt").textContent=st.k==="open"?st.text.replace(/^Closes/,"closes"):st.text;
  el.title=`block ${fmt(p.deadline)}`; foot();
}
setInterval(()=>{ if(scope) tick(); },60000);
const pct=v=>Math.round(v)+"%";
// the call to action for the kind and its state: a duel's two sides, a closed topic's result
function foot(){
  const p=scope.spec, k=kindKey(p), closed=closedAt(p);
  if(closed){ $("ecta").innerHTML=`<a class="cta" href="${pageUrl()}" target="_blank" rel="noopener">See the final result →</a>`; return; }
  if(k==="duel"||k==="yes-no"){ const o=k==="yes-no"?["yes","no"]:p.opts; $("ecta").innerHTML=o.map((x,i)=>`<a class="cta${i?" b":""}" href="${pageUrl({burn:x})}" target="_blank" rel="noopener">Burn for ${esc(k==="yes-no"?x.toUpperCase():x)} →</a>`).join(""); return; }
  $("ecta").innerHTML=`<a class="cta" href="${pageUrl()}" target="_blank" rel="noopener">${KINDS[k].cta}</a>`;
}
function view(){
  const p=scope.spec, k=kindKey(p), T=tallyOf(scope.name,VOTES), tot=T.shareSats, host=$("eview"), known=FRESH||VOTES.length, text=t=>{ const by=hiddenBy(scope.name,t); return by?`<i class="hid">${hiddenTxt(by)}</i>`:esc(shownT(p,t)); };
  let h="";
  if(k==="duel"||k==="yes-no"){
    const ia=k==="yes-no"?p.opts.indexOf("yes"):0, side=o=>T.answers.find(r=>r.key===o)||{t:o,key:o,sats:0,burns:0}, A=side(p.opts[ia]), B=side(p.opts[1-ia]), L=s=>k==="yes-no"?s.key.toUpperCase():s.t, pa=tot?A.sats/tot*100:0, lead=A.sats>=B.sats?A:B;
    h=(k==="yes-no"&&tot?`<div class="fc"><b class="${lead===A?"a":"b"}">${A.sats===B.sats?"Dead even":`${L(lead)} ${pct(lead.sats/tot*100)}`}</b><span>of ${fmt(tot)} sats burned</span></div>`:"")
      +`<div class="duel${tot?"":" empty"}"><div class="names"><span class="a">${esc(L(A))}</span><span class="b">${esc(L(B))}</span></div>
      <div class="bar">${tot?`<i style="width:${pa.toFixed(1)}%"></i><span class="pa">${pct(pa)}</span><span class="pb">${pct(100-pa)}</span>`:`<span class="nocall">${known?(k==="yes-no"?"No call yet":"No side yet"):""}</span>`}</div>
      <div class="sats"><span>${known?`${fmt(A.sats)} sats · ${A.burns} burn${A.burns===1?"":"s"}`:"—"}</span><span>${known?`${fmt(B.sats)} sats · ${B.burns} burn${B.burns===1?"":"s"}`:"—"}</span></div></div>`;
  } else if(k==="number"){
    const [lo,hi]=p.range, f=x=>numU(x,p), m=weightedMedian(T.answers), avg=tot?T.answers.reduce((a,r)=>a+numOf(r.t)*r.sats,0)/tot:null, q1=weightedQuantile(T.answers,.25), q3=weightedQuantile(T.answers,.75), x=v=>hi>lo?((v-lo)/(hi-lo)*100).toFixed(1):50;
    h= tot ? `<div class="num"><div class="est"><span>${closedAt(p)?"final estimate":"estimate"}</span><b>${f(m)}</b></div><div class="tile"><span>average</span><b>${f(avg)}</b></div><div class="tile"><span>middle half</span><b>${f(q1)} – ${f(q3)}</b></div></div>
      <div class="axis"><b style="left:${x(q1)}%;width:${Math.max(1,x(q3)-x(q1))}%"></b><i style="left:${x(m)}%"></i></div><div class="ends"><span>${f(lo)}</span><span>${f(hi)}</span></div>`
      : `<div class="axis empty"></div><div class="ends"><span>${f(lo)}</span><span>${f((lo+hi)/2)}</span><span>${f(hi)}</span></div>${known?`<p class="muted">No answers yet. Where will it land?</p>`:""}`;
  } else if(k==="poll"){
    const rows=p.opts.map(o=>T.answers.find(r=>r.key===o)||{t:o,key:o,sats:0}).sort((a,b)=>b.sats-a.sats);   // zero options last, never ranked
    h=`<div class="race">${tot?rows.filter(r=>r.sats).map((r,i)=>`<i class="s${Math.min(i,3)}" style="flex:${r.sats}"></i>`).join(""):""}</div>
      <p class="legend">${rows.map(r=>`<span${r.sats?"":" class=\"z\""}>${esc(r.t)} ${!known?"—":tot?pct(r.sats/tot*100):"0%"}</span>`).join(" · ")}</p>`;
  } else {
    const top=T.answers.slice(0,3);
    h= top.length ? top.map((s,i)=>`<div class="row"><span class="rk${i?"":" one"}">${String(i+1).padStart(2,"0")}</span><span class="txt" title="${esc(s.t)}">${text(s.t)}</span><span class="sats">${fmt(s.sats)}<small> sats · ${pct(s.sats/tot*100)}</small></span><i class="bar" style="width:${(s.sats/tot*100).toFixed(1)}%"></i></div>`).join("")+(T.answers.length>3?`<div class="rest">+ ${T.answers.length-3} more</div>`:"")
      : known ? `<p class="muted">No takes yet · <a href="${pageUrl()}" target="_blank" rel="noopener">Burn the first take →</a></p>` : "";
  }
  const lines=[T.other.length?`Other answers · not in the result · ${fmt(T.other.reduce((a,r)=>a+r.sats,0))} sats`:null, T.none.burns?`No take · ${fmt(T.none.sats)} sats`:null, T.late.burns?`Late · not counted · ${fmt(T.late.sats)} sats`:null, T.dust.burns?`Below minimum · not counted · ${fmt(T.dust.sats)} sats`:null].filter(Boolean);   // shown, never hidden (spec §6)
  host.innerHTML=h+(lines.length?`<div class="rest">${lines.join(" · ")}</div>`:"");
  post();
}
let LASTREAD=0;
async function open(){
  const raw=hashText().trim().toLowerCase()||"general", name=canonical(parseScope(raw)), p=parseScope(name);
  scope={name, spec:p}; VOTES=[]; FRESH=false; const my=++seq;
  $("etitle").textContent=niceQ(name);
  $("ekind").textContent=[kindWord(p), p.min?`min ${fmt(p.min)} sats`:null, p.range?`${nfc(p.range[0])} – ${nfc(p.range[1])}`:null].filter(Boolean).join(" · ");
  const h=new URL("index.html",location.href); if(NET!=="mainnet") h.searchParams.set("net",NET); $("ehome").href=h.href;
  document.title=niceQ(name)+" · Burning Take"; foot(); tick(); tipReady().then(tick); hideReady().then(()=>{ if(my===seq&&VOTES.length) view(); });
  $("eview").innerHTML=`<p class="muted" id="eloading">Reading the chain…</p>`; $("estatus").innerHTML=syncLine({state:"loading"}); post();
  read(my);
}
async function read(my){                                      // the topic's burns; a read that does not answer keeps the card on screen and says since when
  const r=await loadVotes(scope.name,{ cancelled:()=>my!==seq,
    onPage:vs=>{ VOTES=[...VOTES.filter(v=>!vs.some(x=>x.txid===v.txid)), ...vs]; view(); },
    onPhase:ph=>{ if((ph.phase==="cache"||ph.phase==="snapshot")&&ph.source) $("estatus").innerHTML=syncLine({state:"updating", height:ph.height}); } });
  if(!r||my!==seq) return;
  await tipFresh(); if(my!==seq) return; LASTREAD=Date.now();
  VOTES=r.votes.slice(); FRESH=!r.error;
  if(r.error&&!r.votes.length) $("eview").innerHTML=`<p class="muted">Nothing to show yet.</p>`;   // never "nothing burned" from a read that failed
  else view();                                                // the loader's list is the whole truth
  const n=r.votes.length;
  $("estatus").innerHTML=syncLine({state:r.error||TIPERR?"failed":"fresh", height:r.error?r.height:TIP, tail:`${NET} · ${n} burn${n===1?"":"s"}`});
  tick(); post();
}
addEventListener("hashchange",open); open();
$("estatus").addEventListener("click",e=>{ if(e.target.closest("[data-retry]")&&scope){ chainReset(); $("estatus").innerHTML=syncLine({state:"updating", height:TIP}); read(seq); } });   // the card stays
document.addEventListener("visibilitychange",()=>{ if(!document.hidden&&scope&&LASTREAD&&Date.now()-LASTREAD>300000){ tipRefresh().then(tick); read(seq); } });   // on someone else's page, a tab back after 5 min must not run on an old tip
addEventListener("load",post);
