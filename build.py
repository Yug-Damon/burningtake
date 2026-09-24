#!/usr/bin/env python3
"""Assemble the app pages from parts/ into self-contained pages, then the docs (spec, verify, node) from their _<doc>.tpl.

Markers understood inside a parts/<page>.html template:
  <!--INC:name-->        -> contents of parts/name.html (verbatim)
  <!--CSS:a,b-->         -> <style> parts/a.css + parts/b.css </style>
  <!--JS:a,b-->          -> <script> parts/a.js + parts/b.js </script>
Run:  python3 build.py            (stdlib only; writes next to this file)
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "parts")
PAGES = ["index", "explore", "topic"] + [p for p in ["burner", "receipt", "embed"] if os.path.exists(os.path.join(HERE, "parts", p + ".html"))]   # later pages join when their template exists


def read(name):
    with open(os.path.join(PARTS, name), encoding="utf-8") as f:
        return f.read()


def concat(names, ext):
    return "".join(read(n.strip() + ext) for n in names.split(",") if n.strip())


def build(page):
    html = read(page + ".html")
    html = re.sub(r"<!--INC:([\w,.-]+)-->", lambda m: "".join(read(n.strip() + ".html") for n in m.group(1).split(",")), html)
    html = re.sub(r"<!--CSS:([\w,.-]+)-->", lambda m: "<style>\n" + concat(m.group(1), ".css") + "</style>", html)
    html = re.sub(r"<!--JS:([\w,.-]+)-->", lambda m: "<script>\n" + concat(m.group(1), ".js") + "</script>", html)
    leftover = re.findall(r"<!--(?:INC|CSS|JS):[^>]*-->", html)
    if leftover:
        sys.exit(f"{page}: unresolved markers {leftover}")
    out = os.path.join(HERE, page + ".html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {out} ({len(html.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    for p in (sys.argv[1:] or PAGES):
        build(p)
    css = open(os.path.join(HERE, "_doc.css"), encoding="utf-8").read()
    for doc in ["spec", "verify", "node"]:   # the docs: one template each, their /*CSS*/ marker filled from _doc.css
        tpl = open(os.path.join(HERE, "_" + doc + ".tpl"), encoding="utf-8").read()
        with open(os.path.join(HERE, doc + ".html"), "w", encoding="utf-8") as f:
            f.write(tpl.replace("/*CSS*/", css, 1))
        print(f"wrote {doc}.html")
