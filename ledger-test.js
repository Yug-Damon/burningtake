// node ledger-test.js — loads parts/shared.js + qr.js + wallet.js + ledger.js as browser code; the Ledger transport and app are fakes (a fake device that signs with the BIP-84 test key).
"use strict";
const fs=require("fs"), path=require("path"), assert=require("assert");
const bip39=require("@scure/bip39"), {wordlist}=require("@scure/bip39/wordlists/english"), {HDKey}=require("@scure/bip32"), {secp256k1}=require("@noble/curves/secp256k1");
const {ripemd160:nobleRipemd}=require("@noble/hashes/ripemd160"), {sha256:nobleSha256}=require("@noble/hashes/sha256");

// ---------- load ----------
const src=["shared","qr","wallet","ledger"].map(f=>fs.readFileSync(path.join(__dirname,"parts",f+".js"),"utf8")).join("\n");
const names=["toHex","bech32","scriptPubKey","opReturnScript","txidOf","walletLibs","walletDerive","signP2wpkh",
  "ledgerLibs","ledgerSupported","ledgerError","ledgerAppInfo","ledgerCheckApp","ledgerFingerprint","ledgerAddress","ledgerConnect","ledgerFund","ledgerPsbt","ledgerSign","ledgerAccountPath","ledgerPathString","LEDGER_MODS"];
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
const nav={};                                                    // navigator: nav.hid set per test
const api=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch",
  src+"\nreturn {"+names.join(",")+"};")(doc, {}, {getItem:()=>null, setItem(){}}, ()=>({matches:false}), nav, ()=>{}, ()=>{ throw new Error("fetch not stubbed"); });
const {toHex,bech32,scriptPubKey,opReturnScript,txidOf,walletLibs,walletDerive,signP2wpkh,
  ledgerLibs,ledgerSupported,ledgerError,ledgerAppInfo,ledgerCheckApp,ledgerFingerprint,ledgerAddress,ledgerConnect,ledgerFund,ledgerPsbt,ledgerSign,ledgerAccountPath,ledgerPathString,LEDGER_MODS}=api;
walletLibs({bip39, wordlist, HDKey, secp:secp256k1});

// ---------- fixtures: the BIP-84 test vector ----------
const MN="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const seed=bip39.mnemonicToSeedSync(MN,"");
const TESTNET={public:0x043587cf, private:0x04358394};
const rootMain=HDKey.fromMasterSeed(seed), rootTest=HDKey.fromMasterSeed(seed,TESTNET);
const XPUB=rootMain.derive("m/84'/0'/0'").publicExtendedKey, TPUB=rootTest.derive("m/84'/1'/0'").publicExtendedKey;
const FP=rootMain.fingerprint.toString(16).padStart(8,"0");
const keyMain=rootMain.derive("m/84'/0'/0'/0/0"), keyTest=rootTest.derive("m/84'/1'/0'/0/0");
const ADDR_MAIN="bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";        // BIP-84 vector, first receive address
const H=b=>Buffer.from(b).toString("hex");
const rev=hex=>Buffer.from(hex,"hex").reverse();
const u32=n=>{ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; };
const u64=n=>{ const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vi=n=> n<0xfd ? Buffer.from([n]) : Buffer.from([0xfd,n&255,n>>8]);
const cat=(...a)=>Buffer.concat(a.map(x=>Buffer.from(x)));
const dsha=b=>Buffer.from(nobleSha256(nobleSha256(b)));

// ---------- independent parsers ----------
function readVar(b,p){ const x=b[p]; if(x<0xfd) return [x,p+1]; if(x===0xfd) return [b.readUInt16LE(p+1),p+3]; if(x===0xfe) return [b.readUInt32LE(p+1),p+5]; throw new Error("varint"); }
function parseLegacyTx(buf){                                     // unsigned tx: version, inputs, outputs, locktime; no witness
  const b=Buffer.from(buf); let p=0, n;
  const version=b.readUInt32LE(0); p=4; [n,p]=readVar(b,p); const inputs=[];
  for(let i=0;i<n;i++){ const txid=H(Buffer.from(b.subarray(p,p+32)).reverse()); p+=32; const vout=b.readUInt32LE(p); p+=4; let sl; [sl,p]=readVar(b,p); const scriptSig=b.subarray(p,p+sl); p+=sl; const sequence=b.readUInt32LE(p); p+=4; inputs.push({txid,vout,scriptSig,sequence}); }
  [n,p]=readVar(b,p); const outputs=[];
  for(let i=0;i<n;i++){ const value=Number(b.readBigUInt64LE(p)); p+=8; let sl; [sl,p]=readVar(b,p); outputs.push({value, script:Buffer.from(b.subarray(p,p+sl))}); p+=sl; }
  const locktime=b.readUInt32LE(p); p+=4; assert.strictEqual(p,b.length,"unsigned tx fully consumed");
  return {version,inputs,outputs,locktime};
}
function parsePsbt(buf){                                         // BIP-174 v0 -> {global:Map, inputs:[Map], outputs:[Map]} keyed by hex(type+keydata)
  const b=Buffer.from(buf); assert.strictEqual(H(b.subarray(0,5)),"70736274ff","magic"); let p=5;
  const map=()=>{ const m=new Map(); for(;;){ let kl; [kl,p]=readVar(b,p); if(kl===0) return m; const k=H(b.subarray(p,p+kl)); p+=kl; let vl; [vl,p]=readVar(b,p); m.set(k,Buffer.from(b.subarray(p,p+vl))); p+=vl; } };
  const global=map(); const tx=parseLegacyTx(global.get("00"));
  const inputs=tx.inputs.map(()=>map()), outputs=tx.outputs.map(()=>map());
  assert.strictEqual(p,b.length,"psbt fully consumed");
  return {global, tx, inputs, outputs};
}
function sighash143(tx,i,value,pubkey){
  const prevouts=cat(...tx.inputs.map(x=>cat(rev(x.txid),u32(x.vout)))), seqs=cat(...tx.inputs.map(x=>u32(x.sequence)));
  const outs=cat(...tx.outputs.map(o=>cat(u64(o.value),vi(o.script.length),o.script)));
  const scriptCode=cat([0x19,0x76,0xa9,0x14], nobleRipemd(nobleSha256(pubkey)), [0x88,0xac]);
  return dsha(cat(u32(tx.version), dsha(prevouts), dsha(seqs), rev(tx.inputs[i].txid), u32(tx.inputs[i].vout), scriptCode, u64(value), u32(tx.inputs[i].sequence), dsha(outs), u32(tx.locktime), u32(1)));
}
// ---------- the fake device: answers the two raw APDUs, and its "app" signs a PSBT like a Bitcoin app would (same key, same RFC6979 → same bytes as signP2wpkh) ----------
function fakeTransport({app="Bitcoin", version="2.2.3", fp=FP, sendError=null}={}){
  const t={closed:0, sent:[], async close(){ t.closed++; }, async send(cla,ins){ t.sent.push([cla,ins]); if(sendError) throw sendError;
    if(cla===0xb0&&ins===0x01) return Buffer.from([1, app.length, ...Buffer.from(app,"ascii"), version.length, ...Buffer.from(version,"ascii"), 0, 0x90,0x00]);
    if(cla===0xe1&&ins===0x05) return Buffer.from([...Buffer.from(fp,"hex"), 0x90,0x00]);
    throw Object.assign(new Error("Ledger device: INS_NOT_SUPPORTED (0x6d00)"),{name:"TransportStatusError", statusCode:0x6d00}); } };
  return t;
}
function fakeLibs({transport, signError=null, priv=keyMain.privateKey, pub=keyMain.publicKey, xpub=XPUB, log=[]}={}){
  class AppBtc{
    constructor({transport:tr}){ this.tr=tr; log.push("new AppBtc"); }
    async getWalletXpub({path,xpubVersion}){ log.push("getWalletXpub "+path+" "+xpubVersion.toString(16)); return xpub; }
    async signPsbtBuffer(buf, opts){
      log.push("signPsbtBuffer"); assert.ok(Buffer.isBuffer(buf),"psbt arrives as a Buffer");
      assert.deepStrictEqual(Object.keys(opts).sort(),["accountPath","addressFormat","finalizePsbt","knownAddressDerivations","onDeviceSignatureGranted"]);
      assert.strictEqual(opts.finalizePsbt,true); assert.strictEqual(opts.addressFormat,"bech32"); assert.ok(opts.knownAddressDerivations instanceof Map);
      if(signError) throw signError;
      opts.onDeviceSignatureGranted();
      const {tx,inputs}=parsePsbt(buf), wit=[];
      tx.inputs.forEach((inp,i)=>{
        const utxo=inputs[i].get("01"); const value=Number(utxo.readBigUInt64LE(0));
        const sig=cat(secp256k1.sign(sighash143(tx,i,value,pub),priv,{lowS:true}).toDERRawBytes(),[1]);
        wit.push(cat(vi(2),vi(sig.length),sig,vi(pub.length),pub));
      });
      const hex=H(cat(u32(tx.version),[0,1],vi(tx.inputs.length),...tx.inputs.map(x=>cat(rev(x.txid),u32(x.vout),vi(0),u32(x.sequence))),vi(tx.outputs.length),...tx.outputs.map(o=>cat(u64(o.value),vi(o.script.length),o.script)),...wit,u32(tx.locktime)));
      return {psbt:buf, tx:hex};
    }
  }
  return {TransportWebHID:{ async create(){ log.push("create"); if(transport instanceof Error) throw transport; return transport; } }, AppBtc, Buffer};
}
const UTXOS=[{txid:"aa".repeat(32), vout:1, value:60000, confirmed:true},{txid:"bb".repeat(32), vout:0, value:25000, confirmed:true},{txid:"cc".repeat(32), vout:3, value:400000, confirmed:false}];
const BURN="bc1qrz05qq6tu7senu06nzgkdrhr4dsyn7pd8rrghec0t9h2ktsc27msqvznj2";
const OUTS=[{value:21000, script:scriptPubKey(BURN)},{value:0, script:opReturnScript(new TextEncoder().encode("pineapple is a crime"))}];
const WALLET_MAIN={kind:"ledger", net:"mainnet", addr:ADDR_MAIN, xpub:XPUB, fp:FP};

// ---------- tests ----------
let n=0, failed=0;
async function test(name,fn){ n++; try{ await fn(); console.log(`ok ${n} - ${name}`); }catch(e){ failed++; console.log(`not ok ${n} - ${name}\n  ${e.stack.split("\n").slice(0,4).join("\n  ")}`); } }
(async()=>{
  await test("module list pins hw-transport-webhid 6.x, hw-app-btc 11.x and buffer on jsdelivr /+esm",()=>{
    assert.deepStrictEqual(LEDGER_MODS,["@ledgerhq/hw-transport-webhid@6.36.0/+esm","@ledgerhq/hw-app-btc@11.5.0/+esm","buffer@6.0.3/+esm"]);
  });
  await test("ledgerLibs: injected libs are memoised, the same promise is handed back",async()=>{
    const inj=fakeLibs({transport:fakeTransport()}); const a=await ledgerLibs(inj); assert.strictEqual(a,inj); assert.strictEqual(ledgerLibs(),ledgerLibs());
  });
  await test("ledgerSupported follows navigator.hid",()=>{ delete nav.hid; assert.strictEqual(ledgerSupported(),false); nav.hid={}; assert.strictEqual(ledgerSupported(),true); });
  await test("ledgerAddress: BIP-84 vector from the account xpub (m/84'/0'/0'/0/0), pubkey and path elements",async()=>{
    const a=await ledgerAddress(XPUB,"mainnet",0,0);
    assert.strictEqual(a.address,ADDR_MAIN); assert.strictEqual(H(a.pubkey),H(keyMain.publicKey));
    assert.deepStrictEqual(a.path,[0x80000054,0x80000000,0x80000000,0,0]); assert.strictEqual(a.pathString,"m/84'/0'/0'/0/0");
    const c=await ledgerAddress(XPUB,"mainnet",1,2); assert.strictEqual(c.address,bech32("bc",0,nobleRipemd(nobleSha256(rootMain.derive("m/84'/0'/0'/1/2").publicKey))));
  });
  await test("ledgerAddress: signet tpub -> tb1 address, coin type 1'",async()=>{
    const a=await ledgerAddress(TPUB,"signet",0,0);
    assert.strictEqual(a.address,bech32("tb",0,nobleRipemd(nobleSha256(keyTest.publicKey)))); assert.deepStrictEqual(a.path,[0x80000054,0x80000001,0x80000000,0,0]);
    assert.strictEqual(ledgerAccountPath("signet"),"m/84'/1'/0'"); assert.strictEqual(ledgerPathString("mainnet"),"m/84'/0'/0'/0/0");
  });
  await test("ledgerAddress refuses an xpub of the other network and a non-account key",async()=>{
    await assert.rejects(ledgerAddress(XPUB,"signet"),/Version|version/);
    await assert.rejects(ledgerAddress(rootMain.derive("m/84'/0'").publicExtendedKey,"mainnet"),/account-level/);
  });
  await test("ledgerError: every transport/app failure maps to one readable sentence with a code",()=>{
    const m=e=>{ const r=ledgerError(e); assert.ok(r.ledger&&r.code&&r.message,"shape"); return r; };
    assert.strictEqual(m({name:"TransportOpenUserCancelled",message:"No device selected."}).code,"cancelled");
    assert.strictEqual(m({name:"NotFoundError",message:"No device selected."}).code,"cancelled");
    assert.strictEqual(m({name:"TransportError",id:"HIDNotSupported",message:"navigator.hid is not supported"}).code,"nohid");
    assert.strictEqual(m({name:"TransportInterfaceNotAvailable",message:"x"}).code,"busy");
    assert.strictEqual(m({name:"DisconnectedDeviceDuringOperation",message:"x"}).code,"unplugged");
    assert.strictEqual(m({name:"LockedDeviceError",statusCode:0x5515,message:"Ledger device: Locked device (0x5515)"}).code,"locked");
    assert.strictEqual(m({name:"TransportStatusError",statusCode:0x6985,message:"Ledger device: Condition of use not satisfied (0x6985)"}).message,"Rejected on the Ledger.");
    for(const sc of [0x6e00,0x6e01,0x6d00,0x6d02,0x6511]) assert.strictEqual(m({name:"TransportStatusError",statusCode:sc,message:"x"}).code,"app");
    assert.strictEqual(m({name:"TransportStatusError",statusCode:0x6a80,message:"Ledger device: Incorrect data (0x6a80)"}).message,"The Ledger refused: Incorrect data (0x6a80)");
    assert.strictEqual(m({name:"TransportError",id:"NoDeviceFound",message:"No Ledger device found"}).code,"nodevice");
    assert.strictEqual(m({name:"TransportError",id:"ListenTimeout",message:"No Ledger device found (timeout)"}).code,"timeout");
    assert.strictEqual(m(new TypeError("Failed to fetch dynamically imported module: https://cdn…")).code,"libs");
    assert.strictEqual(m(new Error("something odd")).message,"something odd");
    const pre=Object.assign(new Error("already readable"),{ledger:true,code:"app"}); assert.strictEqual(ledgerError(pre),pre);
  });
  await test("ledgerAppInfo parses GET_APP_AND_VERSION; ledgerFingerprint parses GET_MASTER_FINGERPRINT",async()=>{
    const t=fakeTransport({app:"Bitcoin Test",version:"2.2.3"});
    assert.deepStrictEqual(await ledgerAppInfo(t),{name:"Bitcoin Test",version:"2.2.3"}); assert.deepStrictEqual(t.sent,[[0xb0,0x01]]);
    assert.strictEqual(await ledgerFingerprint(t),FP); assert.deepStrictEqual(t.sent[1],[0xe1,0x05]);
  });
  await test("ledgerCheckApp: dashboard, wrong network's app, Legacy app, old version -> told which app to open; right app passes",async()=>{
    const msg=async(opts,net)=>{ try{ await ledgerCheckApp(fakeTransport(opts),net); return null; }catch(e){ assert.strictEqual(e.code,"app"); return e.message; } };
    assert.strictEqual(await msg({app:"BOLOS",version:"1.6.0"},"mainnet"),"Open the Bitcoin app on the Ledger.");
    assert.strictEqual(await msg({app:"BOLOS",version:"1.6.0"},"signet"),"Open the Bitcoin Test app on the Ledger.");
    assert.match(await msg({app:"Bitcoin"},"signet"),/Bitcoin app is open; this page is on signet\. Open the Bitcoin Test app/);
    assert.match(await msg({app:"Bitcoin Test"},"mainnet"),/Open the Bitcoin app/);
    assert.match(await msg({app:"Bitcoin Legacy"},"mainnet"),/cannot sign a PSBT/);
    assert.match(await msg({app:"Bitcoin",version:"2.0.6"},"mainnet"),/Update the Bitcoin app to 2\.1 or newer/);
    assert.match(await msg({app:"Ethereum",version:"1.10.0"},"mainnet"),/Ethereum app is open/);
    assert.deepStrictEqual(await ledgerCheckApp(fakeTransport({app:"Bitcoin",version:"2.1.0"}),"mainnet"),{name:"Bitcoin",version:"2.1.0"});
    assert.deepStrictEqual(await ledgerCheckApp(fakeTransport({app:"Bitcoin Test",version:"3.0.1"}),"signet"),{name:"Bitcoin Test",version:"3.0.1"});
  });
  await test("ledgerFund: same coins, fee and change as signP2wpkh for the same inputs (dust change to the miners too)",async()=>{
    const k=await walletDerive(MN,"","mainnet"); assert.strictEqual(k.address,ADDR_MAIN);
    const f=ledgerFund({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1}), s=await signP2wpkh({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1, key:k});
    assert.strictEqual(f.inputs.length,1); assert.strictEqual(f.fee,s.fee); assert.strictEqual(f.change,s.change); assert.strictEqual(f.changeIndex,2); assert.strictEqual(f.vsize,s.vsize);
    assert.deepStrictEqual(f.outputs.map(o=>o.value),s.outputs.map(o=>o.value));
    const tight=[{txid:"dd".repeat(32), vout:0, value:21000+f.fee+100}];   // change < 330 sats: no change output, the rest is fee
    const f2=ledgerFund({utxos:tight, outputs:OUTS, changeAddr:ADDR_MAIN}), s2=await signP2wpkh({utxos:tight, outputs:OUTS, changeAddr:ADDR_MAIN, key:k});
    assert.strictEqual(f2.changeIndex,-1); assert.strictEqual(f2.change,0); assert.strictEqual(f2.fee,s2.fee); assert.strictEqual(f2.outputs.length,2);
    assert.throws(()=>ledgerFund({utxos:[{txid:"ee".repeat(32),vout:0,value:1000}], outputs:OUTS, changeAddr:ADDR_MAIN}),/insufficient funds/);
  });
  await test("ledgerPsbt: witness_utxo + BIP32 derivation on every input, derivation on the change output only",async()=>{
    const bip32={pubkey:keyMain.publicKey, fingerprint:Buffer.from(FP,"hex"), path:[0x80000054,0x80000000,0x80000000,0,0]};
    const f=ledgerFund({utxos:UTXOS.slice(0,2), outputs:OUTS, changeAddr:ADDR_MAIN});
    const inputs=f.inputs.map(u=>({txid:u.txid,vout:u.vout,value:u.value,script:scriptPubKey(ADDR_MAIN),bip32}));
    const {serializeUnsignedTxWithInputs}=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch",src+"\nreturn {serializeUnsignedTxWithInputs};")(doc,{}, {getItem:()=>null,setItem(){}},()=>({matches:false}),nav,()=>{},()=>{});
    const unsignedTxHex=serializeUnsignedTxWithInputs(inputs,f.outputs);
    const psbt=parsePsbt(ledgerPsbt({unsignedTxHex, inputs, outputs:f.outputs, changeIndex:f.changeIndex, changeBip32:bip32}));
    assert.strictEqual(psbt.global.size,1); assert.strictEqual(psbt.tx.inputs.length,1); assert.strictEqual(psbt.tx.outputs.length,3);
    const der=FP+"54000080"+"00000080"+"00000080"+"00000000"+"00000000";
    for(const m of psbt.inputs){ assert.deepStrictEqual([...m.keys()],["01","06"+H(keyMain.publicKey)]); assert.strictEqual(H(m.get("01")),H(cat(u64(60000),vi(22),scriptPubKey(ADDR_MAIN)))); assert.strictEqual(H(m.get("06"+H(keyMain.publicKey))),der); }
    assert.strictEqual(psbt.outputs[0].size,0); assert.strictEqual(psbt.outputs[1].size,0);
    assert.deepStrictEqual([...psbt.outputs[2].keys()],["02"+H(keyMain.publicKey)]); assert.strictEqual(H(psbt.outputs[2].get("02"+H(keyMain.publicKey))),der);
    const noChange=parsePsbt(ledgerPsbt({unsignedTxHex, inputs, outputs:f.outputs, changeIndex:-1, changeBip32:bip32})); assert.ok(noChange.outputs.every(m=>m.size===0));
  });
  await test("ledgerSign: the fake device signs the PSBT -> byte-identical transaction to signP2wpkh; stages, app check, transport closed",async()=>{
    const log=[], t=fakeTransport(); ledgerLibs(fakeLibs({transport:t, log})); nav.hid={};
    const stages=[];
    const r=await ledgerSign({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1, wallet:WALLET_MAIN, network:"mainnet", onstage:s=>stages.push(s)});
    const k=await walletDerive(MN,"","mainnet"), s=await signP2wpkh({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1, key:k});
    assert.strictEqual(r.hex,s.hex); assert.strictEqual(r.txid,s.txid); assert.strictEqual(r.txid,await txidOf(r.hex)); assert.strictEqual(r.fee,s.fee); assert.strictEqual(r.change,s.change);
    assert.ok(/^cHNidP8/.test(r.psbtBase64),"psbt base64 magic");
    assert.deepStrictEqual(stages,["preparing the transaction…","connecting to the Ledger…","confirm on the Ledger…","signing…"]);
    assert.deepStrictEqual(log,["create","new AppBtc","signPsbtBuffer"]); assert.deepStrictEqual(t.sent,[[0xb0,0x01]]); assert.strictEqual(t.closed,1);
  });
  await test("ledgerSign: knownAddressDerivations keyed by hash160(pubkey) hex -> {pubkey Buffer, path}",async()=>{
    let seen=null; const libs=fakeLibs({transport:fakeTransport()}); const orig=libs.AppBtc.prototype.signPsbtBuffer;
    libs.AppBtc.prototype.signPsbtBuffer=function(b,o){ seen=o; return orig.call(this,b,o); }; ledgerLibs(libs);
    await ledgerSign({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, wallet:WALLET_MAIN, network:"mainnet"});
    assert.strictEqual(seen.accountPath,"m/84'/0'/0'"); const e=seen.knownAddressDerivations.get(H(nobleRipemd(nobleSha256(keyMain.publicKey))));
    assert.ok(e&&Buffer.isBuffer(e.pubkey)); assert.strictEqual(H(e.pubkey),H(keyMain.publicKey)); assert.deepStrictEqual(e.path,[0x80000054,0x80000000,0x80000000,0,0]);
  });
  await test("ledgerSign: refusals are readable and the transport is closed (rejected on device, wrong app, unplugged, no wallet, mismatch, insufficient)",async()=>{
    const rej=async(args,libs,re,code)=>{ if(libs) ledgerLibs(libs); await assert.rejects(ledgerSign(args),e=>{ assert.ok(e.ledger,"ledger error"); assert.match(e.message,re); if(code) assert.strictEqual(e.code,code); return true; }); };
    const base={utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, wallet:WALLET_MAIN, network:"mainnet"};
    let t=fakeTransport(); await rej(base, fakeLibs({transport:t, signError:Object.assign(new Error("Ledger device: Condition of use not satisfied (0x6985)"),{name:"TransportStatusError",statusCode:0x6985})}), /^Rejected on the Ledger\.$/, "rejected"); assert.strictEqual(t.closed,1);
    t=fakeTransport({app:"BOLOS"}); await rej(base, fakeLibs({transport:t}), /Open the Bitcoin app on the Ledger/, "app"); assert.strictEqual(t.closed,1);
    t=fakeTransport({app:"Bitcoin"}); await rej({...base, network:"signet", wallet:{...WALLET_MAIN, net:"signet", xpub:TPUB, addr:(await ledgerAddress(TPUB,"signet")).address}}, fakeLibs({transport:t}), /Open the Bitcoin Test app/, "app");
    t=fakeTransport(); await rej(base, fakeLibs({transport:t, signError:Object.assign(new Error("x"),{name:"DisconnectedDeviceDuringOperation"})}), /unplugged/, "unplugged"); assert.strictEqual(t.closed,1);
    await rej(base, fakeLibs({transport:Object.assign(new Error("No device selected."),{name:"TransportOpenUserCancelled"})}), /No Ledger selected/, "cancelled");
    await rej({...base, wallet:null}, null, /No Ledger wallet/, "nowallet");
    await rej({...base, wallet:{...WALLET_MAIN, addr:"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"}}, fakeLibs({transport:fakeTransport()}), /does not match this Ledger account/, "mismatch");
    await rej({...base, utxos:[{txid:"ee".repeat(32),vout:0,value:1000}]}, fakeLibs({transport:fakeTransport()}), /insufficient funds/);
  });
  await test("ledgerConnect: app check, fingerprint, account xpub (xpub version per network) -> first receive address; nohid / cancel errors",async()=>{
    const log=[], t=fakeTransport(); ledgerLibs(fakeLibs({transport:t, log})); nav.hid={};
    const r=await ledgerConnect("mainnet");
    assert.deepStrictEqual(r,{addr:ADDR_MAIN, xpub:XPUB, fp:FP, path:"m/84'/0'/0'/0/0", app:{name:"Bitcoin",version:"2.2.3"}});
    assert.deepStrictEqual(log,["create","new AppBtc","getWalletXpub 84'/0'/0' 488b21e"]); assert.deepStrictEqual(t.sent,[[0xb0,0x01],[0xe1,0x05]]); assert.strictEqual(t.closed,1);
    const t2=fakeTransport({app:"Bitcoin Test"}), log2=[]; ledgerLibs(fakeLibs({transport:t2, xpub:TPUB, log:log2}));
    const r2=await ledgerConnect("signet"); assert.strictEqual(r2.addr,(await ledgerAddress(TPUB,"signet")).address); assert.strictEqual(log2[2],"getWalletXpub 84'/1'/0' 43587cf");
    delete nav.hid; await assert.rejects(ledgerConnect("mainnet"),e=>e.code==="nohid"&&/WebHID/.test(e.message)); nav.hid={};
    ledgerLibs(fakeLibs({transport:Object.assign(new Error("Access denied to use Ledger device"),{name:"TransportOpenUserCancelled"})}));
    await assert.rejects(ledgerConnect("mainnet"),e=>e.code==="cancelled");
    const t3=fakeTransport({app:"BOLOS"}); ledgerLibs(fakeLibs({transport:t3})); await assert.rejects(ledgerConnect("mainnet"),e=>e.code==="app"); assert.strictEqual(t3.closed,1);
  });
  console.log(`\n${n-failed}/${n} passed`); process.exit(failed?1:0);
})();
