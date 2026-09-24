// ---------- receipt page: one burn, identified by its txid (receipt.html#<txid>) ----------
// Data: IndexedDB by txid (one row per topic of the transaction; a ballot has several), else every shipped snapshot (loader.js loadAll).
// A burn signed in this browser is on disk as pending (h:null) the moment it is broadcast, so the receipt link works before any explorer has it.
const status=$("status");
let R=null, ALL=[], seq=0;                                  // R: the burn shown (lowest vout), ALL: every burn of the transaction
const stmtOf=v=>v.t||"";
function paint(){
  const v=R, p=parseScope(v.scope), abstain=!stmtOf(v);
  $("rnet").textContent=NET; $("ricon").innerHTML=ICON_TAKE;
  $("rstmt").textContent= abstain ? "abstain · a burn with no take" : stmtOf(v); $("rstmt").classList.toggle("abstain",abstain);
  $("rsats").textContent=fmt(v.sats);
  $("rtopic").textContent="#"+p.q; $("rtopic").href="topic.html#"+encodeURIComponent(v.scope); $("rtopic").title=v.scope;
  if(v.h===null){ $("rblock").innerHTML=`<span class="pend"><i></i>pending</span>`; $("rconf").textContent="in the mempool · not final"; }
  else { $("rblock").textContent=fmt(v.h); const c=TIP-v.h+1; $("rconf").textContent=`${fmt(c)} confirmation${c===1?"":"s"}`; }
  $("rfrom").textContent=v.from||"unknown"; $("rfrom").href=v.from?"burner.html#"+v.from:"#"; $("rfrom").title=v.from||"";
  $("rtxid").textContent=v.txid; $("rexp").href=TXURL(v.txid);
  const others=ALL.filter(x=>x!==v);
  $("ralso").hidden=!others.length;
  $("ralso").innerHTML= others.length ? `Same transaction, ${others.length} more burn${others.length===1?"":"s"}: `+others.map(x=>`<a href="topic.html#${encodeURIComponent(x.scope)}">#${esc(parseScope(x.scope).q)}</a> · ${x.t?esc(x.t):"<i>abstain</i>"} · ${fmt(x.sats)} sats`).join(" · ") : "";
  document.title=(abstain?"abstain":stmtOf(v))+" · receipt · Burning Take";
  $("rcard").hidden=false; $("runknown").hidden=true; $("rpreview").hidden=true;
}
function unknown(txid, why){
  $("rcard").hidden=true; $("runknown").hidden=false;
  $("runkt").textContent= why ? "That is not a transaction id" : "Unknown here yet";
  $("runkp").textContent= why ? "A receipt link ends with the 64 hex characters of a transaction id: receipt.html#<txid>." : "This app has not seen that transaction. Open its topic so it gets scanned, then come back to this link.";
  $("rfind").hidden=!!why; $("runkexpp").hidden=!!why; if(!why) $("runkexp").href=TXURL(txid);
  document.title="Receipt · Burning Take";
}
async function load(){
  const txid=hashText().trim().toLowerCase(), my=++seq;
  R=null; ALL=[];
  if(!/^[0-9a-f]{64}$/.test(txid)){ status.innerHTML=""; unknown(txid,true); return; }
  status.innerHTML=`<span class="spin"></span> looking up ${txid.slice(0,10)}…`;
  let rows=(await DB.byTx(txid))||[]; if(my!==seq) return;
  if(!rows.length){
    const all=await loadAll({onPhase:p=>{ if(my===seq&&p.phase==="snapshots") status.innerHTML=`<span class="spin"></span> searching snapshots · ${p.k}/${p.n}`; }}); if(my!==seq) return;
    rows=all.filter(v=>v.txid===txid);
  }
  if(!rows.length){ status.innerHTML=`<span class="dot"></span> not in the cache or the snapshots`; unknown(txid); return; }
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
  x.fillStyle="#f3efe9"; x.font=`500 28px ${B}`; x.fillText("#"+parseScope(v.scope).q,dx,y);
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
