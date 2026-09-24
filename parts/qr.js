// ---------- qr.js: funded PSBT + BBQr (bbqr.org) for the Coldcard Q flow — pure, no DOM ----------
// Uses from shared.js: toHex, enc, varint, le64, scriptPubKey, serializeUnsignedTx, rhex. Defines nothing twice.
// Shapes: utxo = {txid, vout, value, address[, bip32]}; output = {value, script:Uint8Array};
//         bip32 = {pubkey:Uint8Array(33), fingerprint:Uint8Array(4), path:number[]} (hardened = index | 0x80000000).

function fromHex(hex){
  if(typeof hex!=="string" || hex.length%2 || /[^0-9a-fA-F]/.test(hex)) throw new Error("bad hex");
  const out=new Uint8Array(hex.length/2);
  for(let i=0;i<out.length;i++) out[i]=parseInt(hex.substr(i*2,2),16);
  return out;
}
function concatBytes(parts){                                     // [Uint8Array|number[]] -> Uint8Array, no spread (no argument-count limit)
  let n=0; for(const p of parts) n+=p.length;
  const out=new Uint8Array(n); let o=0;
  for(const p of parts){ out.set(p,o); o+=p.length; }
  return out;
}
function readVarint(b,p){                                        // -> [n, nextPos]
  if(p>=b.length) throw new Error("truncated");
  const x=b[p];
  if(x<0xfd) return [x,p+1];
  if(x===0xfd) return [b[p+1]|(b[p+2]<<8), p+3];
  if(x===0xfe) return [(b[p+1]|(b[p+2]<<8)|(b[p+3]<<16)|(b[p+4]<<24))>>>0, p+5];
  throw new Error("varint too large");
}

// ---------- txid ----------
async function sha256d(bytes){
  const one=await crypto.subtle.digest("SHA-256",bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256",one));
}
function stripWitness(rawHex){                                   // segwit serialization (BIP-144, marker 00 flag 01) -> legacy serialization; legacy passes through
  const b=fromHex(rawHex);
  if(b.length<10 || b[4]!==0x00 || b[5]!==0x01) return rawHex;
  const need=(p,n)=>{ if(p+n>b.length) throw new Error("truncated"); };
  try{
    const out=[b.subarray(0,4)]; let p=6, nIn, nOut, n;
    [nIn,p]=readVarint(b,p); if(nIn===0) return rawHex;           // a witness tx has inputs; "00 01" with none is a 0-input legacy tx with one output
    out.push(varint(nIn));
    for(let i=0;i<nIn;i++){ const s=p; need(p,36); p+=36; [n,p]=readVarint(b,p); need(p,n+4); p+=n+4; out.push(b.subarray(s,p)); }
    [nOut,p]=readVarint(b,p); out.push(varint(nOut));
    for(let i=0;i<nOut;i++){ const s=p; need(p,8); p+=8; [n,p]=readVarint(b,p); need(p,n); p+=n; out.push(b.subarray(s,p)); }
    for(let i=0;i<nIn;i++){ let k; [k,p]=readVarint(b,p); for(let j=0;j<k;j++){ [n,p]=readVarint(b,p); need(p,n); p+=n; } }
    need(p,4); if(p+4!==b.length) throw new Error("trailing bytes");
    out.push(b.subarray(p,p+4));
    return toHex(concatBytes(out));
  }catch{ return rawHex; }                                        // did not parse as segwit: treat the bytes as a legacy tx
}
async function txidOf(rawHex){                                   // double SHA-256 of the legacy serialization, byte-reversed, hex
  const h=await sha256d(fromHex(stripWitness(rawHex)));
  return toHex(h.reverse());
}

// ---------- PSBT (BIP-174) ----------
function psbtKV(type,keydata,value){                             // varint(keylen) + type + keydata, varint(vallen) + value
  const key=concatBytes([[type],keydata||[]]);
  return concatBytes([varint(key.length),key,varint(value.length),value]);
}
function serializePsbt({unsignedTxHex, inputs=[], outputs=[]}){  // inputs: [{value, script[, bip32]}] -> witness_utxo (+ bip32_derivation); outputs: one empty map each
  const parts=[[0x70,0x73,0x62,0x74,0xff], psbtKV(0x00,[],fromHex(unsignedTxHex)), [0x00]];
  for(const inp of inputs){
    parts.push(psbtKV(0x01,[],concatBytes([le64(inp.value),varint(inp.script.length),inp.script])));
    if(inp.bip32){
      const {pubkey,fingerprint,path}=inp.bip32, v=[...fingerprint];
      for(const i of path) v.push(i&255,(i>>8)&255,(i>>16)&255,(i>>>24)&255);
      parts.push(psbtKV(0x06,pubkey,v));
    }
    parts.push([0x00]);
  }
  for(let i=0;i<outputs.length;i++) parts.push([0x00]);
  return concatBytes(parts);
}
function psbtBase64(bytes){
  let s=""; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(s);
}

// ---------- BBQr: base32 (RFC 4648, no padding) split across QR codes, 8-char header "B$" enc type NN II (base36) ----------
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(bytes){
  let acc=0,bits=0,out="";
  for(const b of bytes){ acc=((acc<<8)|b)&0xfff; bits+=8; while(bits>=5){ bits-=5; out+=B32[(acc>>bits)&31]; } }
  if(bits>0) out+=B32[(acc<<(5-bits))&31];
  return out;
}
function base32Decode(str){                                      // padding optional; leftover bits (< 8) are dropped
  const s=str.replace(/=+$/,"").toUpperCase(), out=[];
  let acc=0,bits=0;
  for(const c of s){ const v=B32.indexOf(c); if(v<0) throw new Error("bad base32 character"); acc=((acc<<5)|v)&0xfff; bits+=5; if(bits>=8){ bits-=8; out.push((acc>>bits)&255); } }
  return new Uint8Array(out);
}
function bbqrB36(n){ return n.toString(36).toUpperCase().padStart(2,"0"); }
function bbqrEncode(bytes, fileType="P", maxChars=1000){         // "P" PSBT, "T" transaction, "U" unicode text -> ["B$2P0A00...", ...]
  if(!/^[A-Z]$/.test(fileType)) throw new Error("bad BBQr file type");
  const chunk=Math.floor((maxChars-8)/8)*8;                      // whole base32 groups per part, so every part but the last is a multiple of 8 chars
  if(chunk<8) throw new Error("maxChars too small");
  const payload=base32Encode(bytes), count=Math.max(1,Math.ceil(payload.length/chunk));
  if(count>1295) throw new Error("too many BBQr parts");          // "ZZ" in base36
  const parts=[];
  for(let i=0;i<count;i++) parts.push("B$2"+fileType+bbqrB36(count)+bbqrB36(i)+payload.slice(i*chunk,(i+1)*chunk));
  return parts;
}
function bbqrIsPart(str){ return typeof str==="string" && /^B\$[2HZ][A-Z][0-9A-Z]{4}/.test(str.trim()); }
function bbqrDecode(parts){                                      // any order, duplicates fine -> {fileType, bytes, count}
  if(!Array.isArray(parts)||!parts.length) throw new Error("no BBQr parts");
  const seen=new Map(); let count=null, fileType=null, encoding=null;
  for(const raw of parts){
    const p=String(raw).trim();
    if(!bbqrIsPart(p)) throw new Error("not a BBQr part");
    const e=p[2], ft=p[3], n=parseInt(p.slice(4,6),36), i=parseInt(p.slice(6,8),36);
    if(count===null){ count=n; fileType=ft; encoding=e; }
    else if(n!==count||ft!==fileType||e!==encoding) throw new Error("parts belong to different BBQr sets");
    if(!(n>0)||i>=n) throw new Error("bad BBQr part index");
    const body=p.slice(8);
    if(seen.has(i)&&seen.get(i)!==body) throw new Error("conflicting duplicate BBQr part "+i);
    seen.set(i,body);
  }
  if(seen.size!==count){ const missing=[]; for(let i=0;i<count;i++) if(!seen.has(i)) missing.push(i); throw new Error("missing BBQr parts: "+missing.join(",")); }
  let payload=""; for(let i=0;i<count;i++) payload+=seen.get(i);
  let bytes;
  if(encoding==="2") bytes=base32Decode(payload);
  else if(encoding==="H") bytes=fromHex(payload);
  else throw new Error("unsupported BBQr encoding "+encoding);   // "Z" (zlib) would need an inflater
  return {fileType, bytes, count};
}

// ---------- funding ----------
function estimateVsize(nIn,nOut){                                // rough P2WPKH sizing: overhead 11 + 68 per input + 31 per output (vbytes).
  return 11+nIn*68+nOut*31;                                      // P2WSH outputs are 43 and an OP_RETURN is 9 + data length; callers add that on top if they care.
}
function serializeUnsignedTxWithInputs(inputs, outputs){          // version 2, empty scriptSigs, sequence 0xfffffffd (RBF), locktime 0
  const parts=[[0x02,0,0,0], varint(inputs.length)];
  for(const i of inputs){
    if(typeof i.txid!=="string"||i.txid.length!==64) throw new Error("bad txid");
    parts.push(fromHex(i.txid).reverse(), [i.vout&255,(i.vout>>8)&255,(i.vout>>16)&255,(i.vout>>>24)&255, 0x00, 0xfd,0xff,0xff,0xff]);
  }
  parts.push(varint(outputs.length));
  for(const o of outputs) parts.push(le64(o.value), varint(o.script.length), o.script);
  parts.push([0,0,0,0]);
  return toHex(concatBytes(parts));
}
function buildFundedPsbt({utxos=[], outputs=[], changeAddr, feeRate=1}){
  const outSum=outputs.reduce((a,o)=>a+o.value,0), sel=[];
  let total=0, fee=0, funded=false;
  for(const u of utxos){                                         // in the given order until outputs + fee are covered
    sel.push(u); total+=u.value;
    fee=Math.ceil(feeRate*estimateVsize(sel.length, outputs.length+1));
    if(total>=outSum+fee){ funded=true; break; }
  }
  if(!funded) throw new Error("insufficient funds");
  let change=total-outSum-fee;
  const outs=outputs.map(o=>({value:o.value, script:o.script}));
  if(change>=330) outs.push({value:change, script:scriptPubKey(changeAddr)});
  else { fee=total-outSum; change=0; }                            // dust change goes to the miners
  const inputs=sel.map(u=>({txid:u.txid, vout:u.vout, value:u.value, address:u.address, script:scriptPubKey(u.address), ...(u.bip32?{bip32:u.bip32}:{})}));
  const unsignedTxHex=serializeUnsignedTxWithInputs(inputs, outs);
  const psbt=serializePsbt({unsignedTxHex, inputs, outputs:outs});
  return {psbt, base64:psbtBase64(psbt), unsignedTxHex, fee, change, inputs, outputs:outs};
}
