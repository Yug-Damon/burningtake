// ---------- receipt page: one burn, identified by its txid (receipt.html#<txid>) ----------
// Data: IndexedDB by txid (one row per topic of the transaction; a ballot has several), else the transaction itself from the explorer, its outputs matched against the directory.
// A burn signed in this browser is on disk as pending (h:null) the moment it is broadcast, so the receipt link works before any explorer has it.
const status=$("status");
let R=null, ALL=[], seq=0;                                  // R: the burn shown (lowest vout), ALL: every burn of the transaction
const stmtOf=v=>v.t||"";
function paint(){
  const v=R, abstain=!stmtOf(v), root=v.scope==="", tn=root?nameOf(v.t)||"":v.scope, p=parseScope(tn);   // a root burn sponsors (the first time: registers) the topic its statement names
  $("rnet").textContent=NET; $("ricon").innerHTML=ICON_TAKE;
  $("rstmt").textContent= abstain ? "abstain · a burn with no take" : stmtOf(v); $("rstmt").classList.toggle("abstain",abstain);
  $("rsats").textContent=fmt(v.sats);
  $("rin").textContent= root&&tn ? "to sponsor" : "in";
  $("rtopic").textContent= root&&!tn ? "the root topic" : "#"+p.q; $("rtopic").href= root&&!tn ? "explore.html" : "topic.html#"+encodeURIComponent(tn); $("rtopic").title=tn;   // a root burn naming no topic: an ordinary burn to that address
  if(v.h===null){ $("rblock").innerHTML=`<span class="pend"><i></i>pending</span>`; $("rconf").textContent="in the mempool · not final"; }
  else { $("rblock").textContent=fmt(v.h); const c=TIP-v.h+1; $("rconf").textContent=`${fmt(c)} confirmation${c===1?"":"s"}`; }
  $("rfrom").textContent=v.from||"unknown"; $("rfrom").href=v.from?"burner.html#"+v.from:"#"; $("rfrom").title=v.from||"";
  $("rtxid").textContent=v.txid; $("rexp").href=TXURL(v.txid);
  const others=ALL.filter(x=>x!==v);
  $("ralso").hidden=!others.length;
  $("ralso").innerHTML= others.length ? `Same transaction, ${others.length} more burn${others.length===1?"":"s"}: `+others.map(x=>`${x.scope?"":"sponsoring "}<a href="topic.html#${encodeURIComponent(x.scope||nameOf(x.t)||"")}">#${esc(parseScope(x.scope||nameOf(x.t)||"").q)}</a> · ${x.t?esc(x.t):"<i>abstain</i>"} · ${fmt(x.sats)} sats`).join(" · ") : "";
  document.title=(abstain?"abstain":stmtOf(v))+" · receipt · Burning Take";
  $("rcard").hidden=false; $("runknown").hidden=true; $("rpreview").hidden=true;
}
function unknown(txid, why){                               // why: "bad" (not a txid) | "missing" (no such transaction) | "other" (it burns in no topic this page can name) | "offline"
  const T={bad:["That is not a transaction id","A receipt link ends with the 64 hex characters of a transaction id: receipt.html#<txid>."],
    missing:["No such transaction","The explorer knows no transaction with this id, confirmed or in the mempool."],
    other:["Not a burn in a registered topic","This transaction pays no topic this page can name. If it burns in a topic nobody registered, open that topic by its name and the burn shows there."],
    offline:["The explorer did not answer","Try again in a moment, or pick another explorer at the bottom of the page."]}[why];
  $("rcard").hidden=true; $("runknown").hidden=false;
  $("runkt").textContent=T[0]; $("runkp").textContent=T[1];
  $("rfind").hidden=why!=="other"; $("runkexpp").hidden=why==="bad"; if(why!=="bad") $("runkexp").href=TXURL(txid);
  document.title="Receipt · Burning Take";
}
async function load(){
  const txid=hashText().trim().toLowerCase(), my=++seq;
  R=null; ALL=[];
  if(!/^[0-9a-f]{64}$/.test(txid)){ status.innerHTML=""; unknown(txid,"bad"); return; }
  status.innerHTML=`<span class="spin"></span> looking up ${txid.slice(0,10)}…`;
  let rows=(await DB.byTx(txid))||[]; if(my!==seq) return;
  if(!rows.length){                                        // not in this browser: the transaction from the explorer, its outputs matched against every topic this page can name
    let tx;
    try{ tx=await chainGet(`/tx/${txid}`); }catch(e){ if(my!==seq) return; status.innerHTML=""; unknown(txid, e&&(e.status===404||e.status===400)?"missing":"offline"); return; }
    await dirLoad(); if(my!==seq) return;
    const topics=new Map([[await topicAddr(""),""]]);
    for(const n of new Set([...DIRECTORY.map(d=>d.name), ...((await DB.scopes())||[]).map(s=>s.name).filter(Boolean)])) topics.set(await topicAddr(n), n);
    rows=txBurns(tx,topics).map(v=>cleanVote({...v, scope:v.name})).filter(Boolean);
  }
  if(my!==seq) return;
  if(!rows.length){ status.innerHTML=""; unknown(txid,"other"); return; }
  rows.sort((a,b)=>(a.vout??0)-(b.vout??0)); ALL=rows; R=rows[0]; paint();
  status.innerHTML=`<span class="dot"></span> found · block ${fmt(TIP)}`;
}
addEventListener("hashchange",load); load();
$("rgo").onclick=()=>{ const v=$("rq").value.trim(); if(v) location.href="topic.html#"+encodeURIComponent(canonical(parseScope(v.toLowerCase()))); };
$("rq").onkeydown=e=>{ if(e.key==="Enter") $("rgo").click(); };
$("rcopytx").onclick=()=>copyText(R.txid,$("rcopytx"));
$("rshare").onclick=()=>{ copyText(location.href,$("rshare")); toast("Link copied"); };

// ---------- share image: the card drawn on a 1200×630 canvas (the size link previews use), ember theme ----------
function wrapLines(x,text,max){ const out=[]; let line=""; for(const w of text.split(/\s+/)){ const t=line?line+" "+w:w; if(x.measureText(t).width>max&&line){ out.push(line); line=w; } else line=t; } if(line) out.push(line); return out; }
function rr(x,X,Y,W,H,r){ x.beginPath(); x.moveTo(X+r,Y); x.arcTo(X+W,Y,X+W,Y+H,r); x.arcTo(X+W,Y+H,X,Y+H,r); x.arcTo(X,Y+H,X,Y,r); x.arcTo(X,Y,X+W,Y,r); x.closePath(); }
async function drawCard(){
  const c=document.createElement("canvas"); c.width=1200; c.height=630; const x=c.getContext("2d");
  try{ await Promise.all(['600 56px "Unbounded"','400 26px "Instrument Sans"','400 20px "JetBrains Mono"'].map(f=>document.fonts.load(f))); }catch{}
  const D='"Unbounded",system-ui,sans-serif', B='"Instrument Sans",system-ui,sans-serif', M='"JetBrains Mono",ui-monospace,Menlo,monospace';
  x.fillStyle="#0b0a0e"; x.fillRect(0,0,1200,630);
  let g=x.createRadialGradient(1040,60,0,1040,60,720); g.addColorStop(0,"rgba(255,106,26,.30)"); g.addColorStop(1,"rgba(255,106,26,0)"); x.fillStyle=g; x.fillRect(0,0,1200,630);
  g=x.createRadialGradient(120,640,0,120,640,520); g.addColorStop(0,"rgba(255,181,71,.14)"); g.addColorStop(1,"rgba(255,181,71,0)"); x.fillStyle=g; x.fillRect(0,0,1200,630);
  rr(x,40,40,1120,550,30); x.strokeStyle="rgba(255,255,255,.14)"; x.lineWidth=2; x.stroke();
  g=x.createRadialGradient(92,98,2,96,102,20); g.addColorStop(0,"#ffb547"); g.addColorStop(.6,"#ff6a1a"); g.addColorStop(1,"#7a2200"); x.fillStyle=g; x.shadowColor="rgba(255,106,26,.7)"; x.shadowBlur=26; x.beginPath(); x.arc(96,102,18,0,6.29); x.fill(); x.shadowBlur=0;
  x.fillStyle="#f3efe9"; x.font=`600 24px ${D}`; x.textBaseline="middle"; x.fillText("Burning Take",128,102);
  x.fillStyle="#ffb547"; x.font=`500 18px ${M}`; x.textAlign="right"; try{ x.letterSpacing="3px"; }catch{} x.fillText(`RECEIPT · ${NET.toUpperCase()}`,1104,102); try{ x.letterSpacing="0px"; }catch{} x.textAlign="left";
  const v=R, text= stmtOf(v) ? "“"+stmtOf(v)+"”" : "abstain";
  let size=64, lines; for(const s of [64,54,44,36,30]){ size=s; x.font=`600 ${s}px ${D}`; lines=wrapLines(x,text,1000); if(lines.length<=(s>=54?3:4)) break; }
  x.fillStyle=stmtOf(v)?"#f3efe9":"#8a8177"; x.textBaseline="alphabetic";
  let y=196+size; for(const l of lines.slice(0,4)){ x.fillText(l,96,y); y+=size*1.18; }
  y+=18; x.font=`400 28px ${B}`; x.fillStyle="#a89f95"; const pre="burned "; x.fillText(pre,96,y); let dx=96+x.measureText(pre).width;
  x.font=`600 30px ${D}`; x.fillStyle="#ffb547"; const n=fmt(v.sats)+" sats"; x.fillText(n,dx,y); dx+=x.measureText(n).width;
  x.font=`400 28px ${B}`; x.fillStyle="#a89f95"; x.fillText(" in ",dx,y); dx+=x.measureText(" in ").width;
  x.fillStyle="#f3efe9"; x.font=`500 28px ${B}`; x.fillText("#"+parseScope(v.scope||nameOf(v.t)||"").q,dx,y);
  y+=46; x.font=`400 20px ${M}`; x.fillStyle="#8a8177";
  x.fillText(v.h===null ? "pending in the mempool" : `block ${fmt(v.h)} · ${fmt(TIP-v.h+1)} confirmation${TIP-v.h===0?"":"s"} · burned for good`,96,y);
  x.beginPath(); x.moveTo(96,536); x.lineTo(1104,536); x.strokeStyle="rgba(255,255,255,.12)"; x.setLineDash([3,6]); x.stroke(); x.setLineDash([]);
  x.font=`400 18px ${M}`; x.fillStyle="#8a8177"; x.fillText(location.href.replace(/^https?:\/\//,"").slice(0,70),96,566);
  x.textAlign="right"; x.fillText(v.txid.slice(0,12)+"…"+v.txid.slice(-8),1104,566); x.textAlign="left";
  return c;
}
$("rimg").onclick=async()=>{
  if(!R) return; const b=$("rimg"); b.disabled=true;
  try{
    const c=await drawCard(), stem="burning-take-receipt-"+R.txid.slice(0,12)+".png";
    const blob=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error("no blob")),"image/png"));
    const url=URL.createObjectURL(blob);
    $("rpng").src=c.toDataURL("image/png"); $("rpnglink").href=url; $("rpreview").hidden=false;   // the preview is the fallback: long-press / right-click to save; the link opens the same PNG in a tab
    try{ const a=document.createElement("a"); a.href=url; a.download=stem; document.body.appendChild(a); a.click(); a.remove(); toast("Saving "+stem); }
    catch{ toast("Download blocked here · open the PNG in a new tab"); }
  }catch(e){ toast("Could not draw the image: "+e.message); }
  b.disabled=false;
};
