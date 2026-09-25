
// ---------- toast: one line at the bottom, gone after a moment ----------
function toast(msg){
  let t=document.querySelector(".toast"); if(!t){ t=document.createElement("div"); t.className="toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
  t.textContent=msg; t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("on"),2600);
}
function download(name,text,type){                        // a file from text; a host that blocks downloads gets a toast pointing at the copy button
  try{ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); toast("Saving "+name); }
  catch{ toast("Download blocked here · use Copy JSON"); }
}

// ---------- batch: several burns kept aside (shared.js ballotGet/ballotAdd…), cast as ONE transaction from buildBallotPayload ----------
// The nav pill (#ballotbtn) counts the entries; the dialog lists them, compares one fee with N, and signs through the same wallet block as a single burn.
const bwt=walletTab("bpay",$("bpay-wallet"),{speed:false});   // the fee speed sits in the fees view (the price's edit)
$("bfeehost").innerHTML=feeSegHtml("bfeeseg"); feeSegWire($("bfeeseg"));
let bLast=null, bSent=null, bStep=1, bSnap=null;            // bStep: 1 · Burns (the list), 2 · Fees (edit), 3 · Transaction; bSnap: what the fees view started from                                  // bSent: the entries that went out with the last broadcast, shown until the dialog is reopened
const bTipSats=()=>tipEnabled() ? Math.max(0,Math.round(Number($("b-tip").value||0))) : 0;   // "No tip" is 0
function ballotPill(){ const n=ballotGet().length, b=$("ballotbtn"); if(!b) return; b.hidden=!n; $("ballottxt").textContent=NARROW.matches?String(n):"Batch · "+n; b.title=`Batch · ${n} burn${n===1?"":"s"} kept aside`; b.setAttribute("aria-label",`Batch, ${n} burn${n===1?"":"s"} kept aside`); }   // phone: the count alone next to the ember dot, the nav has no room for the word
addEventListener("resize",ballotPill);
function bSync(){                                            // rebuild the payload from storage and hand it to the wallet block (clears a "sent" state)
  const e=ballotGet();
  try{ bLast=e.length ? buildBallotPayload(e,{tipAddr:TIP_EFFECTIVE, tipSats:bTipSats()}) : null; }catch{ bLast=null; }
  bwt.update(bLast); bPaint();
}
function bPaint(){
  const s=bwt.status(), sent=!!(s&&s.kind==="sent"), e=sent?(bSent||[]):ballotGet(), n=e.length;
  if(!n && bStep!==1){ bStep=1; for(const k of [1,2,3]) $("bstep-"+k).hidden=k!==1; }   // emptied (last burn removed, another tab): back to the list
  $("b-empty").hidden=!!n; $("b-body").hidden=!n;
  $("bstepn").textContent = n ? " · "+n : "";
  $("b-clear").hidden = bStep!==1 || !n || sent;
  const editing=bStep===2, busy=!!(s&&s.kind==="busy");
  $("bback").hidden = bStep!==3 || sent; $("bsend").hidden = !n || editing; $("bcancel").hidden = $("bapply").hidden = !editing;   // the primary signs from the list on; the fees view applies or cancels
  ballotPill();
  $("bprice").hidden=!n||sent;
  if(!n) return;
  $("b-list").innerHTML=e.map((x,i)=>`<div class="bent${sent?" sent":""}">
      ${x.name?iconBadge("",ICON_TAKE):x.intent==="feature"?iconBadge("feature",ICONS.feature):iconBadge("reg",ICONS.reg)}
      <span class="topic">${x.name?topicName(x.name):x.intent==="feature"?"sponsor":"register"}</span>
      <span class="stmt">${x.statement?esc(x.statement):"<i>abstain</i>"}</span>
      <b class="mono">${fmt(x.sats)}<small> sats</small></b>
      ${sent?`<span class="mono" style="font-size:11px;color:var(--ok)">sent</span>`:`<button type="button" class="copy" data-brm="${i}" aria-label="Remove this burn">remove</button>`}
    </div>`).join("");
  const tip=bTipSats();
  dlgPrice($("bprice"), ballotSats(e), `${n} burn${n===1?"":"s"}`+(!editing&&!sent&&!busy?` <button type="button" class="linkbtn" data-editfee>edit</button>`:""), bwt.fee(), tip?[`+${fmt(tip)} sats tip`]:[]);
  feeSegPaint($("bfeeseg"), !!(s&&s.kind!=="err"), $("bfeesum"));
  $("b-tipf").hidden=!tipEnabled(); $("b-tipusd").textContent=tip?usdOf(tip):"";
  $("b-shared").hidden=!bLast||bLast.shared;
  $("bpay-tipnote").hidden=!(bLast&&bLast.tipOmitted);
  $("b-outs").innerHTML=bLast ? bLast.outputs.map((o,i)=>`<div class="kv"><span class="k">${i+1} · ${esc(o.label)}</span><code>${esc(o.addr==="OP_RETURN"?o.scriptHex:o.addr)}</code><span class="mono" style="font-size:11px;color:var(--ink3);white-space:nowrap">${fmt(o.sats)} sats</span></div>`).join("") : "";
  $("bpay-text").textContent=bLast?bLast.rawHex:"…"; $("bpay-copy").disabled=!bLast;
  bwt.paint();
  walletPrimary($("bsend"), bwt, ()=>$("ballotdlg").close(), !!bLast);   // Connect a wallet / Unlock wallet / Sign & broadcast / Done, from any step
  if(/^Sign/.test($("bsend").textContent)) $("bsend").onclick=()=>{ if(bStep!==3) bGo(3); bwt.send(); };   // signing shows the Transaction step, where progress and errors show
}
PAY.push({paint:bPaint, wallet:bwt});                        // repainted with every wallet change, like the burn dialogs
bwt.onsent=({txid})=>{                                       // one transaction, N rows: each topic gets its own pending burn (h:null) so the receipt page and the boards find them
  const e=ballotGet(), from=WALLET?WALLET.addr:"", short=txid.slice(0,6)+"…"+txid.slice(-4);
  e.forEach((x,i)=>{ const v={txid, t:x.statement||"", sats:x.sats, h:null, from, tx:short, vout:i}; DB.putPending(x.name,[v]); globalThis.addPending?.(x.name,[v]); });
  bSent=e; ballotClear(); ballotPill();
  toast(`Batch burned · ${e.length} burn${e.length===1?"":"s"} in one transaction`);
};
$("b-list").onclick=e=>{ const b=e.target.closest("[data-brm]"); if(!b) return; const n=ballotRemove(+b.dataset.brm); bSync(); toast(n?`Removed · ${n} left`:"Batch is empty"); };
$("b-clear").onclick=()=>{ ballotClear(); bSync(); toast("Batch cleared"); };
$("b-tipf").hidden=!tipEnabled();                            // no tip address on this network: the ballot's tip line is never shown
const bTipSave=()=>{ if(tipEnabled()) LS(NETKEY("bv.vote.tipsats"),$("b-tip").value); };   // shared with the burn dialogs
const bTip=amountChips($("b-tipseg"), $("b-tip"), ()=>{ bTipSave(); bSync(); }); bTip.reset(+LS(NETKEY("bv.vote.tipsats"))||0);
$("b-tip").oninput=()=>{ bTipSave(); bSync(); };
$("bpay-copy").onclick=()=>{ if(bLast) copyText(bLast.rawHex,$("bpay-copy")); };
function bGo(n){                                             // show a step; focus its first action
  bStep=n; for(const k of [1,2,3]) $("bstep-"+k).hidden=n!==k; bPaint(); segThumbs();
  $("ballotdlg").querySelector(".dlg").scrollTop=0;
  if($("ballotdlg").open) (n===2?$("bfeeseg").querySelector('[aria-pressed="true"]'):$("bsend")).focus({preventScroll:true});
}
$("bback").onclick=()=>bGo(1);
$("bprice").onclick=e=>{ if(!e.target.closest("[data-editfee]")) return; bSnap={tip:$("b-tip").value, fee:feeSpeed()}; bGo(2); };
$("bapply").onclick=()=>{ bSnap=null; bGo(1); };
$("bcancel").onclick=()=>{ const s=bSnap; bSnap=null; if(s){ bTip.reset(s.tip); bTipSave(); LS(NETKEY("bv.fee"),s.fee); } bSync(); PAY.forEach(p=>p.paint()); bGo(1); };
function ballotOpen(){ bSent=null; bStep=1; bSnap=null; bSync(); $("ballotdlg").showModal(); bGo(1); }
{ const b=$("ballotbtn"); if(b) b.onclick=ballotOpen; }
addEventListener("storage",e=>{ if(e.key===NETKEY("bv.ballot")) { ballotPill(); if($("ballotdlg").open) bSync(); } });   // another tab added a burn
ballotPill();
