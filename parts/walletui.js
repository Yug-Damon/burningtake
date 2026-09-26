
// ---------- burner wallet: state, dialog, nav pill ----------
// ponytail: one BIP84 key, stored in localStorage (encrypted when a passphrase is set). Coins here are meant to be burned.
// Or a Ledger (ledger.js): {kind:"ledger", net, addr, xpub, fp} — the first receive address of account 0, keys on the device, every burn signed there.
let WALLET=(()=>{ try{ return JSON.parse(LS(NETKEY("bv.wallet"))||"null"); }catch{ return null; } })();   // {net, enc, data, addr} | {kind:"ledger", net, addr, xpub, fp}, one per network (bv.wallet.mainnet / bv.wallet.signet)
let wKey=null, walletUtxos=null, WFUND=0, FUNDING=null;   // WFUND: sats a dialog needs, for the receive QR; FUNDING: the dialog waiting on the wallet (its pay panel's prefix)                          // walletUtxos: explorer result, or null while unknown (never fetched, or the explorer is unreachable)
const walletIsLedger=()=>!!(WALLET&&WALLET.kind==="ledger");
const walletState=()=> !WALLET ? "none" : walletIsLedger() ? "ready" : wKey ? "ready" : WALLET.enc ? "locked" : "sealed";   // sealed: stored in clear, derive on demand. A Ledger is always "ready": viewing needs nothing, signing asks the device
const walletSave=()=>{ try{ LS(NETKEY("bv.wallet"),JSON.stringify(WALLET)); }catch{} };
async function walletLoadKey(pass=""){                    // derive the key from the stored words (decrypting first if needed)
  if(walletIsLedger()) throw new Error("the keys are on the Ledger");
  const words = WALLET.enc ? await decryptSecret(WALLET.data, pass) : WALLET.data;
  wKey = await walletDerive(words, WALLET.enc?pass:"", NET);
  wKey.words=words; return wKey;
}
let WREADING=false;                                        // a balance read is running: "checking", not "unknown"
async function walletBalance(force=false){                // -> the explorer's coins, or null when it is unreachable from this page
  if(!WALLET) return null;
  if(walletUtxos && !force) return walletUtxos;
  WREADING=true; try{ walletUtxos = await fetchUtxos(WALLET.addr, NET); } finally{ WREADING=false; }
  return walletUtxos;
}
const walletSats=()=>(walletUtxos||[]).reduce((a,u)=>a+u.value,0);
function walletPill(){
  const st=walletState(), txt=$("wallettxt"), dot=$("walletdot");
  if(st==="none"){ txt.textContent=NARROW.matches?"Connect":"Connect wallet"; dot.style.background="var(--ink3)"; dot.style.boxShadow="none"; $("walletbtn").setAttribute("aria-label","Wallet"); return; }
  const a=WALLET.addr, narrow=NARROW.matches, ledger=walletIsLedger();
  txt.textContent=(st==="locked"&&!narrow?"🔒 ":ledger&&!narrow?"Ledger · ":"")+(narrow ? a.slice(0,4)+"…"+a.slice(-3) : a.slice(0,6)+"…"+a.slice(-4));   // balance lives in the wallet dialog, not the bar
  dot.style.background=st==="locked"?"var(--ember2)":"var(--ok)"; dot.style.boxShadow="0 0 8px currentColor";
  $("walletbtn").setAttribute("aria-label", `${ledger?"Ledger wallet":"Wallet"}, ${st==="locked"?"locked":"ready"}, ${a.slice(0,6)}…${a.slice(-4)}`);
}
async function walletPaint(){
  const st=walletState();
  $("w-none").hidden=st!=="none"; $("w-locked").hidden=st!=="locked"; $("w-ready").hidden=!(st==="ready"||st==="sealed");
  const ledger=walletIsLedger();
  $("w-title").textContent= st==="none"?"Connect a wallet" : st==="locked"?"Unlock wallet" : ledger?"Your Ledger" : "Your wallet";
  if(st==="ready"||st==="sealed"){
    const a=WALLET.addr; $("w-addr").textContent=a.slice(0,10)+"…"+a.slice(-6); $("w-addr").title=a; $("w-netlabel").textContent=NET;   // condensed; copy and the QR carry the full address
    $("w-explorer").href="https://mempool.space/"+(NET==="mainnet"?"":"signet/")+"address/"+a; $("w-burns").href="burner.html#"+a;
    $("w-path").textContent= ledger ? `${ledgerPathString(NET)} · [${WALLET.fp}]` : "m/84'/…/0/0";   // the Ledger's first receive address; [fp] = the master fingerprint the PSBTs carry
    $("w-fundnote").textContent= ledger ? "Burns spend from this address only (the account's first receive address). Send sats here from Ledger Live or anywhere." : "Fund it by sending sats to this address.";
    $("w-keysnote").hidden=!ledger; $("w-backup").hidden=ledger; $("w-qr").alt=(ledger?"Ledger":"Wallet")+" address as QR";
    try{ const q=qrcode(0,"M"); q.addData("bitcoin:"+a+(WFUND?`?amount=${(WFUND/1e8).toFixed(8)}`:""),"Byte"); q.make(); $("w-qr").src=q.createDataURL(4,4); }catch{}   // a dialog waiting on funds: the amount rides in the QR
    if(WFUND) $("w-fundnote").textContent=`Send about ${fmt(WFUND)} sats to this address · your take is waiting`;
    $("w-bal").textContent="…"; $("w-balhint").textContent="checking…";
    await walletBalance();
    $("w-bal").textContent=walletUtxos?fmt(walletSats())+" sats":"—";
    $("w-balhint").innerHTML=walletUtxos?`${walletUtxos.length} coin${walletUtxos.length===1?"":"s"}<span class="more">${usdOf(walletSats())?" · "+usdOf(walletSats()):""}</span>`:`<button type="button" class="linkbtn" data-wretry>retry</button> · the explorer did not answer`;
  }
  walletPill();
}
function walletOpen(){ walletPaint(); $("walletdlg").showModal(); }
$("walletbtn").onclick=walletOpen;
$("w-newnet").textContent=NET==="mainnet"?"mainnet · real sats":"signet · test sats, free from a faucet";   // the network comes from the chip in the top bar
$("w-restorebtn").onclick=()=>{ const open=$("w-restorebox").hidden; $("w-restorebox").hidden=!open; $("w-restorebtn").setAttribute("aria-expanded",String(open)); if(open) $("w-restore").focus(); };
// ---- Ledger (ledger.js): the browser's device prompt needs a click, so the libraries are fetched on hover/focus and the click only awaits them ----
function ledgerOption(){                                   // the option's availability: WebHID or not (Safari, Firefox, phones)
  const ok=ledgerSupported(); $("w-ledger").disabled=!ok; $("w-ledger").title=ok?"":"WebHID is not available in this browser";
  $("w-ledgerhint").textContent= ok ? "Bitcoin app open on the device · keys never leave it" : "Needs WebHID: Chrome, Edge or Brave on a desktop";
}
ledgerOption();
["pointerenter","focus"].forEach(ev=>$("w-ledger").addEventListener(ev,()=>{ if(ledgerSupported()) ledgerLibs().catch(()=>{}); }));
$("w-ledger").onclick=async()=>{
  const b=$("w-ledger"), m=$("w-ledgermsg"); m.hidden=true; b.disabled=true; b.textContent="Connecting…";
  try{
    const r=await ledgerConnect(NET);
    WALLET={kind:"ledger", net:NET, addr:r.addr, xpub:r.xpub, fp:r.fp}; walletSave(); wKey=null; walletUtxos=null;
    await walletPaint(); PAY.forEach(p=>p.paint());
  }catch(e){ m.hidden=false; m.textContent=ledgerError(e).message; }
  b.disabled=!ledgerSupported(); b.textContent="Connect a Ledger";
};
async function walletInstall(words){
  const pass=$("w-pass1").value;
  const k=await walletDerive(words, pass, NET);
  WALLET={net:NET, enc:!!pass, data: pass? await encryptSecret(words, pass) : words, addr:k.address};
  walletSave(); wKey=k; wKey.words=words; walletUtxos=null; $("w-pass1").value="";
  await walletPaint(); PAY.forEach(p=>p.paint());
}
$("w-create").onclick=async()=>{ $("w-createmsg").hidden=true; $("w-create").disabled=true; $("w-create").textContent="Creating…"; try{ const {mnemonic}=await walletGenerate(); await walletInstall(mnemonic); $("w-backup").click(); }catch(e){ $("w-createmsg").hidden=false; $("w-createmsg").textContent="Could not create the wallet: "+e.message; } $("w-create").disabled=false; $("w-create").textContent="Create wallet"; };
$("w-restoreok").onclick=async()=>{ const words=$("w-restore").value.trim().toLowerCase().split(/\s+/).join(" "); if(!(await walletValidate(words))){ $("w-restore").style.borderColor="#ff5c5c"; return; } await walletInstall(words); $("w-restore").value=""; $("w-restorebox").hidden=true; };
$("w-unlock").onclick=async()=>{ try{ await walletLoadKey($("w-pass2").value); $("w-lockmsg").hidden=true; $("w-pass2").value=""; await walletPaint(); PAY.forEach(p=>p.paint()); }catch{ $("w-lockmsg").hidden=false; } };
$("w-pass2").onkeydown=e=>{ if(e.key==="Enter") $("w-unlock").click(); };
$("w-copy").onclick=()=>copyText(WALLET.addr,$("w-copy"));
$("w-refresh").onclick=async()=>{ walletUtxos=null; await walletPaint(); PAY.forEach(p=>p.paint()); };
$("w-backup").onclick=async()=>{
  if(walletIsLedger()) return;                                   // no words: the keys are on the device (the button is hidden)
  if(!wKey){ try{ await walletLoadKey(""); }catch{ return; } }
  $("w-words").innerHTML=wKey.words.split(" ").map(w=>`<li>${w}</li>`).join(""); $("w-backupbox").hidden=false; $("w-forgetbox").hidden=true; $("w-backupbox").scrollIntoView({block:"nearest"});
};
$("w-wordshide").onclick=()=>{ $("w-backupbox").hidden=true; $("w-words").innerHTML=""; };
$("w-wordscopy").onclick=()=>copyText(wKey.words,$("w-wordscopy"));
const forgetUI=()=>{ const sec=$("w-ready").hidden?$("w-locked"):$("w-ready"); sec.querySelector(".dlgfoot").before($("w-forgetbox")); $("w-forgetbox").hidden=false;
  $("w-forgetnote").innerHTML= walletIsLedger() ? "This removes the Ledger from this browser. Its keys and sats stay on the device; connect it again any time. Type <b>FORGET</b> to confirm." : "This removes the wallet from this browser. Its sats stay on the chain, reachable only with the 12 words. Type <b>FORGET</b> to confirm."; $("w-backupbox").hidden=true; $("w-forgetinput").value=""; $("w-forgetok").disabled=true; $("w-forgetbox").scrollIntoView({block:"nearest"}); $("w-forgetinput").focus(); };
$("w-forget1").onclick=forgetUI;
$("w-forget2").onclick=forgetUI;
$("w-forgetinput").oninput=()=>{ $("w-forgetok").disabled=$("w-forgetinput").value!=="FORGET"; };
$("w-forgetcancel").onclick=()=>{ $("w-forgetbox").hidden=true; };
$("w-forgetinput").onkeydown=e=>{ if(e.key==="Enter"&&!$("w-forgetok").disabled) $("w-forgetok").click(); };
$("w-forgetok").onclick=()=>{ WALLET=null; wKey=null; walletUtxos=null; try{ localStorage.removeItem(NETKEY("bv.wallet")); }catch{} $("w-forgetbox").hidden=true; walletPaint(); PAY.forEach(p=>p.paint()); };
addEventListener("resize",walletPill);
walletPill();
if(walletState()==="sealed") walletLoadKey("").then(()=>{ walletPill(); PAY.forEach(p=>p.paint()); }).catch(()=>{});
if(WALLET) walletBalance().then(()=>{ walletPill(); PAY.forEach(p=>p.paint()); });
priceReady(); feeReady().then(()=>PAY.forEach(p=>p.paint()));      // the BTC price and the fee estimates, once per page: only the pages that pay load this file (not the embed)

// ---------- once sent: the panel says what went out, the footer offers the transaction on the explorer ----------
const ICON_OK='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_EXT='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const sentHtml=(s,rcpt)=>{ const sum=re=>(s.outs||[]).filter(o=>re.test(o.label)).reduce((a,o)=>a+o.sats,0), burned=sum(/^(burn|register|sponsor)/), tip=sum(/^tip$/);
  const tiles=[burned&&[burned,"burned"], tip&&[tip,burned?"tip":"sent"], Number.isFinite(s.fee)&&[s.fee,"mining fee"], Number.isFinite(s.after)&&[s.after,"balance after"]].filter(Boolean);
  return `<div class="wdone"><div class="wdonehead"><span class="fi okfi" aria-hidden="true">${ICON_OK}</span><div><b>${burned?"Burned":"Sent"}</b><span class="mono">in the mempool · waiting for its first block</span></div></div>
    <div class="wdonesum">${tiles.map(([v,k])=>`<div><b>${fmt(v)} sats</b><span>${k}</span></div>`).join("")}</div>
    <div class="kv"><span class="k">Transaction</span><code title="${esc(s.txid)}">${esc(s.txid.slice(0,12))}…${esc(s.txid.slice(-8))}</code><button type="button" class="copy" data-copytx="${esc(s.txid)}">copy</button></div>
    ${rcpt?`<a class="wrcpt" href="receipt.html#${esc(s.txid)}">View receipt →</a>`:""}</div>`; };
function txLink(btn,s){ const foot=btn.closest(".dlgfoot"); if(!foot) return; let a=foot.querySelector("[data-txlink]");
  if(!a){ a=document.createElement("a"); a.className="btn"; a.dataset.txlink=""; a.target="_blank"; a.rel="noopener"; a.innerHTML=ICON_EXT+"<span>Explorer</span>"; (btn.closest(".signwrap")||btn).before(a); }
  const sent=!!(s&&s.kind==="sent"); a.hidden=!sent; if(sent) a.href=TXURL(s.txid); }
document.addEventListener("click",e=>{ const b=e.target.closest("[data-copytx]"); if(b) copyText(b.dataset.copytx,b); });
document.addEventListener("click",e=>{ const b=e.target.closest("[data-fund]"); if(!b) return; const [pre,n]=b.dataset.fund.split(":"); FUNDING=pre; WFUND=+n; walletOpen(); });   // short of funds: the wallet opens with the amount in its QR
document.addEventListener("click",e=>{ if(!e.target.closest("[data-wretry]")) return; chainReset(); const p=walletBalance(true); PAY.forEach(x=>x.paint()); if($("walletdlg")?.open) $("w-balhint").textContent="checking…";   // the wallet's balance: another try, when the reader asks
  p.then(()=>{ walletPill(); PAY.forEach(x=>x.paint()); if($("walletdlg")?.open) walletPaint(); }); });
// ---------- the mining fee speed: Fast / Normal / Economy with their sat/vB, remembered on this network; every panel repaints with it ----------
const feeSegHtml=id=>`<div class="seg feeseg" role="group" aria-label="Mining fee speed" id="${id}">${FEE_SPEEDS.map(([k,l])=>`<button type="button" data-fee="${k}" aria-pressed="false">${l}<span class="mono"></span></button>`).join("")}</div>`;
function feeSegPaint(seg, off=false, sum=null){ const r=feeRates(), sp=feeSpeed(); seg.querySelectorAll("[data-fee]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.fee===sp)); b.querySelector("span").textContent=` · ${r[b.dataset.fee]}`; b.disabled=off; });
  if(sum) sum.textContent=`Advanced · mining fee · ${FEE_SPEEDS.find(x=>x[0]===sp)[1]} · ${r[sp]} sat/vB`; }   // sum: the <summary> of an edit view's Advanced
const feeSegWire=seg=>{ seg.onclick=e=>{ const b=e.target.closest("[data-fee]"); if(!b||b.disabled) return; LS(NETKEY("bv.fee"),b.dataset.fee); PAY.forEach(p=>p.paint()); }; };
// ---------- wallet block of the transaction step: tiles + status; the dialog footer's primary button drives it (walletPrimary). speed:false when the dialog sets the fee elsewhere ----------
function walletTab(prefix, root, {speed=true}={}){
  const id=k=>prefix+"-w-"+k;
  root.innerHTML=`<div class="wpay">
    <div id="${id("none")}"><p class="note" style="margin:0">No wallet in this browser yet. Connect one below<span class="more">: a small burner wallet whose keys stay on this device (fund it only with sats you plan to burn), or your Ledger</span>.</p></div>
    <div id="${id("locked")}" hidden><p class="note" style="margin:0">Your wallet is locked. Unlock it to sign from here.</p></div>
    <div id="${id("ready")}" hidden>
      <div class="wsum"><div><b id="${id("total")}">…</b><span>to send</span></div><div><b id="${id("fee")}">…</b><span>mining fee<span class="more" id="${id("rate")}"></span></span></div><div><b id="${id("after")}">…</b><span>balance after</span></div></div>
      ${speed?feeSegHtml(id("speed")):""}
      <p class="note mono" id="${id("msg")}" style="margin:8px 0 0" aria-live="polite"></p>
      <div id="${id("result")}" aria-live="polite" hidden></div>
    </div></div>`;
  const $$=k=>$(id(k)); let last=null, status=null;   // status: null | {kind:"busy"} | {kind:"sent", txid} | {kind:"err", msg}
  const api={ update(p){ last=p; if(!status||status.kind!=="busy") status=null; }, onsent:null };   // onsent({txid, outputs, hex}): the page records what went out (pending burns for the receipt page); status.msg: the Ledger stage
  const calc=()=>{ const total=last.outputs.reduce((a,o)=>a+o.sats,0), fee=Math.ceil(feeRate()*walletVsize(Math.max(1,(walletUtxos||[]).length),[...last.outputs.map(o=>fromHex(o.scriptHex)),new Uint8Array(22)])); let mismatch=true; try{ mismatch=bech32Decode(last.outputs[0].addr).hrp!==HRP; }catch{} return {total, fee, bal:walletSats(), mismatch}; };   // priced like the signers: every coin in, the real output scripts, a P2WPKH change
  const canSend=()=>{ if(walletState()!=="ready"||!last||!walletUtxos||(status&&status.kind!=="err")) return false; const c=calc(); return !c.mismatch && c.bal>=c.total+c.fee; };   // after an error the button stays live: open the Ledger app, plug it back in, try again
  const paint=()=>{
    const st=walletState(), sent=!!(status&&status.kind==="sent");
    root.closest(".pay")?.classList.toggle("sent",sent);   // sent: the txid and the receipt link stay, the rest goes (base.css)
    $$("none").hidden=st!=="none"; $$("locked").hidden=!(st==="locked"||st==="sealed"); $$("ready").hidden=st!=="ready";
    $$("result").hidden=!status||status.kind==="busy";
    if(status&&status.kind==="sent") $$("result").innerHTML=sentHtml(status, !!api.onsent);   // a receipt only where the page recorded a burn (not for a plain tip)
    else if(status&&status.kind==="err") $$("result").innerHTML=`<p class="note mono" style="margin:6px 0 0">${esc(status.msg)}</p>`;
    if(st!=="ready") return;
    const r=feeRates(), sp=feeSpeed(); $$("rate").textContent=` · ${r[sp]} sat/vB`;
    if(speed) feeSegPaint($$("speed"), !!(status&&status.kind!=="err"));
    if(!last){ $$("total").textContent=$$("fee").textContent=$$("after").textContent="—"; $$("msg").textContent="Nothing to send yet."; return; }
    if(sent){ $$("msg").textContent=""; return; }
    const {total,fee,bal,mismatch}=calc();
    $$("total").textContent=fmt(total)+" sats"; $$("fee").textContent="≈ "+fmt(fee)+" sats"; $$("after").textContent=fmt(Math.max(0,bal-total-fee))+" sats";
    if(status&&status.kind==="busy"){ $$("msg").textContent=status.msg||"signing…"; return; }
    if(!walletUtxos){ $$("after").textContent="—"; $$("msg").innerHTML= WREADING ? "checking the balance…" : `<button type="button" class="linkbtn" data-wretry>retry</button> · the explorer did not answer · balance unknown`; return; }
    if(FUNDING===prefix&&!mismatch&&bal>=total+fee){ FUNDING=null; WFUND=0; toast("Funds arrived · your burn is ready to sign"); }   // the wallet caught up with the dialog waiting on it
    $$("msg").innerHTML = mismatch ? `This wallet is on ${NET}; this address is not. The transaction cannot relay.`
      : bal<total+fee ? `Needs ${fmt(total+fee)} sats, the wallet has ${fmt(bal)}. <button type="button" class="linkbtn" data-fund="${prefix}:${total+fee-bal+500}">Add funds</button>`
      : "";                                                   // all is well: nothing to say
  };
  const send=async()=>{
    if(!canSend()) return;
    const outputs=last.outputs.map(o=>({value:o.sats, script:fromHex(o.scriptHex)}));   // pinned: the step can change under a slow explorer
    status={kind:"busy"}; PAY.forEach(p=>p.paint());
    try{
      await walletBalance(true);
      if(!walletUtxos) throw new Error(`balance unknown: the explorer at ${esploraBase(NET)} is unreachable from this page`);
      const r= walletIsLedger()
        ? await ledgerSign({utxos:walletUtxos, outputs, changeAddr:WALLET.addr, feeRate:feeRate(), wallet:WALLET, network:NET, onstage:m=>{ status={kind:"busy", msg:m}; PAY.forEach(p=>p.paint()); }})   // the device signs; the stage shows in the tiles' message
        : await signP2wpkh({utxos:walletUtxos, outputs, changeAddr:WALLET.addr, feeRate:feeRate(), key:wKey});
      const b=await broadcastTx(r.hex, NET);
      if(b.error) throw new Error(b.error);                // the explorer's rejection, verbatim
      const outSum=last.outputs.reduce((a,o)=>a+o.sats,0);
      status={kind:"sent", txid:b.txid||r.txid, fee:r.fee, outs:last.outputs, after:Number.isFinite(r.fee)?walletSats()-outSum-r.fee:null};   // what went out, for the success panel
      try{ api.onsent?.({txid:status.txid, outputs:last.outputs, hex:r.hex}); }catch{}
      walletUtxos=null; walletBalance().then(()=>{ walletPill(); PAY.forEach(p=>p.paint()); });   // coins spent: the change shows once the explorer sees it
    }catch(e){ status={kind:"err", msg:walletIsLedger()?ledgerError(e).message:e.message}; }
    PAY.forEach(p=>p.paint());
  };
  if(speed) feeSegWire($$("speed"));
  const fee=()=>last ? calc().fee : null;                     // coins unknown (no wallet yet, or the explorer has not answered): priced for one coin, exact once they load
  const need=()=>last ? calc().total+calc().fee+500 : 0;       // what to send the wallet for this burn: its outputs, the fee, a little margin
  return Object.assign(api, { paint:()=>{ paint(); feeReady(); }, send, canSend, fee, need, prefix, status:()=>status });
}
// the dialogs' primary from the first step that can sign: "Sign take and…" opens Broadcast / Add to batch (batch null: no batch item).
// Broadcast walks the wallet (connect, unlock), brings up the Transaction step (show), where progress and errors show, then signs and sends; once sent the button is Done.
const CARET='<svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
function signMenu(btn, menu, wt, {label, ok=true, show=()=>{}, batch=null, tx=null, done}){   // tx: bring up the transaction details (null: already there)
  if(!btn._close){ btn._close=dropMenu(btn,menu); btn._toggle=btn.onclick; }       // the menu's toggle, outside click and Escape: wired once
  const st=walletState(), s=wt.status(), bc=menu.querySelector('[data-act="broadcast"]'), ba=menu.querySelector('[data-act="batch"]'), tt=menu.querySelector('[data-act="tx"]'); txLink(btn,s);
  if(s&&s.kind==="sent"){ btn._close(); btn.textContent="Done"; btn.disabled=false; btn.removeAttribute("aria-haspopup"); btn.onclick=done; return; }
  btn.setAttribute("aria-haspopup","menu"); btn.onclick=btn._toggle;
  if(s&&s.kind==="busy"){ btn._close(); btn.textContent=walletIsLedger()?"On the Ledger…":"Signing…"; btn.disabled=true; return; }
  btn.innerHTML=label+CARET; btn.disabled=!ok;
  bc.textContent= st==="none" ? "Broadcast · set up a wallet (your take is kept)" : st!=="ready" ? "Broadcast · unlock the wallet first" : (walletIsLedger() ? "Broadcast · confirm on the Ledger" : "Broadcast");   // the fee sits under the price (dlgPrice)
  bc.onclick=()=>{ btn._close(); if(st!=="ready"){ if(st==="none"){ FUNDING=wt.prefix; WFUND=wt.need(); } return walletOpen(); } show(); if(wt.canSend()) wt.send(); };   // no wallet yet: the dialog stays open under the wallet's, the take kept
  ba.hidden=!batch; ba.onclick=()=>{ btn._close(); if(batch) batch(); };
  tt.hidden=!tx; tt.onclick=()=>{ btn._close(); if(tx) tx(); };
}
// the footer's left in every dialog that builds a transaction: what signing costs, the amount and its word, then what comes on top (fee: wt.fee(), null until the dialog has a transaction to price)
function dlgPrice(host, sats, word, fee, extra=[]){
  const h=`<span><b>${fmt(sats)} sats</b><span class="w">${word}</span></span>${[...extra, fee!=null?`+${fmt(fee)} sats mining fees`:"+ mining fees"].map(x=>`<small>${x}</small>`).join("")}`;
  if(host._h!==h){ host._h=h; host.innerHTML=h; }             // unchanged: left alone, a focused link keeps its focus
}
// the dialog footer's primary button, from the wallet state: none → Connect a wallet, locked → Unlock wallet, ready → Sign & broadcast (Sign on Ledger), sent → Done
function walletPrimary(btn, wt, done, ok=true){
  const st=walletState(), s=wt.status(); txLink(btn,s);
  let label, act, off=false;
  if(s&&s.kind==="sent"){ label="Done"; act=done; }
  else if(st==="none"){ label="Connect a wallet"; act=walletOpen; }
  else if(st==="locked"){ label="Unlock wallet"; act=walletOpen; }
  else if(st==="sealed"){ label="Open wallet"; act=walletOpen; }
  else if(walletIsLedger()){ label= s&&s.kind==="busy" ? "On the Ledger…" : "Sign on Ledger"; act=wt.send; off=!ok||!wt.canSend(); }
  else { label= s&&s.kind==="busy" ? "Signing…" : "Sign & broadcast"; act=wt.send; off=!ok||!wt.canSend(); }
  btn.textContent=label; btn.disabled=off; btn.onclick=act;
}
