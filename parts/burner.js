// ---------- burner page: every burn whose first input is one address, across every topic this app has seen (burner.html#<address>) ----------
// Data: IndexedDB across all topics (DB.all), plus the shipped snapshot of every indexed topic the cache does not know yet (loader.js loadAll).
// Nothing is watched or remembered here: an address is a fact on the chain, not a thing this browser follows.
const status=$("status"), groups=$("groups");
let ADDR="", ROWSB=[], seq=0;                // (loading: the tiles and groups show shimmering placeholders until loadAll returns)                // ROWSB: this address's burns [{txid,t,sats,h,from,tx,scope}], LOADED: the last loadAll done phase
const validAddr=a=>{ try{ return bech32Decode(a).hrp===HRP; }catch{ return false; } };
const shortAddr=a=>a.slice(0,10)+"…"+a.slice(-6);
const hv=v=>v.h===null?Number.MAX_SAFE_INTEGER:v.h;         // pending first
function paintHead(){
  $("baddr").textContent=ADDR||"…"; $("baddr").title=ADDR;
  $("bmine").hidden=!(WALLET&&WALLET.addr===ADDR);
  $("bwrong").hidden=!ADDR||validAddr(ADDR);
  $("bmeta").hidden=$("bmine").hidden&&$("bwrong").hidden;          // no badge to show: no empty row under the sync line
  $("explorerlink").href="https://mempool.space/"+(NET==="mainnet"?"":"signet/")+"address/"+ADDR; $("explorerlink").hidden=!validAddr(ADDR);
  $("bcopy").disabled=!ADDR;
  document.title=(ADDR?shortAddr(ADDR):"Burner")+" · Burning Take";
}
const groupsOf=()=>{ const by={}; for(const v of ROWSB){ const g=by[v.scope]||(by[v.scope]={name:v.scope, sats:0, rows:[]}); g.sats+=v.sats; g.rows.push(v); } return Object.values(by).sort((a,b)=>b.sats-a.sats); };
// ---- loading: placeholders shaped like the real tiles and rows, so the page does not read "0 burns" while it is still looking ----
const skel=(w,h)=>`<span class="sk" style="width:${w};height:${h}px"></span>`;
function paintLoading(){
  $("tsats").innerHTML=skel("110px",20); $("tburns").innerHTML=skel("46px",20); $("ttopics").innerHTML=skel("34px",20);
  $("exportbtn").disabled=true;
  groups.hidden=false; groups.classList.remove("rise"); groups.setAttribute("aria-busy","true");
  groups.innerHTML=[[3,"120px"],[2,"90px"]].map(([n,w])=>`<div class="bgroup ghost" aria-hidden="true">
      <div class="divider">${skel(w,11)}</div>
      <div class="tl">${Array.from({length:n},(_,i)=>`<div class="fr"><span class="fi reg"></span><span class="fm">${skel("92px",10)}</span><span class="fa">${skel(["64%","48%","72%"][i],13)}</span><b>${skel("78px",13)}</b></div>`).join("")}</div>
    </div>`).join("");
}
function countUp(el,to){                                    // the tiles count up to their value; instant under reduced motion or in a hidden tab (no frames there)
  el.textContent=fmt(to); if(RM.matches||document.hidden||!to) return;
  const t0=performance.now(), d=480, step=t=>{ const k=Math.min(1,(t-t0)/d); el.textContent=fmt(Math.round(to*(1-Math.pow(1-k,3)))); if(k<1) requestAnimationFrame(step); };
  el.textContent="0"; requestAnimationFrame(step); setTimeout(()=>{ el.textContent=fmt(to); },d+120);   // the timeout guarantees the final number even if frames stall
}
function paintRows(animate=false){
  const gs=groupsOf(), total=ROWSB.reduce((a,v)=>a+v.sats,0);
  if(animate){ countUp($("tsats"),total); countUp($("tburns"),ROWSB.length); countUp($("ttopics"),gs.length); }
  else { $("tsats").textContent=fmt(total); $("tburns").textContent=fmt(ROWSB.length); $("ttopics").textContent=fmt(gs.length); }
  $("exportbtn").disabled=!ROWSB.length;
  groups.removeAttribute("aria-busy"); groups.classList.toggle("rise",animate);
  groups.hidden=!gs.length;
  groups.innerHTML=gs.map((g,gi)=>{ const p=parseScope(g.name);
    return `<div class="bgroup" style="--i:${Math.min(gi,8)}">
      <div class="divider"><a href="topic.html#${encodeURIComponent(g.name)}" class="tlink">#${esc(p.q)}</a><span class="more"> · ${kind(p)}</span> · ${fmt(g.sats)} sats · ${g.rows.length} burn${g.rows.length===1?"":"s"}</div>
      <div class="tl">${g.rows.sort((a,b)=>hv(b)-hv(a)).map(v=>`<div class="fr burn">${iconBadge("",ICON_TAKE)}
        <span class="fm">${v.h===null?"in the mempool":"block "+fmt(v.h)}</span><a class="frx" href="receipt.html#${esc(v.txid)}">receipt →</a>
        <span class="fa">${v.t?esc(v.t):"<i>no take</i>"}</span><b>${fmt(v.sats)} sats</b></div>`).join("")}</div>
    </div>`; }).join("");
}
function paintEmpty(kind){                                  // kind: "none" (nothing to look up) | "bad" (not an address here) | "zero" (a valid address with no burns seen) | null (hidden)
  const e=$("bempty"); e.hidden=!kind; if(!kind) return;
  groups.hidden=true;
  $("bemptyt").textContent= kind==="none" ? "Which burner?" : kind==="bad" ? `Not a ${NET} address` : `No burns from this address yet on ${NET}`;
  $("bemptyp").textContent= kind==="none" ? "Paste a burner address, or open one from the top burners of any topic." : kind==="bad" ? `A burner is a bech32 address of this network (${HRP}1…). Switch the network chip if the address belongs to the other one.` : "Burns show here once a topic they belong to has been opened in this browser or ships in a snapshot.";
  $("bpaste").hidden=kind==="zero";
}
async function load(){
  ADDR=hashText().trim().toLowerCase(); ROWSB=[]; const my=++seq;
  paintHead();
  if(!ADDR||!validAddr(ADDR)){ status.innerHTML=""; paintRows(); $("tsats").textContent=$("tburns").textContent=$("ttopics").textContent="—"; paintEmpty(ADDR?"bad":"none"); return; }
  paintEmpty(null); paintLoading();
  status.innerHTML=`<span class="spin"></span> reading cache…`;
  const rows=await loadAll({onPhase:p=>{ if(my!==seq) return; if(p.phase==="snapshots") status.innerHTML=`<span class="spin"></span> loading snapshots · ${p.k}/${p.n}`; }});
  if(my!==seq) return;
  ROWSB=rows.filter(v=>v.from===ADDR); paintRows(true);
  status.innerHTML=`<span class="dot"></span> synced · block ${fmt(TIP)}${ROWSB.length?"":" · no burns"}`;   // where the rows came from only shows while loading
  if(!ROWSB.length) paintEmpty("zero");
}
addEventListener("hashchange",load); load();
$("bcopy").onclick=()=>copyText(ADDR,$("bcopy"));
$("bgo").onclick=()=>{ const v=$("bq").value.trim(); if(v) location.hash=v; };
$("bq").onkeydown=e=>{ if(e.key==="Enter") $("bgo").click(); };
// ---- export: the burns grouped by topic, as a file or on the clipboard ----
const exportData=()=>({
  address:ADDR, network:NET, height:TIP, exportedAt:new Date().toISOString(),
  totals:{sats:ROWSB.reduce((a,v)=>a+v.sats,0), burns:ROWSB.length, topics:groupsOf().length},
  topics:groupsOf().map(g=>({topic:g.name, sats:g.sats, burns:g.rows.slice().sort((a,b)=>hv(b)-hv(a)).map(v=>({txid:v.txid, height:v.h, statement:v.t, sats:v.sats}))})),
});
const exportCsv=()=>{ const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"'; return ["txid,topic,height,statement,sats",...ROWSB.slice().sort((a,b)=>hv(b)-hv(a)).map(v=>[v.txid,q(v.scope),v.h??"",q(v.t),v.sats].join(","))].join("\n"); };
const fileStem=()=>"burning-take-burner-"+ADDR.slice(0,12)+"-"+NET+"-"+TIP;
(()=>{
  const close=dropMenu($("exportbtn"),$("exportmenu"));
  $("expjson").onclick=()=>{ close(); download(fileStem()+".json", JSON.stringify(exportData(),null,2), "application/json"); };
  $("expcsv").onclick=()=>{ close(); download(fileStem()+".csv", exportCsv(), "text/csv"); };
  $("expcopy").onclick=()=>{ close(); copyText(JSON.stringify(exportData(),null,2),$("expcopy")); toast("JSON copied"); };
})();
