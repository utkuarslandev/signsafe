# SignSafe

SignSafe is a Chrome extension that intercepts Solana wallet signing requests, simulates the transaction, asks OpenAI for a plain-English risk verdict, and shows the user the result before the wallet popup appears.

## Structure

- `src/background/` contains the MV3 service worker entry.
- `src/content/` contains the content-script bridge and overlay-session lifecycle.
- `src/page/` contains the page-world wallet interception hook.
- `src/overlay/` contains the overlay runtime script used by `overlay.html`.
- `src/demo/` and `src/options/` contain the extension page scripts.
- `shared/` contains cross-surface constants, fixtures, parsing, formatting, and helper logic.
- `test-dapp/` contains the localhost devnet harness.
- Root HTML/CSS files remain extension entry documents referenced directly by Chrome.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked** and select this repository root.
4. Open the SignSafe extension details and set an OpenAI API key through **Extension options**.
5. Open a Solana dApp and trigger a wallet signature request.

## Demo Page

Open `chrome-extension://<EXTENSION_ID>/demo.html` to preview the canned hackathon scenarios:

- Jupiter swap
- Wallet drainer
- Metaplex NFT mint
- Login signature

The demo page renders the same overlay used during live interception, but with bundled fixture verdicts instead of a real wallet call. The fixtures now include structured facts and a raw-message preview example so the richer overlay states stay testable without a live wallet.

## Local Test DApp

For a deterministic localhost harness, serve [index.html](/home/r00t/code/signsafe/test-dapp/index.html) from the `test-dapp/` folder:

```bash
python3 -m http.server 8788 --directory test-dapp
```

Then open `http://127.0.0.1:8788` and use the core buttons in order:

1. `Connect`
2. `Sign Message`
3. `Sign Transaction`
4. `Send Transaction`

The page also includes `Batch Sign All` and `Multi-Instruction Send` to exercise `signAllTransactions` and a multi-instruction transaction shape.

This page uses a 1-lamport self-transfer on devnet and is meant to trigger SignSafe on a controlled localhost origin instead of relying on third-party dApps.

## Licensing

This project is source-available under `BSL 1.1` with an Additional Use Grant.

- Main license: `LICENSE`
- Commercial terms: `COMMERCIAL_LICENSE.md`
- FAQ: `LICENSING_FAQ.md`
