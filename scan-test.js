// node scan-test.js — loads parts/shared.js as browser code and checks the chain reader: OP_RETURN payloads, a transaction's burns (spec §4),
// registration names (spec §3, §7), history paging and retries, against transactions shaped like the Esplora API's.
"use strict";
const fs=require("fs"), path=require("path"), assert=require("assert");
const src=fs.readFileSync(path.join(__dirname,"parts","shared.js"),"utf8");
const names=["opReturnData","txBurns","nameOf","scanAddress","chainGet","deriveScope","canonical","parseScope"];
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
let fetchImpl=()=>{ throw new Error("fetch not stubbed"); };
const lib=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","fetch",src+"\nreturn {"+names.join(",")+"};")(
  doc, {}, {getItem:()=>null, setItem(){}}, ()=>({matches:false}), {}, ()=>{}, (...a)=>fetchImpl(...a));
const {opReturnData,txBurns,nameOf,scanAddress,chainGet,deriveScope}=lib;

// ---------- independent helpers: an OP_RETURN script, Esplora-shaped outputs and transactions ----------
const hex=s=>Buffer.from(s,"utf8").toString("hex");
const opret=s=>{ const b=Buffer.from(s,"utf8"); return "6a"+(b.length<=75?b.length.toString(16).padStart(2,"0"):"4c"+b.length.toString(16).padStart(2,"0"))+b.toString("hex"); };
const burn=(addr,value)=>({scriptpubkey:"0020"+"00".repeat(32), scriptpubkey_type:"v0_p2wsh", scriptpubkey_address:addr, value});
const ret=s=>({scriptpubkey:opret(s), scriptpubkey_type:"op_return", value:0});
const change=v=>({scriptpubkey:"0014"+"11".repeat(20), scriptpubkey_type:"v0_p2wpkh", scriptpubkey_address:"bc1qchange", value:v});
const TXID=n=>n.toString(16).padStart(64,"0");
const tx=(n,vout,h=null,from="bc1qburner0000000000000000000000000000abc")=>({txid:TXID(n), vin:[{prevout:{scriptpubkey_address:from}}], vout, status:h===null?{confirmed:false}:{confirmed:true, block_height:h}});

let n=0, failed=0; const ok=async(name,fn)=>{ n++; try{ await fn(); console.log(`ok ${n} - ${name}`); }catch(e){ failed++; console.log(`not ok ${n} - ${name}\n  ${e.message}`); } };
(async()=>{
  const A=(await deriveScope("general")).addr, B=(await deriveScope("paris-cars?yes|no")).addr, C=(await deriveScope("pizza")).addr;
  const topics=new Map([[A,"general"],[B,"paris-cars?yes|no"]]);

  await ok("opReturnData: one push, OP_PUSHDATA1, several pushes, not an OP_RETURN", ()=>{
    assert.strictEqual(Buffer.from(opReturnData(opret("hello"))).toString(), "hello");
    const long="x".repeat(80); assert.strictEqual(Buffer.from(opReturnData(opret(long))).toString(), long);
    assert.strictEqual(Buffer.from(opReturnData("6a0161"+"0162")).toString(), "ab");
    assert.strictEqual(opReturnData("0014"+"00".repeat(20)), null);
    assert.strictEqual(opReturnData("6a").length, 0);
  });
  await ok("txBurns: one burn, its statement, height, first-input burner and output index", ()=>{
    const r=txBurns(tx(1,[burn(A,5000),ret("Bitcoin fixes this"),change(12000)],900000),topics);
    assert.deepStrictEqual(r,[{txid:TXID(1), name:"general", t:"Bitcoin fixes this", sats:5000, vout:0, h:900000, from:"bc1qburner0000000000000000000000000000abc"}]);
  });
  await ok("txBurns: a batch, one shared OP_RETURN split on 0x1F, in the mempool", ()=>{
    const r=txBurns(tx(2,[burn(A,1000),burn(B,2000),ret("my take\x1fyes"),change(500)]),topics);
    assert.deepStrictEqual(r.map(b=>[b.name,b.t,b.sats,b.h]),[["general","my take",1000,null],["paris-cars?yes|no","yes",2000,null]]);
  });
  await ok("txBurns: one OP_RETURN per topic output, pieces taken in order", ()=>{
    const r=txBurns(tx(3,[burn(A,700),ret("take one"),burn(B,800),ret("no")],900001),topics);
    assert.deepStrictEqual(r.map(b=>[b.name,b.t]),[["general","take one"],["paris-cars?yes|no","no"]]);
  });
  await ok("txBurns: no OP_RETURN is an abstain; an empty piece too", ()=>{
    assert.strictEqual(txBurns(tx(4,[burn(A,330)],900002),topics)[0].t, "");
    const r=txBurns(tx(5,[burn(A,330),burn(B,330),ret("\x1fyes")],900002),topics);
    assert.deepStrictEqual(r.map(b=>b.t),["","yes"]);
  });
  await ok("txBurns: several outputs to one topic are summed, the first one's piece is the statement", ()=>{
    const r=txBurns(tx(6,[burn(A,400),burn(A,600),ret("x\x1fy")],900003),topics);
    assert.deepStrictEqual(r.map(b=>[b.name,b.t,b.sats,b.vout]),[["general","x",1000,0]]);
  });
  await ok("txBurns: a topic this page cannot name still takes its piece, in output order", ()=>{
    const r=txBurns(tx(7,[burn(C,900),burn(A,1000),ret("pizza take\x1fgeneral take")],900004),topics);
    assert.deepStrictEqual(r.map(b=>[b.name,b.t,b.sats]),[["general","general take",1000]]);
  });
  await ok("txBurns: an OP_RETURN without an output to a known topic is invisible", ()=>{
    assert.deepStrictEqual(txBurns(tx(8,[ret("hello"),change(1000)],900005),topics),[]);
    assert.deepStrictEqual(txBurns({txid:TXID(9)},topics),[]);
  });
  await ok("txBurns: UTF-8 statements come back as text", ()=>{
    assert.strictEqual(txBurns(tx(10,[burn(A,330),ret("café ☕ 🔥")],900006),topics)[0].t, "café ☕ 🔥");
  });
  await ok("nameOf: a registration states a canonical name; anything else in the root is some other burn (spec §3, §7)", ()=>{
    assert.strictEqual(nameOf("general"),"general");
    assert.strictEqual(nameOf("paris-cars?yes|no"),"paris-cars?yes|no");
    assert.strictEqual(nameOf("q?b|a@966000!1000"),"q?b|a@966000!1000");
    assert.strictEqual(nameOf("q?b|a!1000@966000"),null,"modifiers out of canonical order");
    assert.strictEqual(nameOf("btc-eoy?500000..50000"),null,"range bounds reversed");
    assert.strictEqual(nameOf("Paris Cars?Yes|No"),null,"uppercase and whitespace");
    assert.strictEqual(nameOf("ID:00\nInsta:Unknown\nLinkedin:Unknown"),null,"seen on mainnet at the root address");
    assert.strictEqual(nameOf(""),null);
  });
  await ok("scanAddress: the mempool from the first page, 25 confirmed per page, until a short page", async()=>{
    const conf=Array.from({length:60},(_,i)=>tx(100+i,[burn(A,330)],900100-i)), mem=[tx(99,[burn(A,330)])];
    const seen=[]; fetchImpl=async url=>{ seen.push(url); const m=url.match(/txs\/chain\/([0-9a-f]{64})$/); const from=m?conf.findIndex(t=>t.txid===m[1])+1:0;
      return {ok:true, json:async()=>m?conf.slice(from,from+25):[...mem,...conf.slice(0,25)]}; };
    const r=await scanAddress(A);
    assert.strictEqual(r.mempool.length,1); assert.strictEqual(r.confirmed.length,60); assert.strictEqual(r.requests,3);
    assert.ok(seen[0].endsWith(`/address/${A}/txs`)); assert.ok(seen[1].endsWith(`/txs/chain/${conf[24].txid}`));
  });
  await ok("scanAddress: stops at the newest burn already known", async()=>{
    const conf=Array.from({length:60},(_,i)=>tx(200+i,[burn(A,330)],900200-i));
    fetchImpl=async url=>{ const m=url.match(/txs\/chain\/([0-9a-f]{64})$/); const from=m?conf.findIndex(t=>t.txid===m[1])+1:0; return {ok:true, json:async()=>conf.slice(from,from+25)}; };
    const r=await scanAddress(A,{stopTx:conf[30].txid});
    assert.strictEqual(r.confirmed.length,30); assert.strictEqual(r.requests,2);
  });
  await ok("chainGet: a 429 is asked again, a 404 is not", async()=>{
    let calls=0; fetchImpl=async()=>(++calls===1?{ok:false,status:429}:{ok:true,json:async()=>({a:1})});
    assert.deepStrictEqual(await chainGet("/x"),{a:1}); assert.strictEqual(calls,2);
    calls=0; fetchImpl=async()=>{ calls++; return {ok:false,status:404}; };
    await assert.rejects(()=>chainGet("/x"), e=>e.status===404); assert.strictEqual(calls,1);
  });
  await ok("chainGet: an unreachable explorer hands over to the other public one", async()=>{
    const hosts=[]; fetchImpl=async url=>{ hosts.push(new URL(url).host); if(url.startsWith("https://mempool.space/")) throw new TypeError("Failed to fetch"); return {ok:true,text:async()=>"968433"}; };
    assert.strictEqual(await chainGet("/blocks/tip/height",{text:true}),"968433");
    assert.deepStrictEqual(hosts,["mempool.space","blockstream.info"]);
    hosts.length=0; await chainGet("/blocks/tip/height",{text:true}); assert.deepStrictEqual(hosts,["blockstream.info"],"the one that answered goes first");
  });
  console.log(`\n${n-failed}/${n} passed${failed?`, ${failed} FAILED`:""}`); process.exitCode=failed?1:0;
})();
