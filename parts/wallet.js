// ---------- wallet.js: burner wallet — BIP-39 words, BIP-84 key, P2WPKH signing (BIP-143/144), encrypted backup, mempool.space I/O. Pure, no DOM ----------
// Uses from shared.js / qr.js: toHex, fromHex, enc, varint, le64, bech32, scriptPubKey, concatBytes, sha256d, txidOf, estimateVsize, serializeUnsignedTxWithInputs. Defines nothing twice.
// The libraries (@scure/bip39, @scure/bip32, @noble/curves) are ESM, loaded lazily from jsdelivr on the first call that needs them; the node test injects them instead.

// ---------- libraries ----------
const WALLET_CDN="https://cdn.jsdelivr.net/npm/";
const WALLET_MODS=["@scure/bip39@1.4.0/+esm","@scure/bip39@1.4.0/wordlists/english/+esm","@scure/bip32@1.5.0/+esm","@noble/curves@1.6.0/secp256k1/+esm"];   // bip32@1.5.0 pins curves ~1.6.0 + hashes ~1.5.0: one copy of each on the page
let walletLibsP=null;
function walletLibs(injected){                                   // -> Promise<{bip39, wordlist, HDKey, secp}>; memoised; a failed load is retried on the next call
  if(injected) walletLibsP=Promise.resolve(injected);
  if(!walletLibsP) walletLibsP=Promise.all(WALLET_MODS.map(m=>import(WALLET_CDN+m)))
    .then(([b39,wl,b32,cur])=>({bip39:b39, wordlist:wl.wordlist, HDKey:b32.HDKey, secp:cur.secp256k1}))
    .catch(e=>{ walletLibsP=null; throw e; });
  return walletLibsP;
}

// ---------- RIPEMD-160 (plain JS: crypto.subtle has none) + HASH160 ----------
const RMD_R=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8, 3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12, 1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2, 4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
const RMD_RR=[5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12, 6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2, 15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13, 8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14, 12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
const RMD_S=[11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8, 7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12, 11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5, 11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12, 9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
const RMD_SR=[8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6, 9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11, 9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5, 15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8, 8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
const RMD_K=[0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e], RMD_KR=[0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0x00000000];
function ripemd160(bytes){                                       // Uint8Array | number[] -> Uint8Array(20)
  const f=(j,x,y,z)=> j<16 ? x^y^z : j<32 ? (x&y)|(~x&z) : j<48 ? (x|~y)^z : j<64 ? (x&z)|(y&~z) : x^(y|~z);
  const rol=(x,n)=>(x<<n)|(x>>>(32-n));
  const len=bytes.length, total=Math.ceil((len+9)/64)*64, m=new Uint8Array(total), dv=new DataView(m.buffer);
  m.set(bytes); m[len]=0x80;                                     // pad: 0x80, zeros, 64-bit little-endian bit length
  dv.setUint32(total-8,(len*8)>>>0,true); dv.setUint32(total-4,Math.floor(len/536870912),true);
  let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476,h4=0xc3d2e1f0;
  const X=new Uint32Array(16);
  for(let off=0;off<total;off+=64){
    for(let i=0;i<16;i++) X[i]=dv.getUint32(off+i*4,true);
    let al=h0,bl=h1,cl=h2,dl=h3,el=h4, ar=h0,br=h1,cr=h2,dr=h3,er=h4, t;
    for(let j=0;j<80;j++){
      const r=j>>4;
      t=(rol((al+f(j,bl,cl,dl)+X[RMD_R[j]]+RMD_K[r])|0,RMD_S[j])+el)|0; al=el; el=dl; dl=rol(cl,10); cl=bl; bl=t;
      t=(rol((ar+f(79-j,br,cr,dr)+X[RMD_RR[j]]+RMD_KR[r])|0,RMD_SR[j])+er)|0; ar=er; er=dr; dr=rol(cr,10); cr=br; br=t;
    }
    t=(h1+cl+dr)|0; h1=(h2+dl+er)|0; h2=(h3+el+ar)|0; h3=(h4+al+br)|0; h4=(h0+bl+cr)|0; h0=t;
  }
  const out=new Uint8Array(20), o=new DataView(out.buffer);
  [h0,h1,h2,h3,h4].forEach((h,i)=>o.setUint32(i*4,h>>>0,true));
  return out;
}
async function hash160(bytes){                                   // RIPEMD160(SHA256(bytes)) -> Promise<Uint8Array(20)>
  const u8=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return ripemd160(new Uint8Array(await crypto.subtle.digest("SHA-256",u8)));
}

// ---------- mnemonic + BIP-84 key ----------
const walletNorm=m=>String(m||"").normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
const walletNet=n=> n==="mainnet" ? {hrp:"bc", coin:0} : {hrp:"tb", coin:1};   // signet / testnet / testnet4 share hrp "tb" and coin type 1'
async function walletGenerate(){                                 // -> {mnemonic}: 12 words from 128 bits of crypto.getRandomValues
  const {bip39,wordlist}=await walletLibs();
  return {mnemonic:bip39.entropyToMnemonic(crypto.getRandomValues(new Uint8Array(16)),wordlist)};
}
async function walletValidate(mnemonic){                         // -> boolean (whitespace/case tolerant; checksum checked)
  const {bip39,wordlist}=await walletLibs();
  try{ return bip39.validateMnemonic(walletNorm(mnemonic),wordlist); }catch{ return false; }
}
async function walletDerive(mnemonic, passphrase="", network="mainnet"){   // -> {address, path, pubkey(33), privkey(32), fingerprint}; fingerprint = master key's (what a PSBT wants)
  const {bip39,wordlist,HDKey}=await walletLibs();
  const m=walletNorm(mnemonic);
  if(!bip39.validateMnemonic(m,wordlist)) throw new Error("invalid mnemonic");
  const {hrp,coin}=walletNet(network), path=`m/84'/${coin}'/0'/0/0`;
  const seed=await bip39.mnemonicToSeed(m,passphrase||"");
  const root=HDKey.fromMasterSeed(seed), k=root.derive(path);
  seed.fill(0);
  const pubkey=k.publicKey, privkey=k.privateKey;
  return {address:bech32(hrp,0,await hash160(pubkey)), path, pubkey, privkey, fingerprint:root.fingerprint};
}

// ---------- P2WPKH spend: coin selection, BIP-143 sighash, RFC6979 low-S ECDSA, BIP-144 witness serialization ----------
const walletU32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255];
const WALLET_SEQ=[0xfd,0xff,0xff,0xff];                          // same sequence serializeUnsignedTxWithInputs writes (RBF)
function walletVsize(nIn,scripts){ return estimateVsize(nIn,scripts.length)+scripts.reduce((a,s)=>a+s.length-22,0); }   // estimateVsize assumes 22-byte (P2WPKH) outputs; a P2WSH (34) or OP_RETURN script adds its extra bytes so 1 sat/vB stays at the relay floor
async function signP2wpkh({utxos=[], outputs=[], changeAddr, feeRate=1, key}){   // -> {hex, txid, fee, change, vsize (estimate the fee was priced on), actualVsize, inputs, outputs}
  if(!key||!key.pubkey||!key.privkey) throw new Error("missing key");
  const changeScript=scriptPubKey(changeAddr), outSum=outputs.reduce((a,o)=>a+o.value,0), sel=[];
  let total=0, fee=0, funded=false;
  for(const u of utxos){                                         // in the given order until outputs + fee (priced with a change output) are covered
    sel.push(u); total+=u.value;
    fee=Math.ceil(feeRate*walletVsize(sel.length,[...outputs.map(o=>o.script),changeScript]));
    if(total>=outSum+fee){ funded=true; break; }
  }
  if(!funded) throw new Error("insufficient funds");
  let change=total-outSum-fee;
  const outs=outputs.map(o=>({value:o.value, script:o.script}));
  if(change>=330) outs.push({value:change, script:changeScript});
  else { fee=total-outSum; change=0; }                            // dust change goes to the miners
  const vsize=walletVsize(sel.length,outs.map(o=>o.script));
  const hashPrevouts=await sha256d(concatBytes(sel.map(u=>concatBytes([fromHex(u.txid).reverse(),walletU32(u.vout)]))));
  const hashSequence=await sha256d(concatBytes(sel.map(()=>WALLET_SEQ)));
  const hashOutputs=await sha256d(concatBytes(outs.map(o=>concatBytes([le64(o.value),varint(o.script.length),o.script]))));
  const scriptCode=concatBytes([[0x19,0x76,0xa9,0x14],await hash160(key.pubkey),[0x88,0xac]]);   // varint(25) + OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
  const {secp}=await walletLibs();
  const witnesses=[];
  for(const u of sel){
    const preimage=concatBytes([[2,0,0,0],hashPrevouts,hashSequence,fromHex(u.txid).reverse(),walletU32(u.vout),scriptCode,le64(u.value),WALLET_SEQ,hashOutputs,[0,0,0,0],[1,0,0,0]]);
    const sig=concatBytes([secp.sign(await sha256d(preimage),key.privkey,{lowS:true}).toDERRawBytes(),[0x01]]);   // DER + SIGHASH_ALL
    witnesses.push(concatBytes([varint(2),varint(sig.length),sig,varint(key.pubkey.length),key.pubkey]));
  }
  const u=fromHex(serializeUnsignedTxWithInputs(sel.map(x=>({txid:x.txid, vout:x.vout})),outs));
  const wit=concatBytes(witnesses);
  const hex=toHex(concatBytes([u.subarray(0,4),[0x00,0x01],u.subarray(4,u.length-4),wit,u.subarray(u.length-4)]));   // version, marker+flag, inputs+outputs, witnesses, locktime
  const actualVsize=Math.ceil((3*u.length+u.length+2+wit.length)/4);   // weight = 3 × base + total
  return {hex, txid:await txidOf(hex), fee, change, vsize, actualVsize, inputs:sel, outputs:outs};
}

// ---------- encrypted backup: PBKDF2-SHA256 (200k) -> AES-GCM-256; blob = base64(JSON{v,iter,salt,iv,ct}) ----------
const WALLET_ITER=200000;
async function walletKey(pass,salt,iterations){
  const base=await crypto.subtle.importKey("raw",enc.encode(pass),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptSecret(text,pass){                         // -> Promise<string>
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await walletKey(pass,salt,WALLET_ITER),enc.encode(text)));
  return btoa(JSON.stringify({v:1, kdf:"pbkdf2-sha256", iter:WALLET_ITER, salt:toHex(salt), iv:toHex(iv), ct:toHex(ct)}));
}
async function decryptSecret(blob,pass){                         // -> Promise<string>; throws "wrong password" on a bad key or tampered blob
  let j; try{ j=JSON.parse(atob(String(blob).trim())); }catch{ throw new Error("not an encrypted backup"); }
  if(!j||typeof j.salt!=="string"||typeof j.iv!=="string"||typeof j.ct!=="string") throw new Error("not an encrypted backup");
  const key=await walletKey(pass,fromHex(j.salt),j.iter||WALLET_ITER);
  try{ return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:fromHex(j.iv)},key,fromHex(j.ct))); }
  catch{ throw new Error("wrong password"); }
}

// ---------- explorer I/O (mempool.space, Esplora API; CORS open, text/plain POST needs no preflight) ----------
const WALLET_ESPLORA={mainnet:"", signet:"signet/", testnet:"testnet/", testnet4:"testnet4/"};
const esploraBase=network=> (typeof ESPLORA_OVERRIDE_URL==="string"&&ESPLORA_OVERRIDE_URL) ? ESPLORA_OVERRIDE_URL : (typeof LIVE_BASE==="string"&&LIVE_BASE&&typeof NET==="string"&&network===NET) ? LIVE_BASE : "https://mempool.space/"+(WALLET_ESPLORA[network]??"signet/")+"api";   // a page-level override (own node) wins; unknown network -> signet, never mainnet by accident
async function fetchUtxos(address,network="mainnet"){            // -> [{txid, vout, value, confirmed}] | null on any failure
  for(let i=0;i<2;i++){                                             // 6 s each, a second try: a stale connection often answers the next time
    try{
      const r=await fetch(`${esploraBase(network)}/address/${address}/utxo`,{headers:{accept:"application/json"}, signal:typeof AbortSignal!=="undefined"&&AbortSignal.timeout?AbortSignal.timeout(6000):undefined});
      if(!r.ok) return null;
      const j=await r.json();
      return Array.isArray(j) ? j.map(u=>({txid:u.txid, vout:u.vout, value:u.value, confirmed:!!(u.status&&u.status.confirmed)})) : null;
    }catch{ if(i) return null; }
  }
}
async function broadcastTx(hex,network="mainnet"){               // -> {txid} | {error}
  try{
    const r=await fetch(`${esploraBase(network)}/tx`,{method:"POST", headers:{"content-type":"text/plain"}, body:hex});
    const text=(await r.text()).trim();
    return r.ok && /^[0-9a-f]{64}$/i.test(text) ? {txid:text.toLowerCase()} : {error:text||`HTTP ${r.status}`};
  }catch(e){ return {error:(e&&e.message)||"network error"}; }
}
