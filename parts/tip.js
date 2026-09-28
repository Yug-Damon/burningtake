// ---------- tip dialog: a plain payment to the project, the burn dialogs' logic: the note, the price (edit: the amount and the fee speed), Validate tip ▾ (Add to batch: the batch's one tip) ----------
// #tipcard and #tipdlg ship with the hidden attribute: without a tip address on this network (TIP_ADDRESSES in shared.js) nothing tip-related is ever shown or wired.
if(tipEnabled()){
  $("tipcard").hidden=false; $("tipdlg").hidden=false;
  const tpay=payPanel("tpay",{speed:false}); PAY.push(tpay);
  $("tfeehost").innerHTML=feeSegHtml("tfeeseg",true); feeSegWire($("tfeeseg"));
  let tStep=2, tEdit=false, tSnap=null;                     // 2: the note (the amount when editing), 4: the transaction; tSnap: what the amount view started from
  const tipAmount=()=>Number($("tipdamt").value||0);
  const tBatch=typeof ballotTipAdd==="function" ? ()=>{ ballotTipAdd(tipAmount()); $("tipdlg").close(); } : null;   // the batch's one tip output (ballotui.js); a page without the batch: no item
  const tipRender=()=>{
    const sats=tipAmount();
    $("tipdusd").textContent=usdOf(sats);
    $("tipdaddr").textContent=TIP_EFFECTIVE; $("copytipd").dataset.copy=TIP_EFFECTIVE;
    tpay.set({burnAddr:TIP_EFFECTIVE, burnSats:sats, statementBytes:null, tipAddr:null, tipSats:0, burnLabel:"tip"});
  };
  const tAmt=amountChips($("tipseg"), $("tipdamt"), tipRender, {wallet:tpay.wallet, noun:"tip", check:v=>tipDust(v)&&"A tip under 330 sats cannot relay: 330 and up."}); tAmt.reset(5000);   // presets over #tipdamt, same chips as the burn dialogs
  const tGo=n=>{ tStep=n; $("tstep-2").hidden=!(n===2&&tEdit); $("tstep-4").hidden=n!==4; tPaint(); segThumbs(); };
  function tPaint(){
    const s=tpay.wallet.status(), editing=tStep===2&&tEdit, ok=tipAmount()>=330;
    $("tprice").hidden=s?.kind==="sent";
    fundsPaint($("tfunds"), tpay.wallet, tStep===2&&!tEdit);   // the first view: short of funds, said before Validate tip
    dlgPrice($("tprice"), tipAmount(), "tip"+(!editing&&!(s&&(s.kind==="sent"||s.kind==="busy"))?` <button type="button" class="linkbtn" data-edittip>edit</button>`:""), tpay.wallet.fee());
    feeSegPaint($("tfeeseg"), !!(s&&s.kind!=="err"), $("tfeesum"));
    $("tcancel").hidden=$("tapply").hidden=!editing; $("tapply").disabled=!ok; $("tsendwrap").hidden=editing;
    const was=typeof ballotTipOwn!=="function" ? 0 : ballotGet().length ? ballotTip() : ballotTipOwn(), amt=Math.round(tipAmount());       // the batch's one tip: another amount there is replaced, not added to
    signMenu($("tsend"), $("tsendmenu"), tpay.wallet, {label:"Validate tip", noun:"tip", ok, show:()=>{ if(tStep!==4) tGo(4); }, batch:tBatch, batchNote:was&&was!==amt?`replaces its ${fmt(was)} tip`:"", tx: tStep!==4 ? ()=>tGo(4) : null, done:()=>$("tipdlg").close()});
  }
  tpay.onpaint=tPaint;
  $("tprice").onclick=e=>{ if(!e.target.closest("[data-edittip]")) return; tSnap={amt:$("tipdamt").value, fee:feeSpeed()}; tEdit=true; tGo(2); };
  $("tapply").onclick=()=>{ if(tipAmount()<330) return; tEdit=false; tGo(2); };
  $("tcancel").onclick=()=>{ const s=tSnap; tSnap=null; if(s){ tAmt.reset(s.amt); LS(NETKEY("bv.fee"),s.fee); } tEdit=false; tipRender(); PAY.forEach(p=>p.paint()); tGo(2); };
  $("tipdamt").oninput=tipRender;
  $("copytipd").onclick=()=>copyText(TIP_EFFECTIVE,$("copytipd"));
  $("tipbtn").onclick=()=>{ tEdit=false; tSnap=null; $("tfeeadv").open=false; tipRender(); $("tipdlg").showModal(); tGo(2); };
  $("tipdlg").addEventListener("close",()=>{ if(FUNDING==="tpay"){ FUNDING=null; WFUND=0; } });   // closed while the wallet was asked for: no amount waits for it any more (QR, fund note, Funds arrived)
  segThumbs();
}
