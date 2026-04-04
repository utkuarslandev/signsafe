(function initSignSafeDemoFixtures(root) {
  const globalRoot = root || globalThis;
  const shared = globalRoot.SIGNSAFE_SHARED || (globalRoot.SIGNSAFE_SHARED = {});

  const fixtures = [
    {
      id: "DEMO_JUPITER_SWAP",
      name: "Jupiter swap",
      description: "1 SOL to USDC through Jupiter. Expected verdict: safe.",
      tx: "demo-jupiter-swap",
      verdict: {
        risk: "safe",
        intercepted_method: "signTransaction",
        simulation_status: "confirmed",
        source: "demo fixture",
        reason_codes: [],
        summary: "This swap exchanges about 1 SOL for USDC through Jupiter with no extra transfer instructions.",
        actions: [
          "Spend about 1 SOL from your wallet.",
          "Receive USDC from a routed Jupiter swap.",
          "Interact with known Jupiter and DEX programs only."
        ],
        risk_reasons: [],
        facts: {
          intercepted_method: "signTransaction",
          simulation_status: "confirmed",
          source: "demo fixture",
          reason_codes: [],
          sol_changes: [{ deltaSol: -1.0 }],
          token_changes: [{ mint: "USDC", delta: 1.0 }],
          programs: [
            { programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", label: "Jupiter" },
            { programId: "11111111111111111111111111111111", label: "System Program" }
          ]
        },
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
        intercepted_method: "sendTransaction",
        simulation_status: "confirmed",
        source: "demo fixture",
        reason_codes: ["sol_outflow", "unknown_program", "multi_transfer_batch"],
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
        facts: {
          intercepted_method: "sendTransaction",
          simulation_status: "confirmed",
          source: "demo fixture",
          reason_codes: ["sol_outflow", "unknown_program", "multi_transfer_batch"],
          sol_changes: [{ deltaSol: -2.75 }],
          token_changes: [{ mint: "unknown-mint", delta: -3.0 }],
          programs: [
            { programId: "11111111111111111111111111111111", label: "System Program" },
            { programId: "unknown-program", label: "Unknown" }
          ]
        },
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
        intercepted_method: "signTransaction",
        simulation_status: "confirmed",
        source: "demo fixture",
        reason_codes: ["unknown_program", "multi_transfer_batch"],
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
        facts: {
          intercepted_method: "signTransaction",
          simulation_status: "confirmed",
          source: "demo fixture",
          reason_codes: ["unknown_program", "multi_transfer_batch"],
          sol_changes: [{ deltaSol: -0.03 }],
          token_changes: [{ mint: "NFT mint", delta: 1 }],
          programs: [
            { programId: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", label: "Metaplex" }
          ]
        },
        verdict: "This may be legitimate, but review the cost and expected collection before proceeding."
      }
    },
    {
      id: "DEMO_RAW_MESSAGE",
      name: "Login signature",
      description: "Raw message authorization with a readable preview. Expected verdict: review.",
      tx: "demo-raw-message",
      verdict: {
        risk: "review",
        intercepted_method: "signMessage",
        simulation_status: "not-applicable",
        source: "demo fixture",
        reason_codes: ["raw_message_signature"],
        summary: "This is a raw message signature request for session authorization.",
        actions: [
          "Sign a non-transaction message.",
          "Authorize a session or login-style workflow.",
          "Do not broadcast anything on-chain."
        ],
        risk_reasons: [
          "Raw signatures can be reused for off-chain approvals.",
          "Only continue if you initiated the login or session request."
        ],
        facts: {
          intercepted_method: "signMessage",
          simulation_status: "not-applicable",
          source: "demo fixture",
          reason_codes: ["raw_message_signature"],
          message_preview: "Sign this message to authenticate with the demo app.\nNonce: 019f3f6c",
          sol_changes: [],
          token_changes: [],
          programs: []
        },
        verdict: "Review the message text carefully before approving a login signature."
      }
    }
  ];

  shared.demoFixtures = fixtures;
  shared.demoVerdictsById = Object.freeze(
    fixtures.reduce((acc, fixture) => {
      acc[fixture.id] = fixture.verdict;
      return acc;
    }, {})
  );
  globalRoot.SIGNSAFE_DEMO_TRANSACTIONS = fixtures;
})(typeof globalThis !== "undefined" ? globalThis : self);
