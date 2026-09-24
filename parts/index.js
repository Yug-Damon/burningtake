// ---------- hero chips, five different topics, each led by a small icon badge: a flame for the most burned (all time), ✦ the 3 most sponsored, a clock for the latest burn ----------
const chipHtml=(name,title,badge)=>`<a class="btn sm" href="topic.html#${esc(name)}" title="${esc(title)}">${badge}<span>${topicName(name,false)}</span></a>`;
function renderChips(){
  const sats=d=>tallyOf(d.name, cache[d.name]||(cache[d.name]=stubVotes(d.name))).sats;   // counted like the topic page; ponytail: stub burns stand in for the summary endpoint
  const top=[...DIRECTORY].sort((a,b)=>sats(b)-sats(a))[0], used=new Set(top?[top.name]:[]);
  const feat=featuredRank(DIRECTORY.length).filter(f=>!used.has(f.name)).slice(0,3); feat.forEach(f=>used.add(f.name));
  const hot=[...DIRECTORY].filter(d=>!used.has(d.name)).sort((a,b)=>b.active-a.active).slice(0,4-feat.length);   // one latest chip; more when fewer topics are sponsored. Ties keep directory order
  $("chips").innerHTML=(top?chipHtml(top.name,`Most burned · ${fmt(sats(top))} sats all time`,iconBadge("sm top",ICONS.top)):"")
    + feat.map(f=>chipHtml(f.name,`Sponsored · ${fmt(f.sats)} sats`,iconBadge("sm feature",ICONS.feature))).join("")
    + hot.map(d=>chipHtml(d.name,`Latest burn · block ${fmt(d.active)}`,iconBadge("sm",ICONS.latest))).join("");
}
renderChips();
DIRECTORY.forEach(async d=>{ await sleep(250+Math.random()*900); d.stats=STATS[d.name]; summarySave(); });   // the chips need no totals; this warms Explore's numbers

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



