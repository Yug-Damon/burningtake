// ---------- ledger.js: a Ledger over WebHID — BIP-84 account xpub read once, every burn signed on the device (PSBT). No DOM ----------
// Uses from shared.js / qr.js / wallet.js: toHex, fromHex, varint, le64, bech32, scriptPubKey, concatBytes, psbtKV, psbtBase64, txidOf,
// serializeUnsignedTxWithInputs, walletLibs (HDKey), walletNet, walletVsize, hash160. Defines nothing twice.
// The Ledger libraries are ESM, loaded lazily from jsdelivr on the first call that needs them; the node test injects fakes instead.
// Wallet record (walletui.js, NETKEY("bv.wallet")): {kind:"ledger", net, addr, xpub, fp} — no words, nothing secret, nothing to encrypt.
// hw-app-btc 11.x API (README, lib-es/BtcNew.js): getWalletXpub({path, xpubVersion}) and signPsbtBuffer(Buffer, {finalizePsbt, accountPath,
// addressFormat, knownAddressDerivations}) -> {psbt, tx}. The device needs the Bitcoin app 2.1+ (Bitcoin Test on signet); the Legacy apps cannot sign a PSBT.

// ---------- libraries ----------
const LEDGER_CDN="https://cdn.jsdelivr.net/npm/";
const LEDGER_MODS=["@ledgerhq/hw-transport-webhid@6.36.0/+esm","@ledgerhq/hw-app-btc@11.5.0/+esm","buffer@6.0.3/+esm"];   // buffer: hw-app-btc reads PSBTs through Buffer methods (readUInt8…), a plain Uint8Array has none
let ledgerLibsP=null;
function ledgerLibs(injected){                                   // -> Promise<{TransportWebHID, AppBtc, Buffer}>; memoised; a failed load is retried on the next call
  if(injected) ledgerLibsP=Promise.resolve(injected);
  if(!ledgerLibsP) ledgerLibsP=Promise.all(LEDGER_MODS.map(m=>import(LEDGER_CDN+m)))
    .then(([hid,btc,buf])=>({TransportWebHID:hid.default, AppBtc:btc.default, Buffer:buf.Buffer}))
    .catch(e=>{ ledgerLibsP=null; throw e; });
  return ledgerLibsP;
}
const ledgerSupported=()=> typeof navigator!=="undefined" && !!navigator.hid;   // WebHID: Chrome, Edge, Brave, Opera on a desktop. Not Safari, not Firefox, not phones.

// ---------- constants ----------
const LEDGER_XPUBVER={mainnet:{public:0x0488b21e, private:0x0488ade4}, signet:{public:0x043587cf, private:0x04358394}};   // xpub / tpub (signet, testnet share)
const LEDGER_APP={mainnet:"Bitcoin", signet:"Bitcoin Test"};       // the app that must be open on the device for this network
const LEDGER_MIN_APP=[2,1,0];                                     // signPsbtBuffer needs the new APDU protocol (app-bitcoin-new ≥ 2.1.0)
const ledgerCoin=network=>walletNet(network).coin;
const ledgerAccountPath=network=>`m/84'/${ledgerCoin(network)}'/0'`;
const ledgerPathElements=(network,change=0,index=0)=>[0x80000000+84, 0x80000000+ledgerCoin(network), 0x80000000, change, index];
const ledgerPathString=(network,change=0,index=0)=>`m/84'/${ledgerCoin(network)}'/0'/${change}/${index}`;

// ---------- errors: whatever the transport or the app throws -> one readable sentence, with a .code the UI can branch on ----------
function ledgerError(e){
  if(e&&e.ledger) return e;
  const mk=(msg,code)=>Object.assign(new Error(msg),{ledger:true, code, cause:e});
  const name=(e&&e.name)||"", id=(e&&e.id)||"", msg=(e&&e.message)||String(e||""), sc=e&&typeof e.statusCode==="number" ? e.statusCode : -1;
  if(id==="HIDNotSupported"||name==="TypeError"&&/navigator\.hid|requestDevice/.test(msg)) return mk("This browser has no WebHID. Use Chrome, Edge or Brave on a desktop.","nohid");
  if(name==="TransportOpenUserCancelled"||name==="NotFoundError"||/No device selected|Access denied/i.test(msg)) return mk("No Ledger selected. Plug it in, unlock it, and pick it in the browser prompt.","cancelled");
  if(name==="TransportInterfaceNotAvailable"||/Failed to open the device|already open|claimInterface|InvalidStateError/i.test(msg)||name==="InvalidStateError") return mk("The Ledger is in use by another app (Ledger Live?). Close it and try again.","busy");
  if(/^DisconnectedDevice/.test(name)||name==="NetworkError"||/disconnected|NotAllowedError: Failed to write/i.test(msg)) return mk("The Ledger was unplugged.","unplugged");
  if(name==="LockedDeviceError"||sc===0x5515) return mk("The Ledger is locked. Enter its PIN and try again.","locked");
  if(sc===0x6985) return mk("Rejected on the Ledger.","rejected");
  if(sc===0x6e00||sc===0x6e01||sc===0x6d00||sc===0x6d02||sc===0x6511||sc===0x6faa) return mk("Open the Bitcoin app on the Ledger.","app");
  if(name==="TransportStatusError") return mk("The Ledger refused: "+msg.replace(/^Ledger device: /,""),"status");
  if(id==="ListenTimeout"||/timeout/i.test(msg)) return mk("The Ledger did not answer in time. Unlock it and try again.","timeout");
  if(id==="NoDeviceFound"||/No Ledger device found/i.test(msg)) return mk("No Ledger found. Plug it in and unlock it.","nodevice");
  if(name==="TypeError"&&/import|module|fetch|Failed to fetch|Load failed/i.test(msg)) return mk("Could not load the Ledger libraries (offline? cdn.jsdelivr.net blocked?).","libs");
  return mk(msg||"Ledger error","unknown");
}

// ---------- the device ----------
const ledgerAscii=b=>{ let s=""; for(const c of b) s+=String.fromCharCode(c); return s; };
async function ledgerAppInfo(transport){                         // BOLOS GET_APP_AND_VERSION (CLA b0 INS 01) -> {name, version}; "BOLOS" = the dashboard, no app open
  const r=await transport.send(0xb0,0x01,0x00,0x00);
  if(!r||r.length<5||r[0]!==1) throw ledgerError(Object.assign(new Error("unexpected answer from the device"),{code:"app"}));
  let p=1; const nl=r[p++], name=ledgerAscii(r.subarray(p,p+nl)); p+=nl; const vl=r[p++], version=ledgerAscii(r.subarray(p,p+vl));
  return {name, version};
}
const ledgerVersionOk=v=>{ const a=String(v).split(".").map(x=>parseInt(x,10)||0); for(let i=0;i<3;i++){ if((a[i]||0)>LEDGER_MIN_APP[i]) return true; if((a[i]||0)<LEDGER_MIN_APP[i]) return false; } return true; };
async function ledgerCheckApp(transport, network="mainnet"){     // -> {name, version} of the open app, or throws a readable error telling which app to open
  const want=LEDGER_APP[network]||LEDGER_APP.signet, other=network==="mainnet"?LEDGER_APP.signet:LEDGER_APP.mainnet;
  const app=await ledgerAppInfo(transport);
  const fail=m=>{ throw Object.assign(new Error(m),{ledger:true, code:"app", app}); };
  if(app.name==="BOLOS") fail(`Open the ${want} app on the Ledger.`);
  if(app.name===other) fail(`The ${other} app is open; this page is on ${network}. Open the ${want} app on the Ledger.`);
  if(/Legacy$/.test(app.name)) fail(`The ${app.name} app cannot sign a PSBT. Open the ${want} app (2.1 or newer) instead.`);
  if(app.name!==want) fail(`Open the ${want} app on the Ledger (the ${app.name} app is open).`);
  if(!ledgerVersionOk(app.version)) fail(`Update the ${want} app to 2.1 or newer (the device runs ${app.version}).`);
  return app;
}
async function ledgerFingerprint(transport){                     // app-bitcoin-new GET_MASTER_FINGERPRINT (CLA e1 INS 05, protocol 1) -> hex of 4 bytes
  const r=await transport.send(0xe1,0x05,0x00,0x01);
  if(!r||r.length<6) throw ledgerError(new Error("no fingerprint from the device"));
  return toHex(r.subarray(0,4));
}
async function ledgerAddress(xpub, network="mainnet", change=0, index=0){   // local derivation from the account xpub -> {address, pubkey(33), path:number[], pathString}
  const {HDKey}=await walletLibs();
  const hd=HDKey.fromExtendedKey(String(xpub).trim(), LEDGER_XPUBVER[network]||LEDGER_XPUBVER.signet);
  if(hd.depth!==3) throw new Error("not an account-level xpub (depth "+hd.depth+")");
  const k=hd.deriveChild(change).deriveChild(index);
  return {address:bech32(walletNet(network).hrp,0,await hash160(k.publicKey)), pubkey:k.publicKey, path:ledgerPathElements(network,change,index), pathString:ledgerPathString(network,change,index)};
}
async function ledgerConnect(network="mainnet"){                 // MUST run from a click (the browser's device prompt). -> {addr, xpub, fp, path, app}
  if(!ledgerSupported()) throw ledgerError(Object.assign(new Error("navigator.hid is not supported"),{id:"HIDNotSupported"}));
  let libs; try{ libs=await ledgerLibs(); }catch(e){ throw ledgerError(Object.assign(new Error("Could not load the Ledger libraries (offline? cdn.jsdelivr.net blocked?)."),{ledger:true, code:"libs", cause:e})); }
  let transport=null;
  try{
    transport=await libs.TransportWebHID.create();
    const app=await ledgerCheckApp(transport, network);
    const fp=await ledgerFingerprint(transport);
    const btc=new libs.AppBtc({transport, currency:"bitcoin"});
    const xpub=await btc.getWalletXpub({path:`84'/${ledgerCoin(network)}'/0'`, xpubVersion:(LEDGER_XPUBVER[network]||LEDGER_XPUBVER.signet).public});
    const a=await ledgerAddress(xpub, network, 0, 0);
    return {addr:a.address, xpub, fp, path:a.pathString, app};
  }catch(e){ throw ledgerError(e); }
  finally{ if(transport) try{ await transport.close(); }catch{} }
}

// ---------- PSBT with derivations: what the Ledger needs to recognise its own inputs and the change ----------
function ledgerFund({utxos=[], outputs=[], changeAddr, feeRate=1}){   // same selection as signP2wpkh (wallet.js): coins in the given order, change ≥ 330 sats or it goes to the miners
  const changeScript=scriptPubKey(changeAddr), outSum=outputs.reduce((a,o)=>a+o.value,0), sel=[];
  let total=0, fee=0, funded=false;
  for(const u of utxos){
    sel.push(u); total+=u.value;
    fee=Math.ceil(feeRate*walletVsize(sel.length,[...outputs.map(o=>o.script),changeScript]));
    if(total>=outSum+fee){ funded=true; break; }
  }
  if(!funded) throw new Error("insufficient funds");
  let change=total-outSum-fee;
  const outs=outputs.map(o=>({value:o.value, script:o.script}));
  let changeIndex=-1;
  if(change>=330){ changeIndex=outs.length; outs.push({value:change, script:changeScript}); }
  else { fee=total-outSum; change=0; }
  return {inputs:sel, outputs:outs, fee, change, changeIndex, vsize:walletVsize(sel.length,outs.map(o=>o.script))};
}
function ledgerPsbt({unsignedTxHex, inputs=[], outputs=[], changeIndex=-1, changeBip32=null}){   // BIP-174 v0: witness_utxo + PSBT_IN_BIP32_DERIVATION per input, PSBT_OUT_BIP32_DERIVATION on the change
  const der=b=>{ const v=[...b.fingerprint]; for(const i of b.path) v.push(i&255,(i>>8)&255,(i>>16)&255,(i>>>24)&255); return v; };
  const parts=[[0x70,0x73,0x62,0x74,0xff], psbtKV(0x00,[],fromHex(unsignedTxHex)), [0x00]];
  for(const inp of inputs){
    parts.push(psbtKV(0x01,[],concatBytes([le64(inp.value),varint(inp.script.length),inp.script])));
    if(inp.bip32) parts.push(psbtKV(0x06,inp.bip32.pubkey,der(inp.bip32)));
    parts.push([0x00]);
  }
  outputs.forEach((o,i)=>{ if(i===changeIndex&&changeBip32) parts.push(psbtKV(0x02,changeBip32.pubkey,der(changeBip32))); parts.push([0x00]); });
  return concatBytes(parts);
}
async function ledgerSign({utxos=[], outputs=[], changeAddr, feeRate=1, wallet, network="mainnet", onstage=()=>{}}){   // -> {hex, txid, fee, change, vsize, inputs, outputs, psbtBase64}
  const stage=s=>{ try{ onstage(s); }catch{} };
  if(!wallet||wallet.kind!=="ledger"||!wallet.xpub||!/^[0-9a-f]{8}$/i.test(wallet.fp||"")) throw ledgerError(Object.assign(new Error("No Ledger wallet in this browser."),{ledger:true, code:"nowallet"}));
  stage("preparing the transaction…");
  let libs; try{ libs=await ledgerLibs(); }catch(e){ throw ledgerError(Object.assign(new Error("Could not load the Ledger libraries (offline? cdn.jsdelivr.net blocked?)."),{ledger:true, code:"libs", cause:e})); }
  const key=await ledgerAddress(wallet.xpub, network, 0, 0);
  if(key.address!==wallet.addr) throw ledgerError(Object.assign(new Error("The stored address does not match this Ledger account. Forget the wallet and connect it again."),{ledger:true, code:"mismatch"}));
  let f; try{ f=ledgerFund({utxos, outputs, changeAddr, feeRate}); }catch(e){ throw ledgerError(e); }
  const bip32={pubkey:key.pubkey, fingerprint:fromHex(wallet.fp), path:key.path}, inScript=scriptPubKey(wallet.addr);
  const inputs=f.inputs.map(u=>({txid:u.txid, vout:u.vout, value:u.value, script:inScript, bip32}));
  const unsignedTxHex=serializeUnsignedTxWithInputs(inputs, f.outputs);
  const psbt=ledgerPsbt({unsignedTxHex, inputs, outputs:f.outputs, changeIndex:f.changeIndex, changeBip32: changeAddr===wallet.addr ? bip32 : null});
  let transport=null;
  try{
    stage("connecting to the Ledger…");
    transport=await libs.TransportWebHID.create();
    await ledgerCheckApp(transport, network);
    const btc=new libs.AppBtc({transport, currency:"bitcoin"});
    const known=new Map([[toHex(await hash160(key.pubkey)), {pubkey:libs.Buffer.from(key.pubkey), path:key.path}]]);   // belt and braces: the PSBT already carries the derivations
    stage("confirm on the Ledger…");
    const r=await btc.signPsbtBuffer(libs.Buffer.from(psbt), {finalizePsbt:true, accountPath:ledgerAccountPath(network), addressFormat:"bech32", knownAddressDerivations:known, onDeviceSignatureGranted:()=>stage("signing…")});
    const hex=String((r&&r.tx)||"").toLowerCase();
    if(!/^[0-9a-f]{20,}$/.test(hex)) throw Object.assign(new Error("The Ledger returned no transaction."),{ledger:true, code:"notx"});
    return {hex, txid:await txidOf(hex), fee:f.fee, change:f.change, vsize:f.vsize, inputs:f.inputs, outputs:f.outputs, psbtBase64:psbtBase64(psbt)};
  }catch(e){ throw ledgerError(e); }
  finally{ if(transport) try{ await transport.close(); }catch{} }
}
