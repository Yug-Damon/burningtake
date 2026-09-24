// ---------- footer data source (foot.html + foot.js on every app page, not the embed): which Esplora API this browser reads the chain through, per network, read by wallet.js too ----------
(()=>{
  const sel=$("ep"), url=$("epurl"), act=$("epactive"); if(!sel) return;
  const stored=()=>(LS(NETKEY("bv.endpoint"))||"").trim();
  const paint=()=>{ const v=stored(), custom=/^https?:\/\//.test(v); sel.value= custom?"custom" : ESPLORA_PRESETS[v]?v : "mempool";
    for(const o of sel.options) if(ESPLORA_PRESETS[o.value]) o.disabled=!ESPLORA_PRESETS[o.value][NET];        // a preset without a server on this network cannot be picked
    url.hidden=!custom&&sel.value!=="custom"; if(custom) url.value=v;
    act.textContent=esploraFor(NET)+(esploraOverride()?"":" · default"); sel.title="Esplora API: "+act.textContent; };
  sel.onchange=()=>{ if(sel.value==="custom"){ url.hidden=false; url.focus(); if(/^https?:\/\//.test(url.value.trim())) esploraSet(url.value.trim()); else return act.textContent=esploraFor(NET)+" · until a URL is entered"; }
    else esploraSet(sel.value==="mempool"?"":sel.value); paint(); };
  url.onchange=url.onblur=()=>{ const v=url.value.trim(); if(/^https?:\/\//.test(v)) esploraSet(v.replace(/\/+$/,"")); else if(!v) esploraSet(""); paint(); };
  url.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); url.blur(); } };
  paint();
})();
