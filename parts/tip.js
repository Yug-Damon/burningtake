// ---------- tip dialog: a plain payment to the project, same transaction panel ----------
// #tipcard and #tipdlg ship with the hidden attribute: without a tip address on this network (TIP_ADDRESSES in shared.js) nothing tip-related is ever shown or wired.
if(tipEnabled()){
  $("tipcard").hidden=false; $("tipdlg").hidden=false;
  const tpay=payPanel("tpay"); PAY.push(tpay);
  const tipAmount=()=>Number($("tipdamt").value||0);
  const tipRender=()=>{
    const sats=tipAmount();
    $("tipdusd").textContent=usdOf(sats);
    $("tipdaddr").textContent=TIP_EFFECTIVE; $("copytipd").dataset.copy=TIP_EFFECTIVE;
    $("tipdemo").hidden=true;
    tpay.set({burnAddr:TIP_EFFECTIVE, burnSats:sats, statementBytes:null, tipAddr:null, tipSats:0, burnLabel:"tip"});
  };
  const tAmt=amountChips($("tipseg"), $("tipdamt"), tipRender); tAmt.reset(5000);   // presets over #tipdamt, same chips as the burn dialogs
  tpay.onpaint=()=>walletPrimary($("tsend"), tpay.wallet, ()=>$("tipdlg").close());   // Connect a wallet / Unlock wallet / Sign & broadcast / Done
  $("tipdamt").oninput=tipRender;
  $("copytipd").onclick=()=>copyText(TIP_EFFECTIVE,$("copytipd"));
  $("tipbtn").onclick=()=>{ tipRender(); $("tipdlg").showModal(); };
  segThumbs();
}
