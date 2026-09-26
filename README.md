# Burning Take

Say it like you mean it. A topic is a name, and its address is P2WSH(OP_RETURN name): a script nobody can spend. A take is a burn to that address with the take in an OP_RETURN, weighed by the sats burned. Anyone can recount every topic from the chain.

Static pages, no backend. Every page reads Bitcoin through an Esplora API (mempool.space by default, blockstream.info when it does not answer, or your own node, picked in the footer) and keeps what it read in IndexedDB, so the next visit only fetches newer burns. The directory of topics is the root topic's registrations (spec §7). `snapshots/<net>/` may hold published snapshots of finished scans (spec §6); it ships empty. `hide.json` lists the takes and topics this site chooses not to display (spec §7 lets a front end refuse to display a topic): `{"takes":[{"topic":"<name>","take":"<text>"}],"topics":["<name>"]}`. Hidden text is replaced on Explore, Home and embeds; its sats and bars still count. It ships empty.

## Build

    python3 build.py       # parts/ -> the app pages, then the docs from _*.tpl
    python3 check-ids.py   # every id a script reads exists in its page

## Test

    npm install
    npm test

## Deploy

Any static host. On GitHub Pages: Settings → Pages → Deploy from a branch → `main`, `/ (root)`.
