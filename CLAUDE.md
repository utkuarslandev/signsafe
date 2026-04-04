# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SignSafe is a Chrome Extension (Manifest V3) that intercepts Solana wallet signing requests, simulates the transaction on-chain, and shows an AI-generated risk verdict before the wallet popup appears.

## Loading & Running

No build step — the extension loads unpacked directly from this directory.

1. Open `chrome://extensions`, enable Developer Mode
2. Click **Load unpacked**, select this repo root
3. Open extension options and set an OpenAI API key (stored in `chrome.storage.local`)
4. After any code change, click the reload button on `chrome://extensions` and hard-refresh the target dApp

To preview the UI without a wallet: open `chrome-extension://<EXTENSION_ID>/demo.html`

## Architecture

The extension uses a three-layer message-passing model across isolated JavaScript contexts:

```
[Dapp Page]
  └─ page_hook.js       (runs in page world — wraps signTransaction/signAllTransactions)
       ↕  window.postMessage (channel: "SIGNSAFE_PAGE_BRIDGE")
  └─ content_script.js  (runs in extension context — routes messages, owns overlay lifecycle)
       ↕  chrome.runtime.sendMessage
  └─ background.js      (service worker — Solana RPC simulation + OpenAI verdict)
       ↕  window.postMessage (channel: "SIGNSAFE_OVERLAY")
  └─ overlay.html/js    (rendered in a fixed iframe at z-index max)
```

**Key data flow:**
1. `page_hook.js` discovers wallet providers (Phantom, Solflare, Backpack, `window.solana`) by polling every 250ms, then monkey-patches `signTransaction`/`signAllTransactions`
2. On intercept, the transaction is base64-serialized and sent to `content_script.js` via `postMessage`
3. `content_script.js` creates an iframe overlay with a unique `sessionId`, forwards the tx to `background.js`, and awaits a DECISION message from the overlay
4. `background.js` calls `simulateTransaction` on Solana RPC, parses logs into human-readable actions, then calls OpenAI with a structured prompt
5. The verdict (`{ risk, summary, actions[], risk_reasons[], verdict }`) is rendered by `overlay.js`; risk levels are `"safe"`, `"review"`, or `"danger"`
6. User clicks Proceed or Block → `overlay.js` posts DECISION → `content_script.js` resolves/rejects the original Promise → `page_hook.js` calls the real provider or throws

**Batch transactions:** `signAllTransactions` is analyzed in parallel; only non-safe verdicts show overlays. If all are safe, a single batch-safe summary is shown.

## Key Configuration in background.js

- `RPC_ENDPOINT` — Solana mainnet-beta RPC URL (hardcoded)
- `OPENAI_API` — OpenAI responses endpoint (hardcoded); model is `"gpt-5-mini"`
- `KNOWN_PROGRAMS` — maps program IDs → human-readable labels (Jupiter, Serum, Raydium, Metaplex)
- `DEMO_VERDICTS` — three canned verdicts returned when no real RPC/API calls should be made

## Demo Fixtures

`demo_transactions.js` exports `SIGNSAFE_DEMO_TRANSACTIONS` — an array of three hardcoded verdict objects (Jupiter swap / safe, wallet drainer / danger, NFT mint / review). `demo.js` renders these via the live overlay iframe without any wallet or network calls.
