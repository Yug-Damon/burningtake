// ---------- burner page: every burn whose first input is one address, across every topic this app has seen (burner.html#<address>) ----------
// Data: the address's own history from the explorer, each transaction matched against every topic this page can name (the directory, and the topics opened in this browser); IndexedDB when the explorer does not answer.
// Nothing is watched or remembered here: an address is a fact on the chain, not a thing this browser follows.
const status=$("status"), groups=$("groups");
let ADDR="", ROWSB=[], seq=0, TALLY={};     // TALLY[topic]: its counted standings (tallyOf), for the ranks of this burner's takes                // (loading: the tiles and groups show shimmering placeholders until the scan lands)                // ROWSB: this address's burns [{txid,t,sats,h,from,tx,scope}], LOADED: the last loadAll done phase
const validAddr=a=>{ try{ return bech32Decode(a).hrp===HRP; }catch{ return false; } };
const shortAddr=a=>a.slice(0,10)+"…"+a.slice(-6);
const hv=v=>v.h===null?Number.MAX_SAFE_INTEGER:v.h;         // pending first
function paintHead(){
  $("baddr").textContent=ADDR ? shortAddr(ADDR) : "…"; $("baddr").title=ADDR;   // condensed; the copy button and the tooltip carry the full address
  $("bmine").hidden=!(WALLET&&WALLET.addr===ADDR);
  $("bwrong").hidden=!ADDR||validAddr(ADDR);
  $("bmeta").hidden=$("bwrong").hidden;                              // no badge to show: no empty row under the sync line
  $("explorerlink").href="https://mempool.space/"+(NET==="mainnet"?"":"signet/")+"address/"+ADDR; $("explorerlink").hidden=!validAddr(ADDR);
  $("bcopy").disabled=!ADDR;
  document.title=(ADDR?shortAddr(ADDR):"Burner")+" · Burning Take";
}
const keyIn=(name,t)=>{ const p=parseScope(name), x=p.range?numOf(t):NaN; return Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1] ? "n:"+x : norm(t); };   // a take as tallyOf keys it
const takesOf=()=>{ const by=new Map();                    // this burner's takes, one per topic and statement, its sats summed: the biggest first
  for(const v of ROWSB){ const key=keyIn(v.scope,v.t), k=v.scope+"\u0000"+key, x=by.get(k)||by.set(k,{name:v.scope, key, t:v.t, sats:0, burns:0}).get(k); x.sats+=v.sats; x.burns++; }
  return [...by.values()].sort((a,b)=>b.sats-a.sats); };
const groupsOf=()=>{ const by={}; for(const v of ROWSB){ const g=by[v.scope]||(by[v.scope]={name:v.scope, sats:0, rows:[]}); g.sats+=v.sats; g.rows.push(v); } return Object.values(by).sort((a,b)=>b.sats-a.sats); };
// ---- loading: placeholders shaped like the real tiles and rows, so the page does not read "0 burns" while it is still looking ----
const skel=(w,h)=>`<span class="sk" style="width:${w};height:${h}px"></span>`;
function paintLoading(){
  $("tsats").innerHTML=skel("110px",20); $("tburns").innerHTML=skel("46px",20); $("ttopics").innerHTML=skel("34px",20);
  $("exportbtn").disabled=true;
  $("bcols").hidden=false; $("bgroupshead").hidden=false;
  $("bhot").innerHTML=[60,48,70].map(w=>`<div class="bchip lb ic ghost" aria-hidden="true"><span class="fi"></span><span class="lbt">${skel(w+"%",13)}</span><b>${skel("70px",13)}</b><span class="m">${skel("40%",10)}</span></div>`).join("");
  $("brecent").innerHTML=[64,48,72].map(w=>`<div class="fr ghost" aria-hidden="true"><span class="fi reg"></span><span class="fm">${skel("92px",10)}</span><span class="fa">${skel(w+"%",13)}</span><b>${skel("70px",13)}</b></div>`).join("");
  groups.hidden=false; groups.classList.remove("rise"); groups.setAttribute("aria-busy","true");
  groups.innerHTML=[[3,"120px"],[2,"90px"]].map(([n,w])=>`<div class="bgroup ghost" aria-hidden="true"><div class="divider">${skel(w,11)}</div>${Array.from({length:n},(_,i)=>`<div class="st ghost"><span class="rank"></span><span class="txt">${skel(["54%","40%","62%"][i],14)}</span><span class="sats">${skel("80px",14)}</span><span class="votes">${skel("50px",10)}</span></div>`).join("")}</div>`).join("");
}
function countUp(el,to){                                    // the tiles count up to their value; instant under reduced motion or in a hidden tab (no frames there)
  const tok=el._cu=(el._cu||0)+1; el.textContent=fmt(to); if(RM.matches||document.hidden||!to) return;   // tok: a later paint cancels this one, so an old value never lands on a fresh one
  const t0=performance.now(), d=480, step=t=>{ if(el._cu!==tok) return; const k=Math.min(1,(t-t0)/d); el.textContent=fmt(Math.round(to*(1-Math.pow(1-k,3)))); if(k<1) requestAnimationFrame(step); };
  el.textContent="0"; requestAnimationFrame(step); setTimeout(()=>{ if(el._cu===tok) el.textContent=fmt(to); },d+120);   // the timeout guarantees the final number even if frames stall
}
const setNum=(el,v)=>{ el._cu=(el._cu||0)+1; el.textContent=fmt(v); };   // no animation, and any count-up still running stops
function paintRows(animate=false){
  const gs=groupsOf(), total=ROWSB.reduce((a,v)=>a+v.sats,0), takes=takesOf();
  if(animate){ countUp($("tsats"),total); countUp($("tburns"),ROWSB.length); countUp($("ttopics"),gs.length); }
  else { setNum($("tsats"),total); setNum($("tburns"),ROWSB.length); setNum($("ttopics"),gs.length); }
  $("exportbtn").disabled=!ROWSB.length;
  $("bcols").hidden=$("bgroupshead").hidden=!gs.length;
  // HOTTEST TAKES: this burner's statements, their sats summed
  $("bhot").innerHTML=takes.slice(0,8).map(x=>`<div class="bchip lb ic">${iconBadge("",ICON_TAKE)}<a class="lbt" href="topic.html#${esc(x.name)}">${x.t?esc(shownT(parseScope(x.name),x.t)):"<i>no take</i>"}</a><b>${fmt(x.sats)} sats</b><span class="m">${topicName(x.name)} · ${x.burns} burn${x.burns===1?"":"s"}</span></div>`).join("");
  // RECENT: Explore's timeline, this burner's part of it (its takes, the topics it registered or sponsored, its first burn)
  const items=recentDigest(ROWSB.map(v=>({v, name:v.scope})), rootBurns().filter(v=>v.from===ADDR), {burns:12, roots:12, joins:1, all:12});
  $("brecent").innerHTML=items.map(x=>recentRow(x,{self:ADDR})).join("")||`<span class="note">nothing yet</span>`;
  // TAKES BY TOPIC: each take drawn like its topic's board row, with its rank there; the burner's own part under the take
  groups.removeAttribute("aria-busy"); groups.classList.toggle("rise",animate);
  groups.hidden=!gs.length;
  groups.innerHTML=gs.map((g,gi)=>{ const p=parseScope(g.name), T=TALLY[g.name];
    const rows=takes.filter(x=>x.name===g.name).map(x=>{ const i=T?T.answers.findIndex(a=>a.key===x.key):-1; return {...x, rank:i>=0?i+1:null, row:T?(i>=0?T.answers[i]:T.other.find(a=>a.key===x.key)):null}; })
      .sort((a,b)=>(a.rank??1e9)-(b.rank??1e9) || b.sats-a.sats);
    return `<div class="bgroup" style="--i:${Math.min(gi,8)}">
      <div class="divider"><a href="topic.html#${encodeURIComponent(g.name)}" class="tlink">${topicName(g.name)}</a><span class="more"> · ${kindWord(p)}</span> · ${fmt(g.sats)} sats · ${g.rows.length} burn${g.rows.length===1?"":"s"}</div>
      ${rows.map(x=>{ const sats=x.row?x.row.sats:x.sats, burns=x.row?x.row.burns:x.burns, share=T&&T.sats&&x.rank?x.row.sats/T.sats*100:0;
        const k=kindKey(p), two=k==="duel"||k==="yes-no", lead=T&&T.answers[0], tie=two&&T&&T.answers[1]&&T.answers[1].sats===lead.sats;
      const tag= !T ? "" : x.rank ? (k==="number" ? "in range" : two ? (tie?"tied":x.rank===1?"leads":"trails") : "") : x.row ? "not in the result" : "not counted";   // a number is not a podium, a side is not a rank; off the list or late: said
      const rk= !T ? "" : k==="number"||two ? "" : x.rank ? String(x.rank).padStart(2,"0") : "—";
    return `<a class="st${x.rank===1&&!two&&k!=="number"?" r1":""}" href="topic.html#${esc(g.name)}">
        <span class="rank" title="${x.rank?`ranked ${x.rank} in ${esc(topicName(g.name))}`:T?"not ranked: off the topic's list, late or below its minimum":"counting…"}">${rk}</span>
        <span class="txt">${x.t?esc(k==="yes-no"&&p.opts.includes(norm(x.t))?norm(x.t).toUpperCase():shownT(p,x.t)):"<i>no take</i>"}${tag?`<span class="tg${/not/.test(tag)?" warn":""}">${tag}</span>`:""}<small class="mine">this burner · ${fmt(x.sats)} sats${x.burns>1?` · ${x.burns} burns`:""}</small></span>
        <span class="sats">${T?fmt(sats):skel("60px",14)}<small> sats</small></span>
        <span class="votes">${T?`${burns} burn${burns===1?"":"s"}`:""}</span>
        <span class="bar" style="width:${share.toFixed(1)}%"></span>
      </a>`; }).join("")}
    </div>`; }).join("");
}
function paintEmpty(kind){                                  // kind: "none" (nothing to look up) | "bad" (not an address here) | "zero" (a valid address with no burns seen) | null (hidden)
  const e=$("bempty"); e.hidden=!kind; if(!kind) return;
  groups.hidden=true; $("bcols").hidden=$("bgroupshead").hidden=true;
  $("bemptyt").textContent= kind==="none" ? "Which burner?" : kind==="bad" ? `Not a ${NET} address` : `No burns from this address yet on ${NET}`;
  $("bemptyp").textContent= kind==="none" ? "Paste a burner address, or open one from the top burners of any topic." : kind==="bad" ? `A burner is a bech32 address of this network (${HRP}1…). Switch the network chip if the address belongs to the other one.` : "This address has not burned in a registered topic yet.";
  $("bpaste").hidden=kind==="zero";
}
async function load(){
  ADDR=hashText().trim().toLowerCase(); ROWSB=[]; TALLY={}; const my=++seq;
  paintHead();
  if(!ADDR||!validAddr(ADDR)){ status.innerHTML=""; paintRows(); $("tsats").textContent=$("tburns").textContent=$("ttopics").textContent="—"; paintEmpty(ADDR?"bad":"none"); return; }
  paintEmpty(null); paintLoading(); status.innerHTML=syncLine({state:"loading"});
  // saved first: this address's burns in the topics this browser has read, ranked from the same rows. Registrations stay out (Recent shows them, through rootBurns)
  const [all,recs]=await Promise.all([DB.all(),DB.scopes()]); if(my!==seq) return;
  await dirFromDisk(); if(my!==seq) return;
  const rec=new Map((recs||[]).map(r=>[r.name,r])), by=new Map();
  for(const v of all||[]) if(v.scope) (by.get(v.scope)||by.set(v.scope,[]).get(v.scope)).push(v);
  const disk=(all||[]).filter(v=>v.from===ADDR&&v.scope).map(v=>v.h===null?{...v, unver:true}:v);
  let painted=false, low=0;
  if(disk.length){
    for(const n of new Set(disk.map(v=>v.scope))){ const r=rec.get(n); if(!r) continue; TALLY[n]=tallyOf(n,by.get(n)||[]); if(r.height) low=low?Math.min(low,r.height):r.height; }
    ROWSB=disk; paintRows(true); painted=true; status.innerHTML=syncLine({state:"updating", height:low});
  }
  await dirLoad(); if(my!==seq) return;
  const topics=new Map();                                   // every topic this page can name: the registered ones, and the ones opened in this browser
  for(const n of new Set([...DIRECTORY.map(d=>d.name), ...(recs||[]).map(s=>s.name).filter(Boolean)])) topics.set(await topicAddr(n), n);
  if(my!==seq) return;
  let rows, failed=false;
  try{
    const scan=await scanAddress(ADDR,{maxPages:40, cancelled:()=>my!==seq});
    if(!scan) return;
    rows=[...scan.mempool, ...scan.confirmed].filter(tx=>{ const pv=tx.vin&&tx.vin[0]&&tx.vin[0].prevout; return pv&&pv.scriptpubkey_address===ADDR; }).flatMap(tx=>txBurns(tx,topics)).map(v=>cleanVote({...v, scope:v.name})).filter(Boolean);   // its burns: the transactions whose first input it signed
    const got=new Set(rows.map(v=>v.txid+"|"+v.scope));
    rows=[...rows, ...disk.filter(v=>v.h!==null&&!got.has(v.txid+"|"+v.scope))];   // the scan stops at 40 pages: confirmed burns saved here stay
  }catch{ if(my!==seq) return; failed=true; rows=disk; }
  if(my!==seq) return;
  ROWSB=rows; paintRows(!painted);                           // the tiles count up once, on this address's first paint
  await tipFresh(); if(my!==seq) return;
  status.innerHTML= failed ? syncLine({state:"failed", height:low}) : syncLine({state:TIPERR?"failed":"fresh", height:TIP, tail:ROWSB.length?"":"no burns"});
  if(!ROWSB.length){ if(failed) $("tsats").textContent=$("tburns").textContent=$("ttopics").textContent="—"; else paintEmpty("zero"); return; }   // "no burns" only from a read that answered
  const todo=[...new Set(ROWSB.map(v=>v.scope))];            // each topic's standings, three at a time (cache first): the ranks land as they come
  const worker=async()=>{ for(let n; (n=todo.shift())!==undefined; ){ const r=await loadVotes(n).catch(()=>null); if(my!==seq) return; if(r&&(!r.error||r.height||r.votes.length)) TALLY[n]=tallyOf(n,r.votes); paintRows(); } };   // a topic the explorer did not answer for, with nothing saved, stays "counting"
  await Promise.all([worker(),worker(),worker()]);
}
addEventListener("hashchange",load); load();
status.addEventListener("click",e=>{ if(e.target.closest("[data-retry]")){ chainReset(); load(); } });   // another try, when the reader asks
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
