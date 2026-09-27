// node ledger-test.js — loads parts/shared.js + qr.js + wallet.js + ledger.js as browser code; the Ledger transport and app are fakes (a fake device that signs with the BIP-84 test key), the explorer too (fetch).
// The last section loads walletui.js on top of them on a stub page (every element made on first use), for the wiring: the balance read, the fee, the burner handed to the page.
"use strict";
const fs=require("fs"), path=require("path"), assert=require("assert");
const bip39=require("@scure/bip39"), {wordlist}=require("@scure/bip39/wordlists/english"), {HDKey}=require("@scure/bip32"), {secp256k1}=require("@noble/curves/secp256k1");
const {ripemd160:nobleRipemd}=require("@noble/hashes/ripemd160"), {sha256:nobleSha256}=require("@noble/hashes/sha256");
const REJ=[]; process.on("unhandledRejection",r=>REJ.push(String(r&&r.message||r)));   // a rejection nobody handles: collected, the last test says there was none

// ---------- load ----------
const read=f=>fs.readFileSync(path.join(__dirname,"parts",f+".js"),"utf8");
const src=["shared","qr","wallet","ledger"].map(read).join("\n");
const names=["toHex","bech32","scriptPubKey","opReturnScript","txidOf","walletLibs","walletDerive","walletVsize","signP2wpkh","fetchUtxos",
  "ledgerLibs","ledgerSupported","ledgerError","ledgerAppInfo","ledgerCheckApp","ledgerFingerprint","ledgerAddress","ledgerUtxos","ledgerConnect","ledgerFund","ledgerPsbt","ledgerSign","ledgerAccountPath","ledgerPathString","LEDGER_MODS","LEDGER_CAP"];
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
const nav={};                                                    // navigator: nav.hid set per test
let fetchImpl=()=>{ throw new Error("fetch not stubbed"); };     // the explorer: set per test (fakeExplorer)
const WAITS=[];                                                  // every pause the code asks for (sleep: esploraGet's backoff), logged and run at once
const fastTimeout=(f,ms,...a)=>{ WAITS.push(ms); return setTimeout(f,0,...a); };
const api=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch","setTimeout",
  src+"\nreturn {"+names.join(",")+"};")(doc, {}, {getItem:()=>null, setItem(){}}, ()=>({matches:false}), nav, ()=>{}, (...a)=>fetchImpl(...a), fastTimeout);
const {toHex,bech32,scriptPubKey,opReturnScript,txidOf,walletLibs,walletDerive,walletVsize,signP2wpkh,fetchUtxos,
  ledgerLibs,ledgerSupported,ledgerError,ledgerAppInfo,ledgerCheckApp,ledgerFingerprint,ledgerAddress,ledgerUtxos,ledgerConnect,ledgerFund,ledgerPsbt,ledgerSign,ledgerAccountPath,ledgerPathString,LEDGER_MODS,LEDGER_CAP}=api;
const LIBS={bip39, wordlist, HDKey, secp:secp256k1};
walletLibs(LIBS);

// ---------- fixtures: the BIP-84 test vector ----------
const MN="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const seed=bip39.mnemonicToSeedSync(MN,"");
const TESTNET={public:0x043587cf, private:0x04358394};
const rootMain=HDKey.fromMasterSeed(seed), rootTest=HDKey.fromMasterSeed(seed,TESTNET);
const XPUB=rootMain.derive("m/84'/0'/0'").publicExtendedKey, TPUB=rootTest.derive("m/84'/1'/0'").publicExtendedKey;
const FP=rootMain.fingerprint.toString(16).padStart(8,"0");
const keyMain=rootMain.derive("m/84'/0'/0'/0/0"), keyTest=rootTest.derive("m/84'/1'/0'/0/0");
const ADDR_MAIN="bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";        // BIP-84 vector, first receive address
const ACCT=rootMain.derive("m/84'/0'/0'"), pubAt=(c,i)=>ACCT.deriveChild(c).deriveChild(i).publicKey;   // the account's keys, derived here (not by ledger.js)
const addrAt=(c,i)=>bech32("bc",0,nobleRipemd(nobleSha256(pubAt(c,i))));
const ACCT_B=rootMain.derive("m/84'/0'/1'"), XPUB_B=ACCT_B.publicExtendedKey;   // account 1 of the same seed: another Ledger, for the wallet switch
const addrB=(c,i)=>bech32("bc",0,nobleRipemd(nobleSha256(ACCT_B.deriveChild(c).deriveChild(i).publicKey)));
const AT=new Map(); for(const c of [0,1]) for(let i=0;i<60;i++){ AT.set(addrAt(c,i),c+"/"+i); AT.set(addrB(c,i),"b"+c+"/"+i); }   // address -> "chain/index" ("b…": account 1), what the fake explorer logs
const H=b=>Buffer.from(b).toString("hex");
const rev=hex=>Buffer.from(hex,"hex").reverse();
const u32=n=>{ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; };
const u64=n=>{ const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vi=n=> n<0xfd ? Buffer.from([n]) : Buffer.from([0xfd,n&255,n>>8]);
const cat=(...a)=>Buffer.concat(a.map(x=>Buffer.from(x)));
const dsha=b=>Buffer.from(nobleSha256(nobleSha256(b)));
const tick=(ms=2)=>new Promise(r=>setTimeout(r,ms));

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
function parseSigned(hex){                                       // segwit tx -> {tx: the unsigned part (parseLegacyTx), wit: [[stack items]] per input}
  const b=Buffer.from(hex,"hex"); assert.deepStrictEqual([b[4],b[5]],[0,1],"segwit marker+flag"); let p=6, n, l;
  [n,p]=readVar(b,p); const nIn=n; for(let i=0;i<nIn;i++){ p+=36; [l,p]=readVar(b,p); p+=l+4; }
  [n,p]=readVar(b,p); for(let i=0;i<n;i++){ p+=8; [l,p]=readVar(b,p); p+=l; }
  const end=p, wit=[]; for(let i=0;i<nIn;i++){ const items=[]; [n,p]=readVar(b,p); for(let j=0;j<n;j++){ [l,p]=readVar(b,p); items.push(Buffer.from(b.subarray(p,p+l))); p+=l; } wit.push(items); }
  assert.strictEqual(p+4,b.length,"signed tx fully consumed");
  return {tx:parseLegacyTx(Buffer.concat([b.subarray(0,4),b.subarray(6,end),b.subarray(p)])), wit};
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
function deviceKey(m){                                          // what the device does for its own input: the key at the input's PSBT derivation, refused unless fingerprint, pubkey and the coin's script all match that path
  const ks=[...m.keys()].filter(k=>k.startsWith("06")); assert.strictEqual(ks.length,1,"one BIP32 derivation per input");
  const d=m.get(ks[0]), pub=ks[0].slice(2), path="m"+[...Array((d.length-4)/4).keys()].map(j=>{ const v=d.readUInt32LE(4+4*j); return v>=0x80000000?`/${v-0x80000000}'`:`/${v}`; }).join("");
  assert.strictEqual(H(d.subarray(0,4)),FP,"master fingerprint"); assert.match(path,/^m\/84'\/0'\/0'\/[01]\/\d+$/,"on the account's receive or change chain");
  const k=rootMain.derive(path); assert.strictEqual(H(k.publicKey),pub,"the pubkey at "+path);
  assert.strictEqual(H(m.get("01").subarray(9)),"0014"+H(nobleRipemd(nobleSha256(k.publicKey))),"the coin pays the key at "+path);
  return {priv:k.privateKey, pub:k.publicKey};
}
function fakeLibs({transport, signError=null, priv=keyMain.privateKey, pub=keyMain.publicKey, xpub=XPUB, log=[], byPath=false}={}){   // byPath: each input signed with the key at its own derivation (deviceKey), not one fixed key
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
        const utxo=inputs[i].get("01"); const value=Number(utxo.readBigUInt64LE(0)), k=byPath?deviceKey(inputs[i]):{priv, pub};
        const sig=cat(secp256k1.sign(sighash143(tx,i,value,k.pub),k.priv,{lowS:true}).toDERRawBytes(),[1]);
        wit.push(cat(vi(2),vi(sig.length),sig,vi(k.pub.length),k.pub));
      });
      const hex=H(cat(u32(tx.version),[0,1],vi(tx.inputs.length),...tx.inputs.map(x=>cat(rev(x.txid),u32(x.vout),vi(0),u32(x.sequence))),vi(tx.outputs.length),...tx.outputs.map(o=>cat(u64(o.value),vi(o.script.length),o.script)),...wit,u32(tx.locktime)));
      return {psbt:buf, tx:hex};
    }
  }
  return {TransportWebHID:{ async create(){ log.push("create"); if(transport instanceof Error) throw transport; return transport; } }, AppBtc, Buffer};
}
// ---------- the fake explorer (Esplora on mempool.space): /address/<a> stats and /address/<a>/utxo for this account, answered a moment later; logs every address request ("addr 0/5", "utxo 1/3", "addr b0/0") and the most in flight ----------
// The page's other reads (fee estimates, the price) are answered and not logged; a POST (broadcastTx) is logged in .posts and answered by post(hex).
function fakeExplorer(acct, {fail=()=>null, delay=()=>1, post=null}={}){   // acct: {"chain/index": {tx, funded, spent, mtx, mfunded, mspent, utxos:[{txid, vout, value, confirmed}]}}, no entry: never used; fail(req) -> a response maker for that request
  const e={log:[], live:0, max:0, posts:[]}, st=(tx=0,funded=0,spent=0)=>({funded_txo_count:funded?1:0, funded_txo_sum:funded, spent_txo_count:spent?1:0, spent_txo_sum:spent, tx_count:tx});
  fetchImpl=async(url,opts={})=>{
    if(opts.method==="POST"){ e.posts.push(opts.body); return post ? post(opts.body) : {ok:false, status:400, text:async()=>"no broadcast in this test"}; }
    if(/\/fee-estimates$/.test(url)) return {ok:true, status:200, json:async()=>({"1":25,"6":20,"144":10})};   // Normal: 20 sat/vB
    if(/\/v1\/prices$/.test(url)) return {ok:true, status:200, json:async()=>({USD:60000})};
    const m=/^https:\/\/mempool\.space\/api\/address\/(\w+)(\/utxo)?$/.exec(url)||[], at=AT.get(m[1])||"?";   // "?": not one of the known addresses (an assert here would be caught by esploraGet and look like a failed read); it answers unused
    const req=(m[2]?"utxo ":"addr ")+at, a=acct[at]||{}; e.log.push(req); e.max=Math.max(e.max,++e.live);
    await new Promise(r=>setTimeout(r,delay(req))); e.live--;
    const f=fail(req); if(f) return f();
    return {ok:true, status:200, json:async()=> m[2] ? (a.utxos||[]).map(u=>({txid:u.txid, vout:u.vout, value:u.value, status:{confirmed:u.confirmed}})) : {address:m[1], chain_stats:st(a.tx,a.funded,a.spent), mempool_stats:st(a.mtx,a.mfunded,a.mspent)}};
  };
  return e;
}
const ACC={                                                      // receive used at 0, 5 (then emptied) and 25; change used at 3, in the mempool only
  "0/0":{tx:1, funded:60000, mtx:1, mfunded:25000, utxos:[{txid:"a0".repeat(32), vout:1, value:60000, confirmed:true},{txid:"a1".repeat(32), vout:0, value:25000, confirmed:false}]},
  "0/5":{tx:2, funded:40000, spent:40000},
  "0/25":{tx:1, funded:12000, utxos:[{txid:"a2".repeat(32), vout:3, value:12000, confirmed:true}]},
  "1/3":{mtx:1, mfunded:7000, utxos:[{txid:"a3".repeat(32), vout:0, value:7000, confirmed:false}]}};
const ACC_USED=[addrAt(0,0),addrAt(0,5),addrAt(0,25),addrAt(1,3)];
const EMPTIED={                                                  // an older Ledger Live account: 0/0 used and emptied long ago, the coins on a later receive address and on the change chain
  "0/0":{tx:2, funded:50000, spent:50000},
  "0/4":{tx:1, funded:90000, utxos:[{txid:"d4".repeat(32), vout:0, value:90000, confirmed:true}]},
  "1/2":{tx:1, funded:30000, utxos:[{txid:"d2".repeat(32), vout:1, value:30000, confirmed:true}]}};
const reads=(c,a,b)=>Array.from({length:b-a+1},(_,k)=>`addr ${c}/${a+k}`);   // the stats reads of chain c, indexes a..b
const UTXOS=[{txid:"aa".repeat(32), vout:1, value:60000, confirmed:true},{txid:"bb".repeat(32), vout:0, value:25000, confirmed:true},{txid:"cc".repeat(32), vout:3, value:400000, confirmed:false}].map(u=>({...u, chain:0, index:0, address:ADDR_MAIN}));   // 0/0's coins, as ledgerUtxos hands them
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
  await test("ledgerAddress: the BIP-84 vector's second receive (0/1) and first change (1/0) addresses; the test's own derivation agrees",async()=>{
    assert.strictEqual((await ledgerAddress(XPUB,"mainnet",0,1)).address,"bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g");
    const c=await ledgerAddress(XPUB,"mainnet",1,0); assert.strictEqual(c.address,"bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"); assert.strictEqual(c.pathString,"m/84'/0'/0'/1/0");
    assert.strictEqual(addrAt(0,0),ADDR_MAIN); assert.strictEqual(addrAt(1,0),c.address);
  });
  await test("ledgerUtxos: each chain ends after 20 unused in a row (receive used at 0, 5, 25 -> 0/0..0/45 read; change used at 3 -> 1/0..1/23), 5 in flight, exactly the requests that implies; used: every address with history",async()=>{
    const e=fakeExplorer(ACC), r=await ledgerUtxos(XPUB,"mainnet");
    assert.deepStrictEqual(e.log,[...reads(0,0,45),...reads(1,0,23),"utxo 0/0","utxo 0/25","utxo 1/3"]);   // stats: last used + 21 per chain (46 + 24), then one UTXO read per used address still holding sats (3)
    assert.strictEqual(e.log.length,73); assert.strictEqual(e.max,5,"5 requests in flight at most, and used");
    assert.strictEqual(r.coins.length,4); assert.deepStrictEqual(r.used,ACC_USED,"0/5 too: emptied, still one of the account's burners");
  });
  await test("ledgerUtxos: a used-then-emptied address keeps the scan going and gets no UTXO request; without its history 0/25 is past a 20-gap and never read",async()=>{
    const e=fakeExplorer(ACC); await ledgerUtxos(XPUB,"mainnet");
    assert.ok(e.log.includes("addr 0/5")&&!e.log.includes("utxo 0/5")); assert.ok(e.log.includes("addr 0/25"),"0/5's history reaches 0/25");
    const {"0/5":_, ...noFive}=ACC, e2=fakeExplorer(noFive), r2=await ledgerUtxos(XPUB,"mainnet");
    assert.deepStrictEqual(e2.log,[...reads(0,0,20),...reads(1,0,23),"utxo 0/0","utxo 1/3"]);   // 0/1..0/20 unused: the receive chain ends at 0/20, 0/21 is never asked
    assert.deepStrictEqual(r2.coins.map(u=>u.chain+"/"+u.index),["0/0","0/0","1/3"]);
  });
  await test("ledgerUtxos: coins carry chain, index and address, in the order the signers spend them: 0/0's first, then confirmed before unconfirmed, the largest first, ties in scan order",async()=>{
    fakeExplorer({"0/0":{tx:1, funded:1000, mtx:1, mfunded:500, utxos:[{txid:"c0".repeat(32), vout:0, value:500, confirmed:false},{txid:"c1".repeat(32), vout:1, value:1000, confirmed:true}]},
      "0/2":{mtx:1, mfunded:50000, utxos:[{txid:"c2".repeat(32), vout:0, value:50000, confirmed:false}]}, "0/3":{tx:1, funded:20000, utxos:[{txid:"c3".repeat(32), vout:0, value:20000, confirmed:true}]},
      "1/1":{tx:1, funded:80000, utxos:[{txid:"c4".repeat(32), vout:2, value:80000, confirmed:true}]}, "1/4":{tx:1, funded:20000, utxos:[{txid:"c5".repeat(32), vout:0, value:20000, confirmed:true}]}});
    const {coins}=await ledgerUtxos(XPUB,"mainnet");
    assert.deepStrictEqual(coins,[
      {txid:"c1".repeat(32), vout:1, value:1000, confirmed:true, chain:0, index:0, address:ADDR_MAIN},      // 0/0, however small: the shown address stays the burner
      {txid:"c0".repeat(32), vout:0, value:500, confirmed:false, chain:0, index:0, address:ADDR_MAIN},
      {txid:"c4".repeat(32), vout:2, value:80000, confirmed:true, chain:1, index:1, address:addrAt(1,1)},
      {txid:"c3".repeat(32), vout:0, value:20000, confirmed:true, chain:0, index:3, address:addrAt(0,3)},   // a tie: the scan's order, receive before change
      {txid:"c5".repeat(32), vout:0, value:20000, confirmed:true, chain:1, index:4, address:addrAt(1,4)},
      {txid:"c2".repeat(32), vout:0, value:50000, confirmed:false, chain:0, index:2, address:addrAt(0,2)}]);   // bigger, but unconfirmed: last
    const e=fakeExplorer({}); assert.deepStrictEqual(await ledgerUtxos(XPUB,"mainnet"),{coins:[], used:[]},"nothing used: no coins, not unknown"); assert.deepStrictEqual(e.log,[...reads(0,0,19),...reads(1,0,19)]);
    const many={}; ["0/0","0/1","0/2","0/3","0/4","0/5","0/6","1/0","1/1"].forEach((at,k)=>{ many[at]={tx:1, funded:1000+k, utxos:[{txid:k.toString(16).repeat(64), vout:k, value:1000+k, confirmed:true}]}; });
    const e2=fakeExplorer(many), r2=await ledgerUtxos(XPUB,"mainnet");   // 9 addresses holding sats: their UTXOs are read 5 at a time too
    assert.deepStrictEqual(r2.coins.map(u=>u.chain+"/"+u.index),["0/0","1/1","1/0","0/6","0/5","0/4","0/3","0/2","0/1"]);
    assert.deepStrictEqual(e2.log,[...reads(0,0,26),...reads(1,0,21),...Object.keys(many).map(at=>"utxo "+at)]); assert.strictEqual(e2.max,5);
    const dust={"0/0":{tx:2, funded:9000, spent:9000}, "0/11":{tx:1, funded:500000, utxos:[{txid:"ee".repeat(32), vout:0, value:500000, confirmed:true}]}};   // dust sent to 0/1..0/10, a real coin on 0/11
    for(let i=1;i<=10;i++) dust["0/"+i]={tx:1, funded:546, utxos:[{txid:(i+16).toString(16).repeat(32), vout:0, value:546, confirmed:true}]};
    fakeExplorer(dust); const d=(await ledgerUtxos(XPUB,"mainnet")).coins, f=ledgerFund({utxos:d, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:20});
    assert.deepStrictEqual(f.inputs.map(u=>u.chain+"/"+u.index),["0/11"],"the dust stays where it is: one input, not eleven");
  });
  await test("ledgerUtxos: any failed read -> null (balance unknown), never a partial list; a busy explorer (429, 5xx) is asked 3 times, 0.8 s then 1.6 s apart, a network error or a cut answer 3 times at once, an answer of the wrong shape once",async()=>{
    const res=(ok,status,body)=>()=>({ok, status, json:async()=>{ if(body instanceof Error) throw body; return body; }}), Z={tx_count:0, funded_txo_sum:0, spent_txo_sum:0};
    for(const [req,make,tries,waits] of [["addr 0/7",res(false,500,{}),3,[800,1600]],["addr 1/12",res(true,200,{chain_stats:{tx_count:1,funded_txo_sum:0,spent_txo_sum:0}}),1,[]],
      ["addr 0/40",res(true,200,{chain_stats:{tx_count:"1",funded_txo_sum:"5000",spent_txo_sum:"0"},mempool_stats:Z}),1,[]],["addr 0/3",res(true,200,{chain_stats:{tx_count:1,funded_txo_sum:5000},mempool_stats:Z}),1,[]],   // a sum missing: not a used address with nothing on it
      ["addr 0/30",res(true,200,new SyntaxError("bad json")),3,[]],["addr 1/2",()=>{ throw new TypeError("Failed to fetch"); },3,[]],
      ["addr 0/11",res(false,503,{chain_stats:Z,mempool_stats:Z}),3,[800,1600]],["utxo 0/0",res(false,500,[]),3,[800,1600]],   // an error status with a well-formed body is still no answer
      ["utxo 0/25",res(false,429,{}),3,[800,1600]],["utxo 1/3",res(true,200,{oops:1}),1,[]]]){
      WAITS.length=0; const e=fakeExplorer(ACC,{fail:q=>q===req?make:null}); assert.strictEqual(await ledgerUtxos(XPUB,"mainnet"),null,req);
      assert.strictEqual(e.log.filter(q=>q===req).length,tries,req+" tries"); assert.deepStrictEqual(WAITS,waits,req+" pauses"); assert.ok(!e.log.some(q=>q.endsWith("?")),req+": nothing else odd");
      if(req==="addr 0/7") assert.deepStrictEqual(e.log,[...reads(0,0,9),"addr 0/7","addr 0/7"],"the scan stops at the batch that failed");
    }
    for(const [req,make,waits] of [["addr 1/2",()=>{ throw new TypeError("Failed to fetch"); },[]],["addr 0/12",res(false,429,{}),[800]],["utxo 0/25",res(false,503,{}),[800]]]){   // once, then it answers
      let k=0; WAITS.length=0; const e=fakeExplorer(ACC,{fail:q=>q===req&&!k++?make:null});
      assert.strictEqual((await ledgerUtxos(XPUB,"mainnet")).coins.length,4,req); assert.strictEqual(e.log.filter(q=>q===req).length,2,req); assert.deepStrictEqual(WAITS,waits,req);
    }
  });
  await test("ledgerUtxos: a coin list that is not a list of distinct coins -> null, never a rejection ([null], a string value, a negative vout, a short txid, one coin twice, one coin under two addresses)",async()=>{
    const list=body=>()=>({ok:true, status:200, json:async()=>body}), c=(o={})=>({txid:"a0".repeat(32), vout:1, value:60000, status:{confirmed:true}, ...o});
    for(const [name,body] of [["[null]",[null]],["a string value",[c({value:"60000"})]],["a negative vout",[c({vout:-1})]],["a short txid",[c({txid:"a0"})]],["a fractional value",[c({value:0.5})]],["one coin twice",[c(),c()]]]){
      fakeExplorer(ACC,{fail:q=>q==="utxo 0/0"?list(body):null}); assert.strictEqual(await ledgerUtxos(XPUB,"mainnet"),null,name);
    }
    fakeExplorer({...ACC, "0/25":{tx:1, funded:60000, utxos:[{txid:"a0".repeat(32), vout:1, value:60000, confirmed:true}]}});   // 0/0's first coin listed again under 0/25
    assert.strictEqual(await ledgerUtxos(XPUB,"mainnet"),null,"one coin under two addresses");
  });
  await test("ledgerUtxos: never rejects: an xpub that does not parse, another network's, a non-account key, none, or the wallet libraries not loading (jsdelivr blocked) -> null, and no explorer read",async()=>{
    const e=fakeExplorer(ACC);
    for(const x of [XPUB.slice(0,-3), "xpub-garbage", TPUB, rootMain.derive("m/84'/0'").publicExtendedKey, undefined, ""]) assert.strictEqual(await ledgerUtxos(x,"mainnet"),null,String(x).slice(0,16));
    const dead=Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@scure/bip32@1.5.0/+esm")); dead.catch(()=>{});
    try{ walletLibs(dead); assert.strictEqual(await ledgerUtxos(XPUB,"mainnet"),null,"no libraries"); } finally{ walletLibs(LIBS); }
    assert.deepStrictEqual(e.log,[]);
  });
  await test("ledgerUtxos: 2,000 addresses per chain at most: an account whose gap ends at 0/1999 is read whole; one still inside its gap there (an explorer that calls every address used) is null, never a partial list",async()=>{
    const chg=new Set(Array.from({length:20},(_,i)=>addrAt(1,i))), zero={tx_count:0, funded_txo_sum:0, spent_txo_sum:0};
    const run=async lastUsed=>{ let rcv=0, ch=0, live=0, max=0;                 // receive addresses are asked in index order: the k-th receive read is 0/(k-1)
      fetchImpl=async url=>{ const a=/\/address\/(\w+)$/.exec(url)[1], isChg=chg.has(a), i=isChg?-1:rcv; isChg?ch++:rcv++; max=Math.max(max,++live); await null; live--;
        return {ok:true, json:async()=>({chain_stats:!isChg&&i<=lastUsed?{tx_count:2, funded_txo_sum:1000, spent_txo_sum:1000}:zero, mempool_stats:zero})}; };
      const r=await ledgerUtxos(XPUB,"mainnet"); assert.ok(max<=5); return {r, rcv, ch}; };
    let {r,rcv,ch}=await run(LEDGER_CAP-21); assert.deepStrictEqual([rcv,ch,r.coins.length,r.used.length],[2000,20,0,1980],"0/1979 used, 0/1980..0/1999 unused: whole");
    ({r,rcv,ch}=await run(LEDGER_CAP-20)); assert.strictEqual(r,null); assert.deepStrictEqual([rcv,ch],[2000,0],"0/1980 used: the gap runs past 0/1999");
    ({r,rcv,ch}=await run(Infinity)); assert.strictEqual(r,null); assert.deepStrictEqual([rcv,ch],[2000,0],"every address used");
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
  await test("ledgerSign: the fake device (each input checked and signed at its PSBT derivation) signs -> byte-identical transaction to signP2wpkh; stages, app check, transport closed, from = 0/0",async()=>{
    const log=[], t=fakeTransport(); ledgerLibs(fakeLibs({transport:t, log, byPath:true})); nav.hid={};
    const stages=[];
    const r=await ledgerSign({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1, wallet:WALLET_MAIN, network:"mainnet", onstage:s=>stages.push(s)});
    const k=await walletDerive(MN,"","mainnet"), s=await signP2wpkh({utxos:UTXOS, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1, key:k});
    assert.strictEqual(r.hex,s.hex); assert.strictEqual(r.txid,s.txid); assert.strictEqual(r.txid,await txidOf(r.hex)); assert.strictEqual(r.fee,s.fee); assert.strictEqual(r.change,s.change);
    assert.ok(/^cHNidP8/.test(r.psbtBase64),"psbt base64 magic"); assert.strictEqual(r.from,ADDR_MAIN);
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
    await rej({...base, utxos:[{txid:"ee".repeat(32),vout:0,value:1000,chain:0,index:0}]}, fakeLibs({transport:fakeTransport()}), /insufficient funds/);
  });
  await test("ledgerSign: a coin without a Ledger derivation (no chain, no index, chain 2, a string, a negative, a fraction, past the cap) is refused before the device is asked, never given a guessed key",async()=>{
    const {txid,vout,value}=UTXOS[0];
    for(const at of [{}, {chain:0}, {index:3}, {chain:2, index:0}, {chain:"0", index:0}, {chain:0, index:-1}, {chain:0, index:1.5}, {chain:1, index:LEDGER_CAP}]){
      const log=[]; ledgerLibs(fakeLibs({transport:fakeTransport(), log}));
      await assert.rejects(ledgerSign({utxos:[{txid, vout, value, confirmed:true, ...at}], outputs:OUTS, changeAddr:ADDR_MAIN, wallet:WALLET_MAIN, network:"mainnet"}),e=>e.ledger&&e.code==="coin"&&/no Ledger derivation/.test(e.message),JSON.stringify(at));
      assert.deepStrictEqual(log,[],"the device is never opened");
    }
  });
  await test("ledgerSign: each input carries its own chain/index derivation (0/5 receive, 1/3 and 1/0 change), the change output 0/0; the device signs each at its path",async()=>{
    let seen=null; const libs=fakeLibs({transport:fakeTransport(), byPath:true}), orig=libs.AppBtc.prototype.signPsbtBuffer;
    libs.AppBtc.prototype.signPsbtBuffer=function(b,o){ seen={psbt:Buffer.from(b), known:o.knownAddressDerivations}; return orig.call(this,b,o); }; ledgerLibs(libs);
    const coins=[{txid:"b0".repeat(32), vout:0, value:10000, confirmed:true, chain:0, index:5},{txid:"b1".repeat(32), vout:2, value:8000, confirmed:false, chain:1, index:3},{txid:"b2".repeat(32), vout:1, value:9000, confirmed:true, chain:1, index:0}], at=[[0,5],[1,3],[1,0]];
    const r=await ledgerSign({utxos:coins, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:1, wallet:WALLET_MAIN, network:"mainnet"});
    const p=parsePsbt(seen.psbt), path=(c,i)=>[0x80000054,0x80000000,0x80000000,c,i], der=(c,i)=>FP+H(cat(...path(c,i).map(u32)));
    assert.strictEqual(p.tx.inputs.length,3); assert.strictEqual(p.tx.outputs.length,3);
    at.forEach(([c,i],n)=>{ const pub=H(pubAt(c,i));
      assert.deepStrictEqual([...p.inputs[n].keys()],["01","06"+pub],`input ${n}: witness_utxo + one derivation`);
      assert.strictEqual(H(p.inputs[n].get("06"+pub)),der(c,i),`input ${n}: [fp]/84'/0'/0'/${c}/${i}`);
      assert.strictEqual(H(p.inputs[n].get("01")),H(cat(u64(coins[n].value),vi(22),scriptPubKey(addrAt(c,i)))),`input ${n}: its own address's script`); });
    assert.deepStrictEqual([...p.outputs[2].keys()],["02"+H(keyMain.publicKey)]); assert.strictEqual(H(p.outputs[2].get("02"+H(keyMain.publicKey))),der(0,0));   // the change: 0/0, as before
    assert.strictEqual(H(p.tx.outputs[2].script),H(scriptPubKey(ADDR_MAIN))); assert.ok(p.outputs[0].size===0&&p.outputs[1].size===0);
    assert.deepStrictEqual([...seen.known].map(([h,v])=>[h,H(v.pubkey),v.path.join("/")]).sort(),[[0,0],...at].map(([c,i])=>[H(nobleRipemd(nobleSha256(pubAt(c,i)))),H(pubAt(c,i)),path(c,i).join("/")]).sort());
    const {tx,wit}=parseSigned(r.hex); assert.strictEqual(r.txid,await txidOf(r.hex)); assert.strictEqual(r.from,addrAt(0,5),"the first input's address");
    at.forEach(([c,i],n)=>{ const pub=pubAt(c,i); assert.strictEqual(H(wit[n][1]),H(pub)); assert.strictEqual(wit[n][0][wit[n][0].length-1],1,"SIGHASH_ALL");
      assert.ok(secp256k1.verify(wit[n][0].subarray(0,-1),sighash143(tx,n,coins[n].value,pub),pub),`input ${n} verifies under m/84'/0'/0'/${c}/${i}`); });
  });
  await test("ledgerUtxos + ledgerSign: the burner (first input's address) is 0/0 while it holds a coin, however small; with 0/0 emptied it is the address of the coin that goes first, and ledgerSign says which",async()=>{
    ledgerLibs(fakeLibs({transport:fakeTransport(), byPath:true}));
    fakeExplorer(EMPTIED); const r=await ledgerUtxos(XPUB,"mainnet"); assert.deepStrictEqual(r.used,[ADDR_MAIN,addrAt(0,4),addrAt(1,2)]);
    const s=await ledgerSign({utxos:r.coins, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:2, wallet:WALLET_MAIN, network:"mainnet"});
    assert.strictEqual(parseSigned(s.hex).tx.inputs[0].txid,"d4".repeat(32)); assert.strictEqual(s.from,addrAt(0,4));
    fakeExplorer({...EMPTIED, "0/0":{tx:3, funded:51000, spent:50000, utxos:[{txid:"d0".repeat(32), vout:0, value:1000, confirmed:true}]}});   // 1,000 sats back on 0/0: not enough alone, still first
    const s2=await ledgerSign({utxos:(await ledgerUtxos(XPUB,"mainnet")).coins, outputs:OUTS, changeAddr:ADDR_MAIN, feeRate:2, wallet:WALLET_MAIN, network:"mainnet"});
    assert.deepStrictEqual(parseSigned(s2.hex).tx.inputs.map(x=>x.txid.slice(0,2)),["d0","d4"]); assert.strictEqual(s2.from,ADDR_MAIN);
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

  // ---------- walletui.js on a stub page: shared + qr + wallet + ledger + walletui in one scope, as a page loads them; the explorer, the device and localStorage faked ----------
  function stubEl(id){                                           // any element: every property settable, the methods walletui.js calls are no-ops (a test may set its own, e.g. closest)
    const t={id, style:{}, dataset:{}, hidden:false, disabled:false, textContent:"", innerHTML:"", value:"", title:"", href:"", alt:"", src:"", open:false};
    const m={classList:{add(){}, remove(){}, toggle(){}, contains:()=>false}, addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute:()=>null, removeAttribute(){}, querySelector:()=>stubEl(id+" >"), querySelectorAll:()=>[], closest:()=>null,
      showModal(){ t.open=true; }, close(){ t.open=false; }, focus(){}, scrollIntoView(){}, before(){}, after(){}, append(){}, appendChild(){}, remove(){}, click(){}};
    return new Proxy(t,{get:(o,k)=>Object.hasOwn(o,k)||!(k in m) ? o[k] : m[k]});
  }
  const uiSrc=["shared","qr","wallet","ledger"].map(read).join("\n")+"\nwalletLibs(__LIBS);\nvar TOASTS=[]; function toast(m){ TOASTS.push(m); }\nvar qrcode=()=>{ let d=\"\"; return {addData(x){ d=x; }, make(){}, createDataURL:()=>\"qr:\"+d}; };\n"+read("walletui");   // the wallet libraries are in before walletui.js reads the balance on load; toast (ballotui.js on a page): what it said; qrcode (a CDN script on a page): the QR image says what it encodes
  function uiPage({wallet=null, libs=LIBS}={}){                  // wallet: the stored record; libs: what walletLibs hands out (a rejected promise: jsdelivr blocked)
    const els=new Map(), store={"bv.net":"mainnet"}; if(wallet) store["bv.wallet.mainnet"]=JSON.stringify(wallet);
    const d={querySelectorAll:()=>[], querySelector:()=>null, getElementById:id=>els.get(id)||els.set(id,stubEl(id)).get(id), createElement:()=>stubEl("new"), body:stubEl("body"), documentElement:stubEl("html"), fonts:null, addEventListener(){}};
    const p=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch","setTimeout","__LIBS", uiSrc+`
return {walletBalance, walletPaint, walletTab, walletOwns, ledgerLibs, feeReady, PAY, $, outParts, capNoteHtml, TOASTS,
  get walletUtxos(){ return walletUtxos; }, set walletUtxos(v){ walletUtxos=v; }, get WALLET(){ return WALLET; }, set WALLET(w){ WALLET=w; }, get WREADING(){ return WREADING; },
  get FUNDING(){ return FUNDING; }, set FUNDING(v){ FUNDING=v; }, get WFUND(){ return WFUND; }, set WFUND(v){ WFUND=v; }};`)(
      d, {}, {getItem:k=>store[k]??null, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; }}, ()=>({matches:false, addEventListener(){}}), {hid:{}, onLine:true}, ()=>{}, (...a)=>fetchImpl(...a), fastTimeout, libs);
    p.store=store; p.stored=()=>JSON.parse(store["bv.wallet.mainnet"]||"null"); return p;
  }
  const burnOuts=sats=>[{sats, scriptHex:toHex(OUTS[0].script), addr:BURN, label:"burn"},{sats:0, scriptHex:toHex(OUTS[1].script), addr:BURN, label:"statement"}];   // what payPanel hands walletTab.update
  await test("walletui: walletBalance reads a Ledger's whole account (ledgerUtxos) and keeps its used addresses in the stored record, so walletOwns knows every burner of it on any page; a burner wallet reads its one address",async()=>{
    const e=fakeExplorer(ACC), p=uiPage({wallet:WALLET_MAIN});
    const coins=await p.walletBalance();                          // shares the page-load read
    assert.deepStrictEqual(e.log,[...reads(0,0,45),...reads(1,0,23),"utxo 0/0","utxo 0/25","utxo 1/3"]); assert.strictEqual(coins,p.walletUtxos);
    assert.deepStrictEqual(coins.map(u=>u.chain+"/"+u.index),["0/0","0/0","0/25","1/3"]);
    assert.deepStrictEqual(p.stored().used,ACC_USED); assert.strictEqual(p.stored().xpub,XPUB);
    assert.ok([ADDR_MAIN,...ACC_USED].every(p.walletOwns)); assert.ok(![addrAt(0,1),addrAt(1,0),BURN,"",null,undefined].some(p.walletOwns));
    const p2=uiPage({wallet:{...WALLET_MAIN, used:ACC_USED}}); assert.ok(p2.walletOwns(addrAt(1,3)),"from the stored record, before this page's read lands"); await p2.walletBalance();
    const p3=uiPage({wallet:WALLET_MAIN}); delete p3.store["bv.wallet.mainnet"];   // another tab forgets the wallet while this one reads
    await p3.walletBalance(); assert.strictEqual(p3.store["bv.wallet.mainnet"],undefined,"not brought back by this tab's read"); assert.ok(p3.walletOwns(addrAt(0,5)),"this tab still knows its account");
    const e2=fakeExplorer(ACC), b=uiPage({wallet:{net:"mainnet", enc:false, data:MN, addr:ADDR_MAIN}});
    assert.strictEqual((await b.walletBalance()).length,2); assert.deepStrictEqual(e2.log,["utxo 0/0"]); assert.ok(b.walletOwns(ADDR_MAIN)&&!b.walletOwns(addrAt(0,5)));
  });
  await test("walletui: walletBalance never rejects: the wallet libraries not loading (jsdelivr blocked) or a coin list with null in it -> null, and the dialog offers retry instead of hanging on 'checking…'",async()=>{
    const dead=Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@scure/bip32@1.5.0/+esm")); dead.catch(()=>{});
    let e=fakeExplorer(ACC), p=uiPage({wallet:WALLET_MAIN, libs:dead});
    assert.strictEqual(await p.walletBalance(),null); assert.deepStrictEqual(e.log,[]);
    await p.walletPaint(); assert.strictEqual(p.$("w-bal").textContent,"—"); assert.match(p.$("w-balhint").innerHTML,/data-wretry/); assert.strictEqual(p.WREADING,false);
    e=fakeExplorer(ACC,{fail:q=>q==="utxo 0/25"?()=>({ok:true, status:200, json:async()=>[null]}):null}); p=uiPage({wallet:WALLET_MAIN});
    assert.strictEqual(await p.walletBalance(),null); assert.strictEqual(p.walletUtxos,null); assert.ok(e.log.includes("utxo 0/25"));
    await tick(20); assert.deepStrictEqual(REJ,[]);
  });
  await test("walletui: the page-load read and the dialog opening share one read of the account; a forced read is a fresh one, and the read it overtakes answers with it",async()=>{
    const e=fakeExplorer(ACC,{delay:()=>3}), p=uiPage({wallet:WALLET_MAIN}); assert.strictEqual(p.WREADING,true);
    const open=p.walletPaint(); assert.strictEqual(p.$("w-balhint").textContent,"checking…");
    await open; assert.strictEqual(e.log.length,73,"one scan: 70 address reads, 3 coin lists"); assert.ok(e.max<=5,"5 in flight: one scan at a time");
    assert.strictEqual(p.$("w-bal").textContent,"104,000 sats"); assert.strictEqual(p.WREADING,false);
    p.walletUtxos=null; const older=p.walletBalance(), newer=p.walletBalance(true);   // a refresh, then a forced read (a send) before it lands
    assert.strictEqual(p.WREADING,true); const [a,b]=await Promise.all([older,newer]);
    assert.strictEqual(a,b,"the older read hands over the newer one's coins, never its own"); assert.strictEqual(p.walletUtxos,b); assert.strictEqual(e.log.length,219); assert.strictEqual(p.WREADING,false);
  });
  await test("walletui: a slow read of a wallet that is gone never lands: Ledger A swapped for Ledger B (Connect a Ledger) or forgotten while A's scan runs; the page keeps B's coins, or none, and A's read writes nothing",async()=>{
    const e=fakeExplorer({...ACC, "b0/0":{tx:1, funded:7000, utxos:[{txid:"bb".repeat(32), vout:1, value:7000, confirmed:true}]}},{delay:q=>/ b/.test(q)?1:10});
    const aDone=async()=>{ for(let quiet=0, k=0; quiet<4; k++){ assert.ok(k<1000,"the explorer never went quiet"); await tick(5); quiet=e.live?0:quiet+1; } };   // no request in flight for 20 ms: A's scan is over
    let p=uiPage({wallet:WALLET_MAIN}); await tick(5); assert.ok(p.WREADING&&e.live,"A's scan runs");
    p.ledgerLibs(fakeLibs({transport:fakeTransport(), xpub:XPUB_B})); await p.$("w-ledger").onclick();   // the dialog's Connect a Ledger: the device hands over account 1
    assert.strictEqual(p.$("w-ledgermsg").hidden,true,p.$("w-ledgermsg").textContent); assert.strictEqual(p.WALLET.addr,addrB(0,0));
    assert.deepStrictEqual(p.walletUtxos.map(u=>u.txid.slice(0,2)),["bb"]); assert.ok(!e.log.includes("utxo 1/3"),"B answered first");
    await aDone(); assert.deepStrictEqual(p.walletUtxos.map(u=>u.txid.slice(0,2)),["bb"]); assert.strictEqual(p.WREADING,false);
    assert.deepStrictEqual([p.stored().xpub,p.stored().used],[XPUB_B,[addrB(0,0)]]); assert.ok(!p.walletOwns(ADDR_MAIN));
    e.log.length=0; p=uiPage({wallet:WALLET_MAIN}); await tick(5); assert.ok(p.WREADING&&e.live,"A's scan runs");
    p.$("w-forgetok").onclick(); assert.strictEqual(p.WALLET,null);   // the dialog's Forget wallet
    await aDone(); assert.strictEqual(p.walletUtxos,null); assert.strictEqual(p.store["bv.wallet.mainnet"],undefined,"the forgotten record is not written back"); assert.strictEqual(p.WREADING,false);
  });
  await test("walletui: the transaction step prices what the signers spend (their own selection), not every coin of the account: fee and canSend agree with ledgerFund",async()=>{
    fakeExplorer({}); const p=uiPage({wallet:WALLET_MAIN}); await p.walletBalance(); await p.feeReady();
    const coins=[{txid:"a0".repeat(32), vout:0, value:300000, confirmed:true, chain:0, index:0},{txid:"a1".repeat(32), vout:0, value:300000, confirmed:true, chain:0, index:1},
      ...Array.from({length:28},(_,k)=>({txid:(k+16).toString(16).repeat(32), vout:0, value:1000, confirmed:true, chain:1, index:k}))];   // 628,000 sats in 30 coins
    p.walletUtxos=coins; const wt=p.walletTab("t",stubEl("root")), all=Math.ceil(20*walletVsize(30,[...OUTS.map(o=>o.script),new Uint8Array(22)]));
    for(const [sats,ins,ok] of [[21000,1,true],[590000,2,true],[630000,0,false]]){
      wt.update({outputs:burnOuts(sats)}); const f=ins ? ledgerFund({utxos:coins, outputs:[{...OUTS[0], value:sats},OUTS[1]], changeAddr:ADDR_MAIN, feeRate:20}) : null;
      if(f) assert.strictEqual(f.inputs.length,ins);
      assert.strictEqual(wt.fee(), f ? f.fee : all, `${sats}: the fee shown`); assert.strictEqual(wt.canSend(),ok,`${sats}: canSend`);
    }
    wt.update({outputs:burnOuts(21000)}); assert.ok(wt.fee()*10<all,"one coin's fee, not thirty's");
    p.walletUtxos=null; assert.strictEqual(wt.fee(),Math.ceil(20*walletVsize(1,[...OUTS.map(o=>o.script),new Uint8Array(22)])),"coins unknown: priced for one");
  });
  await test("walletui: a Ledger burn from an account whose 0/0 is emptied: the account read, the device signs, the broadcast answers; onsent hands the page the real burner (the first input's address), which walletOwns knows",async()=>{
    const e=fakeExplorer(EMPTIED,{post:()=>({ok:true, status:200, text:async()=>"ef".repeat(32)})}), p=uiPage({wallet:WALLET_MAIN}); await p.walletBalance(); await p.feeReady();
    p.ledgerLibs(fakeLibs({transport:fakeTransport(), byPath:true}));
    const wt=p.walletTab("t",stubEl("root")), msgs=[]; let got=null; wt.onsent=x=>{ got=x; };
    p.PAY.push({paint:()=>{ wt.paint(); msgs.push(p.$("t-w-msg").textContent); }});
    wt.update({outputs:burnOuts(21000)}); assert.ok(wt.canSend());
    await wt.send(); await p.walletBalance();                    // and the read after the send, settled
    assert.strictEqual(wt.status().kind,"sent",wt.status().msg); assert.strictEqual(e.posts.length,1);
    assert.strictEqual(parseSigned(e.posts[0]).tx.inputs[0].txid,"d4".repeat(32)); assert.strictEqual(got.from,addrAt(0,4)); assert.strictEqual(got.txid,"ef".repeat(32)); assert.ok(p.walletOwns(got.from));
    assert.deepStrictEqual(msgs.filter((m,i)=>m&&m!==msgs[i-1]).slice(0,5),["checking the balance…","preparing the transaction…","connecting to the Ledger…","confirm on the Ledger…","signing…"]);
  });
  await test("walletui: an ask for funds lives as long as its dialog: walletPaint drops one whose dialog closed, a closed dialog's panel never says Funds arrived; the first read after a Ledger connects sets the ask from its coins (the note and the QR, one figure) or says Wallet connected",async()=>{
    const qr=(p,sats)=>"qr:bitcoin:"+ADDR_MAIN+(sats?`?amount=${(sats/1e8).toFixed(8)}`:"");   // the fake qrcode: the image is what it encodes
    const page=async acct=>{ fakeExplorer(acct); const p=uiPage(); await p.feeReady(); const root=stubEl("root"), wt=p.walletTab("t",root); wt.noun="take"; wt.update({outputs:burnOuts(21000)}); p.PAY.push({paint:wt.paint, wallet:wt});
      const dlg={open:true}; p.$("t-wallet").closest=root.closest=s=>s==="dialog"?dlg:null; p.ledgerLibs(fakeLibs({transport:fakeTransport()})); return {p, wt, dlg}; };   // dlg: the dialog the pay panel sits in
    let {p, wt, dlg}=await page(ACC); p.FUNDING="t"; p.WFUND=wt.need(); await p.walletPaint();
    assert.strictEqual(p.$("w-wait").hidden,false); assert.strictEqual(p.$("w-waithead").textContent,"Your 21,000-sat burn is kept");
    assert.match(p.$("w-waitnote").textContent,/^Once connected, the wallet needs about [\d,]+ sats: burn and mining fee\.$/);
    dlg.open=false; await p.walletPaint(); assert.deepStrictEqual([p.FUNDING,p.WFUND],[null,0],"closed before the wallet came: the ask goes"); assert.strictEqual(p.$("w-wait").hidden,true);
    dlg.open=true; p.FUNDING="t"; p.WFUND=wt.need(); await p.$("w-ledger").onclick();   // a Ledger that holds enough (104,000)
    assert.deepStrictEqual([p.FUNDING,p.WFUND],[null,0]); assert.deepStrictEqual(p.TOASTS,["Wallet connected · your take is ready to sign"]);
    assert.strictEqual(p.$("w-qr").src,qr(p,0),"no amount in the QR"); assert.doesNotMatch(p.$("w-fundnote").textContent,/Send about/);
    wt.paint(); assert.strictEqual(p.TOASTS.length,1,"never Funds arrived after it");
    ({p, wt, dlg}=await page({"0/0":{tx:1, funded:5000, utxos:[{txid:"a0".repeat(32), vout:1, value:5000, confirmed:true}]}}));   // a Ledger short of it
    p.FUNDING="t"; p.WFUND=wt.need(); const asked=p.WFUND; await p.$("w-ledger").onclick(); const f=wt.funds();
    assert.ok(f.short>0&&f.topup<asked,`${f.topup} < ${asked}: its coins count`); assert.strictEqual(p.WFUND,f.topup); assert.deepStrictEqual(p.TOASTS,[]);
    assert.strictEqual(p.$("w-fundnote").textContent,`Send about ${f.topup.toLocaleString("en-US")} sats to this address: the ${f.short.toLocaleString("en-US")} missing, plus the new coin's fee and a small margin. Your take is waiting.`);
    assert.strictEqual(p.$("w-qr").src,qr(p,f.topup),"the QR asks for the note's figure");
    dlg.open=false; p.walletUtxos=[{txid:"a1".repeat(32), vout:0, value:100000, confirmed:true, chain:0, index:0, address:ADDR_MAIN}]; wt.paint();
    assert.deepStrictEqual([p.FUNDING,p.WFUND,p.TOASTS.length],[null,0,0],"the coins land after the dialog closed: its ask goes without a word");
    dlg.open=true; p.FUNDING="t"; p.WFUND=1; wt.paint(); assert.deepStrictEqual(p.TOASTS,["Funds arrived · your take is ready to sign"],"…and while it is open: Funds arrived");
  });
  await test("walletui: the outputs in the dialogs' words (outParts) for the callout, the cap notes and the waiting line: a registration above 330 is a registration and a sponsorship, a burn next to a registration its first answer; the headline counts the noun's own outputs; no fee figure in the cap notes",async()=>{
    fakeExplorer({}); const p=uiPage(); await p.feeReady();
    const sq=[{label:"register · root", sats:1330},{label:"burn · #will-it-snow?yes|no", sats:330},{label:"OP_RETURN", sats:0},{label:"tip", sats:1000}];   // Explore's New topic: 330 + a 1,000 sponsorship, a first answer, a tip
    assert.deepStrictEqual(p.outParts(sq,"registration"),[["registration",330,1],["sponsorship",1000,1],["first answer",330,1],["tip",1000,1]]);
    assert.deepStrictEqual(p.outParts([{label:"burn",sats:330},{label:"register · root",sats:330},{label:"tip",sats:1000}],"take"),[["burn",330,1],["registration",330,1],["tip",1000,1]]);
    assert.deepStrictEqual(p.outParts([{label:"burn · #a",sats:330},{label:"burn · #b",sats:1000},{label:"sponsor · root",sats:5000},{label:"tip",sats:0}],"batch"),[["burn",1330,2],["sponsorship",5000,1]]);
    const wt={prefix:"sq"}, f=(bal,parts)=>({bal, fee:394, topup:700, parts}), nb=s=>s.replace(/ /g," ");
    assert.strictEqual(nb(p.capNoteHtml(wt,f(2000,[["burn",330,1],["tip",1000,1]]),"burn",330,606,330)),"Your wallet holds 2,000 sats: with the 1,000 tip and the mining fee, up to 606 fits.");
    assert.strictEqual(nb(p.capNoteHtml(wt,f(3000,p.outParts(sq,"registration")),"registration",1330,1566,330)),"Your wallet holds 3,000 sats: with the 330 first answer, the 1,000 tip and the mining fee, up to 1,566 fits.","the registration's chip covers its sponsorship");
    assert.match(nb(p.capNoteHtml(wt,f(500,p.outParts(sq,"registration")),"tip",1000,-1258,0,false)),/^With the 330 registration, the 1,000 sponsorship, the 330 first answer and the mining fee, it is about 1,258 short even without a tip\. <button[^>]*data-fund="sq:700"/);
    const sqw=p.walletTab("sq",stubEl("root")); sqw.noun="registration"; p.PAY.push({paint:sqw.paint, wallet:sqw}); p.$("sq-wallet").closest=()=>({open:true});
    sqw.update({outputs:sq.map(o=>o.label==="OP_RETURN" ? {...o, addr:"OP_RETURN", scriptHex:"6a00"} : {...o, addr:BURN, scriptHex:toHex(scriptPubKey(BURN))})});
    p.FUNDING="sq"; p.WFUND=sqw.need(); await p.walletPaint();   // no wallet yet: the Connect view's waiting line
    assert.strictEqual(p.$("w-waithead").textContent,"Your 330-sat registration is kept");
    assert.strictEqual(p.$("w-waitnote").textContent,`Once connected, the wallet needs about ${p.WFUND.toLocaleString("en-US")} sats: registration, sponsorship, first answer, tip and mining fee.`);
  });
  await test("no unhandled rejection in this run",async()=>{ await tick(20); assert.deepStrictEqual(REJ,[]); });
  console.log(`\n${n-failed}/${n} passed`); process.exit(failed?1:0);
})();
