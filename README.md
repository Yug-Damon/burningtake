# Burning Take

Say it like you mean it. A topic is a name, and its address is P2WSH(OP_RETURN name): a script nobody can spend. A take is a burn to that address with the take in an OP_RETURN, weighed by the sats burned. Anyone can recount every topic from the chain.

This repository is the static mock of the app: plain HTML pages with stub data, built from `parts/`, plus the protocol spec, a verification guide and a node guide.

## Build

    python3 build.py       # parts/ -> the app pages, the docs from _*.tpl, then snapshots/
    python3 check-ids.py   # every id a script reads exists in its page

## Test

    npm install
    npm test
