import re, subprocess, sys, os, collections
HERE=os.path.dirname(os.path.abspath(__file__)); bad=0
for page in ["index","explore","topic"]+[p for p in ["burner","receipt","embed"] if os.path.exists(os.path.join(HERE,"parts",p+".html"))]:
    html=open(os.path.join(HERE,page+".html"),encoding="utf-8").read()
    scripts=re.findall(r"<script>(.*?)</script>", html, re.S); assert len(scripts)==1, (page, len(scripts))
    js=scripts[0]; jsf=os.path.join(HERE,f"_{page}.check.js"); open(jsf,"w").write(js)
    r=subprocess.run(["node","--check",jsf],capture_output=True,text=True); os.remove(jsf)
    print(f"{page}: node --check", "OK" if r.returncode==0 else "FAIL\n"+r.stderr); bad+=r.returncode
    markup=re.sub(r"<script>.*?</script>","",html,flags=re.S)
    ids=collections.Counter(re.findall(r'\sid="([^"]+)"', markup))
    dup=[k for k,v in ids.items() if v>1]
    if dup: print(f"{page}: DUPLICATE ids {dup}"); bad+=1
    used=set(re.findall(r'(?<![$\w])\$\("([^"]+)"\)', js))   # not $$("k"): walletTab's per-panel prefixed ids|set(re.findall(r'getElementById\("([^"]+)"\)', js))
    # payPanel(prefix) derives ids dynamically
    for pre in re.findall(r'payPanel\("([^"]+)"\)', js): used|={pre+"-wallet",pre+"-text",pre+"-tipnote",pre+"-copy"}
    # bare-identifier element access (copyhex.onclick)
    used|=set(re.findall(r'^(\w+)\.onclick', js, re.M))-{"stmt","amt","list","seg","copy","b"}
    GUARDED={"embed":{"footnet","netmenu","netpill","nettxt"}}   # shared.js looks these up behind an if: the embed card has no nav or footer
    missing=sorted(u for u in used if u not in ids and u not in GUARDED.get(page,set()))
    if missing: print(f"{page}: MISSING ids referenced by script: {missing}"); bad+=1
    # CSS-only id selectors that are dead on this page (informational)
    css=re.search(r"<style>(.*?)</style>",html,re.S).group(1)
    cssids=set(re.findall(r'#([A-Za-z][\w-]*)\s*[\[\.\s{,>:]', css))-{"how","scopebox","listpanel"}
    print(f"{page}: {len(ids)} ids in markup, {len(used)} referenced by script, all present" if not missing else "", "| css id refs not in page:", sorted(i for i in cssids if i not in ids) or "none")
sys.exit(bad)
