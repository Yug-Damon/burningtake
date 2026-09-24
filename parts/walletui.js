
// ---------- burner wallet: state, dialog, nav pill ----------
// ponytail: one BIP84 key, stored in localStorage (encrypted when a passphrase is set). Coins here are meant to be burned.
// Or a Ledger (ledger.js): {kind:"ledger", net, addr, xpub, fp} — the first receive address of account 0, keys on the device, every burn signed there.
let WALLET=(()=>{ try{ return JSON.parse(LS(NETKEY("bv.wallet"))||"null"); }catch{ return null; } })();   // {net, enc, data, addr} | {kind:"ledger", net, addr, xpub, fp}, one per network (bv.wallet.mainnet / bv.wallet.signet)
let wKey=null, walletUtxos=null;                          // walletUtxos: explorer result, or null while unknown (never fetched, or the explorer is unreachable)
const walletIsLedger=()=>!!(WALLET&&WALLET.kind==="ledger");
const walletState=()=> !WALLET ? "none" : walletIsLedger() ? "ready" : wKey ? "ready" : WALLET.enc ? "locked" : "sealed";   // sealed: stored in clear, derive on demand. A Ledger is always "ready": viewing needs nothing, signing asks the device
const walletSave=()=>{ try{ LS(NETKEY("bv.wallet"),JSON.stringify(WALLET)); }catch{} };
async function walletLoadKey(pass=""){                    // derive the key from the stored words (decrypting first if needed)
  if(walletIsLedger()) throw new Error("the keys are on the Ledger");
  const words = WALLET.enc ? await decryptSecret(WALLET.data, pass) : WALLET.data;
  wKey = await walletDerive(words, WALLET.enc?pass:"", NET);
  wKey.words=words; return wKey;
}
async function walletBalance(force=false){                // -> the explorer's coins, or null when it is unreachable from this page
  if(!WALLET) return null;
  if(walletUtxos && !force) return walletUtxos;
  walletUtxos = await fetchUtxos(WALLET.addr, NET);
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
    const a=WALLET.addr; $("w-addr").textContent=a; $("w-netlabel").textContent=NET;
    $("w-path").textContent= ledger ? `${ledgerPathString(NET)} · [${WALLET.fp}]` : "m/84'/…/0/0";   // the Ledger's first receive address; [fp] = the master fingerprint the PSBTs carry
    $("w-fundnote").textContent= ledger ? "Burns spend from this address only (the account's first receive address). Send sats here from Ledger Live or anywhere." : "Fund it by sending sats to this address.";
    $("w-keysnote").hidden=!ledger; $("w-backup").hidden=ledger; $("w-qr").alt=(ledger?"Ledger":"Wallet")+" address as QR";
    try{ const q=qrcode(0,"M"); q.addData("bitcoin:"+a,"Byte"); q.make(); $("w-qr").src=q.createDataURL(4,4); }catch{}
    $("w-bal").textContent="…"; $("w-balhint").textContent="checking…";
    await walletBalance();
    $("w-bal").textContent=walletUtxos?fmt(walletSats())+" sats":"—";
    $("w-balhint").innerHTML=walletUtxos?`${walletUtxos.length} coin${walletUtxos.length===1?"":"s"}<span class="more"> · ≈ $${(walletSats()/1e8*BTCUSD).toFixed(2)}</span>`:"explorer unreachable";
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

// ---------- wallet block of the transaction step: tiles + status; the dialog footer's primary button drives it (walletPrimary) ----------
function walletTab(prefix, root){
  const id=k=>prefix+"-w-"+k;
  root.innerHTML=`<div class="wpay">
    <div id="${id("none")}"><p class="note" style="margin:0">No wallet in this browser yet. Connect one below<span class="more">: a small burner wallet whose keys stay on this device (fund it only with sats you plan to burn), or your Ledger</span>.</p></div>
    <div id="${id("locked")}" hidden><p class="note" style="margin:0">Your wallet is locked. Unlock it to sign from here.</p></div>
    <div id="${id("ready")}" hidden>
      <div class="wsum"><div><b id="${id("total")}">…</b><span>to send</span></div><div><b id="${id("fee")}">…</b><span>mining fee<span class="more"> · 1 sat/vB</span></span></div><div><b id="${id("after")}">…</b><span>balance after</span></div></div>
      <p class="note mono" id="${id("msg")}" style="margin:8px 0 0" aria-live="polite"></p>
      <p class="note mono" id="${id("result")}" style="margin:6px 0 0" aria-live="polite" hidden></p>
    </div></div>`;
  const $$=k=>$(id(k)); let last=null, status=null;   // status: null | {kind:"busy"} | {kind:"sent", txid} | {kind:"err", msg}
  const api={ update(p){ last=p; if(!status||status.kind!=="busy") status=null; }, onsent:null };   // onsent({txid, outputs, hex}): the page records what went out (pending burns for the receipt page); status.msg: the Ledger stage
  const calc=()=>{ const total=last.outputs.reduce((a,o)=>a+o.sats,0), fee=Math.ceil(estimateVsize((walletUtxos||[]).length||1,last.outputs.length+1)); let mismatch=true; try{ mismatch=bech32Decode(last.outputs[0].addr).hrp!==HRP; }catch{} return {total, fee, bal:walletSats(), mismatch}; };
  const canSend=()=>{ if(walletState()!=="ready"||!last||!walletUtxos||(status&&status.kind!=="err")) return false; const c=calc(); return !c.mismatch && c.bal>=c.total+c.fee; };   // after an error the button stays live: open the Ledger app, plug it back in, try again
  const paint=()=>{
    const st=walletState();
    $$("none").hidden=st!=="none"; $$("locked").hidden=!(st==="locked"||st==="sealed"); $$("ready").hidden=st!=="ready";
    $$("result").hidden=!status||status.kind==="busy";
    if(status&&status.kind==="sent") $$("result").innerHTML=`broadcast · <a href="${TXURL(status.txid)}" target="_blank" rel="noopener" style="color:var(--ember2)">${status.txid.slice(0,10)}…${status.txid.slice(-6)}</a>${api.onsent?` · <a class="receipt" href="receipt.html#${status.txid}">View receipt →</a>`:""}`;   // a receipt only where the page recorded a burn (not for a plain tip)
    else if(status&&status.kind==="err") $$("result").textContent=status.msg;
    if(st!=="ready") return;
    if(!last){ $$("total").textContent=$$("fee").textContent=$$("after").textContent="—"; $$("msg").textContent="Nothing to send yet."; return; }
    if(status&&status.kind==="sent"){ $$("msg").textContent="Signed here and sent to the network."; return; }   // the tiles keep the numbers of the transaction that went out
    const {total,fee,bal,mismatch}=calc();
    $$("total").textContent=fmt(total)+" sats"; $$("fee").textContent="≈ "+fmt(fee)+" sats"; $$("after").textContent=fmt(Math.max(0,bal-total-fee))+" sats";
    if(status&&status.kind==="busy"){ $$("msg").textContent=status.msg||"signing…"; return; }
    if(!walletUtxos){ $$("after").textContent="—"; $$("msg").textContent=`balance unknown: the explorer at ${esploraBase(NET)} is unreachable from this page`; return; }
    $$("msg").textContent = mismatch ? `This wallet is on ${NET}; this address is not. The transaction cannot relay.`
      : bal<total+fee ? `Needs ${fmt(total+fee)} sats, the wallet has ${fmt(bal)}. Fund it from the wallet chip in the top bar.`
      : `Spends ${walletUtxos.length} coin${walletUtxos.length===1?"":"s"}; change comes back to this wallet.`+(walletIsLedger()?" Each output is confirmed on the Ledger.":"");
  };
  const send=async()=>{
    if(!canSend()) return;
    const outputs=last.outputs.map(o=>({value:o.sats, script:fromHex(o.scriptHex)}));   // pinned: the step can change under a slow explorer
    status={kind:"busy"}; PAY.forEach(p=>p.paint());
    try{
      await walletBalance(true);
      if(!walletUtxos) throw new Error(`balance unknown: the explorer at ${esploraBase(NET)} is unreachable from this page`);
      const r= walletIsLedger()
        ? await ledgerSign({utxos:walletUtxos, outputs, changeAddr:WALLET.addr, feeRate:1, wallet:WALLET, network:NET, onstage:m=>{ status={kind:"busy", msg:m}; PAY.forEach(p=>p.paint()); }})   // the device signs; the stage shows in the tiles' message
        : await signP2wpkh({utxos:walletUtxos, outputs, changeAddr:WALLET.addr, feeRate:1, key:wKey});
      const b=await broadcastTx(r.hex, NET);
      if(b.error) throw new Error(b.error);                // the explorer's rejection, verbatim
      status={kind:"sent", txid:b.txid||r.txid};
      try{ api.onsent?.({txid:status.txid, outputs:last.outputs, hex:r.hex}); }catch{}
      walletUtxos=null; walletBalance().then(()=>{ walletPill(); PAY.forEach(p=>p.paint()); });   // coins spent: the change shows once the explorer sees it
    }catch(e){ status={kind:"err", msg:walletIsLedger()?ledgerError(e).message:e.message}; }
    PAY.forEach(p=>p.paint());
  };
  return Object.assign(api, { paint, send, canSend, status:()=>status });
}
// the dialog footer's primary button, from the wallet state: none → Connect a wallet, locked → Unlock wallet, ready → Sign & broadcast (Sign on Ledger), sent → Done
function walletPrimary(btn, wt, done, ok=true){
  const st=walletState(), s=wt.status();
  let label, act, off=false;
  if(s&&s.kind==="sent"){ label="Done"; act=done; }
  else if(st==="none"){ label="Connect a wallet"; act=walletOpen; }
  else if(st==="locked"){ label="Unlock wallet"; act=walletOpen; }
  else if(st==="sealed"){ label="Open wallet"; act=walletOpen; }
  else if(walletIsLedger()){ label= s&&s.kind==="busy" ? "On the Ledger…" : "Sign on Ledger"; act=wt.send; off=!ok||!wt.canSend(); }
  else { label= s&&s.kind==="busy" ? "Signing…" : "Sign & broadcast"; act=wt.send; off=!ok||!wt.canSend(); }
  btn.textContent=label; btn.disabled=off; btn.onclick=act;
}
