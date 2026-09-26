// ---------- receipt page: one burn, identified by its txid (receipt.html#<txid>) ----------
// Data: IndexedDB by txid (one row per topic of the transaction; a ballot has several), else the transaction itself from the explorer, its outputs matched against the directory.
// A burn signed in this browser is on disk as pending (h:null) the moment it is broadcast, so the receipt link works before any explorer has it.
const status=$("status");
let R=null, ALL=[], seq=0;                                  // R: the burn shown (lowest vout), ALL: every burn of the transaction
const stmtOf=v=>v.t||"";
let REGD=false, STAND="";                                    // REGD: this root burn is the topic's registration (its first); STAND: the topic's standing, as of a block
const PICK=(()=>{ try{ return new URLSearchParams(location.search).get("in"); }catch{ return null; } })();   // receipt.html?in=<topic>#<txid>: that topic's burn of a batch
// the burn, then the question it answers in words, what the topic makes of it (counted, not counted, pending), and where its take stands now
function paint(){
  const v=R, root=v.scope==="", tn=root?nameOf(v.t)||"":v.scope, p=parseScope(tn), k=tn?kindKey(p):"open", t=stmtOf(v), none=!t&&!root;   // a root burn sponsors (the first time: registers) the topic its statement names
  const side=(k==="duel"||k==="yes-no")&&!root&&p.opts.includes(norm(t)) ? (p.opts.indexOf(norm(t))===(k==="yes-no"?p.opts.indexOf("yes"):0)?"sa":"sb") : "";
  $("rnet").textContent=NET; $("ricon").innerHTML=root?(REGD?ICONS.reg:ICONS.feature):ICON_TAKE; $("ricon").className="fi"+(root?(REGD?" reg":" feature"):"");
  $("rstmt").textContent= root ? (tn?niceQ(tn):"a burn to the root topic") : none ? "No take" : k==="yes-no"&&side ? norm(t).toUpperCase() : shownT(p,t);
  $("rstmt").className="rstmt"+(none?" abstain":"")+(side?" "+side:"");
  $("rquest").textContent= root ? (tn?(REGD?"registered":"sponsored"):"") : none ? "this burn backs the topic, not a statement" : niceQ(tn);
  $("rsats").textContent=fmt(v.sats);
  $("rin").textContent= root&&tn ? (REGD?"to register":"to sponsor") : "in";
  $("rtopic").textContent= root&&!tn ? "the root topic" : topicName(tn).replace(/&amp;/g,"&"); $("rtopic").href= root&&!tn ? "explore.html" : "topic.html#"+encodeURIComponent(tn); $("rtopic").title=tn;   // a root burn naming no topic: an ordinary burn to that address
  $("rkind").textContent= tn&&!root ? " · "+kindWord(p) : "";
  $("rstatus").textContent= root ? (tn?(REGD?"the topic's first root burn: it is listed in Explore":"a root burn naming the topic: it ranks it higher"):"") : burnStatus(p,v);
  $("rstatus").className="rstatus"+(/not counted|not in the result/.test($("rstatus").textContent)?" off":"");
  $("rstand").hidden=!STAND; $("rstand").textContent=STAND;
  const again=!root&&tn&&!closedAt(p)&&/^counted|^pending/.test(burnStatus(p,v))&&t;   // backing the same take is one tap: the topic page opens its dialog on it
  $("ragain").hidden=!again; if(again) $("ragain").href=`topic.html?burn=${encodeURIComponent(norm(t))}#${encodeURIComponent(tn)}`;
  if(v.h===null){ $("rblock").innerHTML=`<span class="pend"><i></i>pending</span>`; $("rconf").textContent=whenOf(v)+" · not final"; }
  else { $("rblock").textContent=fmt(v.h); const c=TIP>=v.h?TIP-v.h+1:null; $("rconf").textContent=c?`${fmt(c)} confirmation${c===1?"":"s"}`:"confirmed"; }   // a tip below the burn is an old tip: no count from it
  $("rfrom").textContent=v.from||"unknown"; $("rfrom").href=v.from?"burner.html#"+v.from:"#"; $("rfrom").title=v.from||"";
  $("rtxid").textContent=v.txid; $("rexp").href=TXURL(v.txid);
  const others=ALL.filter(x=>x!==v);
  $("ralso").hidden=!others.length;
  $("ralso").innerHTML= others.length ? `Same transaction, ${others.length} more burn${others.length===1?"":"s"}: `+others.map(x=>`${x.scope?"":"sponsoring "}<a href="topic.html#${encodeURIComponent(x.scope||nameOf(x.t)||"")}">#${esc(parseScope(x.scope||nameOf(x.t)||"").q)}</a> · ${x.t?esc(shownT(parseScope(x.scope||""),x.t)):"<i>no take</i>"} · ${fmt(x.sats)} sats`).join(" · ") : "";
  document.title=(root?(tn?niceQ(tn):"root burn"):none?"no take":$("rstmt").textContent)+" · receipt · Burning Take";
  $("rcard").hidden=false; $("runknown").hidden=true; $("rpreview").hidden=true;
}
// where the burn's take stands now: one read of its topic (IndexedDB first; a fresh browser scans the topic once), as of the block read; nothing on a failed read
async function standing(my){
  const v=R; if(!v||v.scope===""||!v.scope) return; const p=parseScope(v.scope), k=kindKey(p), r=await loadVotes(v.scope).catch(()=>null); if(my!==seq||!r||r.error&&!r.votes.length) return;
  const T=tallyOf(v.scope,r.votes), tot=T.shareSats, key=(()=>{ const x=numOf(v.t); return p.range&&Number.isFinite(x)?"n:"+x:norm(v.t); })(), i=T.answers.findIndex(a=>a.key===key), row=T.answers[i], at=` · as of block ${fmt(r.height)}`, pc=s=>Math.round(s/tot*100)+"%";
  if(!tot||i<0&&k!=="number"){ STAND=""; return; }
  if(k==="duel"||k==="yes-no"){ const L=o=>k==="yes-no"?o.toUpperCase():o, s=o=>(T.answers.find(a=>a.key===o)||{sats:0}).sats; STAND=`on the ${L(key)} side · ${p.opts.map(o=>`${L(o)} ${pc(s(o))}`).join(" · ")}${at}`; }
  else if(k==="number"){ const m=weightedMedian(T.answers), x=numOf(v.t); STAND=`estimate ${numU(m,p)}${Number.isFinite(x)&&m?` · this answer is ${x===m?"right on it":`${Math.round(Math.abs(x-m)/Math.abs(m)*100)}% ${x>m?"above":"below"}`}`:""}${at}`; }
  else STAND=`${k==="open"?`“${row.t}”`:row.t} is ${String(i+1).padStart(2,"0")} of ${T.answers.length} ${k==="open"?"takes":"options"} in ${topicName(v.scope).replace(/&amp;/g,"&")} · ${fmt(row.sats)} sats · ${pc(row.sats)}${at}`;
  paint();
}
function unknown(txid, why){                               // why: "bad" (not a txid) | "missing" (no such transaction) | "other" (it burns in no topic this page can name) | "offline"
  const T={bad:["That is not a transaction id","A receipt link ends with the 64 hex characters of a transaction id: receipt.html#<txid>."],
    missing:["No such transaction","The explorer knows no transaction with this id, confirmed or in the mempool."],
    other:["Not a burn in a registered topic","This transaction pays no topic this page can name. If it burns in a topic nobody registered, open that topic by its name and the burn shows there."],
    offline:["The explorer did not answer","Try again, or pick another explorer at the bottom of the page."]}[why];
  $("rcard").hidden=true; $("runknown").hidden=false;
  $("runkt").textContent=T[0]; $("runkp").textContent=T[1];
  $("rfind").hidden=why!=="other"; $("rretryp").hidden=why!=="offline"; $("runkexpp").hidden=why==="bad"; if(why!=="bad") $("runkexp").href=TXURL(txid);
  document.title="Receipt · Burning Take";
}
async function txRows(tx){                                  // a transaction's burns in every topic this page can name
  await dirLoad();
  const topics=new Map([[await topicAddr(""),""]]);
  for(const n of new Set([...DIRECTORY.map(d=>d.name), ...((await DB.scopes())||[]).map(s=>s.name).filter(Boolean)])) topics.set(await topicAddr(n), n);
  return txBurns(tx,topics).map(v=>cleanVote({...v, scope:v.name})).filter(Boolean);
}
async function load(){
  const txid=hashText().trim().toLowerCase(), my=++seq;
  R=null; ALL=[];
  if(!/^[0-9a-f]{64}$/.test(txid)){ status.innerHTML=""; unknown(txid,"bad"); return; }
  status.innerHTML=syncLine({state:"loading"});
  let rows=((await DB.byTx(txid))||[]).map(v=>v.h===null?{...v, unver:true}:v); if(my!==seq) return;   // unconfirmed rows from disk are not verified yet
  let failed=false;
  if(!rows.length){                                        // not in this browser: the transaction from the explorer, its outputs matched against every topic this page can name
    let tx;
    try{ tx=await chainGet(`/tx/${txid}`); }catch(e){ if(my!==seq) return; status.innerHTML=""; unknown(txid, e&&(e.status===404||e.status===400)?"missing":"offline"); return; }
    rows=await txRows(tx); if(my!==seq) return;
  } else if(rows.some(v=>v.h===null)){                     // pending on disk: shown at once, then asked again. The answer is never saved: a confirmed row written outside a full scan would hide older burns (loader.js stopTx)
    rows.sort((a,b)=>(a.vout??0)-(b.vout??0)); ALL=rows; R=rows.find(r=>r.scope===PICK)||rows[0]; paint(); status.innerHTML=syncLine({state:"loading"});
    try{ const fresh=await txRows(await chainGet(`/tx/${txid}`)); if(my!==seq) return; if(fresh.length) rows=fresh; }
    catch(e){ if(my!==seq) return; failed=!(e&&e.status===404); }   // 404: the explorer does not list it (yet): the saved row stays, with its age
  }
  if(my!==seq) return;
  if(!rows.length){ status.innerHTML=""; unknown(txid,"other"); return; }
  rows.sort((a,b)=>(a.vout??0)-(b.vout??0)); ALL=rows; R=rows.find(r=>r.scope===PICK)||rows[0]; STAND=""; REGD=false; paint();
  if(R.scope===""){ await dirLoad(); if(my!==seq) return; REGD=rootBurns().some(x=>x.txid===R.txid&&x.reg); }   // a root burn: the topic's registration, or a sponsorship after it
  await tipFresh(); if(my!==seq) return; paint();                 // confirmations from the tip read on this visit
  standing(my);
  status.innerHTML=syncLine({state:failed||TIPERR?"failed":"fresh", height:TIP});
}
addEventListener("hashchange",load); load();
$("rretry").onclick=()=>{ chainReset(); load(); };
status.addEventListener("click",e=>{ if(e.target.closest("[data-retry]")){ chainReset(); load(); } });   // the tip did not answer: another try
$("rgo").onclick=()=>{ const v=$("rq").value.trim(); if(v) location.href="topic.html#"+encodeURIComponent(canonical(parseScope(v.toLowerCase()))); };
$("rq").onkeydown=e=>{ if(e.key==="Enter") $("rgo").click(); };
$("rcopytx").onclick=()=>copyText(R.txid,$("rcopytx"));
$("rshare").onclick=()=>{ copyText(location.href,$("rshare")); toast("Link copied"); };

// ---------- share image: the receipt on a card (shared.js drawCard); "I said" only on this browser's own burn ----------
const receiptCard=()=>drawCard("RECEIPT", x=>{
  const v=R, root=v.scope==="", tn=root?nameOf(v.t)||"":v.scope, mine=WALLET&&v.from===WALLET.addr, head=$("rstmt").textContent, text=root?head:!stmtOf(v)?"no take":mine?`I said ${/^[A-Z]+$/.test(head)?head:"“"+head+"”"}`:(/^[A-Z]+$/.test(head)?head:"“"+head+"”");
  let size=64, lines; for(const s of [64,54,44,36,30]){ size=s; x.font=`600 ${s}px ${CF.D}`; lines=wrapLines(x,text,1000); if(lines.length<=(s>=54?2:3)) break; }
  x.fillStyle=stmtOf(v)||root?"#f3efe9":"#8a8177"; let y=180+size; for(const l of lines.slice(0,3)){ x.fillText(l,96,y); y+=size*1.15; }
  y+=12; x.font=`400 28px ${CF.B}`; x.fillStyle="#a89f95"; const pre=`burned `; x.fillText(pre,96,y); let dx=96+x.measureText(pre).width;
  x.font=`600 30px ${CF.D}`; x.fillStyle="#ffb547"; const n=fmt(v.sats)+" sats"; x.fillText(n,dx,y); dx+=x.measureText(n).width;
  x.font=`400 28px ${CF.B}`; x.fillStyle="#a89f95"; const inw=root?(REGD?" to register ":" to sponsor "):" in "; x.fillText(inw,dx,y); dx+=x.measureText(inw).width;
  x.fillStyle="#f3efe9"; x.font=`500 28px ${CF.B}`; x.fillText(tn?niceQ(tn):"the root topic",dx,y);
  y+=44; x.font=`400 20px ${CF.M}`; x.fillStyle="#8a8177";
  x.fillText((STAND||(v.h===null?"pending in the mempool":`block ${fmt(v.h)}`)).slice(0,90),96,y);
}, R.txid.slice(0,12)+"…"+R.txid.slice(-8));
$("rimg").onclick=async()=>{
  if(!R) return; const b=$("rimg"); b.disabled=true;
  try{
    const c=await receiptCard(), stem="burning-take-receipt-"+R.txid.slice(0,12)+".png";
    const blob=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error("no blob")),"image/png"));
    const url=URL.createObjectURL(blob);
    $("rpng").src=c.toDataURL("image/png"); $("rpnglink").href=url; $("rpreview").hidden=false;   // the preview is the fallback: long-press / right-click to save; the link opens the same PNG in a tab
    try{ const a=document.createElement("a"); a.href=url; a.download=stem; document.body.appendChild(a); a.click(); a.remove(); toast("Saving "+stem); }
    catch{ toast("Download blocked here · open the PNG in a new tab"); }
  }catch(e){ toast("Could not draw the image: "+e.message); }
  b.disabled=false;
};
