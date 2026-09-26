// ---------- hero chips, up to five topics, each led by a small icon badge: a flame for the most burned (all time), ✦ the 3 most sponsored, a clock for the latest burn (always one) ----------
const chipHtml=(name,title,badge)=>`<a class="btn sm" href="topic.html#${esc(name)}" title="${esc(title)}">${badge}<span>${topicName(name,false)}</span></a>`;
let chipsReady=false, chipsDone=false;                 // the directory has answered / every topic is counted: until then, placeholders hold the chips' places
const chipGhost=w=>`<span class="btn sm chipghost" aria-hidden="true"><span class="fi sm"></span><span class="sk" style="width:${w}px;height:10px"></span></span>`;
function renderChips(){
  if(!chipsReady){ $("chips").innerHTML=[64,52,78,58,70].map(chipGhost).join(""); return; }
  const sats=d=>tallyOf(d.name, cache[d.name]||[]).sats;   // counted like the topic page
  const top=[...DIRECTORY].filter(d=>d.stats&&sats(d)>0).sort((a,b)=>sats(b)-sats(a))[0], used=new Set(top?[top.name]:[]);
  const byActive=[...DIRECTORY].filter(d=>d.active).sort((a,b)=>b.active-a.active);   // ties keep directory order
  const last=byActive.find(d=>!used.has(d.name))||byActive[0]; if(last) used.add(last.name);   // always one latest chip, picked before the sponsored ones: another topic when there is one, else the top one again
  const feat=featuredRank(DIRECTORY.length).filter(f=>!used.has(f.name)).slice(0,3); feat.forEach(f=>used.add(f.name));
  const hot=[...(last?[last]:[]), ...byActive.filter(d=>!used.has(d.name)).slice(0,3-feat.length)];   // more latest chips when fewer topics are sponsored
  const html=(top?chipHtml(top.name,`Most burned · ${fmt(sats(top))} sats all time`,iconBadge("sm top",ICONS.top)):"")
    + feat.map(f=>chipHtml(f.name,`Sponsored · ${fmt(f.sats)} sats`,iconBadge("sm feature",ICONS.feature))).join("")
    + hot.map(d=>chipHtml(d.name,`Latest burn · ${d.active>TIP?"in the mempool":"block "+fmt(d.active)}`,iconBadge("sm",ICONS.latest))).join("");
  $("chips").innerHTML=html+(chipsDone?"":[70,58,64,52,78].slice(0,Math.max(0,5-(html.match(/<a /g)||[]).length)).map(chipGhost).join(""));   // counting: the missing places stay placeholders
}
renderChips();
// ---------- the hero's numbers: every burn this page counted, in the topics and the registrations ----------
let heroReady=false;
function renderStats(){
  if(!heroReady) return;
  if(DIRERR){ for(const id of ["stburned","sttakes","stburns","stusd"]) $(id).textContent="—"; return; }   // nothing saved and the explorer did not answer: no false zeros
  const all=[...rootBurns(), ...DIRECTORY.flatMap(d=>cache[d.name]||[])], sats=all.reduce((a,v)=>a+v.sats,0);   // registrations and sponsorships count; other burns to the root address do not
  const takes=DIRECTORY.reduce((a,d)=>a+new Set((cache[d.name]||[]).map(v=>{ const p=parseScope(d.name), x=p.range?numOf(v.t):NaN; return Number.isFinite(x)?"n:"+x:norm(v.t); }).filter(Boolean)).size,0);   // number answers merge by value, like their boards
  $("stburned").textContent=fmt(sats)+" sats"; $("sttakes").textContent=fmt(takes); $("stburns").textContent=fmt(all.length);
  $("stusd").textContent=BTCUSD ? "≈ $"+fmt(Math.round(sats/1e8*BTCUSD)) : "—";
}
// ---------- five ways to ask: each kind with its most-burned topic and where it stands, or a way to start the first one ----------
const KCOPY={open:["Open","A wall of takes"],"yes-no":["Yes / No","Call it before it closes"],duel:["Duel","Two sides, one bar"],poll:["Poll","A race between options"],number:["Number","Everyone answers with a number"]};
function renderKinds(){
  if(!chipsReady){ $("kcards").innerHTML=Object.keys(KCOPY).map(()=>`<div class="kcard ghost"><span class="sk" style="width:60%"></span><span class="sk" style="width:80%"></span></div>`).join(""); return; }
  $("kcards").innerHTML=Object.entries(KCOPY).map(([k,[word,line]])=>{
    const d=DIRECTORY.filter(d=>!HIDE.topics.has(d.name)&&kindKey(parseScope(d.name))===k&&d.stats).map(d=>({d,T:tallyOf(d.name,cache[d.name]||[])})).filter(x=>x.T.sats).sort((a,b)=>b.T.sats-a.T.sats)[0];
    if(!d) return `<a class="kcard empty" href="explore.html?create=${k}"><span class="eyebrow">${word}</span><b>${line}</b><span class="kc">${chipsDone&&DIRFRESH?`No ${k==="open"?"open topic":k} yet · `:""}Start one →</span></a>`;
    const p=parseScope(d.d.name), c=callOf(d.d.name,d.T), ia=k==="yes-no"?p.opts.indexOf("yes"):0, s=o=>(d.T.answers.find(r=>r.key===o)||{sats:0}).sats;
    const bar= k==="duel"||k==="yes-no" ? `<span class="viz two"><i style="flex:${s(p.opts[ia])||0.0001}"></i><i class="b" style="flex:${s(p.opts[1-ia])||0.0001}"></i></span>`
      : k==="poll" ? `<span class="viz race">${d.T.answers.map((r,i)=>`<i class="s${Math.min(i,3)}" style="flex:${r.sats}"></i>`).join("")}</span>`
      : k==="number" ? (()=>{ const [lo,hi]=p.range, m=weightedMedian(d.T.answers); return `<span class="viz num"><i style="left:${hi>lo?(m-lo)/(hi-lo)*100:50}%"></i></span>`; })()
      : `<span class="viz"><i style="width:${Math.round(d.T.answers[0].sats/d.T.shareSats*100)}%"></i></span>`;
    return `<a class="kcard" href="topic.html#${esc(d.d.name)}"><span class="eyebrow">${word}</span><b>${line}</b><span class="kn">${topicName(d.d.name)}</span><span class="kc">${esc(c||"")}</span>${bar}</a>`; }).join("");
}
renderKinds();
(async()=>{
  if(await dirFromDisk()&&DIRECTORY.length){ chipsReady=chipsDone=heroReady=true; renderChips(); renderStats(); renderKinds(); }   // a returning visit: what this browser knows, at once (totals can only be too low)
  hideReady().then(renderKinds);
  await dirLoad(); chipsReady=true; renderChips(); renderKinds(); await dirTopics({onTopic:()=>{ renderChips(); renderKinds(); }}); chipsDone=true; renderChips(); renderKinds(); heroReady=true; renderStats(); priceReady().then(renderStats);
})();   // also warms Explore's cache

// ---------- embers ----------
const c=document.getElementById("embers"), ctx=c.getContext("2d");
let W,H,P=[];
function size(){W=c.width=c.offsetWidth*devicePixelRatio;H=c.height=c.offsetHeight*devicePixelRatio}
size(); addEventListener("resize",size);
for(let i=0;i<70;i++)P.push({x:Math.random(),y:Math.random(),r:Math.random()*2.2+.6,v:Math.random()*.0009+.0004,d:Math.random()*6.28,a:Math.random()});
(function tick(){
  ctx.clearRect(0,0,W,H);
  for(const p of P){
    p.y-=p.v; p.d+=.02; p.x+=Math.sin(p.d)*.0006; if(p.y<-.05){p.y=1.05;p.x=Math.random()}
    const g=ctx.createRadialGradient(p.x*W,p.y*H,0,p.x*W,p.y*H,p.r*4*devicePixelRatio);
    g.addColorStop(0,`rgba(255,181,71,${.55*p.a+.25})`); g.addColorStop(1,"rgba(255,106,26,0)");
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x*W,p.y*H,p.r*4*devicePixelRatio,0,6.28); ctx.fill();
  }
  if(!matchMedia("(prefers-reduced-motion:reduce)").matches) requestAnimationFrame(tick);
})();
segThumbs();



