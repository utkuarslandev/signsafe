window.SIGNSAFE_DEMO_TRANSACTIONS = [
  {
    id: "DEMO_JUPITER_SWAP",
    name: "Jupiter swap",
    description: "1 SOL to USDC through Jupiter. Expected verdict: safe.",
    tx: "demo-jupiter-swap",
    verdict: {
      risk: "safe",
      summary: "This swap exchanges about 1 SOL for USDC through Jupiter with no extra transfer instructions.",
      actions: [
        "Spend about 1 SOL from your wallet.",
        "Receive USDC from a routed Jupiter swap.",
        "Interact with known Jupiter and DEX programs only."
      ],
      risk_reasons: [],
      verdict: "This looks consistent with a normal swap. Proceed if the amount matches your intent."
    }
  },
  {
    id: "DEMO_DRAINER",
    name: "Wallet drainer",
    description: "Hidden extra transfers to an unknown address. Expected verdict: danger.",
    tx: "demo-drainer",
    verdict: {
      risk: "danger",
      summary: "This transaction attempts to transfer assets to an unknown address outside the expected app flow.",
      actions: [
        "Move most or all token balances out of your wallet.",
        "Send funds to an address that is not explained by the dApp.",
        "Execute multiple transfers in one signature request."
      ],
      risk_reasons: [
        "Bulk token movement to an unverified address.",
        "Transaction intent does not match a normal swap or mint flow.",
        "High likelihood of wallet-drain behavior."
      ],
      verdict: "Do not sign this transaction unless you independently trust every destination address."
    }
  },
  {
    id: "DEMO_NFT_MINT",
    name: "Metaplex mint",
    description: "Standard NFT mint setup with account creation. Expected verdict: review.",
    tx: "demo-nft-mint",
    verdict: {
      risk: "review",
      summary: "This mints an NFT through a Metaplex-style flow and creates new accounts as part of the mint.",
      actions: [
        "Spend SOL for mint and account rent.",
        "Create new accounts tied to the NFT mint.",
        "Interact with a known NFT metadata program."
      ],
      risk_reasons: [
        "Mint flows create new accounts and may include several setup instructions.",
        "Review the mint cost and collection details before signing."
      ],
      verdict: "This may be legitimate, but review the cost and expected collection before proceeding."
    }
  }
];
