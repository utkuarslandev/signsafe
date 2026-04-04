# SignSafe

SignSafe is a Chrome extension that intercepts Solana wallet signing requests, simulates each transaction on Solana RPC, applies deterministic risk heuristics, and (for successful simulations) asks the SignSafe API for a plain-English explanation before the wallet popup appears.

## Structure

- `src/background/` contains the MV3 service worker entry.
- `src/content/` contains the content-script bridge and overlay-session lifecycle.
- `src/page/` contains the page-world wallet interception hook.
- `src/overlay/` contains the overlay runtime script used by `overlay.html`.
- `src/options/` contains the extension options page script.
- `shared/` contains cross-surface constants, parsing, formatting, and helper logic.
- `vendor/solana-web3.iife.js` is a bundled `@solana/web3.js` build for Layer 1 instruction decode in the service worker. Regenerate from `extension/` with `npm run vendor:web3` (requires `npm install` once).
- Root HTML/CSS files remain extension entry documents referenced directly by Chrome.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open the SignSafe extension details and set your SignSafe API key through **Extension options** (optional for local/dev flows if your backend accepts anonymous requests).
5. Open a Solana dApp and trigger a wallet signature request.

## How Analysis Works

For transaction signatures (`signTransaction`, `signAllTransactions`, `sendTransaction`, `signAndSendTransaction`), SignSafe:

1. Simulates the transaction in the background worker.
2. Extracts structured facts (SOL/token deltas, touched programs, simulation status).
3. Applies deterministic heuristics to produce a baseline risk verdict.
4. Calls the SignSafe API (`/v1/analyze`) for user-facing explanation text when simulation succeeds.
5. Falls back to heuristic-only output when the API is unavailable or rate-limited.

For message signatures (`signMessage`), no on-chain simulation is possible, so SignSafe shows a dedicated blind-signature warning flow.

## Local Test DApp

If you are using the multi-repo workspace (`SignSafe-Meta`), the local harness is the `demo` submodule at `demo/` in the meta workspace (repository: `SignSafeHQ/SignSafe-Demo`), not inside the extension repository.
Serve it from the meta root:

```bash
python3 -m http.server 8788 --directory demo
```

Then open `http://127.0.0.1:8788`, connect a devnet wallet, and run the scenario cards (SOL drain, hidden injection, STMT-lite, and others). Sign-only is the default; optional broadcast submits real transactions to devnet after confirmation.

The harness is meant to exercise SignSafe on a controlled localhost origin with real `signTransaction` calls instead of third-party dApps.

## Licensing

This project is source-available under `BSL 1.1` with an Additional Use Grant.

- Main license: `LICENSE`
- Commercial terms: `COMMERCIAL_LICENSE.md`
- FAQ: `LICENSING_FAQ.md`
