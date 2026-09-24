#!/usr/bin/env python3
"""Write snapshots/<net>/<sha256(name)>.json for every stub topic, plus snapshots/<net>/index.json, for net in mainnet / signet.

The votes are the SAME the page's stubVotes(name) produces: both sides seed mulberry32 with FNV-1a(name) and draw in the same
order (32 txid bytes, amount, height, burner). The 40 fake burners come from mulberry32(FNV-1a("burner"+i)) -> 20 bytes -> bech32.
Stdlib only. Data (SCOPES, DIRECTORY, TIP) is read out of parts/shared.js so there is one source of truth.
Run:  python3 snapshot.py            (build.py runs it after every build)
      python3 snapshot.py --verify   (needs node: compares with the page's own stubVotes for every topic)
"""
import hashlib, json, math, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(HERE, "parts", "shared.js")
OUT = os.path.join(HERE, "snapshots")
M32 = 0xFFFFFFFF


# ---------- data out of shared.js: strip // comments outside strings, quote bare keys, drop trailing commas, json.loads ----------
def js_literal(src, start_pat, open_ch, close_ch):
    i = re.search(start_pat, src).end()
    depth, j, in_str = 0, i, None
    while True:
        c = src[j]
        if in_str:
            if c == "\\": j += 1
            elif c == in_str: in_str = None
        elif c in "\"'": in_str = c
        elif c == open_ch: depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0: break
        elif c == "/" and src[j + 1] == "/":                           # comment: skip to end of line
            j = src.index("\n", j); continue
        j += 1
    return src[i:j + 1]


def to_json(lit):
    out, i, in_str = [], 0, None
    while i < len(lit):                                                # drop comments outside strings
        c = lit[i]
        if in_str:
            out.append(c)
            if c == "\\": out.append(lit[i + 1]); i += 1
            elif c == in_str: in_str = None
        elif c in "\"'": in_str = c; out.append(c)
        elif c == "/" and lit[i + 1] == "/": i = lit.index("\n", i); continue
        else: out.append(c)
        i += 1
    s = "".join(out)
    s = re.sub(r'([{,]\s*)([A-Za-z_]\w*)\s*:', r'\1"\2":', s)          # bare keys
    s = re.sub(r",(\s*[}\]])", r"\1", s)                               # trailing commas
    return json.loads(s)


def load_data():
    src = open(SHARED, encoding="utf-8").read()
    scopes = to_json(js_literal(src, r"const SCOPES\s*=\s*", "{", "}"))
    directory = to_json(js_literal(src, r"const DIRECTORY\s*=", "[", "]"))
    tip = int(re.search(r"TIP\s*=\s*(\d+)", src).group(1))
    return scopes, directory, tip


# ---------- the page's PRNG, bit for bit ----------
def imul(a, b):
    return ((a & M32) * (b & M32)) & M32


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = imul(h, 0x01000193)
    return h


def mulberry32(a):
    a &= M32
    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return rnd


def js_round(x):                                                       # Math.round: ties toward +inf
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


# ---------- bech32 (BIP 173), same as shared.js ----------
CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def polymod(v):
    G = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    c = 1
    for x in v:
        b = c >> 25
        c = ((c & 0x1FFFFFF) << 5) ^ x
        for i in range(5):
            if (b >> i) & 1: c ^= G[i]
    return c


def hrp_expand(h):
    return [ord(c) >> 5 for c in h] + [0] + [ord(c) & 31 for c in h]


def to_words(data):
    acc = bits = 0
    out = []
    for b in data:
        acc = ((acc << 8) | b) & 0xFFF
        bits += 8
        while bits >= 5:
            bits -= 5
            out.append((acc >> bits) & 31)
    if bits: out.append((acc << (5 - bits)) & 31)
    return out


def bech32(hrp, ver, prog):
    data = [ver] + to_words(prog)
    pm = polymod(hrp_expand(hrp) + data + [0] * 6) ^ 1
    chk = [(pm >> (5 * (5 - i))) & 31 for i in range(6)]
    return hrp + "1" + "".join(CH[d] for d in data + chk)


def burners(hrp):
    out = []
    for i in range(40):
        r = mulberry32(fnv1a("burner" + str(i)))
        out.append(bech32(hrp, 0, [int(r() * 256) for _ in range(20)]))
    return out


def stub_votes(name, scopes, tip, pool):
    out, rnd = [], mulberry32(fnv1a(name))
    for st in scopes.get(name, []):
        for _ in range(st["votes"]):
            txid = bytes(int(rnd() * 256) for _ in range(32)).hex()
            sats = max(330, js_round(st["sats"] / st["votes"] * (0.3 + rnd() * 1.4)))
            r = rnd()
            h = tip - int(r * r * 3000)
            frm = pool[int(rnd() * 40)]
            out.append({"txid": txid, "t": st["t"], "sats": sats, "h": h, "from": frm})
    out.sort(key=lambda v: -v["h"])                                    # stable, like Array.prototype.sort
    if out: out[0]["h"] = None                                         # one unconfirmed, in the mempool
    return out


def key(name):
    return hashlib.sha256(name.encode("utf-8")).hexdigest()


def main():
    scopes, directory, tip = load_data()
    names = list(dict.fromkeys(list(scopes) + [d["name"] for d in directory]))
    by_name = {d["name"]: d for d in directory}
    n = 0
    for net, hrp in (("mainnet", "bc"), ("signet", "tb")):
        d = os.path.join(OUT, net)
        os.makedirs(d, exist_ok=True)
        pool = burners(hrp)
        for name in names:
            votes = stub_votes(name, scopes, tip, pool)
            with open(os.path.join(d, key(name) + ".json"), "w", encoding="utf-8") as f:
                json.dump({"name": name, "net": net, "height": tip, "count": len(votes), "votes": votes}, f, ensure_ascii=False, separators=(",", ":"))
            n += 1
        # burners across every topic (confirmed burns only): top by sats, newest first burn, latest burn — the host's indexer does this for real
        by_addr = {}
        for name in names:
            for v in stub_votes(name, scopes, tip, pool):
                a = by_addr.setdefault(v["from"], {"addr": v["from"], "sats": 0, "burns": 0, "topics": set(), "first": None, "last": None, "mem": False})
                a["sats"] += v["sats"]; a["burns"] += 1; a["topics"].add(name)
                if v["h"] is None: a["mem"] = True
                else:
                    a["first"] = v["h"] if a["first"] is None else min(a["first"], v["h"])
                    a["last"] = v["h"] if a["last"] is None else max(a["last"], v["h"])
        rows = [dict(x, topics=len(x["topics"])) for x in by_addr.values()]
        burners_summary = {
            "top": [ {k: r[k] for k in ("addr", "sats", "burns", "topics")} for r in sorted(rows, key=lambda r: -r["sats"])[:8] ],
            "new": [ {"addr": r["addr"], "sats": r["sats"], "first": r["first"]} for r in sorted([r for r in rows if r["first"] is not None], key=lambda r: -r["first"])[:8] ],
            "recent": [ {"addr": r["addr"], "sats": r["sats"], "last": (None if r["mem"] else r["last"])} for r in sorted(rows, key=lambda r: (0 if r["mem"] else 1, -(r["last"] or 0)))[:8] ],
        }
        topics = []
        for name in names:                                             # aggregates = what the address summary endpoint reports
            agg = scopes.get(name, [])
            dd = by_name.get(name, {})
            topics.append({"name": name, "sats": sum(x["sats"] for x in agg), "votes": sum(x["votes"] for x in agg),
                           "active": dd.get("active"), "reg": dd.get("reg"), "listings": dd.get("listings"), "last": dd.get("last")})
        with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"height": tip, "net": net, "topics": topics, "burners": burners_summary}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"snapshots: {n} topic files + 2 index files under {OUT}")


def verify():
    """Run the page's stubVotes in node for every topic on both networks and compare with the Python output."""
    scopes, directory, tip = load_data()
    names = list(dict.fromkeys(list(scopes) + [d["name"] for d in directory]))
    js = r"""
const fs=require("fs"); const src=fs.readFileSync(process.argv[1],"utf8");
const doc={querySelectorAll:()=>[], getElementById:()=>null, createElement:()=>({style:{}}), body:{appendChild(){}}, documentElement:{style:{}}, fonts:null};
const out={};
for(const net of ["mainnet","signet"]){
  const api=new Function("document","window","localStorage","matchMedia","navigator","addEventListener","location",
    src+"\nreturn {stubVotes};")(doc,{}, {getItem:k=>k==="bv.net"?net:null, setItem(){}}, ()=>({matches:false}), {}, ()=>{}, {hostname:"",search:""});
  out[net]={}; for(const n of JSON.parse(process.argv[2])) out[net][n]=api.stubVotes(n).map(({tx,...v})=>v);
}
process.stdout.write(JSON.stringify(out));
"""
    res = subprocess.run(["node", "-e", js, SHARED, json.dumps(names)], capture_output=True, text=True, check=True)
    theirs = json.loads(res.stdout)
    bad = 0
    for net, hrp in (("mainnet", "bc"), ("signet", "tb")):
        pool = burners(hrp)
        for name in names:
            mine = stub_votes(name, scopes, tip, pool)
            if mine != theirs[net][name]:
                bad += 1; print(f"MISMATCH {net} {name}: {mine[:1]} vs {theirs[net][name][:1]}")
    print("verify:", "OK, page and snapshot agree on every topic" if not bad else f"{bad} mismatches")
    return bad


if __name__ == "__main__":
    if "--verify" in sys.argv: sys.exit(verify())
    main()
