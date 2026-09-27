
// ---------- burner wallet: state, dialog, nav pill ----------
// ponytail: one BIP84 key, stored in localStorage (encrypted when a passphrase is set). Coins here are meant to be burned.
// Or a Ledger (ledger.js): {kind:"ledger", net, addr, xpub, fp, used} — addr is the first receive address of account 0 (the one shown and used for change); coins are read from every used address of the account (receive 0/* and change 1/*, each until 20 unused in a row), keys on the device, every burn signed there.
// A burn's burner is its first input's address: 0/0 while it holds a coin (ledgerUtxos spends its coins first), else another address of the account. used (the last read's addresses with history) lets walletOwns know them all.
let WALLET=(()=>{ try{ return JSON.parse(LS(NETKEY("bv.wallet"))||"null"); }catch{ return null; } })();   // {net, enc, data, addr} | {kind:"ledger", net, addr, xpub, fp, used}, one per network (bv.wallet.mainnet / bv.wallet.signet)
let wKey=null, walletUtxos=null, WFUND=0, FUNDING=null, WFUNDAT=null;   // WFUNDAT: the coins WFUND was worked out with (null: none known)   // WFUND: sats a dialog needs, for the receive QR; FUNDING: the dialog waiting on the wallet (its pay panel's prefix)                          // walletUtxos: explorer result, or null while unknown (never fetched, or the explorer is unreachable)
const walletIsLedger=()=>!!(WALLET&&WALLET.kind==="ledger");
const walletState=()=> !WALLET ? "none" : walletIsLedger() ? "ready" : wKey ? "ready" : WALLET.enc ? "locked" : "sealed";   // sealed: stored in clear, derive on demand. A Ledger is always "ready": viewing needs nothing, signing asks the device
const walletSave=()=>{ try{ LS(NETKEY("bv.wallet"),JSON.stringify(WALLET)); }catch{} };
async function walletLoadKey(pass=""){                    // derive the key from the stored words (decrypting first if needed)
  if(walletIsLedger()) throw new Error("the keys are on the Ledger");
  const words = WALLET.enc ? await decryptSecret(WALLET.data, pass) : WALLET.data;
  wKey = await walletDerive(words, WALLET.enc?pass:"", NET);
  wKey.words=words; return wKey;
}
let WREADING=false, WREAD=null;                            // a balance read is running: "checking", not "unknown"; WREAD {w, p}: the latest read, shared by every caller that does not force a fresh one
async function walletBalance(force=false){                // -> the explorer's coins, or null when it is unreachable from this page. Never rejects
  const w=WALLET; if(!w) return null;
  if(walletUtxos && !force) return walletUtxos;
  if(WREAD && WREAD.w===w && !force) return WREAD.p;       // page load, then the dialog opening: one read of the account, not two
  const me={w}; WREAD=me; WREADING=true;
  me.p=(async()=>{
    let r=null; try{ r= w.kind==="ledger" ? await ledgerUtxos(w.xpub, NET) : await fetchUtxos(w.addr, NET); }catch{}
    if(WREAD!==me) return WREAD&&WREAD.w===w ? WREAD.p : WALLET===w ? walletUtxos : null;   // a newer read took over (forced, or another wallet's): its answer, never this older one
    WREAD=null; WREADING=false;
    if(WALLET!==w) return null;                            // forgotten or replaced while this read ran: these coins are not the new wallet's
    if(r&&r.coins){ w.used=r.used; try{ if(JSON.parse(LS(NETKEY("bv.wallet"))).xpub===w.xpub) walletSave(); }catch{} r=r.coins; }   // a Ledger: its coins, and the account's addresses with history, kept with its record for walletOwns on every page (unless another tab forgot or replaced it meanwhile)
    return walletUtxos=r;
  })();
  return me.p;
}
const walletSats=()=>(walletUtxos||[]).reduce((a,u)=>a+u.value,0);
const walletOwns=a=>!!a&&!!WALLET&&(a===WALLET.addr||Array.isArray(WALLET.used)&&WALLET.used.includes(a));   // a burn's burner (first input's address) is this wallet's: the address it shows, or for a Ledger any address of the account the last balance read found used
function walletPill(){
  const st=walletState(), txt=$("wallettxt"), dot=$("walletdot");
  if(st==="none"){ txt.textContent=NARROW.matches?"Connect":"Connect wallet"; dot.style.background="var(--ink3)"; dot.style.boxShadow="none"; $("walletbtn").setAttribute("aria-label","Wallet"); return; }
  const a=WALLET.addr, narrow=NARROW.matches, ledger=walletIsLedger();
  txt.textContent=(st==="locked"&&!narrow?"🔒 ":ledger&&!narrow?"Ledger · ":"")+(narrow ? a.slice(0,4)+"…"+a.slice(-3) : a.slice(0,6)+"…"+a.slice(-4));   // balance lives in the wallet dialog, not the bar
  dot.style.background=st==="locked"?"var(--ember2)":"var(--ok)"; dot.style.boxShadow="0 0 8px currentColor";
  $("walletbtn").setAttribute("aria-label", `${ledger?"Ledger wallet":"Wallet"}, ${st==="locked"?"locked":"ready"}, ${a.slice(0,6)}…${a.slice(-4)}`);
}
async function walletPaint(connected=false){               // connected: the first paint of a wallet just created, restored or plugged in
  if(FUNDING&&!$(FUNDING+"-wallet")?.closest("dialog")?.open){ FUNDING=null; WFUND=0; }   // an ask whose dialog is gone: no amount to send, none in the QR
  const st=walletState();
  if(st==="none") wChoicePaint(); else $("w-opts").querySelector("input[value=new]").checked=true;   // no wallet: the picked way's form; a wallet in: the next Connect starts on New
  $("w-none").hidden=st!=="none"; $("w-locked").hidden=st!=="locked"; $("w-ready").hidden=!(st==="ready"||st==="sealed");
  const ledger=walletIsLedger();
  $("w-title").textContent= st==="none"?"Connect a wallet" : st==="locked"?"Unlock wallet" : ledger?"Your Ledger" : "Your wallet";
  if(st==="ready"||st==="sealed"){
    const a=WALLET.addr; $("w-addr").textContent=a.slice(0,10)+"…"+a.slice(-6); $("w-addr").title=a; $("w-netlabel").textContent=NET;   // condensed; copy and the QR carry the full address
    $("w-explorer").href="https://mempool.space/"+(NET==="mainnet"?"":"signet/")+"address/"+a; $("w-burns").href="burner.html#"+a;
    $("w-path").textContent= ledger ? `${ledgerPathString(NET)} · [${WALLET.fp}]` : "m/84'/…/0/0";   // the Ledger's first receive address; [fp] = the master fingerprint the PSBTs carry
    wFundNote();                                              // how much to send (the note and the QR), when a dialog asked for funds
    $("w-keysnote").hidden=!ledger; $("w-backup").hidden=ledger; $("w-qr").alt=(ledger?"Ledger":"Wallet")+" address as QR";
    $("w-bal").textContent="…"; $("w-balhint").textContent="checking…";
    await walletBalance(); if(!WALLET) return;                // forgotten during the read: Forget has painted the Connect view
    const wt=walletUtxos&&walletUtxos!==WFUNDAT&&wWaiting(), f=wt&&wt.funds();   // coins the ask was not worked out with (just connected, refreshed, retried): what the waiting dialog still needs from them
    if(f){ WFUNDAT=walletUtxos; if(f.short) WFUND=f.topup; else if(connected){ FUNDING=null; WFUND=0; toast(`Wallet connected · your ${wt.noun||"burn"} is ready to sign`); } }   // enough already: said now, never as Funds arrived (a refresh leaves that to the dialog's panel)
    wFundNote();                                              // the balance known: what is missing
    $("w-bal").textContent=walletUtxos?fmt(walletSats())+" sats":"—";
    $("w-balhint").innerHTML=walletUtxos?`${walletUtxos.length} coin${walletUtxos.length===1?"":"s"}<span class="more">${usdOf(walletSats())?" · "+usdOf(walletSats()):""}</span>`:`<button type="button" class="linkbtn" data-wretry>retry</button> · the explorer did not answer`;
  }
  walletPill();
}
function walletOpen(){ ["w-ledgermsg","w-createmsg","w-lockmsg"].forEach(i=>$(i).hidden=true); wRestoreErr(); $("w-backupbox").hidden=true; $("w-words").innerHTML=""; $("w-forgetbox").hidden=true; walletPaint(); $("walletdlg").showModal(); $("walletdlg").querySelector(".dlg").scrollTop=0; }   // an error belongs to its attempt; every open starts at the top (the title and the balance in view)
$("walletbtn").onclick=walletOpen;
$("w-newnet").textContent=NET==="mainnet"?"mainnet · real sats":"signet · test sats, free from a faucet";   // the network comes from the chip in the top bar
// ---- Ledger (ledger.js): the browser's device prompt needs a click, so the libraries are fetched on hover/focus and the click only awaits them ----
function ledgerOption(){                                   // the option's availability: WebHID or not (Safari, Firefox, phones); without it the card says why and cannot be picked
  const ok=ledgerSupported(), r=$("w-optledger").querySelector("input"); $("w-ledger").disabled=!ok; $("w-ledger").title=ok?"":"WebHID is not available in this browser";
  $("w-ledgerhint").textContent= ok ? "Keys never leave the device: you confirm every burn on its screen." : "Needs WebHID: Chrome, Edge or Brave on a desktop.";
  r.disabled=!ok; $("w-optledger").classList.toggle("off",!ok); if(!ok&&r.checked) $("w-opts").querySelector("input[value=new]").checked=true;
}
ledgerOption();
// ---- Connect a wallet (#w-none): three ways as radio cards; the picked one opens its form, the footer shows its one primary (#w-create / #w-restoreok / #w-ledger, their handlers below as before) ----
$("w-ledgerapp").textContent=LEDGER_APP[NET]||"Bitcoin";      // the app the device must have open on this network
function wPick(){ return $("w-opts").querySelector("input:checked")?.value||"new"; }   // new | words | ledger
function wPassSum(){ $("w-passsum").textContent= $("w-pass1").value ? "Passphrase\u00a0· set" : wPick()==="words" ? "Passphrase\u00a0· if it had one" : "Passphrase\u00a0· optional"; }   // a folded passphrase still says it is there
function wWaiting(){ return FUNDING&&WFUND&&$(FUNDING+"-wallet")?.closest("dialog")?.open ? PAY.find(p=>p.wallet?.prefix===FUNDING)?.wallet||null : null; }   // the pay panel of a dialog still open under this one, waiting on the wallet (its close drops the ask; this checks it anyway)
// what a transaction's outputs are, in the words the dialogs use: [word, sats, outputs] in output order. A registration above 330 is a registration and a sponsorship (Explore's New topic);
// next to a registration (noun), a burn is its first answer. Read by funds() (the callout, the cap notes) and by the Connect dialog's waiting line
const outParts=(outs,noun)=>{ const parts=[], add=(w,s)=>{ const x=parts.find(p=>p[0]===w); if(x){ x[1]+=s; x[2]++; } else parts.push([w,s,1]); };
  for(const o of outs){ if(!o.sats) continue; const w=o.label==="tip"?"tip":/^register/.test(o.label)?"registration":/^sponsor/.test(o.label)?"sponsorship":noun==="registration"?"first answer":"burn";
    if(w==="registration"&&o.sats>REG_SATS){ add(w,REG_SATS); add("sponsorship",o.sats-REG_SATS); } else add(w,o.sats); }
  return parts; };
function wWaitPaint(){                                      // #w-none: what the waiting dialog keeps (its noun, from signMenu or the batch), and what the wallet will need for it
  const wt=wWaiting(); $("w-wait").hidden=!wt; if(!wt) return;
  const outs=wt.outs(), n=wt.noun, parts=outParts(outs,n), burns=outs.filter(o=>/^(burn|register|sponsor)/.test(o.label)).length, tip=parts.some(p=>p[0]==="tip");   // the labels sentHtml reads
  const word= n==="registration"||n==="sponsorship"||n==="tip" ? n : "burn", own=parts.find(p=>p[0]===word);   // a take or an answer: its amount is a burn; the headline counts the noun's own outputs, never what rides along (a registration, a first answer)
  const [cls,icon]= !burns&&tip ? ["tip",ICONS.tip] : n==="registration" ? ["reg",ICONS.reg] : n==="sponsorship" ? ["feature",ICONS.feature] : ["",ICON_TAKE];   // the badges of the batch list
  $("w-waiticon").className="fi"+(cls&&" "+cls); $("w-waiticon").innerHTML=icon;
  $("w-waithead").textContent= n==="batch" ? `Your batch of ${burns} burn${burns===1?"":"s"} is kept` : own ? `Your ${fmt(own[1])}-sat ${word} is kept` : `Your ${word} is kept`;   // the amounts from the outputs the dialog pinned
  const lead=parts.map(([w,,c])=>c>1?w+"s":w).join(", ");   // what the amount covers, part by part (the footer's words), the mining fee last
  $("w-waitnote").textContent=`Once connected, the wallet needs about ${fmt(WFUND)}\u00a0sats: ${lead?lead+" and ":""}mining fee.`;   // the amount never leaves its unit on a wrap
}
function wChoicePaint(){                                    // the picked way's form and primary; the one passphrase field (walletInstall reads it) rides with New or Restore
  const p=wPick(), adv=$("w-passadv");
  $("w-newbox").hidden=p!=="new"; $("w-restorebox").hidden=p!=="words"; $("w-ledgerbox").hidden=p!=="ledger";
  $("w-create").hidden=p!=="new"; $("w-restoreok").hidden=p!=="words"; $("w-ledger").hidden=p!=="ledger";
  if(p==="new"&&adv.parentNode!==$("w-newbox")) $("w-createmsg").before(adv); else if(p==="words"&&adv.parentNode!==$("w-restorebox")) $("w-restorebox").append(adv);   // typed once, kept across a switch
  $("w-passnote").textContent= p==="words" ? "Type the one it was made with: any other passphrase opens a different, empty wallet." : "Encrypts the words in this browser (BIP39) and changes the address: you need it again to restore.";
  $("w-pass1").placeholder= p==="words" ? "Leave empty if it had none" : "Leave empty for no passphrase";
  $("w-pass1").autocomplete= p==="words" ? "off" : "new-password";   // Restore: no generated password offered (it would open a different, empty wallet)
  wPassSum(); wWaitPaint();
  $("w-opts").querySelectorAll("input").forEach(r=>r.autofocus=r.checked);   // the dialog opens on the pick, not on a field: no phone keyboard
}
$("w-opts").onchange=e=>{ if(e.target.name!=="wopt") return; $("w-ledgermsg").hidden=$("w-createmsg").hidden=true; if(wPick()==="ledger"&&ledgerSupported()) ledgerLibs().catch(()=>{}); wChoicePaint(); };   // an error belongs to its attempt; Ledger picked: its libraries load before the click that needs them
$("w-opts").onclick=e=>{ if(e.detail&&e.target.closest(".wopth")) setTimeout(()=>{ if(wPick()==="words") $("w-restore").focus(); }); };   // a click or tap on Restore goes straight to the words; arrow keys (detail 0) stay in the group
$("w-pass1").oninput=wPassSum;
$("w-pass1").onkeydown=e=>{ if(e.key==="Enter") $(wPick()==="words"?"w-restoreok":"w-create").click(); };   // Enter: the primary on screen, as Unlock does
function wRestoreErr(msg="", words=false){                 // Restore's error: the reason (role=alert), and for a rejected phrase the red border and aria-invalid; "" clears them all
  const r=$("w-restore"), m=$("w-restoremsg"); m.textContent=msg; m.hidden=!msg; r.style.borderColor=words?"#ff5c5c":"";
  if(words) r.setAttribute("aria-invalid","true"); else r.removeAttribute("aria-invalid"); }   // empty when hidden: the field's description (aria-describedby) never reads an old reason
$("w-restore").oninput=()=>wRestoreErr();                  // a rejected phrase's red border and its reason go once it is edited
function wFundNote(){ if(!WALLET) return;                                        // #w-ready, under the address: where its coins come from; a dialog waiting on funds (wWaiting): how much to send, the same figure in the QR, and while it waits with the balance known, why that much
  const wt=wWaiting(), short=wt&&walletUtxos ? Math.max(0, wt.outs().reduce((a,o)=>a+o.sats,0)+wt.fee()-walletSats()) : null, ask=wt&&short!==0?WFUND:0;   // short null: the balance is not known yet; 0: it holds enough now (Funds arrived comes next). ask: the sats the note and the QR ask for
  $("w-fundnote").textContent= ask ? `Send about ${fmt(ask)}\u00a0sats to this address${short&&ask>=short ? `: the ${fmt(short)} missing, plus ${walletUtxos.length&&ask-short>500?"the new coin's fee and ":""}a small margin` : ""}. Your ${wt.noun||"take"} is waiting.`   // WFUND: what is missing, the fee of the coin that lands (one more input to sign, none for a first coin: priced in), 500 sats for a fee that moves
    : walletIsLedger() ? "Burns spend from any address of this Ledger account; change comes back to this one. Reading the balance shows the explorer every address of the account: your own node (Data source) keeps them private." : "Fund it by sending sats to this address.";
  const uri="bitcoin:"+WALLET.addr+(ask?`?amount=${(ask/1e8).toFixed(8)}`:"");   // the QR says what the note says: an amount only while the note asks for one
  if($("w-qr")._uri!==uri) try{ const q=qrcode(0,"M"); q.addData(uri,"Byte"); q.make(); $("w-qr").src=q.createDataURL(4,4); $("w-qr")._uri=uri; }catch{}
}
["pointerenter","focus"].forEach(ev=>$("w-ledger").addEventListener(ev,()=>{ if(ledgerSupported()) ledgerLibs().catch(()=>{}); }));
$("w-ledger").onclick=async()=>{
  const b=$("w-ledger"), m=$("w-ledgermsg"); m.hidden=true; b.disabled=true; b.textContent="Connecting…";
  try{
    const r=await ledgerConnect(NET);
    WALLET={kind:"ledger", net:NET, addr:r.addr, xpub:r.xpub, fp:r.fp}; walletSave(); wKey=null; walletUtxos=null;
    const painted=walletPaint(true); $("w-copy").focus(); await painted; PAY.forEach(p=>p.paint());   // the Connect view is gone: focus lands on the new one, never on <body>
  }catch(e){ m.hidden=false; m.textContent=ledgerError(e).message; }
  b.disabled=!ledgerSupported(); b.textContent="Connect a Ledger";
};
async function walletInstall(words){
  const pass=$("w-pass1").value;
  const k=await walletDerive(words, pass, NET);
  WALLET={net:NET, enc:!!pass, data: pass? await encryptSecret(words, pass) : words, addr:k.address};
  walletSave(); wKey=k; wKey.words=words; walletUtxos=null; $("w-pass1").value=""; $("w-restore").value=""; wRestoreErr();   // the Restore card keeps no words and no old error
  const painted=walletPaint(true); $("w-copy").focus(); await painted; PAY.forEach(p=>p.paint());   // the Connect view is gone: focus lands on the new one (Create moves it to the words)
}
$("w-create").onclick=async()=>{ $("w-createmsg").hidden=true; $("w-create").disabled=true; $("w-create").textContent="Creating…"; try{ const {mnemonic}=await walletGenerate(); await walletInstall(mnemonic); $("w-backup").click(); $("w-wordshide").focus(); }catch(e){ $("w-createmsg").hidden=false; $("w-createmsg").textContent="Could not create the wallet: "+e.message; } $("w-create").disabled=false; $("w-create").textContent="Create wallet"; };
$("w-restoreok").onclick=async()=>{ const words=$("w-restore").value.trim().toLowerCase().split(/\s+/).join(" ");
  try{ if(!(await walletValidate(words))) return wRestoreErr("These words are not a valid 12 or 24-word phrase.",true); await walletInstall(words); $("w-restorebox").hidden=true; }
  catch(e){ wRestoreErr("Could not restore the wallet: "+e.message); } };   // the libraries not loading, a derive that fails: said, like Create
$("w-unlock").onclick=async()=>{ try{ await walletLoadKey($("w-pass2").value); $("w-lockmsg").hidden=true; $("w-pass2").value=""; await walletPaint(); PAY.forEach(p=>p.paint()); $("w-copy").focus(); }catch{ $("w-lockmsg").hidden=false; } };
$("w-pass2").onkeydown=e=>{ if(e.key==="Enter") $("w-unlock").click(); };
$("w-copy").onclick=()=>copyText(WALLET.addr,$("w-copy"));
$("w-refresh").onclick=async()=>{ walletUtxos=null; await walletPaint(); PAY.forEach(p=>p.paint()); };
$("w-backup").onclick=async()=>{
  if(walletIsLedger()) return;                                   // no words: the keys are on the device (the button is hidden)
  if(!wKey){ try{ await walletLoadKey(""); }catch{ return; } }
  $("w-words").innerHTML=wKey.words.split(" ").map(w=>`<li>${w}</li>`).join(""); $("w-backupbox").hidden=false; $("w-forgetbox").hidden=true; $("w-backupbox").scrollIntoView({block:"nearest"});
};
$("w-wordshide").onclick=()=>{ $("w-backupbox").hidden=true; $("w-words").innerHTML=""; $("w-backup").focus(); };   // back on the button that shows them, not on <body>
$("w-wordscopy").onclick=()=>copyText(wKey.words,$("w-wordscopy"));
const forgetUI=()=>{ const sec=$("w-ready").hidden?$("w-locked"):$("w-ready"); sec.querySelector(".dlgfoot").before($("w-forgetbox")); $("w-forgetbox").hidden=false;
  $("w-forgetnote").innerHTML= walletIsLedger() ? "This removes the Ledger from this browser. Its keys and sats stay on the device; connect it again any time. Type <b>FORGET</b> to confirm." : "This removes the wallet from this browser. Its sats stay on the chain, reachable only with the 12 words. Type <b>FORGET</b> to confirm."; $("w-backupbox").hidden=true; $("w-forgetinput").value=""; $("w-forgetok").disabled=true; $("w-forgetbox").scrollIntoView({block:"nearest"}); $("w-forgetinput").focus(); };
$("w-forget1").onclick=forgetUI;
$("w-forget2").onclick=forgetUI;
$("w-forgetinput").oninput=()=>{ $("w-forgetok").disabled=$("w-forgetinput").value!=="FORGET"; };
$("w-forgetcancel").onclick=()=>{ $("w-forgetbox").hidden=true; ($("w-ready").hidden?$("w-forget1"):$("w-forget2")).focus(); };   // back on the Forget wallet… that opened it
$("w-forgetinput").onkeydown=e=>{ if(e.key==="Enter"&&!$("w-forgetok").disabled) $("w-forgetok").click(); };
$("w-forgetok").onclick=()=>{ WALLET=null; wKey=null; walletUtxos=null; try{ localStorage.removeItem(NETKEY("bv.wallet")); }catch{} $("w-forgetbox").hidden=true; $("w-restore").value=""; wRestoreErr(); walletPaint(); PAY.forEach(p=>p.paint()); $("w-opts").querySelector("input:checked")?.focus(); };   // the Connect view, on the picked way; the Restore card empty
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
document.addEventListener("click",e=>{ const b=e.target.closest("[data-fund]"); if(!b) return; const [pre,n]=b.dataset.fund.split(":"); FUNDING=pre; WFUND=+n; WFUNDAT=walletUtxos; walletOpen(); });   // short of funds: the wallet opens with the amount in its QR
document.addEventListener("click",e=>{ if(!e.target.closest("[data-wretry]")) return; chainReset(); const p=walletBalance(true); PAY.forEach(x=>x.paint()); if($("walletdlg")?.open) $("w-balhint").textContent="checking…";   // the wallet's balance: another try, when the reader asks
  p.then(()=>{ walletPill(); PAY.forEach(x=>x.paint()); if($("walletdlg")?.open) walletPaint(); }); });
// ---------- the mining fee speed: Fast / Normal / Economy with their sat/vB, remembered on this network; every panel repaints with it ----------
const feeSegHtml=(id,note=false)=>`${note?`<div class="field feef"><label><span>Mining fee</span></label>`:""}<div class="seg feeseg" role="group" aria-label="Mining fee speed" id="${id}">${FEE_SPEEDS.map(([k,l])=>`<button type="button" data-fee="${k}" aria-pressed="false">${l}<span class="mono"></span></button>`).join("")}</div>${note?`</div><p class="note feenote">Mining fees go to Bitcoin miners, not to Burning Take.</p>`:""}`;   // note: an Advanced view's field, labeled like the tip's, then where the fee goes
function feeSegPaint(seg, off=false, sum=null, tip=null){ const r=feeRates(), sp=feeSpeed(); seg.querySelectorAll("[data-fee]").forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.fee===sp)); b.querySelector("span").textContent=`${r[b.dataset.fee]} sat/vB`; b.disabled=off; });
  const S=FEE_SPEEDS.find(x=>x[0]===sp)[1]; if(sum) sum.textContent= (tip==null ? `Advanced · mining fee · ${S} · ${r[sp]} sat/vB` : `Advanced · ${tip?`tip ${fmt(tip)}`:"no tip"} · ${S} mining fee`).replace(/ ·/g,"\u00a0·"); }   // sum: the <summary> of an edit view's Advanced; tip: the tip it also holds (null: none there); a wrap never starts a line with a "·"
const feeSegWire=seg=>{ seg.onclick=e=>{ const b=e.target.closest("[data-fee]"); if(!b||b.disabled) return; LS(NETKEY("bv.fee"),b.dataset.fee); PAY.forEach(p=>p.paint()); }; };
// ---------- short of funds, said where it matters (walletTab.funds): the take and the first views (fundsHtml), under a row of amount chips (capNoteHtml), the transaction step ----------
const fundsPart=([w,n,c])=>(c>1?`${fmt(n)} in ${c} ${w}s`:`${fmt(n)} ${w}`).replace(/ /g,"\u00a0");   // "330 burn", "1,330 in 2 burns": a part never breaks across lines
function fundsHtml(wt){ const f=wt.funds(); if(!f||!f.short) return "";   // what it needs, what the wallet holds, what is missing; Add funds: the wallet opens with the amount in its QR (data-fund)
  return `<div class="funds">${iconBadge("",ICONS.wallet)}<p><b>Your wallet is ${fmt(f.short)} sats short</b><span>It holds ${fmt(f.bal)} of the ${fmt(f.need)} sats needed: ${[...f.parts.map(fundsPart),`≈\u00a0${fmt(f.fee)}\u00a0mining\u00a0fee`].join("\u00a0+ ")}.</span></p><i class="fundsbar" aria-hidden="true"><i style="width:${(f.bal/f.need*100).toFixed(1)}%"></i></i><button type="button" class="efgo" data-fund="${wt.prefix}:${f.topup}"><span><b>Add funds</b></span></button></div>`; }
const fundsPaint=(host,wt,on=true)=>{ const h=on?fundsHtml(wt):""; if(host._h!==h){ host._h=h; host.innerHTML=h; } host.hidden=!h; };   // a view's callout host: rebuilt only when it changes (a focused Add funds keeps its focus)
function capNoteHtml(wt, f, noun, v, cap, lo, lead=true){     // under amount chips (amountChips): what fits with the rest of the transaction, or what is missing even at the lowest; lead: the dialog's first note, which says what the wallet holds
  const own=noun==="registration"?["registration","sponsorship"]:[noun];   // a registration's chip covers its sponsorship too (funds() splits them)
  const it=[...f.parts.filter(p=>!own.includes(p[0])).map(p=>"the "+fundsPart(p)), "the mining fee"], w=it.length>1?it.slice(0,-1).join(", ")+" and "+it[it.length-1]:it[0];   // no fee figure: the footer says the one the signers pay
  const add=` <button type="button" class="linkbtn" data-fund="${wt.prefix}:${f.topup+Math.max(0,lo-v)}">Add funds</button>`;   // enough for the lowest too, when the amount typed is under it
  return (lead?`Your wallet holds ${fmt(f.bal)} sats: with `:"With ")+`${w}, `+(cap>=lo ? `up to ${fmt(cap)} fits.${v>cap?add:""}` : lo ? `even ${fmt(lo)} is ${fmt(lo-cap)} short.${add}` : `it is about ${fmt(-cap)} short even without a ${noun}.${add}`); }   // about: that fee still prices this output
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
      <div id="${id("short")}" aria-live="polite" hidden></div>
      <div id="${id("result")}" aria-live="polite" hidden></div>
    </div></div>`;
  const $$=k=>$(id(k)); let last=null, status=null;   // status: null | {kind:"busy"} | {kind:"sent", txid} | {kind:"err", msg}
  const api={ update(p){ last=p; if(!status||status.kind!=="busy") status=null; }, onsent:null, chips:[] };   // onsent({txid, outputs, hex, from}): the page records what went out (pending burns for the receipt page; from: the burner, the first input's address); status.msg: the Ledger stage; chips: the amount chips this panel prices (amountChips), synced on every paint
  const calc=()=>{ const total=last.outputs.reduce((a,o)=>a+o.sats,0), outs=last.outputs.map(o=>({value:o.sats, script:fromHex(o.scriptHex)})), rate=feeRate(), coins=walletUtxos||[];
    let fee; try{ fee=ledgerFund({utxos:coins, outputs:outs, changeAddr:WALLET.addr, feeRate:rate}).fee; }   // what the signers pay: their own selection (ledgerFund is signP2wpkh's), coins in the wallet's order until the outputs and the fee are covered
    catch{ fee=Math.ceil(rate*walletVsize(Math.max(1,coins.length),[...outs.map(o=>o.script),new Uint8Array(22)])); }   // short of funds, or coins unknown: every coin in (one when none), the most it could take
    let mismatch=true; try{ mismatch=bech32Decode(last.outputs[0].addr).hrp!==HRP; }catch{} return {total, fee, bal:walletSats(), mismatch}; };
  const canSend=()=>{ if(walletState()!=="ready"||!last||!walletUtxos||(status&&status.kind!=="err")) return false; const c=calc(); return !c.mismatch && c.bal>=c.total+c.fee; };   // after an error the button stays live: open the Ledger app, plug it back in, try again
  const funds=()=>{ if(walletState()!=="ready"||!last||!walletUtxos||(status&&status.kind!=="err")) return null;   // the balance against this transaction, only when it is known and nothing is under way: never a guess
    const c=calc(); if(c.mismatch) return null;
    const scripts=[...last.outputs.map(o=>fromHex(o.scriptHex)),new Uint8Array(22)], feeAt=n=>Math.ceil(feeRate()*walletVsize(n,scripts));   // every coin in and a change, as calc() prices it when short: the fee at the most the wallet can pay (a dust change the signers leave to the miners is no fee to plan on)
    const fee=feeAt(Math.max(1,walletUtxos.length)), short=Math.max(0,c.total+c.fee-c.bal);   // short: the signers' own view (calc), so it agrees with canSend
    return {total:c.total, bal:c.bal, fee, need:c.total+fee, short, room:Math.max(-short,c.bal-c.total-fee), topup:c.total+feeAt(walletUtxos.length+1)-c.bal+500, parts:outParts(last.outputs,api.noun)}; };   // topup, what to send: the coin that lands is one more input to sign, and a margin for a fee that moves; parts: [word, sats, outputs], in output order
  const paint=()=>{
    const st=walletState(), sent=!!(status&&status.kind==="sent");
    root.closest(".pay")?.classList.toggle("sent",sent);   // sent: the txid and the receipt link stay, the rest goes (base.css)
    $$("none").hidden=st!=="none"; $$("locked").hidden=!(st==="locked"||st==="sealed"); $$("ready").hidden=st!=="ready";
    $$("result").hidden=!status||status.kind==="busy";
    if(status&&status.kind==="sent") $$("result").innerHTML=sentHtml(status, !!api.onsent);   // a receipt only where the page recorded a burn (not for a plain tip)
    else if(status&&status.kind==="err") $$("result").innerHTML=`<p class="note mono" style="margin:6px 0 0">${esc(status.msg)}</p>`;
    fundsPaint($$("short"), api);                            // short of funds: the callout (fundsHtml), empty in every other state
    if(st!=="ready") return;
    const r=feeRates(), sp=feeSpeed(); $$("rate").textContent=` · ${r[sp]} sat/vB`;
    if(speed) feeSegPaint($$("speed"), !!(status&&status.kind!=="err"));
    if(!last){ $$("total").textContent=$$("fee").textContent=$$("after").textContent="—"; $$("msg").textContent="Nothing to send yet."; return; }
    if(sent){ $$("msg").textContent=""; return; }
    const {total,fee,bal,mismatch}=calc();
    $$("total").textContent=fmt(total)+" sats"; $$("fee").textContent="≈ "+fmt(fee)+" sats"; $$("after").textContent=fmt(Math.max(0,bal-total-fee))+" sats";
    if(status&&status.kind==="busy"){ $$("msg").textContent=status.msg||"signing…"; return; }
    if(!walletUtxos){ $$("after").textContent="—"; $$("msg").innerHTML= WREADING ? "checking the balance…" : `<button type="button" class="linkbtn" data-wretry>retry</button> · the explorer did not answer · balance unknown`; return; }
    if(FUNDING===prefix&&!mismatch&&bal>=total+fee){ FUNDING=null; WFUND=0; if(root.closest("dialog")?.open) toast(`Funds arrived · your ${api.noun||"burn"} is ready to sign`); }   // the wallet caught up with the dialog waiting on it (noun: signMenu's, or the batch's); a dialog closed meanwhile: its ask goes without a word
    $$("msg").innerHTML = mismatch ? `This wallet is on ${NET}; this address is not. The transaction cannot relay.` : "";   // short of funds: the callout says it; all is well: nothing to say
  };
  const send=async()=>{
    if(!canSend()) return;
    const outputs=last.outputs.map(o=>({value:o.sats, script:fromHex(o.scriptHex)}));   // pinned: the step can change under a slow explorer
    status={kind:"busy", msg:walletIsLedger()?"checking the balance…":""}; PAY.forEach(p=>p.paint());   // a Ledger's fresh read is the whole account: say so, not "signing…"
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
      try{ api.onsent?.({txid:status.txid, outputs:last.outputs, hex:r.hex, from:r.from||WALLET.addr}); }catch{}   // from: a Ledger's burn can go out from another address of the account (ledgerSign), the burner wallet's always from its one
      walletUtxos=null; walletBalance().then(()=>{ walletPill(); PAY.forEach(p=>p.paint()); });   // coins spent: the change shows once the explorer sees it
    }catch(e){ status={kind:"err", msg:walletIsLedger()?ledgerError(e).message:e.message}; }
    PAY.forEach(p=>p.paint());
  };
  if(speed) feeSegWire($$("speed"));
  const fee=()=>last ? calc().fee : null;                     // coins unknown (no wallet yet, or the explorer has not answered): priced for one coin, exact once they load
  const need=()=>last ? calc().total+calc().fee+500 : 0;       // what to send the wallet for this burn: its outputs, the fee, a little margin
  return Object.assign(api, { paint:()=>{ paint(); api.chips.forEach(f=>f()); feeReady(); }, send, canSend, fee, need, funds, prefix, status:()=>status, outs:()=>last?last.outputs:[] });   // outs: the outputs it holds (the Connect dialog's waiting line and fund note read them)
}
// the dialogs' primary from the first step that can sign: "Sign take and…" opens Broadcast / Add to batch (batch null: no batch item).
// Broadcast walks the wallet (connect, unlock), brings up the Transaction step (show), where progress and errors show, then signs and sends; once sent the button is Done.
const CARET='<svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
function signMenu(btn, menu, wt, {label, noun="take", ok=true, show=()=>{}, batch=null, batchOff="", batchNote="", tx=null, done}){   // noun: what the dialog signs (take, answer, sponsorship, registration, tip); tx: bring up the transaction details (null: already there); batchOff: why Add to batch is greyed out ("": it works); batchNote: what it would do besides adding
  if(!btn._close){ btn._close=dropMenu(btn,menu); btn._toggle=btn.onclick; }       // the menu's toggle, outside click and Escape: wired once
  wt.noun=noun;                                                // said wherever the wallet is missing or short: the Connect dialog, its fund note, Funds arrived
  const st=walletState(), s=wt.status(), bc=menu.querySelector('[data-act="broadcast"]'), ba=menu.querySelector('[data-act="batch"]'), tt=menu.querySelector('[data-act="tx"]'); txLink(btn,s);
  if(s&&s.kind==="sent"){ btn._close(); btn.textContent="Done"; btn.disabled=false; btn.removeAttribute("aria-haspopup"); btn.onclick=done; return; }
  btn.setAttribute("aria-haspopup","menu"); btn.onclick=btn._toggle;
  if(s&&s.kind==="busy"){ btn._close(); btn.textContent=walletIsLedger()?"On the Ledger…":"Signing…"; btn.disabled=true; return; }
  btn.innerHTML=label+CARET; btn.disabled=!ok;
  const f=wt.funds(), short=f?f.short:0;                     // the balance known and short of it: Broadcast says so and leads to the funds
  bc.textContent= st==="none" ? `Broadcast · set up a wallet (your ${noun} is kept)` : st!=="ready" ? "Broadcast · unlock the wallet first" : short ? "Broadcast · add funds first" : (walletIsLedger() ? "Broadcast · confirm on the Ledger" : "Broadcast");   // the fee sits under the price (dlgPrice)
  bc.onclick=()=>{ btn._close(); if(st!=="ready"){ if(st==="none"){ FUNDING=wt.prefix; WFUND=wt.need(); WFUNDAT=null; } return walletOpen(); } show(); if(short){ FUNDING=wt.prefix; WFUND=f.topup; WFUNDAT=walletUtxos; return walletOpen(); } if(wt.canSend()) wt.send(); };   // no wallet yet, or short: the dialog stays open under the wallet's, the take kept
  ba.hidden=!batch; ba.setAttribute("aria-disabled",String(!!batchOff)); ba.textContent="Add to batch"+(batchOff?" · "+batchOff:batchNote?" · "+batchNote:""); ba.onclick=()=>{ if(batchOff) return; btn._close(); if(batch) batch(); };   // greyed out, still in the arrow walk: its reason is focused and read out ("…, unavailable")
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
  else if(st==="none"){ label="Connect a wallet"; act=()=>{ FUNDING=wt.prefix; WFUND=wt.need(); WFUNDAT=null; walletOpen(); }; }   // like signMenu's Broadcast: the dialog stays open under the wallet's, which says what it keeps
  else if(st==="locked"){ label="Unlock wallet"; act=walletOpen; }
  else if(st==="sealed"){ label="Open wallet"; act=walletOpen; }
  else if(walletIsLedger()){ label= s&&s.kind==="busy" ? "On the Ledger…" : "Sign on Ledger"; act=wt.send; off=!ok||!wt.canSend(); }
  else { label= s&&s.kind==="busy" ? "Signing…" : "Sign & broadcast"; act=wt.send; off=!ok||!wt.canSend(); }
  btn.textContent=label; btn.disabled=off; btn.onclick=act;
}
