// ---------- embed: one compact card of a topic for any page (embed.html#<name>[?net=signet][&theme=light]) ----------
// Same data path as the topic page (loader.js: IndexedDB → snapshot → explorer), same buckets (late / below minimum), no dialogs, no wallet.
// The host sizes the iframe from the {bvHeight} message this page posts whenever its height changes.
{ const th=new URLSearchParams(location.search).get("theme"); if(th==="light") document.documentElement.dataset.theme="light"; }
const post=()=>{ try{ if(parent!==window) parent.postMessage({bvHeight:Math.ceil($("card").getBoundingClientRect().height), topic:scope?scope.name:""},"*"); }catch{} };
if("ResizeObserver" in window) new ResizeObserver(post).observe(document.body);
let scope=null, agg={}, late={sats:0,votes:0}, dust={sats:0,votes:0}, seq=0;
const T0=Date.now();
const dhm=ms=>{ const m=Math.max(0,Math.round(ms/60000)), d=Math.floor(m/1440), h=Math.floor(m%1440/60), mm=m%60; return d?`${d}d ${h}h`:h?`${h}h ${mm}m`:`${mm}m`; };
const nfm=x=>Math.abs(+x)>=10000?fmt(+x):String(x);
function addVote(v){
  const p=scope.spec;
  if (p.deadline && (v.h===null ? TIP+1>=p.deadline : v.h>=p.deadline)) { late.sats+=v.sats; late.votes++; return; }
  if (p.min && v.sats<p.min) { dust.sats+=v.sats; dust.votes++; return; }
  const k=norm(v.t), a=agg[k]||(agg[k]={t:v.t,sats:0,votes:0}); a.sats+=v.sats; a.votes++;
}
function tick(){                                            // the deadline as time left, ticking between blocks
  const p=scope.spec, el=$("ecount"); if(!p.deadline){ el.hidden=true; return; }
  const closed=p.deadline<=TIP; el.hidden=false; el.classList.toggle("closed",closed);
  $("ecounttxt").textContent= closed ? `closed · block ${fmt(p.deadline)}` : `closes in ${dhm((p.deadline-TIP)*600000-(Date.now()-T0))}`;
  el.title=`block ${fmt(p.deadline)}`;
}
setInterval(()=>{ if(scope) tick(); },60000);
function view(){
  const p=scope.spec, k=kind(p), S=Object.values(agg), host=$("eview"), max=Math.max(1,...S.map(s=>s.sats));
  const find=o=>S.find(s=>norm(s.t)===o)||{t:o,sats:0,votes:0};
  const rows=(list,cls="")=>list.map((s,i)=>`<div class="row ${cls}"><span class="rk${i?"":" one"}">${cls?"":String(i+1).padStart(2,"0")}</span><span class="txt" title="${esc(s.t)}">${esc(s.t)}</span><span class="sats">${fmt(s.sats)}<small> sats</small></span><i class="bar" style="width:${(s.sats/max*100).toFixed(1)}%"></i></div>`).join("");
  if(k==="duel"){
    const [A,B]=p.opts.map(find), tot=A.sats+B.sats, pa=tot?A.sats/tot*100:50, pct=v=>tot?v.toFixed(0)+"%":"—";
    host.innerHTML=`<div class="duel"><div class="names"><span class="a">${esc(A.t)}</span><span class="b">${esc(B.t)}</span></div>
      <div class="bar"><i style="width:${pa.toFixed(1)}%"></i><span class="pa">${pct(pa)}</span><span class="pb">${pct(100-pa)}</span></div>
      <div class="sats"><span>${fmt(A.sats)} sats · ${A.votes} burn${A.votes===1?"":"s"}</span><span>${fmt(B.sats)} sats · ${B.votes} burn${B.votes===1?"":"s"}</span></div></div>`;
  } else if(k==="number"){
    const [lo,hi]=p.range, num=t=>{const m=norm(t).match(/^(-?\d+(?:\.\d+)?)([km])?$/);return m?+m[1]*(m[2]==="k"?1e3:m[2]==="m"?1e6:1):NaN};
    const valid=S.map(s=>({...s,x:num(s.t)})).filter(s=>Number.isFinite(s.x)&&s.x>=lo&&s.x<=hi), tot=valid.reduce((a,s)=>a+s.sats,0);
    const mean=tot?valid.reduce((a,s)=>a+s.x*s.sats,0)/tot:null; let median=null; if(tot){ let acc=0; for(const s of valid.slice().sort((a,b)=>a.x-b.x)){ acc+=s.sats; if(acc>=tot/2){median=s.x;break;} } }
    const bins=Array(10).fill(0); for(const s of valid){ bins[Math.min(9,Math.floor((s.x-lo)/((hi-lo)||1)*10))]+=s.sats; } const bmax=Math.max(1,...bins);
    const nf=x=>x===null?"—":x.toLocaleString("en-US",{maximumFractionDigits:2});
    host.innerHTML=`<div class="num"><div class="tile"><b>${nf(mean)}</b><span>weighted mean</span></div><div class="tile"><b>${nf(median)}</b><span>median</span></div>
      <div class="hist" title="${nfm(lo)} – ${nfm(hi)} · ${fmt(tot)} sats on ${valid.length} value${valid.length===1?"":"s"}">${bins.map(b=>`<div><i style="height:${(b/bmax*100).toFixed(0)}%"></i></div>`).join("")}</div></div>`;
  } else {
    const main= k==="poll" ? p.opts.map(find) : S;
    const top=main.slice().sort((a,b)=>b.sats-a.sats).slice(0,3), rest=main.length-top.length, others=k==="poll"?S.filter(s=>!p.opts.includes(norm(s.t))).length:0;
    host.innerHTML= top.length ? rows(top)+(rest>0||others?`<div class="rest">${[rest>0?`+ ${rest} more`:"", others?`${others} off-list`:""].filter(Boolean).join(" · ")}</div>`:"") : `<p class="muted">Nothing burned here yet. Be the first.</p>`;
  }
  post();
}
async function open(){
  const raw=hashText().trim().toLowerCase()||"general", name=canonical(parseScope(raw));
  scope={name, spec:parseScope(name)}; agg={}; late={sats:0,votes:0}; dust={sats:0,votes:0};
  const p=scope.spec, k=kind(p), my=++seq;
  $("etitle").textContent= k==="open" ? `Hottest takes on #${p.q}` : `${p.q}?`;
  $("ekind").textContent=[{open:"open question",duel:"duel",poll:`poll · ${p.opts?p.opts.length:0} options`,number:"number"}[k], p.min?`min ${fmt(p.min)} sats`:null, p.range?`${nfc(p.range[0])} – ${nfc(p.range[1])}`:null].filter(Boolean).join(" · ");
  const u=new URL("topic.html",location.href); if(NET!=="mainnet") u.searchParams.set("net",NET); u.hash=name; $("elink").href=u.href;
  const h=new URL("index.html",location.href); if(NET!=="mainnet") h.searchParams.set("net",NET); $("ehome").href=h.href;
  document.title=p.q+" · Burning Take"; tick(); tipReady().then(tick);
  $("eview").innerHTML=`<p class="muted" id="eloading">Reading the chain…</p>`; $("estatus").textContent=""; post();
  const r=await loadVotes(name,{ cancelled:()=>my!==seq,
    onPage:vs=>{ vs.forEach(addVote); view(); },
    onPhase:ph=>{ $("estatus").innerHTML= ph.phase==="done" ? `${NET} · block ${fmt(TIP)} · ${ph.count} burn${ph.count===1?"":"s"}` : ph.phase==="scan" ? `scanning · ${ph.count} burn${ph.count===1?"":"s"}` : ph.phase==="error" ? `the explorer did not answer · <button type="button" class="linkbtn" data-retry>retry</button>` : ""; } });
  if(!r||my!==seq) return;
  agg={}; late={sats:0,votes:0}; dust={sats:0,votes:0}; r.votes.forEach(addVote); view();   // the loader's list is the whole truth
}
addEventListener("hashchange",open); open();
$("estatus").addEventListener("click",e=>{ if(e.target.closest("[data-retry]")) open(); });
addEventListener("load",post);
