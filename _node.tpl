<meta charset="utf-8">
<title>Run Your Own Node</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/*CSS*/
</style>

<nav><div class="wrap">
  <a class="logo" href="index.html"><i></i>Burning Take</a>
  <div class="links"><a href="index.html">App</a><a href="verify.html">Verify</a><a href="spec.html">Spec</a><a href="node.html" class="on">Node</a></div>
</div></nav>

<main class="wrap" style="padding-block:56px 20px">
  <span class="eyebrow">Own node kit</span>
  <h1>Run your own node</h1>
  <p class="lede">The app reads the chain through an Esplora-style HTTP API. By default that is a public explorer. Point it at your own node and every number on every page comes from blocks you validated yourself, with nobody in between.</p>
  <div class="toc"><a href="#why">Why</a><a href="#what">What it takes</a><a href="#compose">docker-compose.yml</a><a href="#cors">CORS and TLS</a><a href="#point">Point the app at it</a><a href="#check">Check it is really your node</a><a href="#signet">Start on signet</a></div>

  <h2 id="why">Why bother</h2>
  <p>A public explorer is a convenience with three weaknesses. It can <b>lag</b> (a burn you just sent is not there yet), it can <b>lie</b> (by mistake or on purpose, and you would not know), and it <b>sees you</b>: every topic you open and every address you look at is a request in its logs. Your own node fixes all three. The app was written so that switching costs one URL.</p>
  <p>The kit below is three containers: <b>bitcoind</b> validates and stores the chain, <b>electrs</b> (the Esplora fork) indexes it and speaks the HTTP API the app expects, and a small <b>reverse proxy</b> adds TLS and the CORS header a browser needs to call it from another origin.</p>

  <h2 id="what">What it takes</h2>
  <table>
    <tr><th></th><th>mainnet</th><th>signet</th></tr>
    <tr><td>bitcoind, full chain with <code>txindex=1</code></td><td>≈ 750 GB and growing, ~6 h to 3 days to sync depending on disk and bandwidth</td><td>≈ 3 GB, minutes</td></tr>
    <tr><td>electrs index (Esplora fork, address history for every address)</td><td>≈ 500 GB more, 1 to 3 days after bitcoind is synced</td><td>≈ 1 GB, minutes</td></tr>
    <tr><td>memory</td><td>8 GB is comfortable; the first index pass likes more</td><td>2 GB</td></tr>
    <tr><td>bandwidth</td><td>the initial download once, then a few GB a month</td><td>negligible</td></tr>
  </table>
  <div class="box warn"><b>Figures are as of 2026 and go up.</b> Use an SSD; the index is unusable on spinning disks. <code>txindex=1</code> is not required by electrs, but the <a href="verify.html#node">verification page</a> uses <code>getrawtransaction</code> on your node and that needs it.</div>

  <h2 id="compose">docker-compose.yml</h2>
  <p>One file, three services. Replace <code>YOUR_RPC_PASSWORD</code>, <code>node.example.com</code> and the app origin, then <code>docker compose up -d</code>. Pin the image tags to versions you have checked; the ones below are examples, not endorsements.</p>
<pre><code><span class="c"># docker-compose.yml · bitcoind + electrs (Esplora HTTP API) + Caddy (TLS, CORS)</span>
services:
  bitcoind:
    image: bitcoin/bitcoin:29
    restart: unless-stopped
    command: &gt;-
      bitcoind -printtoconsole -server=1 <span class="e">-txindex=1</span>
      -rpcbind=0.0.0.0 -rpcallowip=172.16.0.0/12
      -rpcuser=bv -rpcpassword=<span class="e">YOUR_RPC_PASSWORD</span>
      <span class="c"># add -signet to run the signet kit instead (see below)</span>
    ports: ["8333:8333"]
    volumes: ["bitcoind:/home/bitcoin/.bitcoin"]

  electrs:
    image: mempool/electrs:latest        <span class="c"># Blockstream's Esplora fork of electrs: /address/…/txs, /tx, /blocks/tip/height</span>
    restart: unless-stopped
    depends_on: [bitcoind]
    command: &gt;-
      electrs -vv --network bitcoin
      --daemon-rpc-addr bitcoind:8332 --cookie bv:<span class="e">YOUR_RPC_PASSWORD</span>
      --daemon-dir /bitcoind --db-dir /db
      --http-addr 0.0.0.0:3000
      <span class="c"># --network signet --daemon-rpc-addr bitcoind:38332 for the signet kit</span>
    volumes: ["bitcoind:/bitcoind:ro", "electrs:/db"]

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [electrs]
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy:/data"]

volumes: { bitcoind: {}, electrs: {}, caddy: {} }</code></pre>

  <h2 id="cors">CORS and TLS: the Caddyfile</h2>
  <p>The app is a page on one origin calling an API on another, so the browser asks the API for permission first (a CORS preflight) and the API must answer with the app's origin. Caddy also gets a certificate for you, and the page, if it is served over HTTPS, may only call an HTTPS API. Put this next to the compose file:</p>
<pre><code><span class="c"># Caddyfile · https://node.example.com/api/… → electrs</span>
node.example.com {
  handle_path <span class="e">/api/*</span> {
    header Access-Control-Allow-Origin  "<span class="e">https://burningtake.example</span>"   <span class="c"># the origin the app is served from; "*" if you do not care</span>
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
    header Access-Control-Allow-Headers "content-type, accept"
    header Access-Control-Max-Age       "86400"
    @preflight method OPTIONS
    respond @preflight 204
    reverse_proxy electrs:3000
  }
  respond 404
}</code></pre>
  <p>Two shortcuts. If you open the app from a file on disk or from <code>http://localhost</code>, the browser lets it call <code>http://127.0.0.1:3000</code> directly, so you can skip Caddy and set <code>--cors "*"</code> on electrs instead. And if the app is served by the same host as the API, there is no cross-origin call at all.</p>

  <h2 id="point">Point the app at it</h2>
  <div class="steps">
    <div class="step"><div><h3>On the front page</h3><p>The <b>Data source</b> row at the bottom of the app has an explorer selector. Pick <em>Custom Esplora URL</em> and enter the API base, for example <code>https://node.example.com/api</code>. The choice is saved in this browser, per network, and every page reads through it from then on: the boards, the burner wallet's balance, the broadcast.</p></div></div>
    <div class="step"><div><h3>Or in the URL</h3><p>Any page accepts <code>?endpoint=https://node.example.com/api</code> once; it is saved the same way. <code>?endpoint=</code> (empty) goes back to the default explorer. Combine with <code>?net=signet</code> for the signet endpoint.</p></div></div>
    <div class="step"><div><h3>What it has to answer</h3><p>The Esplora routes the app uses: <code>GET /address/&lt;addr&gt;/txs/chain[/&lt;last txid&gt;]</code> and <code>/address/&lt;addr&gt;</code> for the boards, <code>GET /address/&lt;addr&gt;/utxo</code> for the wallet, <code>POST /tx</code> to broadcast, <code>GET /blocks/tip/height</code> for the tip. Any server that speaks Esplora (Blockstream's, mempool.space's, this electrs) works.</p></div></div>
  </div>

  <h2 id="check">Check the app is really talking to your node</h2>
  <div class="steps">
    <div class="step"><div><h3>Read the Data source row</h3><p>Under the selector, the app prints the base URL it is reading through. It should be your host, without the word <em>default</em>.</p></div></div>
    <div class="step"><div><h3>Watch the network tab</h3><p>Open the browser's developer tools, <b>Network</b>, then open any topic. Every request that carries an address or a txid must go to your host: <code>node.example.com/api/address/bc1q…/txs/chain</code>, nothing to <code>mempool.space</code> or <code>blockstream.info</code>. Filter by <code>address</code> to see only those. The font and QR library requests are the only other ones a page makes.</p></div></div>
    <div class="step"><div><h3>Ask the node the same question</h3><p><code>bitcoin-cli scantxoutset start '["addr(&lt;topic address&gt;)"]'</code> returns the total ever burned into a topic. It should match the topic page to the sat, once the mempool is out of the picture.</p></div></div>
    <div class="step"><div><h3>Pull the plug</h3><p>Stop electrs (<code>docker compose stop electrs</code>) and open the wallet chip. The balance line must say the explorer at your URL is unreachable; the app never falls back to a public explorer on its own. Topics you already opened keep showing from the cache, with the block height they were last synced at.</p></div></div>
  </div>

  <h2 id="signet">Start on signet</h2>
  <p>Signet is the same software on a test chain: gigabytes instead of terabytes, minutes instead of days, and free coins from a faucet to burn. Add <code>-signet</code> to bitcoind, <code>--network signet</code> and <code>--daemon-rpc-addr bitcoind:38332</code> to electrs (signet's RPC port, where mainnet uses 8332), and open the app with <code>?net=signet&amp;endpoint=https://node.example.com/api</code>. Everything else, from the derivation of a topic address to the receipt of a burn, is identical. When the signet kit does what you expect, the mainnet one is a tag and a bigger disk away.</p>
  <div class="box ok"><b>The endpoint is saved per network.</b> A signet node configured while on signet is not used on mainnet, and the other way round, so a mistake there cannot send the app to the wrong chain.</div>
</main>

<footer><div class="wrap"><span>Burning Take · <a href="verify.html">verify</a> · <a href="spec.html">protocol spec</a> · <a href="index.html">app</a> · made by Yug Damon</span><span class="mono">your node, your numbers</span></div></footer>
