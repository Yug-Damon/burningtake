// node wallet-test.js — loads parts/shared.js + parts/qr.js + parts/wallet.js as browser code and checks the wallet API against independent code.
"use strict";
const fs=require("fs"), path=require("path"), assert=require("assert");
const bip39=require("@scure/bip39"), {wordlist}=require("@scure/bip39/wordlists/english"), {HDKey}=require("@scure/bip32"), {secp256k1}=require("@noble/curves/secp256k1");
const {ripemd160:nobleRipemd}=require("@noble/hashes/ripemd160"), {sha256:nobleSha256}=require("@noble/hashes/sha256");

// ---------- load: the three files in one function scope, DOM globals stubbed, fetch redirected to a per-test stub ----------
const src=["shared","qr","wallet"].map(f=>fs.readFileSync(path.join(__dirname,"parts",f+".js"),"utf8")).join("\n");
const names=["toHex","enc","bech32","bech32Decode","scriptPubKey","opReturnScript","txidOf","estimateVsize",
  "walletLibs","walletGenerate","walletValidate","walletDerive","ripemd160","hash160","signP2wpkh","encryptSecret","decryptSecret","esploraBase","fetchUtxos","broadcastTx","nfc"];
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
let fetchImpl=()=>{ throw new Error("fetch not stubbed"); };
const api=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch",
  src+"\nreturn {"+names.join(",")+"};")(doc, {}, {getItem:()=>null, setItem(){}}, ()=>({matches:false}), {}, ()=>{}, (...a)=>fetchImpl(...a));
const {toHex,enc,bech32,bech32Decode,scriptPubKey,opReturnScript,txidOf,estimateVsize,
  walletLibs,walletGenerate,walletValidate,walletDerive,ripemd160,hash160,signP2wpkh,encryptSecret,decryptSecret,esploraBase,fetchUtxos,broadcastTx,nfc}=api;

// ---------- independent helpers (Buffer + @noble/hashes, none of the code under test) ----------
const H=b=>Buffer.from(b).toString("hex");
const rev=hex=>Buffer.from(hex,"hex").reverse();
const u32=n=>{ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; };
const u64=n=>{ const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vi=n=> n<0xfd ? Buffer.from([n]) : n<=0xffff ? Buffer.from([0xfd,n&255,n>>8]) : (()=>{ const b=Buffer.alloc(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; })();
const cat=(...a)=>Buffer.concat(a.map(x=>Buffer.from(x)));
const dsha=b=>Buffer.from(nobleSha256(nobleSha256(b)));
const N=secp256k1.CURVE.n;
function parseWitnessTx(hex){
  const b=Buffer.from(hex,"hex"); let p=0;
  const rv=()=>{ const x=b[p]; if(x<0xfd){p++;return x;} if(x===0xfd){const n=b.readUInt16LE(p+1);p+=3;return n;} if(x===0xfe){const n=b.readUInt32LE(p+1);p+=5;return n;} throw new Error("varint too big"); };
  const take=n=>{ const s=Buffer.from(b.subarray(p,p+n)); p+=n; return s; };
  const version=b.readUInt32LE(p); p+=4;
  assert.strictEqual(b[p],0x00,"marker"); assert.strictEqual(b[p+1],0x01,"flag"); p+=2;
  const nIn=rv(), inputs=[];
  for(let i=0;i<nIn;i++){ const txid=H(take(32).reverse()); const vout=b.readUInt32LE(p); p+=4; const scriptSig=take(rv()); const sequence=b.readUInt32LE(p); p+=4; inputs.push({txid,vout,scriptSig,sequence}); }
  const nOut=rv(), outputs=[];
  for(let i=0;i<nOut;i++){ const value=Number(b.readBigUInt64LE(p)); p+=8; outputs.push({value, script:take(rv())}); }
  const witnesses=[];
  for(let i=0;i<nIn;i++){ const k=rv(), items=[]; for(let j=0;j<k;j++) items.push(take(rv())); witnesses.push(items); }
  const locktime=b.readUInt32LE(p); p+=4;
  assert.strictEqual(p,b.length,"tx fully consumed");
  return {version,inputs,outputs,witnesses,locktime,size:b.length};
}
const legacyBytes=tx=>cat(u32(tx.version), vi(tx.inputs.length), ...tx.inputs.map(i=>cat(rev(i.txid),u32(i.vout),vi(i.scriptSig.length),i.scriptSig,u32(i.sequence))),
  vi(tx.outputs.length), ...tx.outputs.map(o=>cat(u64(o.value),vi(o.script.length),o.script)), u32(tx.locktime));
function sighash143(tx,i,value,pubkey){                          // BIP-143, SIGHASH_ALL, P2WPKH scriptCode
  const prevouts=cat(...tx.inputs.map(x=>cat(rev(x.txid),u32(x.vout)))), seqs=cat(...tx.inputs.map(x=>u32(x.sequence)));
  const outs=cat(...tx.outputs.map(o=>cat(u64(o.value),vi(o.script.length),o.script)));
  const scriptCode=cat([0x19,0x76,0xa9,0x14], nobleRipemd(nobleSha256(pubkey)), [0x88,0xac]);
  return dsha(cat(u32(tx.version), dsha(prevouts), dsha(seqs), rev(tx.inputs[i].txid), u32(tx.inputs[i].vout), scriptCode, u64(value), u32(tx.inputs[i].sequence), dsha(outs), u32(tx.locktime), u32(1)));
}
function derDecode(sig){                                         // DER + hashtype byte -> {r, s, hashType}; strict DER (BIP-66) asserted
  const n=sig.length; assert.ok(n>=9&&n<=73,"sig length "+n);
  assert.strictEqual(sig[0],0x30,"DER seq"); assert.strictEqual(sig[1],n-3,"DER seq length");
  assert.strictEqual(sig[2],0x02,"DER int r"); const rl=sig[3], r=sig.subarray(4,4+rl);
  assert.strictEqual(sig[4+rl],0x02,"DER int s"); const sl=sig[5+rl], s=sig.subarray(6+rl,6+rl+sl);
  assert.strictEqual(6+rl+sl,n-1,"DER covers all but the hashtype byte");
  for(const x of [r,s]){ assert.ok(x.length>0&&!(x[0]&0x80),"integer positive"); assert.ok(!(x.length>1&&x[0]===0&&!(x[1]&0x80)),"integer minimal"); }
  return {r:BigInt("0x"+H(r)), s:BigInt("0x"+H(s)), hashType:sig[n-1]};
}
const estVsize=(nIn,scripts)=>11+68*nIn+scripts.reduce((a,s)=>a+9+s.length,0);   // 11 overhead + 68 per P2WPKH input + (8 value + 1 len + script) per output
async function checkSigned({res,utxos,key,feeRate,outputs,changeAddr,tag}){   // full independent verification of one signP2wpkh result
  const tx=parseWitnessTx(res.hex);
  assert.strictEqual(tx.version,2,tag+" version"); assert.strictEqual(tx.locktime,0,tag+" locktime");
  const nIn=tx.inputs.length; assert.ok(nIn>=1&&nIn<=utxos.length,tag+" input count");
  tx.inputs.forEach((inp,i)=>{ assert.strictEqual(inp.txid,utxos[i].txid,tag+" outpoint txid"); assert.strictEqual(inp.vout,utxos[i].vout,tag+" outpoint vout"); assert.strictEqual(inp.scriptSig.length,0,tag+" empty scriptSig"); assert.strictEqual(inp.sequence,0xfffffffd,tag+" sequence"); });
  const inSum=utxos.slice(0,nIn).reduce((a,u)=>a+u.value,0), outSum=tx.outputs.reduce((a,o)=>a+o.value,0);
  outputs.forEach((o,i)=>{ assert.strictEqual(tx.outputs[i].value,o.value,tag+" output value"); assert.strictEqual(H(tx.outputs[i].script),H(o.script),tag+" output script"); });
  const hasChange=tx.outputs.length===outputs.length+1;
  assert.ok(hasChange||tx.outputs.length===outputs.length,tag+" output count");
  if(hasChange){ const c=tx.outputs[outputs.length]; assert.strictEqual(H(c.script),H(scriptPubKey(changeAddr)),tag+" change script"); assert.strictEqual(c.value,res.change,tag+" change value"); assert.ok(c.value>=330,tag+" change not dust"); }
  else assert.strictEqual(res.change,0,tag+" no change reported");
  assert.strictEqual(inSum-outSum,res.fee,tag+" fee = inputs − outputs");
  assert.strictEqual(res.change,inSum-outputs.reduce((a,o)=>a+o.value,0)-res.fee,tag+" change = inputs − outputs − fee");
  const est=estVsize(nIn,tx.outputs.map(o=>o.script));
  assert.strictEqual(res.vsize,est,tag+" reported vsize = independent estimate");
  if(hasChange) assert.strictEqual(res.fee,Math.ceil(feeRate*est),tag+" fee = ceil(feeRate × vsize estimate)");
  const base=legacyBytes(tx).length, actual=Math.ceil((3*base+tx.size)/4);
  assert.strictEqual(res.actualVsize,actual,tag+" actualVsize");
  assert.ok(est>=actual,tag+` estimate ${est} >= actual ${actual}`);
  assert.ok(res.fee>=feeRate*actual,tag+" effective fee rate >= requested");
  assert.strictEqual(tx.witnesses.length,nIn,tag+" one witness per input");
  const hashes=tx.inputs.map((_,i)=>sighash143(tx,i,utxos[i].value,key.pubkey));
  tx.witnesses.forEach((w,i)=>{
    assert.strictEqual(w.length,2,tag+" witness items"); assert.strictEqual(H(w[1]),H(key.pubkey),tag+" witness pubkey");
    const {r,s,hashType}=derDecode(w[0]);
    assert.strictEqual(hashType,1,tag+" SIGHASH_ALL"); assert.ok(s<=N/2n,tag+" low-S"); assert.ok(r>0n&&r<N&&s>0n,tag+" r,s in range");
    assert.ok(secp256k1.verify({r,s},hashes[i],key.pubkey,{lowS:true}),tag+` input ${i} signature verifies against the independent BIP-143 sighash`);
    assert.ok(secp256k1.verify(w[0].subarray(0,-1),hashes[i],key.pubkey),tag+" DER bytes verify too");
    const other=Buffer.from(hashes[i]); other[0]^=1;
    assert.ok(!secp256k1.verify({r,s},other,key.pubkey),tag+" tampered sighash fails");
    if(nIn>1) assert.ok(!secp256k1.verify({r,s},hashes[(i+1)%nIn],key.pubkey),tag+" another input's sighash fails");
  });
  const txidIndep=H(dsha(legacyBytes(tx)).reverse());
  assert.strictEqual(res.txid,txidIndep,tag+" txid = sha256d(legacy serialization) reversed");
  assert.strictEqual(res.txid,await txidOf(res.hex),tag+" txid = txidOf(hex)");
  return tx;
}

const M="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const BURN="bc1qrz05qq6tu7senu06nzgkdrhr4dsyn7pd8rrghec0t9h2ktsc27msqvznj2";   // P2WSH(OP_RETURN "pizza") from the shared.js self-check
const fakeTxid=i=>H(nobleSha256(Buffer.from("utxo"+i)));

let n=0, failed=0;
async function t(name,fn){ try{ await fn(); n++; console.log(`ok ${n} - ${name}`); }catch(e){ n++; failed++; console.log(`not ok ${n} - ${name}\n  ${e && e.stack ? e.stack.split("\n").slice(0,4).join("\n  ") : e}`); } }

(async()=>{
  await t("nfc: number chips compact only when exact, years and small values stay bare",()=>{
    const cases={50000:"50k",500000:"500k",12500:"12.5k",12345:"12,345",10050:"10,050",1500000:"1.5M",21000000:"21M",1234000:"1,234,000",2e10:"20B",2026:"2026",0:"0",0.5:"0.5","-50000":"-50k"};
    for(const [x,want] of Object.entries(cases)) assert.strictEqual(nfc(+x),want,x);
  });
  await t("RIPEMD-160: standard vectors",()=>{
    const v={"":"9c1185a5c5e9fc54612808977ee8f548b2258d31","a":"0bdc9d2d256b3ee9daae347be6f4dc835a467ffe","abc":"8eb208f7e05d987a9b044a8e98c6b087f15a0bfc",
      "message digest":"5d0689ef49d2fae572b881b123a85ffa21595f36","abcdefghijklmnopqrstuvwxyz":"f71c27109c692c1b56bbdceb5b9d2865b3708dbc",
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq":"12a053384a9c0c88e405a06c27dcf49ada62eb2b",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789":"b0e20b6e3116640286ed3a87a5713079b21f5189",
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890":"9b752e45573d4b39f4dbd3323cab82bf63326bfb"};
    for(const [s,h] of Object.entries(v)) assert.strictEqual(toHex(ripemd160(enc.encode(s))),h,`RIPEMD160(${JSON.stringify(s)})`);
    assert.strictEqual(toHex(ripemd160(new Uint8Array(1e6).fill(0x61))),"52783243c1697bdbe16d37f97f68f08325dc1528","million a");
  });
  await t("RIPEMD-160: every length 0..200 matches @noble/hashes (padding boundaries)",()=>{
    for(let len=0;len<=200;len++){ const b=crypto.getRandomValues(new Uint8Array(len)); assert.strictEqual(toHex(ripemd160(b)),H(nobleRipemd(b)),"len "+len); }
    const big=new Uint8Array(require("crypto").randomBytes(70000)); assert.strictEqual(toHex(ripemd160(big)),H(nobleRipemd(big)),"70000 bytes");   // getRandomValues caps at 65536 bytes
    assert.strictEqual(toHex(ripemd160([0x61,0x62,0x63])),"8eb208f7e05d987a9b044a8e98c6b087f15a0bfc","plain array input");
  });
  await t("hash160 = RIPEMD160(SHA256(x))",async()=>{
    const pub=Buffer.from("0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c","hex");
    assert.strictEqual(toHex(await hash160(pub)),H(nobleRipemd(nobleSha256(pub))));
    assert.strictEqual(toHex(await hash160(pub)),"c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2","BIP-84 vector key hash");
    assert.strictEqual((await hash160(new Uint8Array(0))).length,20);
  });

  await t("walletLibs: injected libs are used and memoised",async()=>{
    const injected={bip39, wordlist, HDKey, secp:secp256k1};
    const a=await walletLibs(injected); assert.strictEqual(a,injected);
    const p1=walletLibs(), p2=walletLibs(); assert.strictEqual(p1,p2,"same promise"); assert.strictEqual(await p1,injected);
  });
  await t("walletGenerate: 12 valid words, fresh every time",async()=>{
    const {mnemonic}=await walletGenerate(), words=mnemonic.split(" ");
    assert.strictEqual(words.length,12); for(const w of words) assert.ok(wordlist.includes(w),"word in list: "+w);
    assert.ok(bip39.validateMnemonic(mnemonic,wordlist),"checksum valid per @scure/bip39");
    assert.ok(await walletValidate(mnemonic),"walletValidate agrees");
    const seen=new Set(); for(let i=0;i<5;i++) seen.add((await walletGenerate()).mnemonic); assert.strictEqual(seen.size,5,"distinct");
  });
  await t("walletValidate: vector true, bad checksum / garbage / empty false, whitespace and case tolerated",async()=>{
    assert.strictEqual(await walletValidate(M),true);
    assert.strictEqual(await walletValidate("  ABANDON abandon\tabandon abandon abandon abandon abandon abandon abandon abandon abandon   about "),true);
    assert.strictEqual(await walletValidate(M.replace("about","abandon")),false,"bad checksum");
    assert.strictEqual(await walletValidate("not a mnemonic at all"),false);
    assert.strictEqual(await walletValidate(""),false); assert.strictEqual(await walletValidate(null),false);
  });
  await t("walletDerive: BIP-84 mainnet vector m/84'/0'/0'/0/0",async()=>{
    const k=await walletDerive(M);
    assert.strictEqual(k.address,"bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    assert.strictEqual(k.path,"m/84'/0'/0'/0/0");
    assert.ok(k.pubkey instanceof Uint8Array&&k.pubkey.length===33); assert.ok(k.privkey instanceof Uint8Array&&k.privkey.length===32);
    assert.strictEqual(toHex(k.pubkey),"0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c","BIP-84 vector pubkey");
    assert.strictEqual(H(secp256k1.getPublicKey(k.privkey,true)),toHex(k.pubkey),"privkey matches pubkey");
    assert.strictEqual(k.fingerprint,0x73c5da0a,"master fingerprint");
    const d=bech32Decode(k.address); assert.strictEqual(d.hrp,"bc"); assert.strictEqual(d.version,0); assert.strictEqual(toHex(d.program),H(nobleRipemd(nobleSha256(k.pubkey))));
    assert.strictEqual((await walletDerive(M,"","mainnet")).address,k.address);
  });
  await t("walletDerive: signet/testnet path m/84'/1'/0'/0/0 -> tb1…, matches an independent derivation",async()=>{
    const seed=await bip39.mnemonicToSeed(M,""), pub=HDKey.fromMasterSeed(seed).derive("m/84'/1'/0'/0/0").publicKey;
    const expected=bech32("tb",0,nobleRipemd(nobleSha256(pub)));
    for(const net of ["signet","testnet"]){
      const k=await walletDerive(M,"",net);
      assert.strictEqual(k.path,"m/84'/1'/0'/0/0",net+" path"); assert.ok(k.address.startsWith("tb1q"),net+" prefix");
      const d=bech32Decode(k.address); assert.strictEqual(d.hrp,"tb"); assert.strictEqual(d.version,0); assert.strictEqual(d.program.length,20);
      assert.strictEqual(toHex(k.pubkey),H(pub),net+" pubkey"); assert.strictEqual(k.address,expected,net+" address");
      assert.strictEqual(k.fingerprint,0x73c5da0a);
    }
    console.log("  # testnet/signet first address:",expected);
  });
  await t("walletDerive: passphrase changes the key; invalid mnemonic throws",async()=>{
    const a=await walletDerive(M), b=await walletDerive(M,"TREZOR");
    assert.notStrictEqual(a.address,b.address); assert.notStrictEqual(toHex(a.privkey),toHex(b.privkey));
    const seed=await bip39.mnemonicToSeed(M,"TREZOR"), k=HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'/0/0");
    assert.strictEqual(toHex(b.pubkey),H(k.publicKey)); assert.strictEqual(b.address,bech32("bc",0,nobleRipemd(nobleSha256(k.publicKey))));
    await assert.rejects(()=>walletDerive(M.replace("about","abandon")),/invalid mnemonic/);
  });

  // ---------- signing ----------
  const key=await walletDerive(M);
  const burnOut={value:5000, script:scriptPubKey(BURN)}, opret={value:0, script:opReturnScript(enc.encode("pizza"))};
  await t("signP2wpkh: 1 input 100000 sats -> P2WSH 5000 + OP_RETURN + change, feeRate 1, fully verified",async()=>{
    const utxos=[{txid:fakeTxid(1), vout:0, value:100000}];
    const res=await signP2wpkh({utxos, outputs:[burnOut,opret], changeAddr:key.address, feeRate:1, key});
    assert.ok(/^[0-9a-f]+$/.test(res.hex)&&res.hex.startsWith("02000000"+"0001"+"01"),"hex starts version 2, marker/flag, 1 input");
    const tx=await checkSigned({res,utxos,key,feeRate:1,outputs:[burnOut,opret],changeAddr:key.address,tag:"single"});
    assert.strictEqual(tx.outputs.length,3); assert.strictEqual(res.vsize,11+68+43+16+31,"169 vB priced"); assert.strictEqual(res.fee,169); assert.strictEqual(res.change,100000-5000-169);
    assert.strictEqual(res.inputs.length,1); assert.strictEqual(res.outputs.length,3);
    console.log("  # txid",res.txid,"fee",res.fee,"vsize",res.vsize,"actual",res.actualVsize,"hex bytes",res.hex.length/2);
  });
  await t("signP2wpkh: feeRate 7 prices the same estimate ×7",async()=>{
    const utxos=[{txid:fakeTxid(2), vout:3, value:100000}];
    const res=await signP2wpkh({utxos, outputs:[burnOut,opret], changeAddr:key.address, feeRate:7, key});
    await checkSigned({res,utxos,key,feeRate:7,outputs:[burnOut,opret],changeAddr:key.address,tag:"rate7"});
    assert.strictEqual(res.fee,7*169); assert.strictEqual(res.change,100000-5000-7*169);
  });
  await t("signP2wpkh: two inputs needed, third left alone, each input signed with its own value",async()=>{
    const utxos=[{txid:fakeTxid(3), vout:1, value:3000},{txid:fakeTxid(4), vout:0, value:4000},{txid:fakeTxid(5), vout:2, value:50000}];
    const res=await signP2wpkh({utxos, outputs:[burnOut,opret], changeAddr:key.address, feeRate:1, key});
    const tx=await checkSigned({res,utxos,key,feeRate:1,outputs:[burnOut,opret],changeAddr:key.address,tag:"multi"});
    assert.strictEqual(tx.inputs.length,2,"third utxo not selected"); assert.strictEqual(res.vsize,11+2*68+43+16+31); assert.strictEqual(res.change,7000-5000-res.fee);
  });
  await t("signP2wpkh: dust change (< 330 sats) is absorbed into the fee",async()=>{
    const utxos=[{txid:fakeTxid(6), vout:0, value:5400}];                // fee with change 169 -> change 231 < 330 -> no change output
    const res=await signP2wpkh({utxos, outputs:[burnOut,opret], changeAddr:key.address, feeRate:1, key});
    const tx=await checkSigned({res,utxos,key,feeRate:1,outputs:[burnOut,opret],changeAddr:key.address,tag:"dust"});
    assert.strictEqual(tx.outputs.length,2); assert.strictEqual(res.change,0); assert.strictEqual(res.fee,400); assert.strictEqual(res.vsize,11+68+43+16);
  });
  await t("signP2wpkh: change to a different address, single P2WPKH output (31 vB outputs -> plain estimateVsize)",async()=>{
    const other=await walletDerive(M,"x"), utxos=[{txid:fakeTxid(7), vout:0, value:20000}], outs=[{value:6000, script:scriptPubKey(other.address)}];
    const res=await signP2wpkh({utxos, outputs:outs, changeAddr:other.address, feeRate:2, key});
    const tx=await checkSigned({res,utxos,key,feeRate:2,outputs:outs,changeAddr:other.address,tag:"p2wpkh"});
    assert.strictEqual(res.vsize,estimateVsize(1,2),"pure P2WPKH outputs equal qr.js's estimateVsize"); assert.strictEqual(H(tx.outputs[1].script),H(scriptPubKey(other.address)));
  });
  await t("signP2wpkh: insufficient funds / missing key throw",async()=>{
    await assert.rejects(()=>signP2wpkh({utxos:[{txid:fakeTxid(8), vout:0, value:5100}], outputs:[burnOut,opret], changeAddr:key.address, feeRate:1, key}),/insufficient funds/);
    await assert.rejects(()=>signP2wpkh({utxos:[], outputs:[burnOut], changeAddr:key.address, feeRate:1, key}),/insufficient funds/);
    await assert.rejects(()=>signP2wpkh({utxos:[{txid:fakeTxid(9), vout:0, value:100000}], outputs:[burnOut], changeAddr:key.address, feeRate:1}),/missing key/);
  });
  await t("signP2wpkh: deterministic (RFC 6979) — same inputs give the same hex twice",async()=>{
    const args={utxos:[{txid:fakeTxid(10), vout:0, value:100000}], outputs:[burnOut,opret], changeAddr:key.address, feeRate:1, key};
    assert.strictEqual((await signP2wpkh(args)).hex,(await signP2wpkh(args)).hex);
  });

  // ---------- encrypted backup ----------
  await t("encryptSecret / decryptSecret: round trip, base64 JSON shape, random salt+iv",async()=>{
    const blob=await encryptSecret(M,"correct horse");
    const j=JSON.parse(Buffer.from(blob,"base64").toString());
    assert.strictEqual(j.v,1); assert.strictEqual(j.iter,200000); assert.match(j.salt,/^[0-9a-f]{32}$/); assert.match(j.iv,/^[0-9a-f]{24}$/); assert.match(j.ct,/^[0-9a-f]+$/);
    assert.strictEqual(j.ct.length/2,M.length+16,"ciphertext = plaintext + 16-byte GCM tag");
    assert.strictEqual(await decryptSecret(blob,"correct horse"),M);
    assert.notStrictEqual(await encryptSecret(M,"correct horse"),blob,"fresh salt/iv");
    const uni="héllo wörld ✓ 日本"; assert.strictEqual(await decryptSecret(await encryptSecret(uni,"p"),"p"),uni);
  });
  await t("decryptSecret: wrong password, tampered ciphertext and garbage all throw",async()=>{
    const blob=await encryptSecret(M,"correct horse");
    await assert.rejects(()=>decryptSecret(blob,"wrong horse"),/wrong password/);
    const j=JSON.parse(Buffer.from(blob,"base64").toString()); j.ct=j.ct.slice(0,-2)+(j.ct.endsWith("00")?"01":"00");
    await assert.rejects(()=>decryptSecret(Buffer.from(JSON.stringify(j)).toString("base64"),"correct horse"),/wrong password/);
    await assert.rejects(()=>decryptSecret("not base64 json","x"),/not an encrypted backup/);
    await assert.rejects(()=>decryptSecret(Buffer.from("{}").toString("base64"),"x"),/not an encrypted backup/);
  });

  // ---------- explorer I/O ----------
  await t("esploraBase",()=>{
    assert.strictEqual(esploraBase("mainnet"),"https://mempool.space/api");
    assert.strictEqual(esploraBase("signet"),"https://mempool.space/signet/api");
    assert.strictEqual(esploraBase("testnet"),"https://mempool.space/testnet/api");
    assert.strictEqual(esploraBase("bogus"),"https://mempool.space/signet/api","unknown network never hits mainnet");
    globalThis.ESPLORA_OVERRIDE_URL="https://node.example/api";                       // shared.js sets it from the stored endpoint override (own node)
    try{ assert.strictEqual(esploraBase("mainnet"),"https://node.example/api","override wins on every network"); assert.strictEqual(esploraBase("signet"),"https://node.example/api"); }
    finally{ globalThis.ESPLORA_OVERRIDE_URL=""; }
    assert.strictEqual(esploraBase("mainnet"),"https://mempool.space/api","empty override falls back to the table");
  });
  await t("fetchUtxos: maps the Esplora shape, null on HTTP error / throw / non-array",async()=>{
    const calls=[];
    fetchImpl=async(url,opts)=>{ calls.push({url,opts}); return {ok:true, json:async()=>[{txid:"ab".repeat(32), vout:1, status:{confirmed:true, block_height:1}, value:12345},{txid:"cd".repeat(32), vout:0, status:{confirmed:false}, value:1}]}; };
    const u=await fetchUtxos(key.address,"signet");
    assert.strictEqual(calls[0].url,`https://mempool.space/signet/api/address/${key.address}/utxo`);
    assert.deepStrictEqual(u,[{txid:"ab".repeat(32), vout:1, value:12345, confirmed:true},{txid:"cd".repeat(32), vout:0, value:1, confirmed:false}]);
    fetchImpl=async()=>({ok:false, status:400, json:async()=>({})}); assert.strictEqual(await fetchUtxos(key.address,"mainnet"),null,"http error");
    fetchImpl=async()=>{ throw new TypeError("Failed to fetch"); }; assert.strictEqual(await fetchUtxos(key.address),null,"network error");
    fetchImpl=async()=>({ok:true, json:async()=>({oops:1})}); assert.strictEqual(await fetchUtxos(key.address),null,"non-array");
    fetchImpl=async()=>({ok:true, json:async()=>{ throw new SyntaxError("bad json"); }}); assert.strictEqual(await fetchUtxos(key.address),null,"bad json");
  });
  await t("broadcastTx: POST text/plain hex, {txid} on success, {error} on rejection / throw",async()=>{
    let seen=null; const hex="0200000000010100", txid="ef".repeat(32);
    fetchImpl=async(url,opts)=>{ seen={url,opts}; return {ok:true, status:200, text:async()=>txid+"\n"}; };
    assert.deepStrictEqual(await broadcastTx(hex,"mainnet"),{txid});
    assert.strictEqual(seen.url,"https://mempool.space/api/tx"); assert.strictEqual(seen.opts.method,"POST"); assert.strictEqual(seen.opts.body,hex); assert.strictEqual(seen.opts.headers["content-type"],"text/plain");
    fetchImpl=async()=>({ok:false, status:400, text:async()=>"sendrawtransaction RPC error: {\"code\":-26,\"message\":\"min relay fee not met\"}"});
    const e=await broadcastTx(hex,"signet"); assert.ok(e.error&&/min relay fee/.test(e.error)&&!e.txid);
    fetchImpl=async()=>({ok:false, status:502, text:async()=>""}); assert.deepStrictEqual(await broadcastTx(hex),{error:"HTTP 502"});
    fetchImpl=async()=>{ throw new TypeError("Failed to fetch"); }; assert.deepStrictEqual(await broadcastTx(hex),{error:"Failed to fetch"});
    fetchImpl=async()=>({ok:true, status:200, text:async()=>"<html>proxy page</html>"}); assert.ok((await broadcastTx(hex)).error,"non-txid body on 200 is an error");
  });

  console.log(`\n1..${n}\n# ${failed?`FAILED ${failed}/${n}`:`all ${n} passed`}`);
  process.exit(failed?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
