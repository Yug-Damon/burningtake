
// ---------- toast: one line at the bottom, gone after a moment ----------
function toast(msg){
  let t=document.querySelector(".toast"); if(!t){ t=document.createElement("div"); t.className="toast"; t.setAttribute("role","status"); }
  const host=[...document.querySelectorAll("dialog[open]")].pop()||document.body; if(t.parentNode!==host) host.appendChild(t);   // inside the top open dialog: a modal's backdrop would hide it and make it inert
  t.textContent=msg; t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("on"),2600);
}
function download(name,text,type){                        // a file from text; a host that blocks downloads gets a toast pointing at the copy button
  try{ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); toast("Saving "+name); }
  catch{ toast("Download blocked here · use Copy JSON"); }
}

// ---------- batch: several burns kept aside (shared.js ballotGet/ballotAdd…), cast as ONE transaction from buildBallotPayload ----------
// The nav pill (#ballotbtn) counts the entries; the dialog lists them, compares one fee with N, and signs through the same wallet block as a single burn.
const bwt=walletTab("bpay",$("bpay-wallet"),{speed:false});   // the fee speed sits in the fees view (the price's edit)
bwt.noun="batch";                                            // what the wallet dialog says waits on it (signMenu sets it for the other dialogs)
$("bfeehost").innerHTML=feeSegHtml("bfeeseg",true); feeSegWire($("bfeeseg"));
let bLast=null, bSent=null, bSentTip=0, bStep=1, bSnap=null;   // bStep: 1 · Burns (the list), 2 · Fees (edit), 3 · Transaction; bSnap: what the fees view started from                                  // bSent: the entries that went out with the last broadcast (bSentTip: its tip), shown until the dialog is reopened
const bTipSats=()=>tipEnabled() ? Math.max(0,Math.round(Number($("b-tip").value||0))) : 0;   // "No tip" is 0
function ballotPill(){ const n=ballotGet().length, t=!n&&ballotTipOwn()>0, b=$("ballotbtn"); if(!b) return; b.hidden=!n&&!t; const what=t?"a tip kept aside":`${n} burn${n===1?"":"s"} kept aside`;   // t: a tip and no burn yet
  $("ballottxt").textContent=NARROW.matches?(t?"tip":String(n)):"Batch · "+(t?"tip":n); b.title="Batch · "+what; b.setAttribute("aria-label","Batch, "+what); }   // phone: the count alone next to the ember dot, the nav has no room for the word
addEventListener("resize",ballotPill);
document.addEventListener("batchchange",()=>ballotPill());   // any change to the batch (shared.js ballotSave): the nav pill follows
function bSync(){                                            // rebuild the payload from storage and hand it to the wallet block (clears a "sent" state)
  const e=ballotGet();
  const own=ballotTipOwn();
  try{ bLast=e.length ? buildBallotPayload(e,{tipAddr:TIP_EFFECTIVE, tipSats:bTipSats()}) : own&&TIP_EFFECTIVE ? buildPayload({burnAddr:TIP_EFFECTIVE, burnSats:own, burnLabel:"tip"}) : null; }catch{ bLast=null; }   // no burn yet: the tip alone
  bwt.update(bLast); bPaint();
}
function bPaint(){
  const s=bwt.status(), sent=!!(s&&s.kind==="sent"), e=sent?(bSent||[]):ballotGet(), n=e.length, t=!n&&(sent?bSentTip>0:ballotTipOwn()>0), any=n||t;   // t: a tip and no burn
  if(!any && bStep!==1){ bStep=1; for(const k of [1,2,3]) $("bstep-"+k).hidden=k!==1; }   // emptied (last burn removed, another tab): back to the list
  $("b-empty").hidden=!!any; $("b-body").hidden=!any;
  $("bstepn").textContent = n ? " · "+n : t ? " · tip" : "";
  $("b-clear").hidden = bStep!==1 || !any || sent;
  const editing=bStep===2, busy=!!(s&&s.kind==="busy");
  $("bback").hidden = bStep!==3 || sent; $("bsend").hidden = !any || editing; $("bcancel").hidden = $("bapply").hidden = !editing;   // the primary signs from the list on; the fees view applies or cancels
  const dust=!!tipDust(bTipSats()); $("bapply").disabled=dust;   // a tip of 1–329 sats cannot relay: not applied, not signed (the note under the tip says why)
  ballotPill();
  $("bprice").hidden=!any||sent;
  if(!any) return;
  const firstAt=new Map(); e.forEach(x=>{ if(!firstAt.has(x.addr)) firstAt.set(x.addr,x); });   // a second burn to one address in one transaction is summed under the first (spec §4)
  const tip=sent?bSentTip:bTipSats(), sentTag=`<span class="mono" style="font-size:11px;color:var(--ok)">sent</span>`;   // sent: the tip that went out with these burns
  $("b-list").innerHTML=e.map((x,i)=>`<div class="bent${sent?" sent":""}">
      ${x.name?iconBadge("",ICON_TAKE):x.intent==="feature"?iconBadge("feature",ICONS.feature):iconBadge("reg",ICONS.reg)}
      <span class="topic">${x.name?topicLabel(x.name):x.intent==="feature"?"sponsor":"register"}</span>
      <span class="stmt">${x.statement?esc(x.statement):"<i>no take</i>"}${sent?"":bTag(x, firstAt.get(x.addr))}</span>
      <b class="mono">${fmt(x.sats)}<small> sats</small></b>
      ${sent?sentTag:`<button type="button" class="copy" data-brm="${i}" aria-label="Remove this burn">remove</button>`}
    </div>`).join("")
    +(tip?`<div class="bent tipr${sent?" sent":""}">${iconBadge("tip",ICONS.tip)}<span class="stmt">Tip the project</span><b class="mono">${fmt(tip)}<small> sats</small></b>${sent?sentTag:`<button type="button" class="copy" data-btip aria-label="Remove the tip">remove</button>`}</div>`:"");   // the batch's one tip output: its own row, after the burns
  const edit=!editing&&!sent&&!busy?` <button type="button" class="linkbtn" data-editfee>edit</button>`:"";
  if(n) dlgPrice($("bprice"), ballotSats(e), `${n} burn${n===1?"":"s"}`+edit, bwt.fee(), tip?[`+${fmt(tip)} sats tip`]:[]); else dlgPrice($("bprice"), tip, "tip"+edit, bwt.fee());   // no burn yet: the tip is the amount
  feeSegPaint($("bfeeseg"), !!(s&&s.kind!=="err"), $("bfeesum"), tipEnabled()?tip:null);
  $("b-tipf").hidden=!tipEnabled(); $("b-tipusd").textContent=tip?usdOf(tip):"";
  $("b-shared").hidden=!bLast||!n||bLast.shared;
  $("bpay-tipnote").hidden=!(bLast&&bLast.tipOmitted);
  $("b-outs").innerHTML=bLast ? bLast.outputs.map((o,i)=>`<div class="kv"><span class="k">${i+1} · ${esc(o.label)}</span><code>${esc(o.addr==="OP_RETURN"?o.scriptHex:o.addr)}</code><span class="mono" style="font-size:11px;color:var(--ink3);white-space:nowrap">${fmt(o.sats)} sats</span></div>`).join("") : "";
  $("bpay-text").textContent=bLast?bLast.rawHex:"…"; $("bpay-copy").disabled=!bLast;
  bwt.paint();
  fundsPaint($("bfunds"), bwt, bStep===1);                    // the list: short of funds, said before Sign & broadcast (the Transaction step says it in the wallet block)
  walletPrimary($("bsend"), bwt, ()=>$("ballotdlg").close(), !!bLast&&!dust);   // Connect a wallet / Unlock wallet / Sign & broadcast / Done, from any step
  if(/^Sign/.test($("bsend").textContent)) $("bsend").onclick=()=>{ if(bStep!==3) bGo(3); bwt.send(); };   // signing shows the Transaction step, where progress and errors show
}
// what a batch row would really do, said on the row: summed into an earlier burn to the same topic, too late for a deadline, or an answer off the topic's list
function bTag(x, first){
  const t=s=>` <small class="btag">${s}</small>`;
  if(first!==x) return t(x.name ? `counts as ${first.statement?"“"+esc(first.statement)+"”":"no take"}` : "left out: one root burn per transaction");
  const p=x.name?parseScope(x.name):null; if(!p) return "";
  if(p.deadline&&TIP&&tipEst()+1>=p.deadline) return t("closed · this burn would not count");
  if(p.deadline&&TIP&&blocksTo(p.deadline)<=3) return t(`closes in ≈ ${Math.max(1,Math.ceil(blocksTo(p.deadline)))} blocks · may confirm too late`);
  const v=norm(x.statement||""); if(v&&(p.opts?!p.opts.includes(v):p.range?!(numOf(v)>=p.range[0]&&numOf(v)<=p.range[1]):false)) return t("not in the result");
  return "";
}
// a burn for a topic the batch already holds: one transaction counts one burn per topic, so the dialog asks (replace it, or add these sats to it) instead of losing one
function batchConflict(note, i, e, done){
  const x=ballotGet()[i], q=s=>s?`“${esc(s)}”`:"no take", same=!!e.name&&norm(x.statement)===norm(e.statement);
  note.innerHTML = !e.name ? `<p>Your batch already ${x.intent==="feature"?"sponsors":"registers"} ${topicName(nameOf(x.statement)||x.statement)}. One transaction carries one burn to the root topic: send this one separately, or replace it.</p><div class="acts"><button type="button" class="btn sm" data-bx="replace">Replace it</button></div>`
    : same ? `<p>${topicName(e.name)} is already in your batch with ${q(x.statement)}.</p><div class="acts"><button type="button" class="btn sm primary" data-bx="add">Add ${fmt(e.sats)} sats to it</button></div>`
    : `<p>${topicName(e.name)} is already in your batch with ${q(x.statement)}. One transaction counts one ${kind(parseScope(e.name))==="open"?"take":"answer"} per topic.</p><div class="acts"><button type="button" class="btn sm" data-bx="replace">Replace with ${q(e.statement)}</button><button type="button" class="btn sm" data-bx="add">Add ${fmt(e.sats)} to ${q(x.statement)}</button></div>`;
  note.hidden=false; note.querySelector("[data-bx]").focus({preventScroll:true});
  note.onclick=ev=>{ const b=ev.target.closest("[data-bx]"); if(!b) return; ballotSet(i, b.dataset.bx==="replace" ? e : {sats:x.sats+e.sats}); note.hidden=true; done(); };
}
PAY.push({paint:bPaint, wallet:bwt});                        // repainted with every wallet change, like the burn dialogs
bwt.onsent=({txid, outputs, from:signer})=>{                // one transaction, N rows: each topic gets its own pending burn (h:null) so the receipt page and the boards find them
  const e=ballotGet(), from=signer||(WALLET?WALLET.addr:""), short=txid.slice(0,6)+"…"+txid.slice(-4);   // from: the signed transaction's first input (a Ledger can spend from another address of its account), what the chain will say
  e.forEach((x,i)=>{ const v={txid, t:x.statement||"", sats:x.sats, h:null, from, tx:short, vout:i}; DB.putPending(x.name,[v]); globalThis.addPending?.(x.name,[v]); });
  bSent=e; bSentTip=outputs.filter(o=>o.label==="tip").reduce((a,o)=>a+o.sats,0); ballotClear(); ballotPill();   // cleared: the batch's own tip goes too (ballotSave)
  toast(e.length ? `Batch burned · ${e.length} burn${e.length===1?"":"s"} in one transaction` : "Tip sent · thank you");
};
const bFocusNext=i=>{ const l=!$("b-body").hidden&&$("b-list"), c=$("b-clear"); (l&&(l.querySelector(`[data-brm="${i}"]`)||i<Infinity&&l.querySelector("[data-btip]"))||!c.hidden&&c||$("ballotdlg").querySelector("[data-close]")).focus(); };   // a row removed (i: its index, Infinity for the tip): the next row's remove, else Clear (the close button once empty: the old rows stay, hidden), never <body>
$("b-list").onclick=e=>{ if(e.target.closest("[data-btip]")){ ballotTipSet(0); bTip.reset(0); bSync(); toast("Tip removed"); bFocusNext(Infinity); return; }   // 0: this batch goes without, the other dialogs keep their tip
  const b=e.target.closest("[data-brm]"); if(!b) return; const i=+b.dataset.brm, n=ballotRemove(i); bSync(); toast(n?`Removed · ${n} left`:"Batch is empty"); bFocusNext(i); };
$("b-clear").onclick=()=>{ ballotClear(); bSync(); toast("Batch cleared"); };
$("b-tipf").hidden=!tipEnabled();                            // no tip address on this network: the ballot's tip line is never shown
const bTipSave=()=>{ tipPrefSave($("b-tip").value); ballotTipSet(null); };   // the chips: every amount dialog's tip (tipPref), and this batch follows it again
const bTip=amountChips($("b-tipseg"), $("b-tip"), ()=>{ bTipSave(); bSync(); }, {wallet:bwt, noun:"tip", check:tipDust}); bTip.reset(ballotTip());
$("b-tip").oninput=()=>{ bTipSave(); bSync(); };
$("bpay-copy").onclick=()=>{ if(bLast) copyText(bLast.rawHex,$("bpay-copy")); };
function bGo(n){                                             // show a step; focus its first action
  bStep=n; for(const k of [1,2,3]) $("bstep-"+k).hidden=n!==k; bPaint(); segThumbs();
  $("ballotdlg").querySelector(".dlg").scrollTop=0;
  if($("ballotdlg").open) (n===2?$("bfeeseg").querySelector('[aria-pressed="true"]'):$("bsend")).focus({preventScroll:true});
}
$("bback").onclick=()=>bGo(1);
$("bprice").onclick=e=>{ if(!e.target.closest("[data-editfee]")) return; bSnap={tip:LS(NETKEY("bv.ballot.tip")), pref:tipPref(), fee:feeSpeed()}; bGo(2); };   // tip: this batch's own (null: it follows pref)
$("bapply").onclick=()=>{ if(tipDust(bTipSats())) return; bSnap=null; bGo(1); };
$("bcancel").onclick=()=>{ const s=bSnap; bSnap=null; if(s){ tipPrefSave(s.pref); ballotTipSet(s.tip); bTip.reset(ballotTip()); LS(NETKEY("bv.fee"),s.fee); } bSync(); PAY.forEach(p=>p.paint()); bGo(1); };
function ballotOpen(){ bSent=null; bStep=1; bSnap=null; bTip.reset(ballotTip()); bSync(); $("ballotdlg").showModal(); bGo(1); }
{ const b=$("ballotbtn"); if(b) b.onclick=ballotOpen; }
$("ballotdlg").addEventListener("close",()=>{ if(FUNDING==="bpay"){ FUNDING=null; WFUND=0; } });   // closed while the wallet was asked for: no amount waits for it any more (QR, fund note, Funds arrived)
function ballotTipAdd(sats){ const was=ballotGet().length ? ballotTip() : ballotTipOwn(); ballotTipSet(sats); const now=ballotTip(); bTip.reset(now); bSync(); toast(was&&was!==now ? `Batch tip set to ${fmt(now)} sats (was ${fmt(was)})` : `Tip added to your batch · ${fmt(now)} sats`); }   // the tip dialog's Add to batch: this batch's one tip (a different one it held is replaced, and said), the saved tip of the other dialogs stays
addEventListener("storage",e=>{ if(e.key!==NETKEY("bv.ballot")&&e.key!==NETKEY("bv.ballot.tip")) return;   // another tab changed the batch or its tip
  if(!bSnap) bTip.reset(ballotTip()); ballotPill(); if($("ballotdlg").open) bSync(); PAY.forEach(p=>p.paint()); });   // not while the fees view is being edited; PAY: the tip dialog's Add to batch follows the count
ballotPill();
