# SignSafe

SignSafe is a Chrome extension that intercepts Solana wallet signing requests, simulates the transaction, asks OpenAI for a plain-English risk verdict, and shows the user the result before the wallet popup appears.

## Files

- `manifest.json` sets up the MV3 extension, background worker, options page, and content script.
- `page_hook.js` runs in the page world and wraps `signTransaction` / `signAllTransactions`.
- `content_script.js` bridges page messages to the background worker and owns the overlay lifecycle.
- `background.js` simulates transactions on Solana RPC and calls OpenAI.
- `overlay.html`, `overlay.css`, and `overlay.js` render the verdict UI.
- `options.html` and `options.js` store the OpenAI API key in `chrome.storage.local`.
- `demo.html`, `demo.js`, and `demo_transactions.js` provide a hackathon-friendly demo preview.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked** and select this repository root.
4. Open the SignSafe extension details and set an OpenAI API key through **Extension options**.
5. Open a Solana dApp and trigger a wallet signature request.

## Demo Page

Open `chrome-extension://<EXTENSION_ID>/demo.html` to preview the three canned hackathon scenarios:

- Jupiter swap
- Wallet drainer
- Metaplex NFT mint

The demo page renders the same overlay used during live interception, but with bundled fixture verdicts instead of a real wallet call.

## Playground Testing

Use [playground-test-snippet.js](/home/r00t/code/signsafe/playground-test-snippet.js) as a browser-console snippet on `https://beta.solpg.io` when you want deterministic wallet-method tests against Phantom or Solflare on devnet.
