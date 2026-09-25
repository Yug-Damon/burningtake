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
  const all=[...rootBurns(), ...DIRECTORY.flatMap(d=>cache[d.name]||[])], sats=all.reduce((a,v)=>a+v.sats,0);   // registrations and sponsorships count; other burns to the root address do not
  const takes=DIRECTORY.reduce((a,d)=>a+new Set((cache[d.name]||[]).map(v=>norm(v.t)).filter(Boolean)).size,0);
  $("stburned").textContent=fmt(sats)+" sats"; $("sttakes").textContent=fmt(takes); $("stburns").textContent=fmt(all.length);
  $("stusd").textContent=BTCUSD ? "≈ $"+fmt(Math.round(sats/1e8*BTCUSD)) : "—";
}
(async()=>{ await dirLoad(); chipsReady=true; renderChips(); await dirTopics({onTopic:renderChips}); chipsDone=true; renderChips(); heroReady=true; renderStats(); priceReady().then(renderStats); })();   // also warms Explore's cache

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



