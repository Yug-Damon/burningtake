// node qr-test.js — loads parts/shared.js + parts/qr.js as browser code and checks the PSBT / BBQr API.
"use strict";
const fs=require("fs"), path=require("path"), assert=require("assert");

// ---------- load: both files in one function scope, DOM globals stubbed, pure functions returned ----------
const src=fs.readFileSync(path.join(__dirname,"parts/shared.js"),"utf8")+"\n"+fs.readFileSync(path.join(__dirname,"parts/qr.js"),"utf8");
const names=["toHex","enc","varint","le64","scriptPubKey","opReturnScript","serializeUnsignedTx","rhex",
  "fromHex","sha256d","txidOf","stripWitness","serializePsbt","psbtBase64","base32Encode","base32Decode",
  "bbqrEncode","bbqrDecode","bbqrIsPart","estimateVsize","serializeUnsignedTxWithInputs","buildFundedPsbt"];
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
const api=new Function("document","window","localStorage","matchMedia","navigator","addEventListener",
  src+"\nreturn {"+names.join(",")+"};")(doc, {}, {getItem:()=>null, setItem(){}}, ()=>({matches:false}), {}, ()=>{});
const {toHex,enc,scriptPubKey,opReturnScript,fromHex,sha256d,txidOf,stripWitness,serializePsbt,psbtBase64,base32Encode,base32Decode,
  bbqrEncode,bbqrDecode,bbqrIsPart,estimateVsize,serializeUnsignedTxWithInputs,buildFundedPsbt}=api;

// ---------- tiny parsers used by the assertions (independent of qr.js) ----------
function reader(u8){
  let p=0;
  const rv=()=>{ const x=u8[p]; if(x<0xfd){p++;return x;} if(x===0xfd){const n=u8[p+1]|(u8[p+2]<<8);p+=3;return n;} const n=(u8[p+1]|(u8[p+2]<<8)|(u8[p+3]<<16)|(u8[p+4]<<24))>>>0;p+=5;return n; };
  const take=n=>{ const s=u8.subarray(p,p+n); p+=n; return s; };
  const u32=()=>{ const s=take(4); return (s[0]|(s[1]<<8)|(s[2]<<16)|(s[3]<<24))>>>0; };
  const u64=()=>{ const lo=u32(), hi=u32(); return hi*4294967296+lo; };
  return {rv,take,u32,u64, pos:()=>p, len:u8.length};
}
function parseTx(u8){                                            // legacy serialization only
  const r=reader(u8), version=r.u32(), inputs=[], outputs=[];
  let nIn=r.rv();
  for(let i=0;i<nIn;i++){ const txid=toHex([...r.take(32)].reverse()), vout=r.u32(), script=toHex(r.take(r.rv())), sequence=r.u32(); inputs.push({txid,vout,script,sequence}); }
  const nOut=r.rv();
  for(let i=0;i<nOut;i++){ const value=r.u64(), script=toHex(r.take(r.rv())); outputs.push({value,script}); }
  const locktime=r.u32();
  assert.strictEqual(r.pos(),r.len,"tx fully consumed");
  return {version,inputs,outputs,locktime};
}
function parsePsbt(u8){
  assert.strictEqual(toHex(u8.subarray(0,5)),"70736274ff","psbt magic");
  const r=reader(u8); r.take(5);
  const readMap=()=>{ const m=[]; for(;;){ const kl=r.rv(); if(kl===0) return m; const key=r.take(kl), val=r.take(r.rv()); m.push({type:key[0], keydata:toHex(key.subarray(1)), value:val}); } };
  const global=readMap(), txEntry=global.find(e=>e.type===0x00);
  assert.ok(txEntry,"global map has PSBT_GLOBAL_UNSIGNED_TX");
  const tx=parseTx(txEntry.value), inputs=[], outputs=[];
  for(let i=0;i<tx.inputs.length;i++) inputs.push(readMap());
  for(let i=0;i<tx.outputs.length;i++) outputs.push(readMap());
  assert.strictEqual(r.pos(),r.len,"psbt fully consumed");
  return {global, unsignedTxHex:toHex(txEntry.value), tx, inputs, outputs};
}
const shuffle=a=>{ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const b36=n=>n.toString(36).toUpperCase().padStart(2,"0");

// BIP-173 test vectors: P2WPKH and P2WSH mainnet addresses
const P2WPKH="bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH="bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const BURN="bc1qrz05qq6tu7senu06nzgkdrhr4dsyn7pd8rrghec0t9h2ktsc27msqvznj2";   // P2WSH(OP_RETURN "pizza") from shared.js self-check

let n=0, failed=0;
async function t(name,fn){ try{ await fn(); n++; console.log(`ok ${n} - ${name}`); }catch(e){ n++; failed++; console.log(`not ok ${n} - ${name}\n  ${e && e.stack ? e.stack.split("\n").slice(0,3).join("\n  ") : e}`); } }

(async()=>{
  await t("fromHex / toHex round-trip and validation",()=>{
    assert.deepStrictEqual([...fromHex("00ff10")],[0,255,16]);
    assert.strictEqual(toHex(fromHex("deadBEEF")),"deadbeef");
    assert.strictEqual(fromHex("").length,0);
    assert.throws(()=>fromHex("abc"),/bad hex/); assert.throws(()=>fromHex("zz"),/bad hex/);
  });

  await t("base32: RFC 4648 vectors without padding",()=>{
    const v={"":"","f":"MY","fo":"MZXQ","foo":"MZXW6","foob":"MZXW6YQ","fooba":"MZXW6YTB","foobar":"MZXW6YTBOI"};
    for(const [s,b] of Object.entries(v)){ assert.strictEqual(base32Encode(enc.encode(s)),b,`encode ${JSON.stringify(s)}`); assert.strictEqual(Buffer.from(base32Decode(b)).toString(),s,`decode ${b}`); }
    assert.strictEqual(Buffer.from(base32Decode("MZXW6YTBOI======")).toString(),"foobar","padding tolerated");
    assert.strictEqual(Buffer.from(base32Decode("mzxw6ytboi")).toString(),"foobar","lowercase tolerated");
    assert.throws(()=>base32Decode("MZ1"),/bad base32/);
    const rnd=crypto.getRandomValues(new Uint8Array(1234));
    assert.deepStrictEqual(base32Decode(base32Encode(rnd)),rnd,"random round-trip");
  });

  await t("bbqrEncode: 3000 bytes at maxChars 500 -> >= 6 parts, 8-char headers, 8-aligned payloads",()=>{
    const bytes=crypto.getRandomValues(new Uint8Array(3000));
    const parts=bbqrEncode(bytes,"P",500);
    assert.ok(parts.length>=6,`parts=${parts.length}`);
    const count=parts.length;
    assert.strictEqual(count,Math.ceil(4800/488),"3000 bytes = 4800 base32 chars in 488-char chunks");
    parts.forEach((p,i)=>{
      assert.ok(p.length<=500,`part ${i} fits in 500 chars`);
      assert.strictEqual(p.slice(0,8),"B$2P"+b36(count)+b36(i),`header of part ${i}`);
      if(i<count-1) assert.strictEqual(p.length-8,488,`part ${i} payload is 488 chars`);
      assert.match(p.slice(8),/^[A-Z2-7]*$/,`part ${i} payload alphabet`);
    });
    console.log(`   headers: ${parts[0].slice(0,8)} .. ${parts[count-1].slice(0,8)}`);
    assert.strictEqual(bbqrEncode(new Uint8Array(0),"U",100).length,1,"empty payload is one part");
    assert.strictEqual(bbqrEncode(new Uint8Array(0),"U",100)[0],"B$2U0100");
    assert.throws(()=>bbqrEncode(bytes,"p",500),/file type/);
    assert.throws(()=>bbqrEncode(bytes,"P",10),/too small/);
  });

  await t("bbqrDecode: shuffled + duplicated parts give identical bytes and fileType P",()=>{
    const bytes=crypto.getRandomValues(new Uint8Array(3000));
    const parts=bbqrEncode(bytes,"P",500);
    const mixed=shuffle([...parts, parts[3], parts[0], " "+parts[5]+"\n"]);
    const out=bbqrDecode(mixed);
    assert.strictEqual(out.fileType,"P"); assert.strictEqual(out.count,parts.length);
    assert.deepStrictEqual(out.bytes,bytes);
    assert.throws(()=>bbqrDecode(parts.slice(1)),/missing BBQr parts: 0/);
    assert.throws(()=>bbqrDecode([...parts, bbqrEncode(bytes,"T",500)[0]]),/different BBQr sets/);
    assert.throws(()=>bbqrDecode([parts[0].slice(0,8)+"AAAAAAAA", ...parts]),/conflicting duplicate/);
    assert.throws(()=>bbqrDecode(["hello"]),/not a BBQr part/);
    assert.throws(()=>bbqrDecode([]),/no BBQr parts/);
    const single=bbqrEncode(enc.encode("hi there"),"U");
    assert.strictEqual(single.length,1); assert.strictEqual(Buffer.from(bbqrDecode(single).bytes).toString(),"hi there");
    const hex=bbqrDecode(["B$HT0100"+"DEADBEEF"]); assert.strictEqual(hex.fileType,"T"); assert.strictEqual(toHex(hex.bytes),"deadbeef");
    assert.throws(()=>bbqrDecode(["B$ZP0100AAAA"]),/unsupported BBQr encoding Z/);
  });

  await t("bbqrIsPart",()=>{
    assert.strictEqual(bbqrIsPart("B$2P0A00MZXW"),true);
    assert.strictEqual(bbqrIsPart("B$HT0100DEAD"),true);
    assert.strictEqual(bbqrIsPart("B$2P0A00"),true);
    assert.strictEqual(bbqrIsPart("  B$2P0A00\n"),true);
    assert.strictEqual(bbqrIsPart("B$2p0A00"),false);
    assert.strictEqual(bbqrIsPart("bitcoin:bc1q..."),false);
    assert.strictEqual(bbqrIsPart("cHNidP8BAH"),false);
    assert.strictEqual(bbqrIsPart(null),false);
    assert.strictEqual(bbqrIsPart(""),false);
  });

  const GENESIS="01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000";
  await t("txidOf: genesis coinbase",async()=>{
    assert.strictEqual(await txidOf(GENESIS),"4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b");
    assert.strictEqual(stripWitness(GENESIS),GENESIS,"legacy passes through");
    const h=await sha256d(enc.encode("hello"));                  // sha256d("hello") = 9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50
    assert.strictEqual(toHex(h),"9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50");
  });

  await t("stripWitness: segwit serialization of a 2-in/2-out tx -> same txid as its legacy form",async()=>{
    const legacy=serializeUnsignedTxWithInputs(
      [{txid:"aa".repeat(32),vout:1},{txid:"bb".repeat(32),vout:0}],
      [{value:25000,script:scriptPubKey(BURN)},{value:12345,script:scriptPubKey(P2WPKH)}]);
    const tx=parseTx(fromHex(legacy));
    // rebuild with marker/flag and a witness stack per input (2 items: fake sig 71 bytes + pubkey 33 bytes)
    const b=fromHex(legacy), body=b.subarray(4,b.length-4), lock=b.subarray(b.length-4);
    const wit=[]; for(let i=0;i<2;i++){ wit.push(0x02, 71, ...new Uint8Array(71).fill(0x30+i), 33, ...new Uint8Array(33).fill(0x02)); }
    const segwit=toHex(new Uint8Array([...b.subarray(0,4),0x00,0x01,...body,...wit,...lock]));
    assert.strictEqual(stripWitness(segwit),legacy);
    assert.strictEqual(await txidOf(segwit),await txidOf(legacy));
    assert.strictEqual(tx.inputs.length,2); assert.strictEqual(tx.inputs[0].txid,"aa".repeat(32)); assert.strictEqual(tx.inputs[0].vout,1);
    assert.strictEqual(tx.inputs[0].script,""); assert.strictEqual(tx.inputs[0].sequence,0xfffffffd);
    assert.strictEqual(tx.version,2); assert.strictEqual(tx.locktime,0);
    assert.strictEqual(tx.outputs[1].value,12345);
    // a 0-input legacy tx with exactly one output starts with "...0001" too: it must not be mistaken for segwit
    const zeroIn=api.serializeUnsignedTx([{value:5000,script:scriptPubKey(BURN)}]);
    assert.strictEqual(zeroIn.slice(8,12),"0001");
    assert.strictEqual(stripWitness(zeroIn),zeroIn);
    assert.strictEqual(stripWitness("0200000000010000000000"),"0200000000010000000000","garbage after a 0001 prefix passes through");
  });

  await t("serializePsbt: magic, unsigned tx and witness_utxo parse back (one input, no bip32)",()=>{
    const script=scriptPubKey(P2WPKH);
    const unsignedTxHex=serializeUnsignedTxWithInputs([{txid:"cc".repeat(32),vout:3}],[{value:9000,script:scriptPubKey(BURN)}]);
    const psbt=serializePsbt({unsignedTxHex, inputs:[{value:10000,script}], outputs:[{value:9000,script:scriptPubKey(BURN)}]});
    assert.ok(psbt instanceof Uint8Array);
    assert.strictEqual(toHex(psbt).slice(0,10),"70736274ff");
    const p=parsePsbt(psbt);
    assert.strictEqual(p.unsignedTxHex,unsignedTxHex);
    assert.strictEqual(p.global.length,1);
    assert.strictEqual(p.inputs.length,1); assert.strictEqual(p.outputs.length,1); assert.strictEqual(p.outputs[0].length,0);
    assert.strictEqual(p.inputs[0].length,1);
    const wu=p.inputs[0][0]; assert.strictEqual(wu.type,0x01); assert.strictEqual(wu.keydata,"");
    assert.strictEqual(toHex(wu.value),"1027000000000000"+"16"+toHex(script));   // 10000 sats LE + push(22) + P2WPKH script
    // exact bytes: magic, key 00 (len 1), value = tx, separator, input map, separator, output map
    const expected="70736274ff"+"01"+"00"+toHex(api.varint(unsignedTxHex.length/2))+unsignedTxHex+"00"
      +"01"+"01"+"1f"+"1027000000000000"+"16"+toHex(script)+"00"
      +"00";
    assert.strictEqual(toHex(psbt),expected);
    assert.strictEqual(psbtBase64(psbt),Buffer.from(psbt).toString("base64"));
    assert.ok(psbtBase64(psbt).startsWith("cHNidP8"),"base64 of a PSBT starts with cHNidP8");
  });

  await t("serializePsbt: bip32_derivation entry (key 06 + pubkey, value fingerprint + path LE)",()=>{
    const pubkey=new Uint8Array(33).fill(0x03), fingerprint=fromHex("d34db33f"), path=[0x80000054,0x80000000,0x80000000,0,7];
    const unsignedTxHex=serializeUnsignedTxWithInputs([{txid:"cc".repeat(32),vout:0}],[{value:1000,script:scriptPubKey(BURN)}]);
    const p=parsePsbt(serializePsbt({unsignedTxHex, inputs:[{value:2000,script:scriptPubKey(P2WPKH),bip32:{pubkey,fingerprint,path}}], outputs:[{}]}));
    assert.strictEqual(p.inputs[0].length,2);
    const d=p.inputs[0][1]; assert.strictEqual(d.type,0x06); assert.strictEqual(d.keydata,toHex(pubkey));
    assert.strictEqual(toHex(d.value),"d34db33f"+"54000080"+"00000080"+"00000080"+"00000000"+"07000000");
  });

  await t("psbtBase64: chunked btoa matches Buffer on a 200 KB payload",()=>{
    const big=require("crypto").randomFillSync(new Uint8Array(200000));   // getRandomValues caps at 64 KiB per call
    assert.strictEqual(psbtBase64(big),Buffer.from(big).toString("base64"));
    assert.strictEqual(psbtBase64(new Uint8Array(0)),"");
  });

  await t("estimateVsize",()=>{
    assert.strictEqual(estimateVsize(1,2),11+68+62);
    assert.strictEqual(estimateVsize(2,2),209);
    assert.strictEqual(estimateVsize(0,0),11);
  });

  await t("buildFundedPsbt: 20000 + 30000 sats for 25000 out -> both inputs, change = 50000-25000-fee, PSBT has 2 inputs",()=>{
    const utxos=[{txid:"11".repeat(32),vout:0,value:20000,address:P2WPKH},{txid:"22".repeat(32),vout:5,value:30000,address:P2WSH}];
    const outputs=[{value:25000,script:scriptPubKey(BURN)}];
    const r=buildFundedPsbt({utxos, outputs, changeAddr:P2WPKH, feeRate:1});
    assert.strictEqual(r.inputs.length,2,"20000 < 25000 + fee, so both utxos are needed");
    assert.strictEqual(r.fee,estimateVsize(2,2));
    assert.strictEqual(r.change,50000-25000-r.fee);
    assert.ok(r.change>=330);
    assert.strictEqual(r.inputs[0].txid,"11".repeat(32)); assert.strictEqual(r.inputs[1].vout,5);
    assert.strictEqual(toHex(r.inputs[1].script),toHex(scriptPubKey(P2WSH)));
    const p=parsePsbt(r.psbt);
    assert.strictEqual(p.unsignedTxHex,r.unsignedTxHex);
    assert.strictEqual(p.tx.version,2); assert.strictEqual(p.tx.locktime,0);
    assert.strictEqual(p.tx.inputs.length,2); assert.strictEqual(p.inputs.length,2);
    assert.deepStrictEqual(p.tx.inputs.map(i=>[i.txid,i.vout,i.script,i.sequence]),[["11".repeat(32),0,"",0xfffffffd],["22".repeat(32),5,"",0xfffffffd]]);
    assert.strictEqual(p.tx.outputs.length,2);
    assert.deepStrictEqual(p.tx.outputs[0],{value:25000,script:toHex(scriptPubKey(BURN))});
    assert.deepStrictEqual(p.tx.outputs[1],{value:r.change,script:toHex(scriptPubKey(P2WPKH))});
    assert.strictEqual(p.outputs.length,2);
    assert.strictEqual(toHex(p.inputs[0][0].value),toHex(api.le64(20000))+"16"+toHex(scriptPubKey(P2WPKH)));
    assert.strictEqual(toHex(p.inputs[1][0].value),toHex(api.le64(30000))+"22"+toHex(scriptPubKey(P2WSH)));
    assert.strictEqual(r.base64,Buffer.from(r.psbt).toString("base64"));
    assert.strictEqual(r.outputs.length,2);
    // and it splits into BBQr parts that come back as the same PSBT
    const parts=bbqrEncode(r.psbt,"P",200), back=bbqrDecode(shuffle([...parts]));
    assert.ok(parts.length>1); assert.strictEqual(back.fileType,"P"); assert.deepStrictEqual(back.bytes,r.psbt);
  });

  await t("buildFundedPsbt: first utxo alone when it covers outputs + fee; dust change is absorbed into the fee",()=>{
    const utxos=[{txid:"11".repeat(32),vout:0,value:30000,address:P2WPKH},{txid:"22".repeat(32),vout:1,value:30000,address:P2WPKH}];
    const r=buildFundedPsbt({utxos, outputs:[{value:25000,script:scriptPubKey(BURN)}], changeAddr:P2WPKH});
    assert.strictEqual(r.inputs.length,1); assert.strictEqual(r.fee,estimateVsize(1,2)); assert.strictEqual(r.change,30000-25000-r.fee);
    assert.strictEqual(parsePsbt(r.psbt).tx.outputs.length,2);
    // 25000 + fee(141) = 25141; a 25300 utxo leaves 159 sats of change: below 330, no change output, fee = 300
    const d=buildFundedPsbt({utxos:[{txid:"33".repeat(32),vout:0,value:25300,address:P2WPKH}], outputs:[{value:25000,script:scriptPubKey(BURN)}], changeAddr:P2WPKH});
    assert.strictEqual(d.change,0); assert.strictEqual(d.fee,300);
    assert.strictEqual(parsePsbt(d.psbt).tx.outputs.length,1);
    // feeRate scales and rounds up; OP_RETURN payload output is carried through untouched
    const f=buildFundedPsbt({utxos, outputs:[{value:25000,script:scriptPubKey(BURN)},{value:0,script:opReturnScript(enc.encode("pizza"))}], changeAddr:P2WPKH, feeRate:2.5});
    assert.strictEqual(f.fee,Math.ceil(2.5*estimateVsize(1,3)));
    const ft=parsePsbt(f.psbt).tx; assert.strictEqual(ft.outputs[1].script,"6a0570697a7a61"); assert.strictEqual(ft.outputs[1].value,0);
    // bip32 hints on a utxo end up in its input map
    const b=buildFundedPsbt({utxos:[{...utxos[0],bip32:{pubkey:new Uint8Array(33).fill(2),fingerprint:fromHex("01020304"),path:[0,1]}}], outputs:[{value:25000,script:scriptPubKey(BURN)}], changeAddr:P2WPKH});
    assert.strictEqual(parsePsbt(b.psbt).inputs[0].length,2);
  });

  await t("buildFundedPsbt: throws Error('insufficient funds')",()=>{
    const outputs=[{value:25000,script:scriptPubKey(BURN)}];
    assert.throws(()=>buildFundedPsbt({utxos:[{txid:"11".repeat(32),vout:0,value:10000,address:P2WPKH},{txid:"22".repeat(32),vout:0,value:12000,address:P2WPKH}], outputs, changeAddr:P2WPKH}),
      e=>e instanceof Error && e.message==="insufficient funds");
    assert.throws(()=>buildFundedPsbt({utxos:[], outputs, changeAddr:P2WPKH}),/insufficient funds/);
    // exactly the outputs but not the fee is still insufficient
    assert.throws(()=>buildFundedPsbt({utxos:[{txid:"11".repeat(32),vout:0,value:25000,address:P2WPKH}], outputs, changeAddr:P2WPKH}),/insufficient funds/);
    assert.throws(()=>buildFundedPsbt({utxos:[{txid:"11".repeat(32),vout:0,value:50000,address:"bc1qnotanaddress"}], outputs, changeAddr:P2WPKH}),/checksum|length|character/);
  });

  console.log(`\n${n-failed}/${n} passed`);
  process.exit(failed?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
