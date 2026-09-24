const enc=new TextEncoder(); const toHex=u8=>[...u8].map(b=>b.toString(16).padStart(2,"0")).join("");
const CH="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(v){const G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let c=1;for(const x of v){const b=c>>>25;c=((c&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((b>>>i)&1)c^=G[i]}return c>>>0}
function hrpExpand(h){const r=[];for(const ch of h)r.push(ch.charCodeAt(0)>>5);r.push(0);for(const ch of h)r.push(ch.charCodeAt(0)&31);return r}
function toWords(bytes){let acc=0,bits=0,out=[];for(const b of bytes){acc=((acc<<8)|b)&0xfff;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31)}}if(bits>0)out.push((acc<<(5-bits))&31);return out}
function bech32(hrp,ver,prog){const data=[ver,...toWords(prog)];const pm=polymod([...hrpExpand(hrp),...data,0,0,0,0,0,0])^1;const chk=[];for(let i=0;i<6;i++)chk.push((pm>>>(5*(5-i)))&31);return hrp+"1"+[...data,...chk].map(d=>CH[d]).join("")}
const BECH32M=0x2bc830a3;
const TIPADDR="bc1q_your_tip_address_goes_here";                 // placeholder: does not decode, so the tip output is left out until it is set
function fromWords(words){let acc=0,bits=0,out=[];for(const w of words){acc=((acc<<5)|w)&0xfff;bits+=5;while(bits>=8){bits-=8;out.push((acc>>bits)&255)}}if(bits>=5||((acc<<(8-bits))&255))throw new Error("bad padding");return new Uint8Array(out)}
function bech32Decode(addr){                                     // -> {hrp, version, program}; v0 = bech32, v1+ = bech32m (BIP-173 / BIP-350)
  if(typeof addr!=="string") throw new Error("not a string");
  if(addr!==addr.toLowerCase() && addr!==addr.toUpperCase()) throw new Error("mixed case");
  const s=addr.toLowerCase(), i=s.lastIndexOf("1");
  if(s.length<8||s.length>90||i<1||i+7>s.length) throw new Error("bad length");
  const hrp=s.slice(0,i), data=[...s.slice(i+1)].map(c=>CH.indexOf(c));
  if(data.includes(-1)) throw new Error("bad character");
  const version=data[0]; if(version>16) throw new Error("bad witness version");
  if(polymod([...hrpExpand(hrp),...data])!==(version===0?1:BECH32M)) throw new Error("bad checksum");
  const program=fromWords(data.slice(1,-6));
  if(program.length<2||program.length>40) throw new Error("bad program length");
  if(version===0&&program.length!==20&&program.length!==32) throw new Error("bad v0 program length");
  return {hrp, version, program};
}
function scriptPubKey(addr){ const {version,program}=bech32Decode(addr); return new Uint8Array([version?0x50+version:0x00, program.length, ...program]); }
function opReturnScript(bytes){ return new Uint8Array([0x6a, ...(bytes.length<=75?[bytes.length]:[0x4c,bytes.length]), ...bytes]); }   // 6a + minimal push
const varint=n=> n<0xfd?[n] : n<=0xffff?[0xfd,n&255,n>>8] : [0xfe,n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255];
const le64=sats=>{ const lo=sats%4294967296, hi=Math.floor(sats/4294967296); return [lo&255,(lo>>8)&255,(lo>>16)&255,(lo>>>24)&255,hi&255,(hi>>8)&255,(hi>>16)&255,(hi>>>24)&255]; };
function serializeUnsignedTx(outputs){                           // version 2, no inputs, no witness, locktime 0 — a wallet funds and signs it
  const b=[0x02,0,0,0, ...varint(0), ...varint(outputs.length)];
  for(const o of outputs) b.push(...le64(o.value), ...varint(o.script.length), ...o.script);
  b.push(0,0,0,0);
  return toHex(new Uint8Array(b));
}
/* self-check (not executed): serializeUnsignedTx([{value:5000, script:scriptPubKey("bc1qrz05qq6tu7senu06nzgkdrhr4dsyn7pd8rrghec0t9h2ktsc27msqvznj2")},{value:0, script:opReturnScript(enc.encode("pizza"))}])
   === "02000000" + "00" + "02"
     + "8813000000000000" + "22" + "0020189f40034be7a199f1fa9891668ee3ab6049f82d38c68be70f596eab2e1857b7"
     + "0000000000000000" + "07" + "6a0570697a7a61"                                     // OP_RETURN push(5) "pizza"
     + "00000000"
   i.e. 0200000000028813000000000000220020189f40034be7a199f1fa9891668ee3ab6049f82d38c68be70f596eab2e1857b70000000000000000076a0570697a7a6100000000 */
function buildPayload({burnAddr, burnSats, statementBytes=null, tipAddr=null, tipSats=0}){
  const btc=v=>(v/1e8).toFixed(8);
  const outs=[], core=[], electrum=[];
  outs.push({label:"burn", addr:burnAddr, sats:burnSats, script:scriptPubKey(burnAddr)});
  core.push(`{"${burnAddr}":${btc(burnSats)}}`); electrum.push(`${burnAddr}, ${burnSats} sat`);
  if(statementBytes && statementBytes.length){
    const dataHex=toHex(statementBytes);
    outs.push({label:"OP_RETURN", addr:"OP_RETURN", sats:0, script:opReturnScript(statementBytes)});
    core.push(`{"data":"${dataHex}"}`); electrum.push(`OP_RETURN ${dataHex}, 0`);
  }
  let tipOmitted=false;
  if(tipSats>0){
    let ts=null; try{ ts=tipAddr?scriptPubKey(tipAddr):null; }catch{ ts=null; }
    if(ts){ outs.push({label:"tip", addr:tipAddr, sats:tipSats, script:ts}); core.push(`{"${tipAddr}":${btc(tipSats)}}`); electrum.push(`${tipAddr}, ${tipSats} sat`); }
    else tipOmitted=true;
  }
  return {
    outputs: outs.map(o=>({label:o.label, addr:o.addr, sats:o.sats, scriptHex:toHex(o.script)})),
    rawHex: serializeUnsignedTx(outs.map(o=>({value:o.sats, script:o.script}))),
    core: {
      createrawtransaction: `bitcoin-cli createrawtransaction '[]' '[${core.join(",")}]'`,
      note: "fundrawtransaction adds inputs and change to a zero-input transaction",
      next: ["bitcoin-cli fundrawtransaction <hex>", "bitcoin-cli signrawtransactionwithwallet <funded hex>", "bitcoin-cli sendrawtransaction <signed hex>"],
    },
    electrum: electrum.join("\n"),
    tipOmitted,
  };
}

const assert=require("assert");
const BURN="bc1qrz05qq6tu7senu06nzgkdrhr4dsyn7pd8rrghec0t9h2ktsc27msqvznj2";
const EXP="0200000000028813000000000000220020189f40034be7a199f1fa9891668ee3ab6049f82d38c68be70f596eab2e1857b70000000000000000076a0570697a7a6100000000";
const hex=serializeUnsignedTx([{value:5000,script:scriptPubKey(BURN)},{value:0,script:opReturnScript(enc.encode("pizza"))}]);
assert.strictEqual(hex,EXP,"raw tx mismatch"); console.log("raw tx OK");
const p0=buildPayload({burnAddr:BURN,burnSats:5000,statementBytes:enc.encode("pizza")});
assert.strictEqual(p0.rawHex,EXP); assert.strictEqual(p0.outputs.length,2); assert.strictEqual(p0.tipOmitted,false); console.log("buildPayload no tip OK");
const p1=buildPayload({burnAddr:BURN,burnSats:5000,statementBytes:enc.encode("pizza"),tipAddr:"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",tipSats:1000});
assert.strictEqual(p1.outputs.length,3); assert.strictEqual(p1.outputs[2].scriptHex.slice(0,4),"0014"); assert.strictEqual(p1.outputs[2].scriptHex.length,44); assert.strictEqual(p1.tipOmitted,false);
assert.ok(p1.rawHex.startsWith("020000000003")); assert.ok(p1.rawHex.includes("e803000000000000160014")); console.log("valid tip adds 0014 output OK");
const p2=buildPayload({burnAddr:BURN,burnSats:5000,statementBytes:enc.encode("pizza"),tipAddr:TIPADDR,tipSats:1000});
assert.strictEqual(p2.outputs.length,2); assert.strictEqual(p2.tipOmitted,true); assert.strictEqual(p2.rawHex,EXP); console.log("placeholder tip omitted OK");
assert.strictEqual(p1.core.createrawtransaction,`bitcoin-cli createrawtransaction '[]' '[{"${BURN}":0.00005000},{"data":"70697a7a61"},{"bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4":0.00001000}]'`); console.log("core 8dp + bare data hex OK");
assert.strictEqual(p1.electrum,`${BURN}, 5000 sat\nOP_RETURN 70697a7a61, 0\nbc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4, 1000 sat`); console.log("electrum OK");
// no statement (open scope root / no OP_RETURN)
const p3=buildPayload({burnAddr:BURN,burnSats:5000}); assert.strictEqual(p3.outputs.length,1); console.log("no statement OK");
console.log("ALL PAYLOAD CHECKS PASS");
