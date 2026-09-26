// ---------- leaderboard ----------
const list=$("list"), status=$("status"), hero=$("hero");
try{ Object.keys(localStorage).filter(k=>k.startsWith("bv.cache.")).forEach(k=>localStorage.removeItem(k)); }catch{}
let S=[], agg={}, q="", seq=0, win=winGet(), sortBy=LS(NETKEY("bv.sort"))==="new"?"new":"top", numBy="sats", zoomOff=false, binAt=null;   // win: the time window shared with Explore (shared.js winGet / winSet); sortBy: an open wall's Top | New (remembered); numBy: a number board by sats or by value
// (the IndexedDB cache lives in db.js: DB.sync / votes / put / putPending / byTx, shared with the ballot and the receipt page)
let late={sats:0,votes:0}, dust={sats:0,votes:0}, none={sats:0,votes:0};
let SEEN=[], BUCKET=new Map(), BURN={}, OUTWIN=new Set(), AGGW={};   // every burn seen this scan; txid -> "late"|"dust"|"window" (not counted) or "none" (no take: in the total only); burner -> {sats, votes} (counted, in the window); OUTWIN: burns out of the window that a result with fixed answers still counts; AGGW: that window's own count
function addVote(v){ SEEN.push(v); countVote(v); }
function recount(){ agg={}; AGGW={}; late={sats:0,votes:0}; dust={sats:0,votes:0}; none={sats:0,votes:0}; BUCKET=new Map(); OUTWIN=new Set(); BURN={}; SEEN.forEach(countVote); S=Object.values(agg); render(); }   // the window changed: count again from every burn seen
const fixedKind=()=>kind(scope.spec||{})!=="open";                 // duels, yes-no, polls, numbers: the result counts all time, like the embed and a shared link; an open wall follows the window
function countVote(v){
  const p=scope.spec||{}, fixed=fixedKind(), inW=win==="all"||closedKnown()||v.h===null||v.h>=TIP-WIN[win];   // closed: the result is final, every burn before the deadline counts
  if (!inW&&!fixed) { BUCKET.set(v.txid,"window"); return; }
  if (!inW) OUTWIN.add(v.txid);
  if (p.deadline && (v.h===null ? tipEst()+1>=p.deadline : v.h>=p.deadline)) { late.sats+=v.sats; late.votes++; BUCKET.set(v.txid,"late"); return; }
  if (p.min && v.sats<p.min) { dust.sats+=v.sats; dust.votes++; BUCKET.set(v.txid,"dust"); return; }
  if (inW && v.from){ const b=BURN[v.from]||(BURN[v.from]={sats:0,votes:0}); b.sats+=v.sats; b.votes++; }
  let k=norm(v.t), t=v.t;
  if (!k) { none.sats+=v.sats; none.votes++; BUCKET.set(v.txid,"none"); return; }   // no take: it backs the topic, never a row, a rank or a share
  if (p.range){ const x=numOf(v.t); if(Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1]){ k="n:"+x; t=String(x); } }   // number answers merge by value: "150k" and "150000" are one row
  const a=agg[k]||(agg[k]={t, sats:0, votes:0, last:0, first:Infinity, pend:0, mine:0, from:new Set(), h0:Infinity, tx0:""});
  a.sats+=v.sats; a.votes++; a.last=Math.max(a.last, v.h??Infinity); a.first=Math.min(a.first, v.h??Infinity); spell(a,v,t);   // spell: the earliest burn's spelling (shared.js)
  if (v.h===null) a.pend+=v.sats; if (v.from) a.from.add(v.from); if (WALLET&&v.from===WALLET.addr) a.mine+=v.sats;
  if (inW && fixed){ const w=AGGW[k]||(AGGW[k]={t, sats:0, votes:0}); w.sats+=v.sats; w.votes++; }
}
const onKey=k=>{ const p=scope.spec||{}; return p.range ? k.startsWith("n:") : p.opts ? p.opts.includes(k) : true; };   // in the result: an option, an in-range number, any take
const keyOfRow=s=>{ const p=scope.spec||{}; if(p.range){ const x=numOf(s.t); if(Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1]) return "n:"+x; } return norm(s.t); };
const noun=()=>kind(scope.spec||{})==="open"?"take":"answer";
const burnsTxt=n=>`${fmt(n)} burn${n===1?"":"s"}`;
// the lines under the board for burns that are not a take: no take (counted in the total only), late and below the minimum (not counted); each opens on its burns
const bucketsHtml=()=>{
  if(q) return "";
  const rows=b=>{ const vs=SEEN.filter(v=>BUCKET.get(v.txid)===b).sort((x,y)=>y.sats-x.sats);
    return vs.slice(0,5).map(v=>`<div class="orow"><span>${v.t?esc(shownT(scope.spec,v.t)):"<i>no take</i>"}</span><span>${fmt(v.sats)} sats · <a href="receipt.html?in=${encodeURIComponent(scope.name)}#${esc(v.txid)}">receipt →</a></span></div>`).join("")+(vs.length>5?`<div class="orow more">+ ${vs.length-5} more</div>`:""); };
  const line=(b,label,x,why)=>`<details class="others bucket" data-b="${b}"${OPEN.has(b)?" open":""}><summary>${label} · ${why} · ${fmt(x.sats)} sats in ${burnsTxt(x.votes)}</summary><div class="orows">${rows(b)}</div></details>`;
  return (none.votes?line("none","No take",none,`backs the topic, not ${noun()==="take"?"a take":"an answer"}`):"") + (late.votes?line("late","Late",late,"not counted"):"") + (dust.votes?line("dust","Below minimum",dust,"not counted"):"");
};
const PHONE=matchMedia("(max-width:480px)");
// closed: the next block reaches the deadline (shared.js closedAt, as tallyOf counts a pending burn late); with no tip at all a deadline topic counts as closed for its buttons (the header says "checking") until the first tip lands
const isClosed=()=>{ const p=scope.spec||{}; return !!(p.deadline&&(!TIP||closedAt(p))); };
const closedKnown=()=>TIP>0&&isClosed();                    // closed for sure: the header, the dialog's note and the standings say so
let WASCLOSED=null;                                          // the last closed state painted: closedFlip() repaints when the estimate crosses the deadline
function closedFlip(){ const c=isClosed(); if(c===WASCLOSED) return; WASCLOSED=c; headMeta(); if(SEEN.length||synced) recount(); }   // recount: the late bucket moves with it; placeholders stay until there are burns
const shareOf=s=>s.total?s.sats/s.total*100:0;
const pct=v=>Math.round(v)+"%";
const wouldLead=gap=>Math.max(gap+1, 330, (scope.spec||{}).min||0);   // the exact amount that would lead: shown only from fresh data, never past a 100,000-sat gap
const leadOk=gap=>synced&&!isClosed()&&gap>=0&&gap<100000;
const asOf=()=>synced||!SHOWN_H?"":`as of block ${fmt(SHOWN_H)} · `;
// ranks: equal sats share a rank (both read "02", no mark); a row nobody burned for is "·"
const rankLabels=rows=>{ const m=new Map(); rows.forEach(s=>{ const j=rows.findIndex(x=>x.sats===s.sats); m.set(s, !s.sats?"·":String(j+1).padStart(2,"0")); }); return m; };
const tag=(t,cls="")=>`<span class="tg${cls?" "+cls:""}">${t}</span>`;
let REVEALED=new Set();                                     // hidden takes the reader chose to see on this page
const rowHtml=(s,rank,cls="")=>{ const sh=shareOf(s), over=enc.encode(s.t).length>80, p=scope.spec||{}, by=hiddenBy(scope.name,s.t), fold=by&&!REVEALED.has(norm(s.t)), disp=fold?`${hiddenTxt(by)} · show`:s.disp??s.t, off=isClosed()||over||fold, unk=s.unknown;   // unknown: nothing saved and not read yet: "—", never 0; fold: a hidden take keeps its row and sats, its text one tap away
  return `
    <div class="st ${cls}${/^=?01$/.test(rank)?" r1":""}" data-vote-row="${esc(s.t)}">
      <span class="rank">${rank}</span>
      <span class="txt"><span class="tt${fold?" hid":""}" title="${esc(disp)}"${fold?` data-reveal="${esc(norm(s.t))}"`:""}>${esc(disp)}</span>${s.tags||""}</span>
      <span class="sats">${unk?"—":fmt(s.sats)}<small> sats${s.total&&s.sats&&!unk?` · ${pct(sh)}`:""}</small></span>
      <span class="votes">${unk?"—":s.votes?burnsTxt(s.votes):"no burns yet"}</span>
      <span class="act">${off?"":`<button class="btn sm" data-vote="${esc(s.t)}" aria-label="Burn for “${esc(disp)}”">${p.range&&Number.isFinite(numOf(s.t))?`Burn for ${esc(nfc(numOf(s.t)))}`:"Burn for it"}</button>`}</span>
      <span class="plus" aria-hidden="true">${off?"":"+"}</span>
      <span class="bar" style="width:${sh.toFixed(1)}%"></span>
    </div>`; };
// ---- smooth updates: rows are keyed by norm(statement) and patched in place; numbers tween, bars transition, reorders FLIP ----
const ROWS=new Map(); let DUEL=null;                    // persistent row elements (open/poll/number), the duel block
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
function rowEl(s,rank,cls=""){                          // s carries total (for the share); returns the row for this statement, created or patched
  const k=norm(s.t), sh=shareOf(s), shape=[isClosed(), enc.encode(s.t).length>80, !!s.unknown, hiddenBy(scope.name,s.t)&&!REVEALED.has(k)].join();
  let r=ROWS.get(k);
  if(!r||r._shape!==shape){ r=htmlEl(rowHtml(s,rank,cls)); r.dataset.key=k; r._shape=shape; r._sats=s.sats; r._disp=s.disp??s.t; r._tags=s.tags||""; ROWS.set(k,r); return r; }   // closed, too long to burn for, or unknown: built again
  r.className="st "+cls+(/^=?01$/.test(rank)?" r1":""); r.querySelector(".rank").textContent=rank;
  const disp=s.disp??s.t, tt=r.querySelector(".tt");
  if(r._disp!==disp){ r._disp=disp; tt.textContent=disp; tt.title=disp; r.dataset.voteRow=s.t; const b=r.querySelector("[data-vote]"); if(b){ b.dataset.vote=s.t; b.setAttribute("aria-label",`Burn for “${disp}”`); } }
  if(r._tags!==(s.tags||"")){ r._tags=s.tags||""; r.querySelectorAll(".txt .tg").forEach(x=>x.remove()); tt.insertAdjacentHTML("afterend",r._tags); }
  r.querySelector(".votes").textContent=s.votes?burnsTxt(s.votes):"no burns yet";
  const sats=r.querySelector(".sats"); sats.lastChild.textContent=` sats${s.total&&s.sats?` · ${pct(sh)}`:""}`;
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
// what changed lately under a result with fixed answers: the window's own count when one is picked, else the last 7 days when anything happened in them
function momentum(rows, yn){                              // rows: [{key, t}] the result's sides or options
  const p=scope.spec||{}, fromW=win!=="all"&&!closedKnown(), W=fromW?WINLABEL[win]:"last 7 days", cap=W.charAt(0).toUpperCase()+W.slice(1);
  const add={}; let n=0, sats=0;
  if(fromW) for(const [k,w] of Object.entries(AGGW)){ if(!onKey(k)) continue; add[k]=w.sats; n+=w.votes; sats+=w.sats; }
  else for(const v of SEEN){ if(BUCKET.has(v.txid)||v.h!==null&&v.h<TIP-1008) continue; const k=keyOfRow(v); if(!onKey(k)) continue; add[k]=(add[k]||0)+v.sats; n++; sats+=v.sats; }
  if(!n) return fromW ? `No burns ${W} · the result above counts all of them` : "";
  if(yn){ const y=add.yes||0; return `${cap}: ${pct(y/sats*100)} yes · ${fmt(sats)} sats in ${burnsTxt(n)}`; }
  if(p.range){ const m=weightedMedian(Object.entries(add).map(([k,s])=>({t:k.slice(2),sats:s}))), all=weightedMedian(S.filter(s=>onKey(keyOfRow(s)))); const d=all?Math.round((m-all)/Math.abs(all)*100):0;
    return `${cap}: estimate ${numU(m,p)}${d?` · ${d>0?"↑":"↓"} ${Math.abs(d)}% vs all time`:""} · ${burnsTxt(n)}`; }
  return `${cap}: `+rows.map(r=>`${esc(r.t)} +${fmt(add[r.key]||0)}${r===rows[0]?" sats":""}`).join(" · ");
}
// the burns' concentration: one address behind most of a result is worth saying
const concLine=rows=>{ const tot=rows.reduce((a,s)=>a+s.sats,0); if(!tot) return ""; const by={}; for(const v of SEEN){ if(BUCKET.has(v.txid)||!v.from||!onKey(keyOfRow(v))) continue; by[v.from]=(by[v.from]||0)+v.sats; }
  const top=Math.max(0,...Object.values(by)); return top>tot/2 ? `One address holds ${pct(top/tot*100)} of the sats.` : ""; };
// ---- a duel, or a yes-no (a forecast headline over it, yes always on the left): two named sides, one bar, the gap in sats ----
function duelEl(A,B,yn){
  const tot=A.sats+B.sats, pa=tot?A.sats/tot*100:50, closed=isClosed(), nA=!!tot&&pa<12, nB=!!tot&&100-pa<12, vs=!yn&&!/-vs-/.test(scope.q);
  const L=s=>yn?s.key.toUpperCase():s.t, lead=A.sats>=B.sats?A:B, trail=lead===A?B:A, gap=lead.sats-trail.sats, tie=!!tot&&gap===0, unk=!synced&&!tot, figs=tot||unk;   // figs: no row of zeros before the first burn, "—" while unknown
  const key=[!!tot,nA,nB,closed,yn,vs,unk].join();
  const fig=(s,c)=>`<p class="dside ${c}"><span class="vh">${esc(L(s))}: </span><span class="dsum"><b class="n${c}">${unk?"—":fmt(s.sats)}</b>${unk?"":" sats"}</span><span class="dmeta v${c}" title="Burners are counted by first-input address; one person can use several.">${unk?"":sideMeta(s)}</span>${closed?"":`<button type="button" class="linkbtn dhint dh${c}" data-vote="${esc(s.key)}"></button>`}</p>`;
  if(!DUEL||DUEL._key!==key){                             // the layout changes (empty, a narrow side, closed, known): build it again; otherwise patch and tween
    if(DUEL) ["_pa","_a","_b"].forEach(k=>cancelAnimationFrame(DUEL[k+"_raf"]));   // the old card's tweens stop: they would paint their old targets into the new one
    DUEL=htmlEl(`
    <div class="duel${tot?"":unk?" unknown":" blank"}${yn?" yesno":""}">
      ${yn?`<div class="fc"><b class="fcbig"></b><span class="fcmeta"></span></div>`:""}
      <div class="duel-head"><span class="a">${esc(L(A))}<b class="side pa">${nA?pct(pa):""}</b></span>${vs?`<i class="vs" aria-hidden="true">VS</i>`:""}<span class="b"><b class="side pb">${nB?pct(100-pa):""}</b>${esc(L(B))}</span></div>
      <div class="duel-bar" role="img"><div class="a" style="width:${pa.toFixed(1)}%"></div><div class="b" style="width:${(100-pa).toFixed(1)}%"></div><span class="pct a">${tot&&!nA?pct(pa):""}</span><span class="pct b">${tot&&!nB?pct(100-pa):""}</span>${tot||unk?"":`<span class="nocall">${yn?"No call yet":"No side yet"}</span>`}</div>
      ${figs?`<div class="duel-sides">${fig(A,"a")}${fig(B,"b")}</div>`:""}
      <p class="duel-verdict"></p>
      ${closed?"":`<div class="duel-acts">${[A,B].map((s,i)=>`<button type="button" class="btn dbtn d${"ab"[i]}" data-vote="${esc(s.key)}">Burn for ${esc(L(s))}</button>`).join("")}</div>`}
      <p class="duel-x"></p>
    </div>`);
    DUEL._key=key; DUEL._pa=pa; DUEL._a=A.sats; DUEL._b=B.sats;
  } else {
    const qs=sel=>DUEL.querySelector(sel);
    if(tot) tween(DUEL,"_pa",pa,v=>{ qs(nA?".side.pa":".pct.a").textContent=pct(v); qs(nB?".side.pb":".pct.b").textContent=pct(100-v); });
    if(figs){ tween(DUEL,"_a",A.sats,v=>qs(".na").textContent=unk?"—":fmt(Math.round(v)));
      tween(DUEL,"_b",B.sats,v=>qs(".nb").textContent=unk?"—":fmt(Math.round(v)));
      qs(".va").innerHTML=unk?"":sideMeta(A); qs(".vb").innerHTML=unk?"":sideMeta(B); }
    DUEL._w=[pa,100-pa];                                  // applied in commit(), after the DOM move
  }
  const qs=sel=>DUEL.querySelector(sel), p=scope.spec||{};
  qs(".duel-bar").setAttribute("aria-label", tot ? `${L(A)} ${pct(pa)}, ${L(B)} ${pct(100-pa)}` : unk ? "—" : yn?"No call yet":"No side yet");
  if(yn){ qs(".fcbig").className="fcbig "+(tot&&!tie?(lead===A?"a":"b"):"");   // the leader's color; "Dead even" in neutral ink, never side A's
    qs(".fcbig").textContent= !tot ? (unk?"—":"No call yet") : tie ? "Dead even" : `${L(lead)} ${pct(lead.sats/tot*100)}`;
    const nb=new Set([...A.from,...B.from]).size; qs(".fcmeta").textContent= tot ? `${tie?"50% / 50% · ":""}of ${fmt(tot)} sats burned · ${burnsTxt(A.votes+B.votes)} · ${nb} burner${nb===1?"":"s"}` : ""; }
  const dl=p.deadline&&!closed&&TIP ? ` Closes ≈ ${new Date(Date.now()+blocksTo(p.deadline)*600000).toLocaleDateString(undefined,{dateStyle:"medium"})}.` : "";
  qs(".duel-verdict").innerHTML= !tot ? (unk ? "" : SEEN.length ? "No counted burns yet. The lines below list the ones that don't count." : yn ? `The first burn sets the forecast.${dl}` : "Nobody has picked a side yet. The first burn sets the bar.")
    : tie ? `${asOf()}Tied at ${fmt(lead.sats)} sats each${yn?`<span class="fcx">Burned sats are gone for good and nobody gets paid: the split shows how much each side was willing to burn.</span>`:""}`
    : yn ? `${asOf()}${esc(L(trail))} is ${efSats(gap)} behind<span class="fcx">Burned sats are gone for good and nobody gets paid: the split shows how much each side was willing to burn.</span>`
    : `${asOf()}${esc(L(lead))} leads by ${efSats(gap)}`;
  for(const [s,c] of [[A,"a"],[B,"b"]]){ const h=qs(".dh"+c); if(!h) continue;   // no figures or closed: no hint
    const behind=tot&&!tie&&trail===s, amt=behind&&leadOk(gap)?wouldLead(gap):0, wait=behind&&!amt&&!synced&&gap<100000;   // the trailing side, duel or yes-no; wait: saved data before the sync keeps the row (hidden), so the amount's arrival moves nothing
    h.textContent=amt?`${fmt(amt)} sats would lead`:wait?"would lead":""; h.dataset.amt=amt||""; h.classList.toggle("wait",wait);   // a tap burns that amount (boardClick: data-amt)
    if(amt) h.setAttribute("aria-label",`Burn ${fmt(amt)} sats for ${L(s)}: would lead`); else h.removeAttribute("aria-label"); }
  qs(".duel-x").innerHTML=[yn?forecastLine():"", concLine([A,B]), momentum([A,B],yn)].filter(Boolean).map(x=>`<span>${x}</span>`).join("");
  return DUEL;
}
// how a yes-no's forecast moved: its yes share after each block with counted burns, drawn as a step line (5 burns over 2 blocks at least)
function forecastLine(){ const vs=SEEN.filter(v=>!BUCKET.has(v.txid)&&onKey(keyOfRow(v))).sort((a,b)=>(a.h??Infinity)-(b.h??Infinity)); if(vs.length<5||new Set(vs.map(v=>v.h)).size<2) return "";
  const pts=[]; let y=0, t=0; for(const v of vs){ t+=v.sats; if(norm(v.t)==="yes") y+=v.sats; const h=v.h??Infinity, s=y/t*100; if(pts.length&&pts[pts.length-1].h===h) pts[pts.length-1].s=s; else pts.push({h,s}); }
  const W=160, H=28, X=i=>(i/(pts.length-1)*W).toFixed(1), Y=v=>(H-2-v/100*(H-4)).toFixed(1), d=`M0 ${Y(pts[0].s)}`+pts.slice(1).map((p,i)=>` H${X(i+1)} V${Y(p.s)}`).join("");
  return `<span class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>Yes: ${pct(pts[0].s)} after the first burn, ${pct(pts[pts.length-1].s)} now</span>`; }
const sideMeta=s=>s.votes?`<span>${burnsTxt(s.votes)}</span>${s.from.size?`<span class="dsep"> · </span><span>${fmt(s.from.size)} burner${s.from.size===1?"":"s"}</span>`:""}`:"<span>no burns yet</span>";   // a side's counts under its sats: numbers and fixed words only, no esc(); a real " · " between them (copy-paste reads it), hidden on phones where they stack
// ---- a take's details: who burned it first and when, how many burns and burners, the other spellings, its burns with receipts, a link to it ----
let OPEN_TAKE=null;                                          // the take whose details are open (its norm)
function withDetail(row,s){ if(norm(s.t)!==OPEN_TAKE) return [row]; const p=scope.spec||{}, key=keyOfRow(s), vs=SEEN.filter(v=>keyOfRow(v)===key).sort((a,b)=>(a.h??Infinity)-(b.h??Infinity)||String(a.txid).localeCompare(b.txid));
  if(!vs.length) return [row]; const f=vs[0], short=a=>a.slice(0,6)+"…"+a.slice(-4), who=new Set(vs.map(v=>v.from).filter(Boolean)), spell=[...new Set(vs.map(v=>v.t.trim()))].filter(t=>t!==s.t);
  const link=new URL(location.href); link.search=(NET==="mainnet"?"":`net=${NET}&`)+"take="+encodeURIComponent(norm(s.t));
  const el=htmlEl(`<div class="stdetail">
    <p>First burned by ${f.from?`<a href="burner.html#${esc(f.from)}" title="${esc(f.from)}">${esc(short(f.from))}</a>`:"an unknown burner"} · ${whenOf(f)}</p>
    <p>${burnsTxt(vs.length)} · ${who.size} burner${who.size===1?"":"s"}${spell.length?` · Also written: ${spell.slice(0,4).map(t=>esc(shownT(p,t))).join(", ")}.`:""}</p>
    <div class="orows">${vs.slice(-5).reverse().map(v=>`<div class="orow"><span>${fmt(v.sats)} sats · ${v.from?esc(short(v.from)):"unknown"} · ${whenOf(v)}</span><span><a href="receipt.html?in=${encodeURIComponent(scope.name)}#${esc(v.txid)}">receipt →</a></span></div>`).join("")}</div>
    <p><button type="button" class="linkbtn" data-copytake="${esc(link.href)}">Copy link to this take</button> · <button type="button" class="linkbtn" data-hidetake="${esc(s.t)}">Hide this take</button></p></div>`);
  return [row, el]; }
function render(){ renderList(); renderStand(); renderBurners(); paintOpts(); if($("votedlg").open) vPaint(); }
let synced=false, boardN=0, OPEN=new Set();                // synced: the first full load of this topic is done; boardN: rows shown past the first page; OPEN: the lines under the board the reader opened
const capBoard=rows=>{ const cap=(PHONE.matches?5:10)+boardN;   // 10 rows on desktop, 5 on phone, then 20 more per click
  if(q || rows.length<=(PHONE.matches?5:10)) return [rows,""];
  if(rows.length<=cap) return [rows,`<button type="button" class="showall" data-showless>Show fewer</button>`];
  const left=rows.length-cap; return [rows.slice(0,cap),`<button type="button" class="showall" data-showmore>Show ${fmt(Math.min(20,left))} more · ${fmt(left)} left</button>`]; };
// off-list answers: one line, not part of the result, all of them a click away; when one outgrows an option, a way to ask again with it
const othersHtml=other=>{ if(!other.length) return "";
  const tot=other.reduce((a,s)=>a+s.sats,0), n=other.reduce((a,s)=>a+s.votes,0), top=other.slice().sort((a,b)=>b.sats-a.sats), all=OPEN.has("othersall");
  const p=scope.spec||{}, weakest=p.opts?Math.min(...p.opts.map(o=>(agg[o]||{sats:0}).sats)):null, w=p.opts&&top[0].sats>weakest?p.opts.find(o=>(agg[o]||{sats:0}).sats===weakest):null;
  const again= w&&norm(top[0].t) ? `<p class="note signal">${esc(top[0].t)} has more sats than ${esc(w)}. Options are fixed in the name · <a class="linkbtn" href="explore.html?new=${encodeURIComponent(canonical({...p, opts:[...p.opts, optClean(top[0].t)], deadline:null}))}">start a new poll with ${esc(top[0].t)} →</a> (burns here stay here)</p>` : "";
  return `<details class="others" data-b="others"${OPEN.has("others")?" open":""}><summary>Other answers · not in the result · ${fmt(tot)} sats in ${burnsTxt(n)}</summary><div class="orows">${(all?top:top.slice(0,5)).map(s=>`<div class="orow"><span>${esc(s.t)}</span><span>${fmt(s.sats)} sats</span></div>`).join("")}${top.length>5&&!all?`<button type="button" class="orow more" data-othersall>+ ${top.length-5} more</button>`:""}</div></details>`+again; };
const optClean=o=>norm(o).replace(/[?|@!]/g,"").replace(/\s+/g,"-");   // an answer as an option of a name: no grammar characters, hyphens for spaces
const quietHtml=()=>`<div class="emptybox quietbox">No burns ${WINLABEL[win]}. <button type="button" class="linkbtn" data-win-all>All time</button></div>`;
const noCountHtml=()=>`<div class="emptybox quietbox">No counted burns yet. The lines below list the ones that don't count.</div>`;
function renderList(){
  const p=scope.spec||{}, k=kindKey(p);
  if(FAILED && !synced && !SEEN.length){                      // the explorer did not answer and nothing is saved: say so, never "no takes yet"
    ROWS.clear(); DUEL=null; hero.hidden=true;
    list.innerHTML=`<div class="emptybox">Nothing saved in this browser yet · <button type="button" class="linkbtn" data-retry>retry</button></div>`; return; }
  if(!synced && !SEEN.length) return;                          // the skeleton stays until something is known
  if(k==="open") return renderOpen(p);
  if(k==="number") return renderNumber(p);
  if(k==="poll") return renderPoll(p);
  return renderDuel(p, k==="yes-no");
}
// ---- an open wall of takes: the leader as a quote over the board, the gap to it, Top | New, and a search that is also where a take gets written ----
function renderOpen(p){
  const tot=S.reduce((a,s)=>a+s.sats,0), ranked=S.slice().sort((a,b)=>b.sats-a.sats), labels=rankLabels(ranked);
  if(synced && !SEEN.length){ ROWS.clear(); hero.hidden=true;   // a brand-new wall: what the first take does
    list.innerHTML=`<div class="emptybox first"><b>Be the first take on ${esc(niceQ(scope.name).toLowerCase())}</b><span>Any burn from ${fmt(Math.max(330,p.min||0))} sats puts it at 01. Others can burn for it or answer with their own.</span>${isClosed()?"":`<span class="acts"><button type="button" class="btn sm primary" data-first>Burn the first take</button><button type="button" class="btn sm" data-copylink>Copy link</button></span>`}</div>`; return; }
  if(q) return renderSearch(p);
  if(!ranked.length){ ROWS.clear(); hero.hidden=true; list.innerHTML=(SEEN.some(v=>BUCKET.get(v.txid)==="window")?quietHtml():noCountHtml())+bucketsHtml(); return; }
  const [a,b]=ranked, gap=b?a.sats-b.sats:0, one=a.from.size;
  hero.hidden=false; hero.className="hero lead1";
  hero.innerHTML=`<p class="lq">“${esc(a.t)}”</p>
    <p class="lm">${b&&!gap ? `Tied for the lead at ${fmt(a.sats)} sats` : `Leads with ${pct(a.sats/tot*100)} of ${fmt(tot)} sats`} · ${burnsTxt(a.votes)} from ${one} burner${one===1?"":"s"}${closedKnown()?" · at the close":""}</p>
    ${b&&gap ? `<p class="lg">${asOf()}“${esc(b.t)}” is ${fmt(gap)} sats behind${leadOk(gap)?` · ${fmt(wouldLead(gap))} would lead <button type="button" class="btn sm" data-vote="${esc(b.t)}" data-amt="${wouldLead(gap)}">Burn for “${esc(b.t)}”</button>`:""}</p>` : ""}`;
  const order= sortBy==="new" ? ranked.slice().sort((x,y)=>(y.first===Infinity?1e12:y.first)-(x.first===Infinity?1e12:x.first)||y.sats-x.sats) : ranked;
  const look=new Map(), vis=s=>norm(s.t).replace(/\p{Cf}/gu,"");   // lookalikes: the same text once invisible characters are stripped
  for(const s of ranked){ const o=ranked.find(x=>x!==s&&vis(x)===vis(s)); if(o) look.set(s,labels.get(o)); }
  const tags=s=>(s.first>=TIP-144||s.first===Infinity&&s.pend?tag("new"):"")+(s.pend?tag(`+${fmt(s.pend)} pending`,"pend"):"")+(look.has(s)?tag(`looks like ${look.get(s)} · different characters`,"warn"):"")+(enc.encode(s.t).length>80?tag("over 80 bytes"):"");
  const before=snapshot(), [shown,more]=capBoard(order);
  commit([...shown.flatMap(s=>withDetail(rowEl({...s,total:tot,tags:tags(s)},labels.get(s),"lane"+(norm(s.t)===OPEN_TAKE?" open":"")), s)), ...htmlEls(more+bucketsHtml())], before);
}
// a search on an open wall: every take of any window that matches, the same words pinned first, and the new take when nothing says it already
function renderSearch(p){
  ROWS.clear(); hero.hidden=true;
  const qn=norm(q), T=tallyOf(scope.name, SEEN), all=T.answers, exact=all.find(r=>r.key===qn), part=all.filter(r=>r!==exact&&(r.key.includes(qn)||norm(r.t).includes(qn))).sort((a,b)=>b.sats-a.sats);
  const raw=$("q").value.trim(), row=(r,t)=>rowHtml({t:r.t, sats:r.sats, votes:r.burns, total:T.shareSats, tags:t}, "·", "lane");
  list.innerHTML = `<div class="searchnote">Takes of every window matching “${esc(raw)}”</div>`
    + (exact ? row(exact, tag("same take","pend")) : !raw ? "" : synced ? `
    <div class="st newrow" data-vote-row="${esc(raw)}" data-new>
      <span class="rank">new</span><span class="txt"><span class="tt">New take · “${esc(raw)}”</span></span><span class="sats">0<small> sats</small></span><span class="votes">starts at 0 sats</span>
      <span class="act"><button class="btn sm primary" data-vote="${esc(raw)}" data-new>Burn it as a new take</button></span><span class="plus" aria-hidden="true">+</span>
    </div>` : `<div class="emptybox quietbox">New take · not in saved data yet</div>`)
    + part.map(r=>row(r,"")).join("");
}
// ---- a poll: the race over the board, every option in its lane from the start ----
function renderPoll(p){
  const zero=o=>({t:o, key:o, sats:0, votes:0, from:new Set(), pend:0, first:Infinity, mine:0}), rows=p.opts.map(o=>agg[o]?{...agg[o],key:o}:zero(o));
  const tot=rows.reduce((a,s)=>a+s.sats,0), ranked=rows.slice().sort((a,b)=>b.sats-a.sats), labels=rankLabels(ranked), other=S.filter(s=>!p.opts.includes(norm(s.t))), unk=!synced&&!tot;
  const burned=ranked.filter(s=>s.sats), [a,b]=burned, gap=b?a.sats-b.sats:0, tint=i=>i?(i<3?"s"+i:"s3"):"s0";
  // the race: one segment per option with burns, the leader in ember; the line says who leads and by how much
  const line= !tot ? (unk?"":SEEN.length?"No counted burns yet. The lines below list the ones that don't count.":`${p.opts.length} options, no burns yet. The first burn sets the leader.`)
    : b&&!gap ? `${asOf()}${esc(a.t)} and ${esc(b.t)} are tied at ${fmt(a.sats)} sats`
    : b ? `${asOf()}${esc(a.t)} leads · ${pct(a.sats/tot*100)} · ${fmt(gap)} sats ahead of ${esc(b.t)}`
    : `${asOf()}${esc(a.t)} leads · the other ${p.opts.length-1} have no burns yet`;
  hero.hidden=false; hero.className="hero race";
  hero.innerHTML=`${tot?`<div class="racebar" role="img" aria-label="${esc(ranked.map(s=>`${s.t} ${pct(s.sats/tot*100)}`).join(", "))}">${burned.map((s,i)=>`<i class="${tint(i)}" style="flex:${s.sats}">${s.sats/tot>=.12?`<b>${esc(s.t)} ${pct(s.sats/tot*100)}</b>`:""}</i>`).join("")}</div>`:""}
    <p class="rline">${line}</p>${[momentum(ranked.map(s=>({key:s.key,t:s.t}))), concLine(ranked)].filter(Boolean).map(x=>`<p class="rmom">${x}</p>`).join("")}`;
  // rank moves since yesterday (144 blocks): only from fresh data, a replay over partial data could invent them
  const old=synced ? rankLabels(p.opts.map(o=>({key:o, sats:SEEN.filter(v=>!BUCKET.has(v.txid)&&v.h!==null&&v.h<TIP-144&&norm(v.t)===o).reduce((x,v)=>x+v.sats,0)})).sort((x,y)=>y.sats-x.sats)) : null;
  const oldRank=o=>{ if(!old) return null; for(const [s,l] of old) if(s.key===o) return l==="·"?null:parseInt(l.replace("=",""),10); return null; };
  const tags=(s,i)=>{ const r=oldRank(s.key), now=s.sats?i+1:null, d=r&&now?r-now:0; return (d?tag(`${d>0?"▲":"▼"}${Math.abs(d)} today`, d>0?"up":""):"")+(s.pend?tag(`+${fmt(s.pend)} pending`,"pend"):""); };
  const before=snapshot();
  commit([...ranked.flatMap((s,i)=>withDetail(rowEl({...s,total:tot,unknown:unk&&!s.sats,tags:tags(s,i)}, labels.get(s), "lane poll"+(i===0&&s.sats?" lead":"")+(p.opts.length>8?" compact":"")+(norm(s.t)===OPEN_TAKE?" open":"")), s)), ...htmlEls(othersHtml(other)+bucketsHtml())], before);
}
// ---- a number: one estimate (the weighted median), its spread, the histogram, the board by sats or by value ----
function renderNumber(p){
  const [lo,hi]=p.range, valid=S.map(s=>({...s,x:numOf(s.t)})).filter(s=>Number.isFinite(s.x)&&s.x>=lo&&s.x<=hi), other=S.filter(s=>{ const x=numOf(s.t); return !(Number.isFinite(x)&&x>=lo&&x<=hi); });
  const tot=valid.reduce((a,s)=>a+s.sats,0), mean=tot?valid.reduce((a,s)=>a+s.x*s.sats,0)/tot:null, med=weightedMedian(valid), q1=weightedQuantile(valid,.25), q3=weightedQuantile(valid,.75), nf=x=>numU(x,p);
  const fin=closedKnown()&&synced&&TIPLIVE>=p.deadline+6;
  // the histogram: round bins, zoomed on the answers when most of the sats sit in two bins
  let B=binsOf(lo,hi), sums=Array(B.n).fill(0); const fill=b=>{ const s=Array(b.n).fill(0); for(const v of valid) s[Math.max(0,Math.min(b.n-1,Math.floor((v.x-b.start)/b.step)))]+=v.sats; return s; };
  sums=fill(B); const two=sums.slice().sort((x,y)=>y-x), zoomable=tot&&valid.length>2&&(two[0]+two[1])/tot>.8&&B.n>3;
  if(zoomable&&!zoomOff){ const idx=sums.map((s,i)=>s?i:-1).filter(i=>i>=0&&sums[i]>=two[1]), a=Math.max(0,Math.min(...idx)-1), b=Math.min(B.n-1,Math.max(...idx)+1), zlo=B.start+a*B.step, zhi=Math.min(hi,B.start+(b+1)*B.step); B=binsOf(Math.max(lo,zlo),zhi); sums=fill(B); }
  const bmax=Math.max(1,...sums), peak=sums.indexOf(Math.max(...sums)), end=B.start+B.n*B.step, pos=x=>Math.max(0,Math.min(100,(x-B.start)/(end-B.start)*100));
  const mine=new Set(valid.filter(s=>s.mine).map(s=>Math.max(0,Math.min(B.n-1,Math.floor((s.x-B.start)/B.step)))));
  const binLabel=i=>`${nf(B.start+i*B.step)} – ${nf(B.start+(i+1)*B.step)}`, cnt=i=>valid.filter(s=>Math.min(B.n-1,Math.floor((s.x-B.start)/B.step))===i).length;
  const medBin=med===null?0:Math.max(0,Math.min(B.n-1,Math.floor((med-B.start)/B.step))), cap=i=>`${binLabel(i)} · ${fmt(sums[i])} sats · ${cnt(i)} answer${cnt(i)===1?"":"s"}`;
  binAt=binAt!==null&&binAt<B.n?binAt:medBin;
  const m=[4,5,3,2].find(m=>B.n%m===0)||1, ticks=Array.from({length:m+1},(_,k)=>k*B.n/m), near=mean!==null&&Math.abs(pos(mean)-pos(med))<9;
  // how the estimate moved: the weighted median after each block with burns
  const hist=[], seen={}; for(const v of SEEN.filter(v=>!BUCKET.has(v.txid)).sort((a,b)=>(a.h??Infinity)-(b.h??Infinity))){ const x=numOf(v.t); if(!(Number.isFinite(x)&&x>=lo&&x<=hi)) continue; seen[x]=(seen[x]||0)+v.sats; const m=weightedMedian(Object.entries(seen).map(([t,s])=>({t,sats:s}))), h=v.h??Infinity; if(hist.length&&hist[hist.length-1].h===h) hist[hist.length-1].m=m; else hist.push({h,m}); }
  const spark=hist.length>1 ? (()=>{ const ys=hist.map(x=>x.m), y0=Math.min(...ys), y1=Math.max(...ys)||1, W=200, H=36, pts=hist.map((x,i)=>`${(i/(hist.length-1)*W).toFixed(1)},${(H-2-(y1===y0?H/2:(x.m-y0)/(y1-y0)*(H-4))).toFixed(1)}`).join(" ");
      return `<div class="spark"><svg viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><span>${nf(hist[0].m)} → ${nf(med)} since block ${hist[0].h===Infinity?"—":fmt(hist[0].h)}</span></div>`; })() : "";
  hero.hidden=false; hero.className="hero est";
  hero.innerHTML = !tot ? `<div class="numview empty"><p class="histempty">${!synced?"":other.length||late.votes||dust.votes?"No answers in range yet":"No answers yet. Where will it land?"}</p><div class="hist-axis">${[lo,(lo+hi)/2,hi].map(x=>`<span>${nf(x)}</span>`).join("")}</div>${synced&&!isClosed()&&!SEEN.length?`<button type="button" class="btn sm primary" data-first>Burn the first answer</button>`:""}</div>`
    : `<div class="esttop"><div class="esthero"><span class="lbl">${fin?"Final estimate":"Estimate"}</span><b>${nf(med)}</b><span class="sub">the middle answer, weighted by sats burned</span></div>
      <div class="eststats"><div><span>Average</span><b>${nf(mean)}</b></div><div><span>Middle half</span><b>${nf(q1)} – ${nf(q3)}</b></div></div></div>
    <div class="numview">
      <div class="hist" style="grid-template-columns:repeat(${B.n},1fr)" role="group" aria-label="Most sats between ${binLabel(peak)}; estimate ${nf(med)}">${sums.map((b,i)=>`<button type="button" class="hb${i===binAt?" on":""}" data-bin="${i}" aria-label="${cap(i)}"><i style="height:${(b/bmax*100).toFixed(0)}%">${i===peak?`<b>${fmt(b)} sats</b>`:""}</i>${mine.has(i)?`<em class="you">you</em>`:""}</button>`).join("")}</div>
      <div class="hist-ticks">${near?`<i style="left:${pos(med)}%">estimate · average</i>`:`<i style="left:${pos(med)}%">estimate</i><i class="avg" style="left:${pos(mean)}%">average</i>`}</div>
      <div class="hist-axis pos">${ticks.map(i=>`<span style="left:${(i/B.n*100).toFixed(1)}%">${nf(B.start+i*B.step)}</span>`).join("")}</div>
      <p class="hcap" aria-live="polite">${cap(binAt)}</p>
      ${zoomable?`<button type="button" class="linkbtn" data-zoom>${zoomOff?"Zoom in":"Full range"}</button>`:""}
    </div>${spark}${[momentum([]), concLine(valid)].filter(Boolean).map(x=>`<p class="rmom">${x}</p>`).join("")}`;
  ROWS.clear();                                        // the number view repaints instantly
  const rows=valid.map(s=>({...s,total:tot,disp:nf(s.x)}));
  let board;
  if(numBy==="value"){ const asc=rows.slice().sort((a,b)=>a.x-b.x), mi=Math.max(0,asc.findIndex(s=>s.x>=med)), cut=!boardN&&asc.length>11&&!q;
    const shown=cut?asc.slice(Math.max(0,mi-5),mi+6):asc;
    board=shown.map(s=>rowHtml({...s,tags:(s.x===med?tag("estimate","pend"):"")+(s.mine?tag("you"):"")},"","lane")).join("")+(cut?`<button type="button" class="showall" data-showmore>Show all ${fmt(asc.length)} answers</button>`:""); }
  else { const ranked=rows.slice().sort((a,b)=>b.sats-a.sats), labels=rankLabels(ranked), [shown,more]=capBoard(ranked); board=shown.map(s=>rowHtml({...s,tags:s.mine?tag("you"):""},labels.get(s),"lane")).join("")+more; }
  list.innerHTML = board + othersHtml(other) + bucketsHtml();
}
// ---- a duel or a yes-no ----
function renderDuel(p,yn){
  const ia=yn?p.opts.indexOf("yes"):0, side=o=>agg[o]?{...agg[o],key:o}:{t:o, key:o, sats:0, votes:0, from:new Set()};   // yes is side A whatever the name's order
  const A=side(p.opts[ia]), B=side(p.opts[1-ia]), other=S.filter(s=>!p.opts.includes(norm(s.t)));
  hero.hidden=true; const before=snapshot();
  commit([duelEl(A,B,yn), ...htmlEls(othersHtml(other)+bucketsHtml())], before);
}
// the standings head: what the result totals, the window as a filter chip, then the search
function renderStand(){
  const p=scope.spec||{}, k=kind(p), empty=synced&&!SEEN.length, closed=closedKnown(), fixed=k!=="open";
  $("standings").hidden=empty;
  $("q").hidden = k!=="open" || !SEEN.length;                 // the search: open topics with takes
  paintVerdict();
  $("tseg").hidden=closed; $("sortseg").hidden=k!=="open"||closed||!SEEN.length; $("numseg").hidden=k!=="number"||!SEEN.length;
  $("standhint").hidden=k!=="open"||!SEEN.length||closed;
  const fin=closed ? (synced&&TIPLIVE>=p.deadline+6 ? `Final · block ${fmt(p.deadline)}` : `closed · final after block ${fmt(p.deadline+6)}`) : null;   // final a few confirmations past the deadline (spec: reorgs), checked on this visit
  $("standchip").hidden=closed||win==="all"||!SEEN.length; $("standchip").innerHTML=`Filtered: ${WINLABEL[win]} <span aria-hidden="true">✕</span>`; $("standchip").setAttribute("aria-label",`Remove the ${WINLABEL[win]} filter`);
  if(!synced&&!SEEN.length){ $("standsum").textContent=""; return; }   // nothing known yet: no "0 takes · 0 sats"
  const on=S.filter(s=>onKey(keyOfRow(s))), sats=on.reduce((a,s)=>a+s.sats,0)+none.sats, burns=on.reduce((a,s)=>a+s.votes,0)+none.votes;
  const pend=p.deadline&&!closed&&TIP&&blocksTo(p.deadline)<=6 ? SEEN.filter(v=>v.h===null&&!BUCKET.has(v.txid)).reduce((a,v)=>a+v.sats,0) : 0;   // the last blocks: what the result counts only if it confirms in time
  $("standsum").textContent=[fin, fixed?null:`${fmt(S.length)} take${S.length===1?"":"s"}`, `${fmt(sats)} sats`, fixed?burnsTxt(burns):null, closed?`every burn before block ${fmt(p.deadline)}`:fixed?"all time":WINLABEL[win], pend?`includes ${fmt(pend)} pending sats, counted only if they confirm before block ${fmt(p.deadline)}`:null].filter(Boolean).join(" · ");
}
const ghostFor = (k,p) => k==="duel"||k==="yes-no"             // loading: the final shape of each kind, unranked, at its final height
  ? `<div class="duel ghost">${k==="yes-no"?`<div class="fc"><span class="sk" style="width:180px;height:40px"></span></div>`:""}<div class="duel-head"><span class="sk" style="width:70px;height:16px"></span><span class="sk" style="width:70px;height:16px"></span></div><div class="duel-bar"></div><div class="duel-sides">${["a","b"].map(c=>`<p class="dside ${c}"><span class="sk" style="width:88px;height:16px"></span><span class="sk" style="width:128px"></span></p>`).join("")}</div><p class="duel-verdict"><span class="sk" style="width:220px"></span></p>${isClosed()?"":`<div class="duel-acts"><span class="sk"></span><span class="sk"></span></div>`}</div>`
  : (k==="poll"?p.opts:Array.from({length:4},()=>"")).map(o=>`
    <div class="st ghost"><span class="rank"></span><span class="txt">${o?esc(o):`<span class="sk" style="width:${40+Math.random()*40}%"></span>`}</span>
    <span class="sats"><span class="sk" style="width:80px"></span></span><span class="votes"><span class="sk" style="width:50px"></span></span><span class="act"></span></div>`).join("");
const heroGhost = k => k==="number" ? `<div class="esttop"><div class="esthero"><span class="lbl">Estimate</span><b><span class="sk" style="width:120px;height:26px"></span></b></div></div><div class="numview"><div class="hist">${'<div></div>'.repeat(10)}</div></div>`
  : k==="poll" ? `<div class="racebar ghost"></div><p class="rline"><span class="sk" style="width:50%"></span></p>`
  : k==="open" ? `<p class="lq"><span class="sk" style="width:60%;height:24px"></span></p><p class="lm"><span class="sk" style="width:40%"></span></p>` : "";

let LOADED=false, FAILED=false, SHOWN_H=0, WASFAILED=false, SINCE=0, TAKE_DONE=false;   // SINCE: the block a watched topic was last seen at (its newer burns say "new")
// since the last visit to a watched topic: what changed, and where this browser's own take stands
function paintSince(news, at){
  const el=$("sincebar"), mine=S.filter(s=>s.mine&&onKey(keyOfRow(s))).sort((a,b)=>b.sats-a.sats)[0], ranked=S.filter(s=>onKey(keyOfRow(s))).sort((a,b)=>b.sats-a.sats), i=mine?ranked.indexOf(mine):-1, up=i>0?ranked[i-1]:null;
  const you= mine&&synced ? (i===0 ? `Your ${noun()} leads` : `Your ${noun()} is ${rankLabels(ranked).get(mine)}${up&&leadOk(up.sats-mine.sats)?` · ${fmt(wouldLead(up.sats-mine.sats))} sats would put it at ${rankLabels(ranked).get(up)}`:""}`) : "";
  const lines=[news?`Since your last visit (${agoText(at)}): ${news.replace(/^\+(\S+)/,(m,n)=>`${n} burn${n==="1"?"":"s"}`)}`:"", you].filter(Boolean);
  el.hidden=!lines.length; el.innerHTML=lines.map(x=>`<span>${esc(x)}</span>`).join("");
}   // LOADED: this topic's first pass ended (answered or not); FAILED: the last pass did not answer; SHOWN_H: the block the board is as of
async function loadScope(name){
  const my=++seq;
  S=[]; agg={}; AGGW={}; late={sats:0,votes:0}; dust={sats:0,votes:0}; none={sats:0,votes:0}; ROWS.clear(); DUEL=null; SEEN=[]; BUCKET=new Map(); OUTWIN=new Set(); BURN={};   // a new scope starts from fresh rows
  synced=false; LOADED=false; FAILED=false; SHOWN_H=0; SINCE=0; $("sincebar").hidden=true; boardN=0; OPEN=new Set(); binAt=null; zoomOff=false; $("burners").hidden=true;
  const sp=scope.spec||{}, k0=kindKey(sp); list.innerHTML=ghostFor(k0,sp); hero.innerHTML=heroGhost(k0); hero.hidden=!hero.innerHTML; hero.className="hero ghost";   // a skeleton of this kind, never the previous topic's
  renderStand(); status.innerHTML=syncLine({state:"loading"});
  hideReady().then(()=>{ if(my===seq&&SEEN.length) render(); });   // the site's hide list: hidden takes fold behind a line
  const r=await loadVotes(name,{                             // loader.js: IndexedDB → snapshot → explorer; this page only paints
    addr:scope.addr, cancelled:()=>my!==seq,
    onPage:votes=>{ votes.forEach(addVote); S=Object.values(agg); render(); },
    onPhase:p=>{ if((p.phase==="cache"||p.phase==="snapshot")&&p.source){ SHOWN_H=p.height; status.innerHTML=syncLine({state:"updating", height:SHOWN_H}); } },   // the final line waits for every read of the pass
  });
  if(!r) return;
  await tipFresh(); if(my!==seq) return;                      // "synced" needs the tip read too: deadlines and windows hang on it
  SEEN=r.votes.slice(); synced=!r.error; FAILED=!!r.error||TIPERR; SHOWN_H=r.error?r.height:TIP; LOADED=true; LASTTICK=Date.now();
  recount(); paintSync();
  const tk=new URLSearchParams(location.search).get("take"); if(tk&&my===seq&&!TAKE_DONE){ TAKE_DONE=true; OPEN_TAKE=norm(tk); render(); const r=list.querySelector(`.st[data-key="${CSS.escape(OPEN_TAKE)}"]`); if(r){ r.classList.add("hl"); r.scrollIntoView({block:"center"}); } }
  if(!r.error){ const T=tallyOf(name,r.votes), w=watchGet().find(x=>x.name===name), news=w&&w.seenAt?watchNews(w,r.votes,T):null;   // a watched topic: once per visit, what changed since the last one
    SINCE=w&&w.seenAt?w.seenH:0; if(w) paintSince(news, w.seenAt); watchMarkSeen(name,r.votes.length,TIP,callSeen(name,T)); if(SINCE) renderBurners(); }
}
let TWIN=null, TWINT=null;                                  // an open topic asking the same question (a duel or yes-no page shows its top takes), and its tally
function paintTwins(addrNow){
  const p=scope.spec||{}, k=kindKey(p), tw=DIRECTORY.filter(d=>d.name!==scope.name&&parseScope(d.name).q===p.q); if(!tw.length) return;
  $("twins").hidden=false; $("twins").innerHTML=tw.slice(0,3).map(d=>{ const t=parseScope(d.name), tk=kindKey(t), href=`topic.html#${esc(d.name)}`;
    return k!=="open"&&tk==="open" ? `<a href="${href}">Why? Read the takes in ${topicName(d.name)} →</a>`
      : k==="open"&&tk!=="open" ? `<a href="${href}">${tk==="yes-no"?"Call it":tk==="duel"?"Pick a side":"Answer"} in ${topicName(d.name)} · ${esc(kindWord(t))}${t.opts&&tk!=="yes-no"?" · "+esc(t.opts.join(" | ")):""} →</a>`
      : `<a href="${href}">Also a topic: ${topicName(d.name)} · ${esc(kindWord(t))} →</a>`; }).join("");
  const open=k!=="open"&&tw.find(d=>kindKey(parseScope(d.name))==="open");
  if(open){ TWIN=open; const go=()=>loadVotes(open.name).then(r=>{ if(scope.addr!==addrNow||!r||r.error&&!r.votes.length) return; TWINT={T:tallyOf(open.name,r.votes), h:r.height}; renderBurners(); });   // read after this page's own read, cache first
    LOADED ? go() : setTimeout(()=>{ if(scope.addr===addrNow) go(); },1500); }
}
function paintSync(){                                         // the line under the title, from this topic's state; the failed state is announced once, on the way in and on the way out
  const n=SEEN.length;
  status.innerHTML=syncLine({state:FAILED?"failed":"fresh", height:SHOWN_H, tail:n?`${n} burn${n===1?"":"s"}`:"no burns yet"});
  if(FAILED!==WASFAILED){ WASFAILED=FAILED; announce(FAILED?"The explorer did not answer":"Synced"); }
}
// a burn signed in this browser (single or ballot) lands on the board at once as pending; the explorer takes over on the next scan
globalThis.addPending=(name,votes)=>{ if(name===""){ dirAddPending(votes.map(cleanVote).filter(Boolean)); headMeta(); return; } if(name!==scope.name) return; (cache[name]||(cache[name]=[])).unshift(...votes); votes.forEach(addVote); S=Object.values(agg); render(); };
function retry(){ chainReset(); if(!SEEN.length) return go(); status.innerHTML=syncLine({state:"updating", height:SHOWN_H}); refresh(); }   // rows on screen stay while the explorer is asked again
status.addEventListener("click",e=>{ if(e.target.closest("[data-retry]")) retry(); });   // the explorer did not answer: another try, when the reader asks
list.addEventListener("toggle",e=>{ const b=e.target.dataset&&e.target.dataset.b; if(b) (e.target.open?OPEN.add(b):OPEN.delete(b)); },true);   // the lines under the board stay as the reader left them
PHONE.addEventListener("change",()=>render());                                // 10 rows on desktop, 5 on phone
document.querySelectorAll("#tseg [data-win]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.win===win)); b.onclick=()=>{
  if(b.dataset.win===win) return;
  document.querySelectorAll("#tseg [data-win]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  win=b.dataset.win; winSet(win); recount();                 // remembered: Explore opens on the same window
}; });
$("q").oninput=e=>{q=e.target.value.toLowerCase();render()};
document.querySelectorAll("#sortseg [data-sort]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.sort===sortBy)); b.onclick=()=>{   // an open wall: Top (sats) or New (first burned), remembered
  sortBy=b.dataset.sort; LS(NETKEY("bv.sort"),sortBy); document.querySelectorAll("#sortseg [data-sort]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); boardN=0; render(); }; });
document.querySelectorAll("#numseg [data-by]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.by===numBy)); b.onclick=()=>{   // a number board: by sats (ranked) or by value (the spread)
  numBy=b.dataset.by; document.querySelectorAll("#numseg [data-by]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); boardN=0; render(); }; });
$("standchip").onclick=()=>$("tseg").querySelector('[data-win="all"]').click();   // the window filter, removed in one tap
function boardClick(e){
  const ct=e.target.closest("[data-copytake]"); if(ct){ copyText(ct.dataset.copytake,ct); return; }
  const rv=e.target.closest("[data-reveal]"); if(rv){ REVEALED.add(rv.dataset.reveal); render(); return; }
  const hd=e.target.closest("[data-hidetake]"); if(hd){ hideMine(scope.name,hd.dataset.hidetake,true); OPEN_TAKE=null; render(); toast("Hidden in this browser · its sats still count"); return; }
  const tt=e.target.closest(".st:not(.ghost):not(.newrow) .txt"); if(tt&&!e.target.closest("button,a")){ const k=tt.closest(".st").dataset.key||norm(tt.closest(".st").dataset.voteRow||""); OPEN_TAKE=OPEN_TAKE===k?null:k; render(); return; }   // the take's text opens its details
  if(e.target.closest("[data-showmore]")){ boardN+=20; render(); return; }
  if(e.target.closest("[data-showless]")){ boardN=0; render(); return; }
  if(e.target.closest("[data-othersall]")){ OPEN.add("othersall"); render(); return; }
  if(e.target.closest("[data-zoom]")){ zoomOff=!zoomOff; binAt=null; render(); return; }
  const bin=e.target.closest("[data-bin]"); if(bin){ binAt=+bin.dataset.bin; render(); hero.querySelector(`[data-bin="${binAt}"]`)?.focus({preventScroll:true}); return; }
  if(e.target.closest("[data-copylink]")){ copyText(location.href,e.target.closest("[data-copylink]")); return; }
  if(e.target.closest("[data-win-all]")){ $("tseg").querySelector('[data-win="all"]').click(); return; }
  if(e.target.closest("[data-first]")){ $("burnbtn").click(); return; }
  if(e.target.closest("[data-retry]")){ retry(); return; }
  let b=e.target.closest("[data-vote]");
  if(!b && PHONE.matches && !isClosed() && !e.target.closest("summary,a,.stdetail")){ const r=e.target.closest("[data-vote-row]"); if(r) b={dataset:{vote:r.dataset.voteRow}, hasAttribute:x=>r.hasAttribute(x)}; }   // phone: the row is the target
  if(!b) return;
  vOther=false; stmt.value=b.dataset.vote;
  if(scope.spec?.range && Number.isFinite(+b.dataset.vote)) $("num").value=b.dataset.vote;   // keep the number input in step with the row clicked
  update();
  openVote(!b.hasAttribute("data-new"), false, 2);                  // Burn for it: the take is chosen, straight to the amount                // an existing statement/option/number opens locked; the synthetic "new" row does not
  if(b.dataset&&b.dataset.amt){ vAmt.reset(+b.dataset.amt); AMTFOR=norm(stmt.value); update(); }   // "831 would lead": the amount comes with it, for this answer
  else if(AMTFOR!==null&&AMTFOR!==norm(stmt.value)){ vAmt.reset(amt.min); AMTFOR=null; update(); }   // another answer: back to the topic's minimum
}
list.addEventListener("click",boardClick); hero.addEventListener("click",boardClick);
hero.addEventListener("focusin",e=>{ const bin=e.target.closest("[data-bin]"); if(bin&&+bin.dataset.bin!==binAt){ binAt=+bin.dataset.bin; hero.querySelectorAll("[data-bin]").forEach(x=>x.classList.toggle("on",x===bin)); const c=hero.querySelector(".hcap"); if(c) c.textContent=bin.getAttribute("aria-label"); } });   // a bin under the finger or the keyboard says its range

let scope={name:"general",addr:"…",poll:null};

const vpay=payPanel("vpay",{speed:false}); PAY.push(vpay);   // the fee speed sits in the amount view (Advanced), not in the transaction
$("vfeehost").innerHTML=feeSegHtml("vfeeseg",true); feeSegWire($("vfeeseg"));
const nfm=x=>Math.abs(+x)>=10000?fmt(+x):String(x);
$("tipaddr").textContent=TIP_EFFECTIVE || "not set yet · left out"; $("copytip").dataset.copy=TIP_EFFECTIVE||""; $("copytip").disabled=!TIP_EFFECTIVE;

// ---------- vote builder: real OP_RETURN script hex ----------
const stmt=document.getElementById("stmt"), amt=document.getElementById("amt"),
      hexEl=document.getElementById("hex"), usd=document.getElementById("usd");
let AMTFOR=null;                                             // the answer a suggested amount (would lead, Make it) was set for; a preset picked by hand clears it
const vAmt=amountChips($("vamtseg"), amt, ()=>{ AMTFOR=null; update(); });   // presets over #amt; reset per topic in openScope (330 or the topic minimum)
const burnTitle=()=>{ const t=stmt.value.trim(), p=scope.spec||{};   // a new take: the question it answers; an existing one (Burn for it): that take, a yes-no's side in capitals
  return vLocked&&t ? (kindKey(p)==="yes-no"&&p.opts.includes(norm(t)) ? `Burn for ${norm(t).toUpperCase()}` : `Burn for “${shownT(p,t)}”`) : niceQ(scope.name); };
const amtLabelText=()=>featureMode ? "Amount to burn to sponsor" : `Amount to burn for this ${kind(scope.spec||{})==="open"?"take":"answer"}${scope.spec&&scope.spec.min?` · min ${fmt(scope.spec.min)}`:""}`;
// an unregistered topic: its registration can ride in the burn's transaction (one OP_RETURN holds both statements, 80 bytes at most)
const vRegOK=()=>!featureMode&&DIRFRESH&&!featureScore(scope.name)&&!regIssue(scope.name)&&!!ROOT&&!isClosed();
const vRegEntries=()=>{ const t=stmt.value.trim(); return [{name:scope.name, addr:scope.addr, statement:t, sats:burnSats()}, {name:"", addr:ROOT.addr, statement:scope.name, sats:REG_SATS, intent:"register"}]; };
const vRegFits=()=>enc.encode(stmt.value.trim()+BALLOT_SEP+scope.name).length<=80;
function update(){
  if(!featureMode&&typeof scope!=="undefined"&&scope.spec) $("votehead").textContent=burnTitle();
  const payload=stmt.value.trim();
  const data=enc.encode(payload);
  const n=data.length, left=80-n;                              // a take is at most 80 bytes: counted as it is typed, an emoji weighs 4 or more
  $("byteshint").textContent= left<0 ? `${-left} bytes too long · emoji use 4 bytes or more, accented letters 2` : `${left} bytes left${n>=70?" · emoji use 4 bytes or more, accented letters 2":""}`;
  $("byteshint").classList.toggle("over",left<0); $("bmeter").firstElementChild.style.width=Math.min(100,n/80*100)+"%"; $("bmeter").classList.toggle("over",left<0);
  hexEl.textContent=toHex(opReturnScript(data));                 // 6a + direct push (<=75) or OP_PUSHDATA1
  const b=burnSats();
  usd.textContent="sats"+(usdOf(b)?" · "+usdOf(b):"");
  const t=tipSats();
  $("tipusd").textContent=t?usdOf(t):"";
  $("tiprow").hidden=!t; amt.setAttribute("aria-invalid",String(!vValid2()));
  const withReg=vRegOK()&&$("vreg").checked&&vRegFits(); $("vregf").hidden=!vRegOK(); $("vregnote").hidden=!(vRegOK()&&$("vreg").checked&&!vRegFits());
  $("vpay-outputs").hidden=withReg;                           // two burns: the raw transaction below carries both
  if(withReg) vpay.set({entries:vRegEntries(), tipAddr:TIP_EFFECTIVE, tipSats:t}); else vpay.set({burnAddr:featureMode&&ROOT?ROOT.addr:scope.addr, burnSats:b, statementBytes:data, tipAddr:TIP_EFFECTIVE, tipSats:t});
  syncPollUI(); paintNumPick(); vPaint();
}
// effective amounts: the burn is the vote (never optional); tip only when ticked
const burnSats=()=>regMode ? REG_SATS : Number(amt.value||0);   // registering burns the fixed amount; the amount chips stay as they were for the next burn
const tipSats=()=>TIP_EFFECTIVE ? Math.max(0,Math.round(Number($("tip").value||0))) : 0;   // "No tip" is 0; no tip address on this network → never a tip output
const vTipSave=()=>tipPrefSave($("tip").value);   // the tip chosen here is every amount dialog's next one (tipPref)
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
  if(featureMode){ $("stmtfield").hidden=false; $("optfield").hidden=true; $("numfield").hidden=true; $("permnote").hidden=true; $("othernote").hidden=true; return; }
  const k=kindKey(scope.spec||{});
  $("stmtlabel").textContent=vOther?"Other answer":"Your take"; $("permnote").hidden=k!=="open"||vLocked;
  $("othernote").hidden=!(vOther&&stmt.value.trim()); if(!$("othernote").hidden) $("othernote").textContent=offListText();   // an answer off the list is shown, not counted in the result: said before paying
  if(scope.spec?.range){
    const raw=$("num").value, set=raw!=="";
    if(set) $("numrange").value=raw; $("numrange").setAttribute("aria-valuetext",set?nfmt(raw):"not set"); $("numbig").textContent=nfmt(raw);
    const numeric=Number.isFinite(+stmt.value.trim());
    $("stmtfield").hidden=numeric;
    const ok=!set||numInRange(), [lo,hi]=scope.spec.range;
    $("numhint").textContent= !set ? "pick a number" : ok ? `${nfm(lo)} – ${nfm(hi)}` : `must be between ${nfm(lo)} and ${nfm(hi)}`;
    $("numhint").classList.toggle("over",!ok); $("num").setAttribute("aria-invalid",String(!ok));
    return;
  }
  if(!scope.poll){ $("stmtfield").hidden=false; return; }
  const on=scope.poll.includes(norm(stmt.value));
  $("stmtfield").hidden=!vOther&&(on||!stmt.value.trim());   // nothing picked yet: chips only
  $("otherans").hidden=!$("stmtfield").hidden||vLocked||k==="yes-no";   // a yes-no has two answers; anything else still shows under Other answers
  $("otherans").textContent= k==="poll" ? "None of these? Burn another answer" : "Neither? Burn another answer";
  document.querySelectorAll("#opts [data-opt]").forEach(b=>{ const sel=b.dataset.opt===norm(stmt.value); b.classList.toggle("primary",sel); b.setAttribute("aria-pressed",String(sel)); });
}
vTip.reset(tipPref());   // 1,000 until another tip is chosen
if(!tipEnabled()){ $("vtipf").hidden=true; $("tiprow").hidden=true; }   // no tip address on this network: every tip control disappears (tipSats() is 0)
vpay.onpaint=vPaint;                                    // the wallet block repaints (wallet created, unlocked, balance in) → the footer primary follows
stmt.oninput=()=>{ if(/\n/.test(stmt.value)) stmt.value=stmt.value.replace(/\s*\n+\s*/g," "); update(); };   // one line of text: a pasted line break becomes a space
stmt.addEventListener("keydown",e=>{ if(e.key==="Enter") e.preventDefault(); });
amt.oninput=update; $("vreg").onchange=()=>update(); update();

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
  $("opts").className="choice "+(k==="duel"?"pair":k); $("opts")._h=""; paintOpts();
  const sp=scope.spec;
  scope.kindLine=k==="open"?"free text, 80 bytes max":k==="number"?`a number, ${nfm(sp.range[0])} – ${nfm(sp.range[1])}`:k==="duel"?(kindKey(sp)==="yes-no"?"":"pick a side"):`pick one of ${scope.poll.length}`;   // a yes-no's line is its deadline alone
  scopeLines(); $("votesub").textContent=scope.sub;
  $("numfield").hidden=!sp.range;
  if (sp.range){
    const [lo,hi]=sp.range, r=$("numrange"), both=Number.isInteger(lo)&&Number.isInteger(hi);
    let step=Math.pow(10,Math.floor(Math.log10(Math.max((hi-lo)/100,1e-9)))); if(both) step=Math.max(1,step);   // a round step: 50000..500000 → 1000, 0..100 → 1
    r.min=lo; r.max=hi; r.step=step; r.value=(lo+hi)/2; $("num").min=lo; $("num").max=hi; $("num").value=""; stmt.value="";   // nothing preset: a burn of a value nobody chose is one tap away otherwise
  } else stmt.value="";
  amt.min=Math.max(330,sp.min||0); vAmt.reset(330);   // never under 330: a smaller output is dust and does not relay
  $("amtlabel").textContent=amtLabelText();
  update();
  WASCLOSED=isClosed(); headMeta();
  tipReady().then(()=>{ if(scope.addr===addrNow) closedFlip(); });   // the fresh tip alone decides closed: never wait for the directory
  TWIN=null; TWINT=null; $("twins").hidden=true;
  dirLoad().then(()=>{ if(scope.addr===addrNow){ headMeta(); renderBurners(); paintTwins(addrNow); } });   // the sponsor score, Recent's sponsorships and the twin topics need the directory
  const want="#"+n.replace(/[%?|@!]/g,encodeURIComponent); if(location.hash!==want) history.replaceState(null,"",location.pathname+location.search+want);   // "|", "@" and "!" survive chat apps percent-encoded; "/" stays readable
  const burn=new URLSearchParams(location.search).get("burn");   // an embed's side button: this side's dialog, opened here; nothing is sent until the visitor validates
  if(burn!==null){ const u=new URL(location.href); u.searchParams.delete("burn"); history.replaceState(null,"",u.pathname+u.search+u.hash);
    const b=norm(burn), sp=scope.spec, ok=b&&!isClosed()&&(sp.opts?sp.opts.includes(b):sp.range?(x=>Number.isFinite(x)&&x>=sp.range[0]&&x<=sp.range[1])(numOf(b)):true);   // a side, an option, a number, a take
    if(ok){ vOther=false; stmt.value=sp.opts?b:burn.trim(); if(sp.range) $("num").value=String(numOf(b)); update(); openVote(true,false,2); } }
}
$("copyaddr").onclick=()=>copyText($("addr").textContent,$("copyaddr"));

// ---------- vote dialog: view 2 is the take (or the amount in its place: the price's edit; sponsoring: the amount), view 4 the transaction ----------
function numInRange(){ const r=scope.spec?.range; if(!r) return true; const v=+stmt.value.trim(); return Number.isFinite(v) && v>=r[0] && v<=r[1]; }   // hoisted like vValid: a number scope only takes numbers inside its range
function vValid1(){ if(featureMode) return true; const raw=stmt.value.trim(); if(!raw||enc.encode(raw).length>80) return false; if(!scope.spec?.range) return true; return Number.isFinite(+raw) ? numInRange() : vLocked; }   // a number topic takes in-range numbers, or an existing off-list row opened from the board
function vValid2(){ return burnSats()>=+(amt.min||330); }
function vValid(n=vStep){ return n<=1 ? vValid1() : vValid1()&&vValid2(); }   // step n reachable when everything before it holds   // hoisted: update() runs at load, before this section
function vPaint(){
  const first=2, sign=vStep>=first, s=vpay.wallet.status(), amtView=vStep===2&&vEdit;   // the first view: the take (none for Burn for it and sponsoring), or the amount in its place; the primary signs
  const sent=!!(s&&s.kind==="sent"), editing=vStep===2&&vEdit; $("vprice").hidden=sent;   // editing: the amount in place of the take, Apply or Cancel
  $("vcancel").hidden=$("vapply").hidden=!editing; $("vapply").disabled=!vValid2();
  $("vsendwrap").hidden=!sign||editing; const t=tipSats();
  const edit=!regMode&&!amtView&&!(s&&(s.kind==="sent"||s.kind==="busy"));   // edit: the amount and the fee speed, in place of the view
  const reg=vRegOK()&&$("vreg").checked&&vRegFits();
  dlgPrice($("vprice"), burnSats(), (regMode?"registration":featureMode?"sponsorship":"burn")+(edit?` <button type="button" class="linkbtn" data-editamt>edit</button>`:""), vpay.wallet.fee(), [reg?`+${fmt(REG_SATS)} sats registration`:null, t?`+${fmt(t)} sats tip`:null].filter(Boolean));
  feeSegPaint($("vfeeseg"), !!(s&&s.kind!=="err"), $("vfeesum"), tipEnabled()?tipSats():null);
  const late=lateRisk(); if(late) $("vfeeseg").querySelector('[data-fee="fast"] span').textContent+=" · recommended";   // near a deadline: the speed that still counts, said, not forced
  const eff=vStep===2&&!vEdit&&!sent ? effectHtml() : ""; if($("veffect")._h!==eff){ $("veffect")._h=eff; $("veffect").innerHTML=eff; } $("veffect").hidden=!eff;
  const ln=amtView?leadNoteHtml():""; $("leadnote").hidden=!ln; if($("leadnote")._h!==ln){ $("leadnote")._h=ln; $("leadnote").innerHTML=ln; }   // the amount view: the card's action, or 'would lead' once the amount does
  const sh=!$("veffect").hidden?$("veffect"):!$("leadnote").hidden?$("leadnote"):null, say=sh?efSay(sh).replace(/\s+/g," ").trim():"";
  if($("veffectsay").textContent!==say) $("veffectsay").textContent=say;   // the dialog's live region: words only, and only when they change (not on every key of a take)
  $("minnote").hidden=!(amtView&&!featureMode&&scope.spec&&scope.spec.min); if(!$("minnote").hidden) $("minnote").textContent=`Burns under ${fmt(scope.spec.min)} sats are listed but never counted, even when they add up.`;
  if(sign) signMenu($("vsend"), $("vsendmenu"), vpay.wallet, {label: regMode?"Validate topic":featureMode?"Validate sponsorship":kind(scope.spec||{})==="open"?"Validate take":"Validate answer",
    ok:vValid(4)&&scope.addr.length>=20, show:()=>{ if(vStep!==4) vGo(4); }, batch:vBatch, tx: vStep!==4 ? ()=>vGo(4) : null, done:()=>$("votedlg").close()});
  $("vsend").title= !featureMode&&enc.encode(stmt.value.trim()).length>80 ? "Shorten your take to 80 bytes" : "";
}
// ---------- what this burn changes, before it is signed: counted by the board's rules on the burns the result counts, plus this one ----------
function offListText(){ const p=scope.spec||{}; return p.range ? `Outside ${numU(p.range[0],p)} – ${numU(p.range[1],p)}: this burn shows under Other answers and is not in the result.`
  : p.opts&&p.opts.length===2 ? `Not ${p.opts[0]} or ${p.opts[1]}: this burn shows under Other answers and is not in the result.` : `Not one of the ${p.opts.length} options: this burn shows under Other answers and is not in the result.`; }
function lateRisk(){ const p=scope.spec||{}; if(!p.deadline||!TIP||closedKnown()) return false; const left=blocksTo(p.deadline); return left<3||left<FEE_SPEEDS.find(f=>f[0]===feeSpeed())[2]; }   // hoisted: update() runs at load
function effectBase(){ const fixed=fixedKind(); return SEEN.filter(v=>fixed||BUCKET.get(v.txid)!=="window"); }   // what the result counts: all time for fixed answers, the window on an open wall
function leadAmt(){                                           // the exact amount that would put this take or answer first (5.0 d), or null
  const p=scope.spec||{}, t=stmt.value.trim(); if(featureMode||!t||!synced||isClosed()) return null; const key=keyOfRow({t}); if(!onKey(key)) return null;
  const T=tallyOf(scope.name, effectBase()), r=T.answers.find(x=>x.key===key), lead=T.answers.find(x=>x.key!==key); if(!lead) return null;
  const gap=lead.sats-(r?r.sats:0); return gap>=0&&gap<100000 ? wouldLead(gap) : null; }
function efIcon(k){ return svgIcon({swap:'<path d="M4 8h15l-4-4M20 16H5l4 4"/>', wallet:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',   // the notes' small icons (a take: ICON_TAKE, late: ICONS.latest); a function: hoisted like the rest
  cost:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>', warn:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>'}[k]); }
function efGo(n,what,b){ return `<button type="button" class="efgo${b?" b":""}" data-make="${n}"><span><b>Make it ${fmt(n)} sats</b><i>${what}</i></span></button>`; }   // the one action: the exact amount, in its side's color
function efOk(what){ return `<span class="efok">${ICON_OK}${what}</span>`; }                                                                          // this amount already does it
function efWarn(h,icon=efIcon("warn")){ return `<p class="efwarn">${icon}<span>${h}</span></p>`; }
function efNote(icon,h,cls=""){ return `<li${cls?` class="${cls}"`:""}>${icon}<span>${h}</span></li>`; }
function efB(p,key){ const k=kindKey(p); return (k==="duel"||k==="yes-no")&&key!==p.opts[k==="yes-no"?p.opts.indexOf("yes"):0]; }   // a duel's second side: blue
function efRefocus(host){ const a=document.activeElement; if(a&&a!==document.body&&a.isConnected) return;   // the tapped control was rebuilt: focus the ✓ or the next action, never <body>
  const t=host.querySelector(".efok,[data-make],[data-switch]")||(host===$("leadnote")?$("vapply"):$("vsend")); if(t.classList.contains("efok")) t.tabIndex=-1; t.focus({preventScroll:true}); }
function efSay(el){ return el.nodeType===3 ? el.textContent : el.nodeType!==1||el.getAttribute("aria-hidden")==="true" ? "" : el.getAttribute("aria-label")||[...el.childNodes].map(efSay).join(" "); }   // what the live region reads: the words, not the pictures (nor the take typed in them)
function efSats(n){ return `${fmt(n)} sat${n===1?"":"s"}`; }                                                                             // a gap: 1 sat, 2 sats
function efTo(a,b){ return `<span class="was">${a}</span> <span class="to" aria-hidden="true">→</span><span class="vh"> to </span> ${b}`; }                                                         // before → after, the after one bright
// the card: the picture, then the outcome (bold) over one fact, and the action; T0/T1 before and after this burn, r0/r1 this answer's row in each
function efCard(p,k,t,key,sats,T0,T1,r0,r1){
  const o=T1.answers.find(r=>r.key!==key), up0=!!r0&&(!o||r0.sats>o.sats), up1=!o||r1.sats>o.sats;   // o: the best other answer (this burn does not move it); up: first on its own
  let viz, head, fact="", act="";
  if(k==="number"){
    const v=T=>T.answers.map(r=>({t:r.t,sats:r.sats})), m0=weightedMedian(v(T0)), m1=weightedMedian(v(T1)), x=numOf(t), f=y=>esc(numU(y,p)), [lo,hi]=p.range, q1=weightedQuantile(v(T1),.25), q3=weightedQuantile(v(T1),.75);
    const X=y=>hi>lo?Math.min(100,Math.max(0,(y-lo)/(hi-lo)*100)):50, P=y=>X(y).toFixed(1)+"%", at=(y,c)=>`<i class="${c}" style="left:${P(y)}"></i>`;
    const lbl=(y,c,h)=>`<span class="${c}" style="left:${P(y)};transform:translateX(-${P(y)})">${h}</span>`;   // a label slides along its point: never past the axis ends
    viz=`<div class="efaxis" aria-hidden="true"><span class="end">${f(lo)}</span><div class="trk"><i class="ln"></i><i class="q" style="left:${P(q1)};width:${(X(q3)-X(q1)).toFixed(1)}%"></i>${m0!==null&&m0!==m1?`<i class="mv" style="left:${P(Math.min(m0,m1))};width:${Math.abs(X(m1)-X(m0)).toFixed(1)}%"></i>`+at(m0,"m0"):""}${at(m1,"m1")}${at(x,"you")}${lbl(x,"lt","yours")}${lbl(m1,"lb","estimate")}</div><span class="end">${f(hi)}</span></div>`;
    const d=Math.abs(x-m1)/Math.abs(m1||1)*100;
    head= m0===null ? "Sets the first estimate" : f(m0)===f(m1) ? `Estimate stays at ${f(m1)}` : `Estimate ${efTo(f(m0),f(m1))}`;   // compared as shown: a midpoint that rounds the same stays
    fact= m0===null ? (T0.other.length?"No answers in range yet":"Nobody has answered yet") : x===m1 ? (m0===m1?"Yours is right on it":"Lands on yours") : `Yours is ${m1>0&&lo>=0?(d<.5?"just":pct(d)):f(Math.abs(x-m1))} ${x>m1?"above":"below"} it`;   // a percent only over a positive estimate; around zero, the distance itself
    const need=estAmt(); act= need&&x!==m1 ? efGo(need,"would be the estimate") : synced&&m0!==null&&m0!==x&&m1===x ? efOk("would be the estimate") : "";   // short of it: the amount; this burn does it: said (fresh data only)
  }
  else if(k==="duel"||k==="yes-no"){
    const yn=k==="yes-no", A=p.opts[yn?p.opts.indexOf("yes"):0], B=p.opts.find(x=>x!==A), nm=x=>esc(yn?x.toUpperCase():x), sh=(T,r)=>T.shareSats&&r?r.sats/T.shareSats*100:0;
    const a1=sh(T1,T1.answers.find(r=>r.key===A)), a0=T0.shareSats?sh(T0,T0.answers.find(r=>r.key===A)):key===A?0:100;   // nothing burned yet: this whole side is the move
    viz=`<div aria-hidden="true"><div class="efends"><span class="a">${nm(A)}</span><span class="b">${nm(B)}</span></div><div class="efbar"><div class="mini"><i class="a" style="width:${a1.toFixed(1)}%"></i><i class="b"></i><span class="proj" style="left:${Math.min(a0,a1).toFixed(1)}%;width:${Math.abs(a1-a0).toFixed(1)}%"></span></div></div></div>`;
    const s0=pct(sh(T0,r0)), s1=pct(sh(T1,r1)), vs=nm(key===A?B:A);
    head=`<span class="${key===A?"a":"b"}">${nm(key)}</span> ${!T0.shareSats?s1:s0===s1?`stays ${s1}`:efTo(s0,s1)}`;   // a share that rounds the same "stays"
    fact= !T0.shareSats ? (yn?"The first burn sets the forecast":"The first burn sets the bar") : !o ? `${vs} has no burns yet`
      : up1 ? `${efSats(r1.sats-o.sats)} ahead of ${vs}` : r1.sats===o.sats ? `Level with ${vs} at ${fmt(r1.sats)} sats each` : `${efSats(o.sats-r1.sats)} short of ${vs}`;
  }
  else{
    const L0=rankLabels(T0.answers), L1=rankLabels(T1.answers), tot=T1.shareSats, n1=L1.get(r1), tied=(T,r)=>T.answers.filter(x=>x.sats===r.sats).length>1, tie=tied(T1,r1), of=k==="poll"?` of ${p.opts.length}`:"";   // ponytail: rankLabels is O(n²), about 50 ms a key at 2,000 takes; rank only r0, r1 and o if boards grow that big
    const rows=T1.answers[0]===r1?[r1,T1.answers[1]]:[T1.answers[0],r1], vs=r=>k==="poll"&&!(hiddenBy(scope.name,r.t)&&!REVEALED.has(norm(r.t)))?esc(r.t):L1.get(r);   // the leader and yours; yours first: the runner-up under it
    const row=r=>{ if(!r) return ""; const mine=r===r1, w=(r.sats-(mine?sats:0))/tot*100, l=L1.get(r), by=!mine&&hiddenBy(scope.name,r.t), hid=by&&!REVEALED.has(norm(r.t));   // a hidden take keeps its row and sats, not its words
      return `<div class="efrow${mine?" me":""}${/^=?01$/.test(l)?" r1":""}"><span class="k">${l}</span><div class="bx"><i style="width:${w.toFixed(1)}%"></i>${mine?`<i class="add" style="left:${w.toFixed(1)}%;width:${(sats/tot*100).toFixed(1)}%"></i>`:""}<span class="n${hid?" hid":""}"${hid?"":` title="${esc(shownT(p,r.t))}"`}>${hid?hiddenTxt(by):esc(shownT(p,r.t))}</span><span class="s">${mine&&r.sats>sats?`<span class="was">${fmt(r.sats-sats)} → </span>`:""}<b>${fmt(r.sats)}</b></span></div></div>`; };
    viz=`<div class="eflad" aria-hidden="true">${rows.map(row).join("")}</div>`;
    const rk=n1==="01"?`<span class="a">01</span>`:n1;
    head=(!r0 ? `Enters ${tie?"tied ":""}at ${rk}` : L0.get(r0)==="01"&&tied(T0,r0)&&!tie ? `Takes ${rk}` : L0.get(r0)===n1 ? `Stays ${rk}` : tie ? `Ties for ${rk}` : `Moves to ${rk}`)+of;   // ranks compared as numbers: breaking away from a tie at 03 still stays 03
    fact= !o ? (k==="open" ? (r0?"The only take so far":"The first take") : T0.shareSats ? "No other option has burns yet" : "The first burn in this poll")
      : r1.sats===o.sats ? "" : up1 ? `${efSats(r1.sats-o.sats)} ahead of ${vs(o)}` : `${efSats(o.sats-r1.sats)} short of ${vs(o)}`;
  }
  if(k!=="number"){ const need=leadAmt(); act= !synced ? "" : o&&up1&&!up0 ? efOk("would lead") : !up1&&need ? efGo(need,"would lead",efB(p,key)) : ""; }   // the lead flips: said; short of it: the exact amount, one tap
  const pre=asOf();
  return `<div class="ef ef-${k}"><p class="efeye"><span>With your ${fmt(sats)} sats${!fixedKind()&&win!=="all"?` · ${WINLABEL[win]}`:""}</span>${pre?`<span class="asof">${pre.replace(/ · $/,"")}</span>`:""}</p>${viz}<div class="efcap"><p><b>${head}</b>${fact?`<span>${fact}</span>`:""}</p>${act}</div></div>`;
}
// a number: the exact amount that puts the estimate on this answer (the weighted median lands on x once the sats at x outweigh the gap between below and above), or null; fresh data only, like leadAmt
function estAmt(){
  const p=scope.spec||{}, t=stmt.value.trim(); if(!p.range||featureMode||!t||!synced||isClosed()) return null;
  const key=keyOfRow({t}), x=numOf(t); if(!onKey(key)) return null;
  const rows=tallyOf(scope.name,effectBase()).answers.map(r=>({t:r.t,sats:r.sats})), m0=weightedMedian(rows); if(m0===null||m0===x) return null;
  let lo=0, hi=0, at=0; for(const r of rows){ const v=numOf(r.t); if(v<x) lo+=r.sats; else if(v>x) hi+=r.sats; else at+=r.sats; }
  const g=Math.abs(lo-hi)-at+1, s=Math.max(g, 330, p.min||0);   // g: capped like leadAmt's gap, not the topic minimum
  return g<=100000&&weightedMedian([...rows,{t:String(x),sats:s}])===x ? s : null; }   // checked on the median itself: never a wrong promise
function effectHtml(){
  const p=scope.spec||{}, k=kindKey(p), t=stmt.value.trim(), sats=burnSats(); if(featureMode||!t||closedKnown()) return "";
  const key=keyOfRow({t}), on=onKey(key), notes=[]; let card="", warn="";
  if(!on){ if(p.range&&Number.isFinite(numOf(t))) card=efWarn(`Pick a number between ${esc(numU(p.range[0],p))} and ${esc(numU(p.range[1],p))}.`); else if(!vOther) card=efWarn(esc(offListText())); }   // typed as another answer: the note under the field says it
  else if(p.min&&sats<p.min) card=efWarn(`Below this topic's ${fmt(p.min)}-sat minimum: this burn would not count.`);
  else if(synced||SHOWN_H){ const base=effectBase(), me={txid:"~", t, sats, h:null, from:WALLET?WALLET.addr:null}, T0=tallyOf(scope.name,base), T1=tallyOf(scope.name,[...base,me]), r1=T1.answers.find(r=>r.key===key);
    if(r1) card=efCard(p,k,t,key,sats,T0,T1,T0.answers.find(r=>r.key===key),r1); }   // nothing read yet: no outcome, never one made of zeros
  if(on&&(k==="duel"||k==="yes-no")){ const o=p.opts.find(x=>x!==key); notes.push(efNote(efIcon("swap"),`<button type="button" class="linkbtn" data-switch="${esc(o)}">Switch to ${esc(k==="yes-no"?o.toUpperCase():o)}</button>`)); }
  if(k==="open"&&!vLocked){ const qn=norm(t), all=tallyOf(scope.name,SEEN).answers, ws=s=>s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" "), q=ws(qn), inW=(l,x)=>!!x&&(" "+l+" ").includes(" "+x+" "), sim=qn.length>=3&&!all.some(r=>r.key===qn)&&all.filter(r=>(inW(ws(r.key),q)||inW(q,ws(r.key)))&&!hiddenBy(scope.name,r.t)).sort((a,b)=>b.sats-a.sats)[0];   // a take already on the board says it better: one tap to back it instead
    if(sim) notes.push(efNote(ICON_TAKE,`Similar take: “<bdi>${esc(sim.t)}</bdi>” · ${fmt(sim.sats)} sats · <button type="button" class="linkbtn" data-use="${esc(sim.t)}">Burn for it instead</button>`)); }
  if(lateRisk()){ const left=blocksTo(p.deadline), n=Math.max(1,Math.ceil(left)), sp=FEE_SPEEDS.find(f=>f[0]===feeSpeed())[1]; warn=efWarn(`Closes in ≈ ${untilText(left)} (${fmt(n)} block${n===1?"":"s"}). ${sp==="Fast"?"Even Fast":sp} may confirm too late and not count${sp==="Fast"?"":": use Fast"}.`,ICONS.latest); }
  if(walletState()==="none") notes.push(efNote(efIcon("wallet"),`No wallet in this browser yet · set one up to burn. Your ${noun()} is kept.`));
  const fee=vpay.wallet.fee(), reg=vRegOK()&&$("vreg").checked&&vRegFits(), all=sats+(reg?REG_SATS:0)+tipSats()+(fee||0); if(BTCUSD) notes.push(efNote(efIcon("cost"),`≈ $${(all/1e8*BTCUSD).toFixed(2)} all in`,"cost"));
  return card+warn+(notes.length?`<ul class="efnotes">${notes.join("")}</ul>`:"");
}
// the amount view (the footer's edit): the same action while the amount falls short; once it is enough, said, with the exact amount one tap away when it overshoots
function leadNoteHtml(){
  const p=scope.spec||{}, num=!!p.range, need=num?estAmt():leadAmt(), b=burnSats(), what=num?"would be the estimate":"would lead"; if(!need) return "";
  return b<need ? efGo(need,what,efB(p,norm(stmt.value))) : efOk(what)+(b>need?`<button type="button" class="linkbtn" data-make="${need}">${fmt(need)} sats is enough</button>`:""); }
$("veffect").addEventListener("click",e=>{
  const m=e.target.closest("[data-make]"), w=e.target.closest("[data-switch]"), u=e.target.closest("[data-use]");
  if(m){ vAmt.reset(+m.dataset.make); AMTFOR=norm(stmt.value); update(); }
  if(w){ stmt.value=w.dataset.switch; vLock(); update(); }
  if(u){ stmt.value=u.dataset.use; vLocked=true; vLock(); update(); $("votehead").textContent=burnTitle(); $("votesub").textContent=vSub(); }
  if(m||w||u) efRefocus($("veffect"));
});
$("leadnote").addEventListener("click",e=>{ const m=e.target.closest("[data-make]"); if(m){ vAmt.reset(+m.dataset.make); AMTFOR=norm(stmt.value); update(); efRefocus($("leadnote")); } });
// the answer chips carry where each answer stands (from fresh data only): a yes-no's share in its side's color, a poll's share and rank
function paintOpts(){
  const p=scope.spec||{}, k=kindKey(p); if(!p.opts) return;
  const T=tallyOf(scope.name,SEEN), tot=T.shareSats, labels=rankLabels(p.opts.map(o=>({key:o, sats:(T.answers.find(r=>r.key===o)||{sats:0}).sats})).sort((a,b)=>b.sats-a.sats)), lab=o=>{ for(const [x,l] of labels) if(x.key===o) return l; return "·"; };
  const order=k==="yes-no"?["yes","no"]:p.opts;
  const h=order.map((o,i)=>{ const r=T.answers.find(x=>x.key===o), sh=synced ? (tot&&r?pct(r.sats/tot*100):k==="poll"?"no burns yet":"0%") : "—";
    return `<button type="button" class="btn${k!=="poll"?" big":""}${k!=="poll"?" side-"+(i?"b":"a"):""}" data-opt="${esc(o)}">${esc(k==="yes-no"?o.charAt(0).toUpperCase()+o.slice(1):o)}<small>${k==="poll"&&synced&&r&&r.sats?`${sh} · ${lab(o)}`:sh}</small></button>`; }).join("");
  if($("opts")._h===h) return; $("opts")._h=h; $("opts").innerHTML=h;
  if($("votedlg").open){ syncPollUI(); vLock(); }
}
// a number's picker: the answers so far as faint bars over the slider, the estimate marked, and four answers one tap away
function paintNumPick(){
  const p=scope.spec||{}; if(!p.range||featureMode) return;
  const [lo,hi]=p.range, valid=S.map(s=>({...s,x:numOf(s.t)})).filter(s=>Number.isFinite(s.x)&&s.x>=lo&&s.x<=hi), tot=valid.reduce((a,s)=>a+s.sats,0);
  const bins=Array(20).fill(0); for(const s of valid) bins[Math.min(19,Math.floor((s.x-lo)/((hi-lo)||1)*20))]+=s.sats; const mx=Math.max(1,...bins), med=weightedMedian(valid);
  const h=tot ? bins.map(b=>`<i style="height:${(b/mx*100).toFixed(0)}%"></i>`).join("")+(med!==null?`<b style="left:${((med-lo)/((hi-lo)||1)*100).toFixed(1)}%"></b>`:"") : "";
  if($("numbins")._h!==h){ $("numbins")._h=h; $("numbins").innerHTML=h; } $("numbins").hidden=!tot;
  const mean=tot?valid.reduce((a,s)=>a+s.x*s.sats,0)/tot:null, picks=tot&&!vLocked?[["Estimate",med],["Average",Math.round(mean*100)/100],["Low",weightedQuantile(valid,.25)],["High",weightedQuantile(valid,.75)]]:[];
  const qh=picks.map(([l,v])=>`<button type="button" class="copy" data-q="${v}">${l} · ${numU(v,p)}</button>`).join("");
  if($("numquick")._h!==qh){ $("numquick")._h=qh; $("numquick").innerHTML=qh; }
}
$("numquick").onclick=e=>{ const b=e.target.closest("[data-q]"); if(!b) return; $("num").value=b.dataset.q; stmt.value=b.dataset.q; update(); };
function vSub(){ return vLocked ? [kindKey(scope.spec||{})==="yes-no"?niceQ(scope.name):"in "+topicName(scope.name).replace(/&amp;/g,"&"), ...(scope.rules||[])].join(" · ") : scope.sub||""; }   // the dialog's subtitle: a given take, the question it goes to; a new one, the typing hint
function vGo(n){
  n=Math.max(n,2); vStep=n; const amtView=vEdit;   // view 2: the take (none for Burn for it and sponsoring), or the amount in its place (the price's edit; registering, a fixed 330, has none)
  $("vstep-4").hidden=n!==4; $("vstep-2").hidden=n!==2||!amtView; $("vstep-1").hidden=n!==2||amtView||vLocked; vPaint(); segThumbs();
  $("votedlg").querySelector(".dlg").scrollTop=0;
  const first=[...document.querySelectorAll(`#vstep-1 :is(input,textarea,button.primary),#vstep-${n} :is(input,textarea,button.primary)`)].find(el=>!el.closest("[hidden]")&&!el.disabled&&!el.readOnly&&el.type!=="hidden"&&el.type!=="checkbox");
  (n===2&&amtView ? ($("vamtseg").hidden?amt:$("vamtseg").querySelector('[aria-pressed="true"]'))||amt : first||$("vsend")).focus({preventScroll:true});
}
let vSnap=null;                                              // what the amount view started from: Cancel puts it back
$("vprice").onclick=e=>{ if(!e.target.closest("[data-editamt]")) return; vSnap={amt:amt.value, tip:$("tip").value, fee:feeSpeed()}; vEdit=true; vGo(2); };
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
  vLocked=false; vLock(); update(); $("votesub").textContent=scope.sub||"";
  const k=kind(scope.spec||{});
  (!stmt.readOnly&&!$("stmtfield").hidden ? stmt : k==="number" ? $("num") : $("opts").querySelector("[data-opt]")||stmt).focus({preventScroll:true});
};
let vOpener=null; $("votedlg").addEventListener("close",()=>{ vOpener?.focus?.({preventScroll:true}); vOpener=null;
  const s=vpay.wallet.status(); if(FUNDING==="vpay"&&!(s&&s.kind==="sent")&&stmt.value.trim()){ FUNDING=null; const e=featureMode&&ROOT ? {name:"", addr:ROOT.addr, statement:scope.name, sats:burnSats(), intent:regMode?"register":"feature"} : {name:scope.name, addr:scope.addr, statement:stmt.value.trim(), sats:burnSats()};   // closed while the wallet was being funded: the take waits in the batch
    if(ballotFind(e.addr)<0){ ballotAdd(e); ballotPill(); toast("Your take is in your batch. It waits there until your wallet is funded."); } } });
function openVote(locked=false, feature=false, start=1){   // start 2: the take is known (Burn for it), straight to the amount
  featureMode=!!feature; regMode=featureMode && !featureScore(scope.name); vTip.reset(tipPref());   // the saved tip, whichever dialog chose it
  $("votehead").textContent = regMode ? "Register #"+scope.q : featureMode ? "Sponsor #"+scope.q : burnTitle();
  if(regMode){ $("votesub").textContent= DIRFRESH ? `Nobody has registered this topic yet. Registering burns ${fmt(REG_SATS)} sats so it appears in Explore. Sponsoring it later ranks it higher.` : `Registers this topic so it appears in Explore, or sponsors it if someone already did · ${fmt(REG_SATS)} sats.`; amt.min=330; }   // "nobody" only from a directory read on this visit
  else if(featureMode){ $("votesub").textContent=`Ranks it on Home and in Explore · ${fmt(featureScore(scope.name))} sats so far.`; amt.min=330; }
  else { amt.min=Math.max(330,(scope.spec&&scope.spec.min)||0); $("votesub").textContent=scope.sub||""; }   // a plain burn: the topic's own line, not the one a sponsoring left
  update();                                                  // the payload follows the mode at once (root address and minimum when sponsoring)
  $("addr").textContent = featureMode&&ROOT ? ROOT.addr : scope.addr;
  vOpener=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:$("burnbtn");
  vLocked=!!locked; vLock(); if(!featureMode){ $("votehead").textContent=burnTitle(); $("votesub").textContent=vSub(); }   // a given take: the question it goes to, not the typing hint
  $("amtlabel").textContent=amtLabelText();
  vEdit=false; vSnap=null; $("vfeeadv").open=false; $("vbatchnote").hidden=true; $("vafter").hidden=true; $("closednote").hidden=featureMode||!closedKnown(); $("votedlg").showModal(); vGo(2); }   // sponsoring: the statement is the topic name, nothing to ask, straight to the amount
$("copylink").onclick=()=>copyText(location.href,$("copylink"));
$("featurebtn").onclick=()=>{                          // register / sponsor = burn to the root topic with this topic's name, locked
  vOther=false; stmt.value=scope.name; openVote(true,true);
};
$("burnbtn").onclick=()=>{                             // + New take / + New answer: a fresh burn for this topic's kind
  vOther=false;
  if(scope.spec?.range) $("num").value="";                  // a number starts unset: "—" and Validate off until one is picked
  stmt.value="";
  if(kind(scope.spec||{})==="open"&&$("q").value.trim()) stmt.value=$("q").value.trim();   // the search box is also where a take gets written
  update(); openVote();
};
const hashScope=()=>hashText();
const go=()=>openScope(hashScope());
addEventListener("hashchange",go);
go();
segThumbs();

// ---------- header: kind, badges, live countdown, actions ----------
// (featureScore lives in shared.js: the sats burned to the root topic with this name; explore and index rank by it)
function headMeta(){                                          // the static part: from the name alone, before any burn is known
  const p=scope.spec||{}, fs=featureScore(scope.name), closed=closedKnown(), segs=p.q?p.q.split("/"):[];
  scopeLines(); $("closednote").hidden=!closed||featureMode;   // the dialog's deadline line and its closed note follow the estimate (sponsoring a closed topic still ranks it)
  $("hkind").textContent=kindWord(p).toUpperCase()+(segs.length>1?` · in ${segs.slice(0,-1).join("/")}/`:"");
  // the question as a heading (a path's folders link to Explore's search), the name itself under it: the address, the links and the data use the name
  const last=segs.length>1?niceQ(canonical({...p, q:segs[segs.length-1]})):null;
  $("boardtitle").innerHTML= last ? segs.slice(0,-1).map((f,i)=>`<a class="folder" href="explore.html?q=${encodeURIComponent(segs.slice(0,i+1).join("/")+"/")}">${esc(f.replace(/-/g," "))}</a>`).join(" › ")+" › "+esc(last) : esc(niceQ(scope.name));
  $("boardslug").textContent=scope.name; document.title=niceQ(scope.name)+" · Burning Take";
  $("hmin").hidden=!p.min; if(p.min){ $("hmin").textContent=`min ${fmt(p.min)} sats`; $("hmin").title="Smaller burns are listed as below minimum and not counted."; }
  $("hrange").hidden=!p.range; if(p.range) $("hrange").textContent=`${nfc(p.range[0])} – ${nfc(p.range[1])}`;
  $("hrule").hidden=!p.range; if(p.range) $("hrule").textContent=`Answer with a number from ${numU(p.range[0],p)} to ${numU(p.range[1],p)}. More sats, more weight.`;
  const ri=fs?null:regIssue(scope.name);                      // a name the directory would never list: said at once, and Register stays off
  $("hreg").hidden=!!fs || scope.name==="" || !DIRFRESH&&!ri;  // "not registered" only from a directory read on this visit
  $("hreg").textContent= ri ? `can't be registered · ${ri}` : "not registered · not in Explore";
  $("hcount").hidden=!p.deadline; headTick();
  $("hmeta").hidden=[...$("hmeta").children].every(b=>b.hidden);   // no rules and registered: no badge line at all
  $("featurebtn").hidden=scope.name==="";
  $("featurebtn").textContent= fs ? `✦ Sponsor · ${satsShort(fs)}` : DIRFRESH ? "Register" : "Register / sponsor";
  $("featurebtn").title= fs ? `Sponsor this topic: burn to the root topic with its name · ${fmt(fs)} sats so far` : ri ? `This name can't be registered: ${ri}. Share its link instead.` : "Register this topic so it appears in Explore";   // same act, the first one lists it
  $("featurebtn").disabled=!!ri;
  $("burnbtn").textContent= kind(p)==="open" ? "+ New take" : kind(p)==="poll" ? "+ Burn an answer" : "+ New answer"; $("qrow").hidden=kind(p)==="duel";   // beside the search, like Explore's + New topic; a duel burns from its two sides
  $("burnbtn").hidden=isClosed();                             // closed: no path offers a burn that would not count
  paintMbar(); watchPaint();
}
// phones: the burn within thumb reach, in the header's words (a duel's two sides), the result once closed
function paintMbar(){ const p=scope.spec||{}, k=kindKey(p), el=$("mbar");
  el.hidden=scope.name===""; if(el.hidden) return;
  el.innerHTML= isClosed() ? `<button type="button" class="btn" data-seeresult>See the result ↓</button>`
    : k==="duel"||k==="yes-no" ? (k==="yes-no"?["yes","no"]:p.opts).map((o,i)=>`<button type="button" class="btn${i?" sideb":" primary"}" data-vote="${esc(o)}"><span>Burn for ${esc(k==="yes-no"?o.toUpperCase():o)}</span></button>`).join("")
    : `<button type="button" class="btn primary" data-newburn>${esc($("burnbtn").textContent)}</button>`; }
$("mbar").addEventListener("click",e=>{ if(e.target.closest("[data-seeresult]")) $("hclosed").scrollIntoView({block:"start"}); else if(e.target.closest("[data-newburn]")) $("burnbtn").click(); else boardClick(e); });
// phones: Sponsor joins Watch and More in the header's action row
const placeSponsor=()=>{ const b=$("featurebtn"); if(PHONE.matches) document.querySelector(".hactions").prepend(b); else $("tactions").prepend(b); };
PHONE.addEventListener("change",placeSponsor); placeSponsor();
function scopeLines(){                                        // the dialog's lines: the kind, the minimum, the deadline as it stands now
  const sp=scope.spec||{}, st=closeState(sp), dl=!st?null:st.k==="open"?`closes ≈ ${dlWhen(sp.deadline)} · in ${Math.round(blocksTo(sp.deadline)/144)} days`:st.short;
  scope.rules=[sp.min?`min ${fmt(sp.min)} sats`:null, dl].filter(Boolean);   // what still matters when the take is given
  scope.sub=[scope.kindLine, sp.min?`min ${fmt(sp.min)} sats`:null, dl].filter(Boolean).join(" · ");
}
function headTick(){                                          // every minute: the deadline's state, the time left as a bar from the registration to the close, the result banner once closed
  const p=scope.spec||{}; if(!p.deadline) return;
  closedFlip();
  const st=closeState(p, synced?TIPLIVE:0);
  $("hcounttxt").textContent=st.text; $("hcount").classList.toggle("live",st.k==="soon"||st.k==="last"); $("hcount").classList.toggle("done",!["open","soon","last","checking"].includes(st.k));
  $("hcount").title= TIP ? `block ${fmt(p.deadline)} · about ${fmt(Math.max(0,Math.ceil(blocksTo(p.deadline))))} blocks to go` : "";
  const d=DIRECTORY.find(x=>x.name===scope.name), from=d&&Number.isFinite(d.first)?d.first:null;
  $("tleft").hidden=!from||!TIP||st.k!=="open"&&st.k!=="soon"&&st.k!=="last";
  if(!$("tleft").hidden) $("tleft").firstElementChild.style.width=Math.max(0,Math.min(100,(tipEst()-from)/Math.max(1,p.deadline-from)*100)).toFixed(1)+"%";
  paintVerdict();
}
// a closed topic's result, said once at the top: who the burns backed, final only a few confirmations past the deadline on a tip read now
function paintVerdict(){
  const p=scope.spec||{}, el=$("hclosed"), st=p.deadline&&closedKnown()&&(synced||SEEN.length)?closeState(p, synced?TIPLIVE:0):null;
  el.hidden=!st; if(!st) return;
  const fin=st.k==="final", k=kindKey(p), on=S.filter(s=>onKey(keyOfRow(s))).sort((a,b)=>b.sats-a.sats), tot=on.reduce((a,s)=>a+s.sats,0), [a,b]=on, pc=s=>pct(s.sats/tot*100), after=`final after block ${fmt(p.deadline+6)}`;
  const nm=s=>k==="yes-no"?norm(s.t).toUpperCase():k==="open"?`“${s.t}”`:s.t;
  let line;
  if(!tot) line= fin ? `Final · no counted burns before block ${fmt(p.deadline)}` : `Closed · no counted burns · ${after}`;
  else if(k==="number"){ const v=on.map(s=>({...s,x:numOf(s.t)})), med=weightedMedian(v), mean=v.reduce((x,s)=>x+s.x*s.sats,0)/tot; line= fin ? `Final estimate ${numU(med,p)} · average ${numU(mean,p)}` : `Closed · estimate ${numU(med,p)} · ${after}`; }
  else if(b&&a.sats===b.sats) line= fin ? `Final · tie · ${pc(a)} / ${pc(b)}` : `Closed · tied · ${after}`;
  else if(k==="yes-no") line= fin ? `Final · the burns said ${nm(a)} · ${pc(a)} of ${fmt(tot)} sats` : `Closed · ${nm(a)} ahead · ${after}`;
  else if(k==="open") line= fin ? `Top take at close: ${nm(a)} · ${fmt(a.sats)} sats` : `Closed · ${nm(a)} leads · ${after}`;
  else line= fin ? `Final · ${nm(a)} wins · ${pc(a)} of ${fmt(tot)} sats` : k==="duel" ? `At the deadline: ${nm(a)} ahead · ${after}` : `Closed · ${nm(a)} ahead · ${after}`;
  el.innerHTML=`<p class="verdict">${esc(line)}</p>${k==="yes-no"&&fin?`<p class="vnote">Burning Take records what people burned, not what happened.</p>`:""}<div class="vacts"><button type="button" class="btn sm" data-share>Share</button><button type="button" class="btn sm" data-copylink>Copy link</button></div>`;
}
setInterval(headTick,60000);
// ---- watch ★ ----
function watchPaint(){ const on=watchHas(scope.name); $("watchbtn").setAttribute("aria-pressed",String(on)); $("watchbtn").classList.toggle("on",on); $("watchlbl").textContent=on?"Watching":"Watch"; $("watchbtn").title=on?"Stop watching this topic":"Watch this topic in this browser"; }
$("watchbtn").onclick=()=>{ const on=watchToggle(scope.name); if(on) watchMarkSeen(scope.name,SEEN.length,TIP); watchPaint(); toast(on?"Watching · kept in this browser":"No longer watching"); };
// ---- export: the counted burns and the buckets, as a file or on the clipboard ----
const exportData=()=>({
  topic:scope.name, network:NET, address:scope.addr, height:TIP, exportedAt:new Date().toISOString(),
  statements:Object.values(agg).sort((a,b)=>b.sats-a.sats).map(a=>({statement:a.t, sats:a.sats, votes:a.votes})),
  buckets:{late:{...late}, belowMinimum:{...dust}, noTake:{...none}},
  votes:SEEN.map(v=>{ const b=BUCKET.get(v.txid); return {txid:v.txid, height:v.h, statement:v.t, sats:v.sats, from:v.from||null, counted:!b||b==="none", bucket:b||null, other:!b&&!onKey(keyOfRow(v))}; }),   // other: counted, not one of the answers (spec §6 "other")
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
const embedH=()=>({open:300, poll:260})[kindKey(scope.spec||{})]||240;   // the card's height by kind, so a static frame does not clip it
const embedSnippet=(auto=false)=>{ const u=new URL("embed.html",location.href); if(NET!=="mainnet") u.searchParams.set("net",NET); u.hash=scope.name; const id="bt-"+scope.q.replace(/[^a-z0-9]+/g,"-").slice(0,24);   // pasted into other sites: the name is text there too
  const f=`<iframe${auto?` id="${id}"`:""} src="${u.href}" width="100%" height="${embedH()}" style="border:0" title="Burning Take · #${esc(scope.q)}"></iframe>`;
  return auto ? f+`\n<script>addEventListener("message",function(e){var f=document.getElementById("${id}");if(f&&e.source===f.contentWindow&&e.origin==="${location.origin}"&&e.data&&e.data.bvHeight)f.style.height=e.data.bvHeight+"px";});<\/script>` : f; };   // "<\/script>": the page's own script block must not end here   // the height follows the card; matched by frame and origin, never by topic name
$("embedbtn").onclick=morePick(()=>{ $("em-code").textContent=embedSnippet(); $("em-code2").textContent=embedSnippet(true); $("embeddlg").showModal(); });
$("em-copy3").onclick=()=>copyText($("em-code2").textContent,$("em-copy3"));
$("shareimg").onclick=morePick(()=>sharePage());   // the result as a card: the share sheet, else the text copied and the image saved
$("em-copy").onclick=()=>copyText($("em-code").textContent,$("em-copy"));
$("em-copy2").onclick=()=>copyText($("em-code").textContent,$("em-copy2"));
// ---- ballot: keep this burn aside (shared.js ballotAdd), cast several in one transaction from the nav pill ----
function vBatch(){ const e=featureMode&&ROOT ? {name:"", addr:ROOT.addr, statement:scope.name, sats:burnSats(), intent:regMode?"register":"feature"} : {name:scope.name, addr:scope.addr, statement:stmt.value.trim(), sats:burnSats()}, i=ballotFind(e.addr);
  if(i>=0) return batchConflict($("vbatchnote"), i, e, ()=>{ $("votedlg").close(); ballotPill(); toast("Batch updated"); });   // one burn per topic per transaction (ballotui.js)
  const n=ballotAdd(e); $("votedlg").close(); ballotPill(); toast(`Added to your batch · ${n} burn${n===1?"":"s"}`); }
// ---- receipts: a burn signed here is on disk at once as pending (h:null, from = this wallet), so receipt.html#<txid> can show it before the explorer does ----
// a burn sent from here: pending on disk and on the board at once; registered or sponsored, the header follows at once too
vpay.wallet.onsent=({txid})=>{ const v={txid, t:stmt.value.trim(), sats:burnSats(), h:null, from:WALLET?WALLET.addr:"", tx:txid.slice(0,6)+"…"+txid.slice(-4), vout:0};
  if(!featureMode&&vRegOK()&&$("vreg").checked&&vRegFits()){ const r={...v, t:scope.name, sats:REG_SATS, vout:1, at:Date.now()}; DB.putPending("",[r]); dirAddPending([cleanVote(r)]); headMeta(); }   // registered in the same transaction: listed at once, in the mempool
  if(featureMode){ DB.putPending("",[v]); dirAddPending([cleanVote({...v, at:Date.now()})]); headMeta(); renderBurners(); return; } DB.putPending(scope.name,[v]); addPending(scope.name,[v]); paintAfter(v.t); };
const STAR='<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';   // the top take of the topic, in Recent
// ---- under the board: [biggest burns (window)] | [recent (this topic's timeline, whatever the window), top burners (window)] ----
function renderBurners(){
  const host=$("burners"), short=a=>a.slice(0,6)+"…"+a.slice(-4), tag={late:" · late",dust:" · below min",window:""}, closed=closedKnown(), W=closed?"before close":WINLABEL[win], p=scope.spec||{};
  const seen=SEEN.filter(v=>{ const b=BUCKET.get(v.txid); return b!=="window"&&!OUTWIN.has(v.txid)&&!(closed&&b==="late"); });   // the window's burns; closed: the ones that made the result (late ones stay in Recent and the Late line)
  host.hidden=!SEEN.length || !!q; if(host.hidden) return;   // from the first burns known (saved ones included), not during a search
  const top=Object.entries(BURN).sort((a,b)=>b[1].sats-a[1].sats).slice(0,5);   // counted sats only
  const off=v=>!BUCKET.has(v.txid)&&!onKey(keyOfRow(v));      // counted, but not one of the answers the result is made of
  const pendTag=v=>(v.h===null&&p.deadline&&!closed ? ` · counts if it confirms before block ${fmt(p.deadline)}` : "")+(SINCE&&(v.h===null||v.h>SINCE)?" · new":"")+(WALLET&&v.from===WALLET.addr?" · you":"");   // pending near a deadline, new since the last visit, this browser's own
  // the burn that took the lead, replayed in block order: only from fresh data, a replay over part of the burns could invent one
  const flips=new Set(); if(synced&&kind(p)!=="open"){ const run={}; let lead=null; for(const v of SEEN.filter(v=>!BUCKET.has(v.txid)&&onKey(keyOfRow(v))).sort((a,b)=>(a.h??Infinity)-(b.h??Infinity))){ const k=keyOfRow(v); run[k]=(run[k]||0)+v.sats; if(lead!==null&&k!==lead&&run[k]>(run[lead]||0)){ flips.add(v.txid); lead=k; } else if(lead===null) lead=k; } }
  const burnRow=v=>`<div class="bchip lb ic">${iconBadge("",ICON_TAKE)}<span class="lbt">${v.t?esc(shownT(p,v.t)):"<i>no take</i>"}</span><b>${fmt(v.sats)} sats</b>
      <span class="m">${v.from?`<a href="burner.html#${esc(v.from)}" title="${esc(v.from)}">${esc(short(v.from))}</a>`:"unknown burner"} · ${whenOf(v)}${tag[BUCKET.get(v.txid)]||""}${off(v)?" · not in the result":""}${pendTag(v)}</span><a class="m" href="receipt.html?in=${encodeURIComponent(scope.name)}#${esc(v.txid)}">receipt →</a></div>`;
  const burnerRow=(addr,sats,meta)=>`<a class="bchip br ic" href="burner.html#${esc(addr)}" title="${esc(addr)}">${iconBadge("burner",ICONS.burner)}<span class="ad">${esc(short(addr))}</span><span class="m">${meta}</span><b>${fmt(sats)} sats</b></a>`;
  const col=(head,rows,empty)=>`<div class="burnercol"><div class="divider">${head}</div>${rows.join("")||`<span class="note">${empty}</span>`}</div>`;
  const word=noun();   // the board's 01: counted like countVote, off-list answers never rank; on a number topic, the estimate's bin
  const lead=Object.entries(agg).filter(([k])=>onKey(k)).sort((a,b)=>b[1].sats-a[1].sats)[0], leadKey=lead&&lead[1].sats>0?lead[0]:null;
  let near=null; if(p.range&&SEEN.length){ const valid=S.map(s=>({...s,x:numOf(s.t)})).filter(s=>Number.isFinite(s.x)&&s.x>=p.range[0]&&s.x<=p.range[1]), med=weightedMedian(valid), B=binsOf(p.range[0],p.range[1]); if(med!==null){ const bin=x=>Math.floor((x-B.start)/B.step); near=x=>bin(x)===bin(med); } }
  const star=v=>{ if(!v.t) return false; if(p.range){ const x=numOf(v.t); return !!near&&Number.isFinite(x)&&x>=p.range[0]&&x<=p.range[1]&&near(x); } return leadKey!==null&&keyOfRow(v)===leadKey; };
  const starTitle=p.range?"In the estimate's range":`The top ${word} in this topic · ${W}`;
  const take=(v,link)=>{ const rk=star(v), t=v.t?esc(shownT(p,v.t)):""; return link(!v.t?"<i>no take</i>":rk?`<span>${t}</span><span class="rk1" role="img" aria-label="${starTitle}" title="${starTitle}">${STAR}</span>`:t, rk?" has-rk":""); };   // link: recentRow's, to the topic page
  const items=recentDigest(SEEN.map(v=>({v, name:scope.name})), rootBurns().filter(v=>v.name===scope.name));   // shared.js, Explore's Recent for this topic alone
  const right = `<div class="burnercol"><div class="divider"><span class="hot" title="Live: each new block adds its burns here">Recent</span></div><div class="tl">${items.map(x=>recentRow(x,{here:true, take, tag:v=>(tag[BUCKET.get(v.txid)]||"")+(off(v)?" · not in the result":"")+(flips.has(v.txid)?" · took the lead":"")+pendTag(v)})).join("")}</div></div>`
    + col(`<span title="by first-input address">Top burners · ${W}</span>`, top.map(([a,b])=>burnerRow(a,b.sats,burnsTxt(b.votes))), "none counted "+W);
  const twin= TWIN&&TWINT&&TWINT.T.answers.length ? col(`Takes in ${topicName(TWIN.name)}`, TWINT.T.answers.slice(0,3).map((r,i)=>`<a class="bchip lb ic" href="topic.html#${esc(TWIN.name)}">${iconBadge("",ICON_TAKE)}<span class="lbt">${String(i+1).padStart(2,"0")} · “${esc(r.t)}”</span><b>${fmt(r.sats)} sats</b><span class="m">as of block ${fmt(TWINT.h)}</span></a>`), "") : "";   // not tied to a side: those takes are said, not counted here
  host.innerHTML = `<div class="col cl">${col(`Biggest burns · ${W}`, [...seen].sort((a,b)=>b.sats-a.sats).slice(0,ONE_COL.matches?5:20).map(burnRow), "none "+W)}${twin}</div><div class="col cr">${right}</div>`;
  if(!ONE_COL.matches){ const L=host.querySelector(".cl"), R=host.querySelector(".cr"), rows=[...L.querySelectorAll(".bchip")];   // Biggest burns grows to the right column's height, never below 5
    for(let n=rows.length; n>5 && L.offsetHeight>R.offsetHeight+6; ) rows[--n].remove(); }
}
const ONE_COL=matchMedia("(max-width:860px)"); ONE_COL.addEventListener("change",()=>renderBurners());
// ---------- live: the open topic is read again every minute (cache first: one request when nothing changed), new blocks and mempool burns alike ----------
// one pass at a time: a slow pass is joined, not stacked; a failed pass keeps the board and says since when; a tab back after a minute away reads at once
let REFP=null, LASTTICK=Date.now();
function refresh(){ return REFP||(REFP=(async()=>{ const my=seq; try{
  await tipRefresh(); if(my!==seq) return; closedFlip();
  const r=await loadVotes(scope.name,{addr:scope.addr, force:true, cancelled:()=>my!==seq}); if(!r||my!==seq) return;
  if(r.error){ FAILED=true; if(!SEEN.length) render(); paintSync(); return; }
  SEEN=r.votes.slice(); synced=true; FAILED=TIPERR; SHOWN_H=TIP; recount(); headTick(); paintSync();
  dirLoad(true).then(()=>{ if(my===seq){ headMeta(); renderBurners(); } });   // the root topic too: sponsorships land in the header and in Recent
} finally{ REFP=null; LASTTICK=Date.now(); } })()); }
setInterval(()=>{ if(!document.hidden&&LOADED) refresh(); },60000);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden&&LOADED&&Date.now()-LASTTICK>60000) refresh(); });

// ---------- share: the result as it stands on a card (shared.js drawCard), the system's share sheet, else the text copied and the image saved ----------
function shareText(){
  const p=scope.spec||{}, k=kindKey(p), on=S.filter(s=>onKey(keyOfRow(s))).sort((a,b)=>b.sats-a.sats), tot=on.reduce((a,s)=>a+s.sats,0), q=niceQ(scope.name);
  if(!tot) return `“${q}” · no burns yet · burn the first one:`;
  if(k==="poll") return `${q} · ${p.opts.map(o=>[o,(agg[o]||{sats:0}).sats]).sort((a,b)=>b[1]-a[1]).map(([o,x])=>`${o} ${pct(x/tot*100)}`).join(" · ")} · burn for yours:`;
  if(k==="number") return `Estimate ${numU(weightedMedian(on.map(s=>({t:String(numOf(s.t)),sats:s.sats}))),p)} on “${q}” · burn to disagree:`;
  const a=on[0]; return `${k==="yes-no"?norm(a.t).toUpperCase():k==="open"?`“${a.t}”`:a.t} leads ${pct(a.sats/tot*100)} on “${q}” · burn to disagree:`;
}
const topicCard=()=>{ const p=scope.spec||{}, k=kindKey(p), on=S.filter(s=>onKey(keyOfRow(s))).sort((a,b)=>b.sats-a.sats), tot=on.reduce((a,s)=>a+s.sats,0), st=closeState(p);
  return drawCard(kindWord(p).toUpperCase(), x=>{
    const W="#f3efe9", G="#a89f95", E="#ffb547", B="#7fa8ff", SL=["#ff6a1a","#56667f","#44526a","#343f52"];
    x.font=`600 36px ${CF.D}`; x.fillStyle=W; let y=200; for(const l of wrapLines(x,niceQ(scope.name),1000).slice(0,2)){ x.fillText(l,96,y); y+=44; }
    const meta=[tot?`${fmt(tot)} sats burned`:"no burns yet", st?st.short:null].filter(Boolean).join(" · ");
    if(k==="yes-no"||k==="duel"){ const ia=k==="yes-no"?p.opts.indexOf("yes"):0, A=p.opts[ia], Bo=p.opts[1-ia], a=(agg[A]||{sats:0}).sats, b=(agg[Bo]||{sats:0}).sats, L=o=>k==="yes-no"?o.toUpperCase():o;
      if(k==="yes-no"&&tot){ x.font=`800 84px ${CF.D}`; x.fillStyle=a>=b?E:B; x.fillText(`${L(a>=b?A:Bo)} ${pct(Math.max(a,b)/tot*100)}`,96,y+80); y+=100; }
      else { x.font=`700 44px ${CF.D}`; x.fillStyle=E; x.fillText(L(A),96,y+50); const w=x.measureText(L(A)).width; x.fillStyle=G; x.font=`500 26px ${CF.M}`; x.fillText(" VS ",96+w+10,y+48); x.fillStyle=B; x.font=`700 44px ${CF.D}`; x.fillText(L(Bo),96+w+90,y+50); y+=70; }
      cardBar(x,96,y,1008,44,[[a||(tot?0:1),"#ff8a2a"],[b||(tot?0:1),"#3d7bff"]]); x.font=`700 22px ${CF.D}`; x.fillStyle="#1a0900"; if(tot) x.fillText(pct(a/tot*100),112,y+30); x.textAlign="right"; x.fillStyle="#fff"; if(tot) x.fillText(pct(b/tot*100),1088,y+30); x.textAlign="left"; y+=80; }
    else if(k==="poll"){ cardBar(x,96,y,1008,40,tot?on.map((r,i)=>[r.sats,SL[Math.min(i,3)]]):[[1,"rgba(255,255,255,.07)"]]); y+=80; x.font=`500 28px ${CF.B}`;
      on.slice(0,3).forEach((r,i)=>{ x.fillStyle=i?G:E; x.fillText(`${String(i+1).padStart(2,"0")}`,96,y); x.fillStyle=W; x.fillText(`${r.t} · ${pct(r.sats/tot*100)}`,150,y); y+=40; }); }
    else if(k==="number"){ const v=on.map(s=>({t:String(numOf(s.t)),sats:s.sats,x:numOf(s.t)})), m=weightedMedian(v);
      x.font=`500 18px ${CF.M}`; x.fillStyle=G; x.fillText(tot?(closedKnown()?"FINAL ESTIMATE":"ESTIMATE"):"NO ANSWERS YET",96,y+20); if(tot){ x.font=`700 76px ${CF.D}`; x.fillStyle=E; x.fillText(numU(m,p),96,y+96); }
      const Bn=binsOf(p.range[0],p.range[1]), sums=Array(Bn.n).fill(0); for(const s of v) sums[Math.max(0,Math.min(Bn.n-1,Math.floor((s.x-Bn.start)/Bn.step)))]+=s.sats; const mx=Math.max(1,...sums), bw=(1008-(Bn.n-1)*6)/Bn.n;
      sums.forEach((s,i)=>{ const h=s/mx*70; x.fillStyle=s?"#ff8a2a":"rgba(255,255,255,.06)"; rr(x,96+i*(bw+6),y+190-Math.max(3,h),bw,Math.max(3,h),4); x.fill(); }); y+=210; }
    else { x.font=`500 30px ${CF.B}`; on.slice(0,3).forEach((r,i)=>{ x.fillStyle=i?G:E; x.fillText(String(i+1).padStart(2,"0"),96,y+10); x.fillStyle=W; const t=wrapLines(x,`“${r.t}”`,760)[0]; x.fillText(t,150,y+10); x.textAlign="right"; x.fillStyle=G; x.fillText(`${fmt(r.sats)} sats · ${pct(r.sats/tot*100)}`,1104,y+10); x.textAlign="left"; y+=54; }); if(!tot){ x.fillStyle=G; x.fillText("No takes yet · burn the first one",96,y+10); } }
    x.font=`400 20px ${CF.M}`; x.fillStyle="#8a8177"; x.fillText(meta,96,Math.min(512,y+10));
  }, `as of block ${fmt(SHOWN_H||TIP)}`); };
async function sharePage(){ const url=new URL(location.href); url.search=NET==="mainnet"?"":`?net=${NET}`;   // the link to the topic, with its network, no dialog in it
  shareCard({title:niceQ(scope.name)+" · Burning Take", text:shareText(), url:url.href, canvas:await topicCard(), stem:"burning-take-"+scope.q.replace(/[^a-z0-9]+/g,"-")}); }
document.addEventListener("click",e=>{ if(e.target.closest("[data-share]")) sharePage(); });
// after a burn: where the take stands now (the pending burn counted like the board counts it), and a way to share it
function paintAfter(t){ const p=scope.spec||{}, k=kindKey(p), key=keyOfRow({t}), on=S.filter(s=>onKey(keyOfRow(s))).sort((a,b)=>b.sats-a.sats), i=on.findIndex(s=>keyOfRow(s)===key), r=on[i], lab=r?rankLabels(on).get(r):null, el=$("vafter");
  const nm=k==="yes-no"?norm(t).toUpperCase():k==="open"?`“${t}”`:shownT(p,t), tot=on.reduce((a,s)=>a+s.sats,0);
  const line= !r ? "Burned · it shows under the board, not in the result" : (k==="duel"||k==="yes-no") ? `Burned · ${nm} now has ${pct(r.sats/tot*100)}, your burn included (still in the mempool)` : k==="number" ? `Burned · the estimate is ${numU(weightedMedian(on.map(s=>({t:String(numOf(s.t)),sats:s.sats}))),p)}, your answer included (still in the mempool)` : `Burned · ${nm} is ${lab} with ${fmt(r.sats)} sats, yours included (still in the mempool)`;
  el.hidden=false; el.innerHTML=`<p>${esc(line)}</p><button type="button" class="btn sm" data-share>Share your ${noun()}</button>`; }
