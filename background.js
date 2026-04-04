const RPC_ENDPOINT = "https://api.devnet.solana.com";
const OPENAI_API = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-5.4-mini";
const DEBUG = true;

const KNOWN_PROGRAMS = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
  srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX: "OpenBook DEX",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Metaplex"
};

const DEMO_VERDICTS = {
  DEMO_JUPITER_SWAP: {
    risk: "safe",
    summary: "This swap exchanges about 1 SOL for USDC through Jupiter with no extra transfer instructions.",
    actions: [
      "Spend about 1 SOL from your wallet.",
      "Receive USDC from a routed Jupiter swap.",
      "Interact with known Jupiter and DEX programs only."
    ],
    risk_reasons: [],
    verdict: "This looks consistent with a normal swap. Proceed if the amount matches your intent."
  },
  DEMO_DRAINER: {
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
  },
  DEMO_NFT_MINT: {
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
};

const verdictCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "ANALYZE_TX") {
    debugLog("received ANALYZE_TX", message.method, sender?.url || "");
    analyzeTransaction(message.tx, {
      method: message.method || "signTransaction",
      sourceUrl: message.sourceUrl || sender?.url || ""
    }).then(sendResponse);
    return true;
  }

  if (message.type === "RUN_DEMO_ANALYSIS") {
    sendResponse(DEMO_VERDICTS[message.demoId] || buildReviewVerdict("Unknown demo fixture.", [], []));
    return false;
  }

  return false;
});

async function analyzeTransaction(base64Tx, context) {
  if (!base64Tx || typeof base64Tx !== "string" || base64Tx.trim() === "") {
    debugLog("empty or invalid transaction payload", context?.method);
    return buildReviewVerdict("Could not analyze this transaction because it could not be serialized.", [], [
      "The dApp did not provide a valid transaction payload."
    ]);
  }

  if (verdictCache.has(base64Tx)) {
    debugLog("cache hit", context?.method);
    return verdictCache.get(base64Tx);
  }

  try {
    debugLog("simulate start", context?.method);
    const simulation = await simulateTransaction(base64Tx);
    debugLog("simulate complete", context?.method);
    const parsed = parseSimulation(simulation, context);
    debugLog("openai start", context?.method);
    const verdict = await askOpenAI(parsed);
    debugLog("openai complete", context?.method, verdict?.risk);
    verdictCache.set(base64Tx, verdict);
    return verdict;
  } catch (error) {
    debugLog("analysis failed", context?.method, error.message);
    return buildReviewVerdict(
      "Could not fully analyze this transaction. Proceed with caution.",
      [],
      [`Analysis error: ${error.message}`]
    );
  }
}

async function simulateTransaction(base64Tx) {
  const data = await fetchJson(
    RPC_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [
          base64Tx,
          {
            encoding: "base64",
            commitment: "processed",
            replaceRecentBlockhash: true,
            sigVerify: false
          }
        ]
      })
    },
    12000
  );

  if (data?.error?.message) {
    throw new Error(data.error.message);
  }

  return data?.result;
}

function parseSimulation(simulation, context) {
  const value = simulation?.value || {};
  const preBalances = Array.isArray(value.preBalances) ? value.preBalances : [];
  const postBalances = Array.isArray(value.postBalances) ? value.postBalances : [];
  const logs = Array.isArray(value.logs) ? value.logs : [];
  const programs = extractProgramsFromLogs(logs);

  const solChanges = preBalances
    .map((pre, index) => {
      const post = postBalances[index] || 0;
      const deltaLamports = post - pre;
      return {
        accountIndex: index,
        deltaLamports,
        deltaSol: Number((deltaLamports / 1e9).toFixed(9))
      };
    })
    .filter((entry) => entry.deltaLamports !== 0);

  const preTokenBalances = Array.isArray(value.preTokenBalances) ? value.preTokenBalances : [];
  const postTokenBalances = Array.isArray(value.postTokenBalances) ? value.postTokenBalances : [];
  const tokenIndex = new Map();

  for (const entry of [...preTokenBalances, ...postTokenBalances]) {
    const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
    if (!tokenIndex.has(key)) {
      tokenIndex.set(key, {
        accountIndex: entry.accountIndex,
        mint: entry.mint,
        owner: entry.owner || "",
        preAmount: 0,
        postAmount: 0
      });
    }
  }

  for (const entry of preTokenBalances) {
    const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
    tokenIndex.get(key).preAmount = Number(entry?.uiTokenAmount?.uiAmountString || "0");
  }

  for (const entry of postTokenBalances) {
    const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
    tokenIndex.get(key).postAmount = Number(entry?.uiTokenAmount?.uiAmountString || "0");
  }

  const tokenChanges = Array.from(tokenIndex.values())
    .map((entry) => ({
      ...entry,
      delta: Number((entry.postAmount - entry.preAmount).toFixed(9))
    }))
    .filter((entry) => entry.delta !== 0);

  return {
    sourceUrl: context?.sourceUrl || "",
    method: context?.method || "signTransaction",
    error: value.err || null,
    unitsConsumed: value.unitsConsumed ?? null,
    logs,
    programs: programs.map((programId) => ({
      programId,
      label: KNOWN_PROGRAMS[programId] || null
    })),
    solChanges,
    tokenChanges
  };
}

function extractProgramsFromLogs(logs) {
  const seen = new Set();

  for (const line of logs) {
    const match = /^Program (\w+) invoke/.exec(line);
    if (match) {
      seen.add(match[1]);
    }
  }

  return Array.from(seen);
}

async function askOpenAI(parsed) {
  const apiKey = await getApiKey();

  if (!apiKey) {
    debugLog("missing openai api key");
    return buildReviewVerdict(
      "SignSafe could not contact OpenAI because no API key is configured yet.",
      buildHumanActions(parsed),
      ["Open the extension options page and save an OpenAI API key before using live analysis."]
    );
  }

  const prompt = [
    "You are a Solana transaction security analyzer.",
    "Return only raw JSON. No markdown, no code fences, no commentary.",
    "",
    "Simulation data:",
    JSON.stringify(parsed, null, 2),
    "",
    "Known safe programs:",
    JSON.stringify(KNOWN_PROGRAMS, null, 2),
    "",
    "Return exactly this shape:",
    JSON.stringify(
      {
        risk: "safe | review | danger",
        summary: "one-sentence plain English summary",
        actions: ["specific user-visible effects"],
        risk_reasons: ["specific concerns, or empty array"],
        verdict: "one-sentence recommendation"
      },
      null,
      2
    ),
    "",
    "Risk rules:",
    '- danger: suspicious asset drains, unexplained transfers, simulation errors, or obviously malicious behavior.',
    '- review: unknown programs, unclear intent, unusual balance changes, or incomplete confidence.',
    '- safe: recognized intent with no suspicious side effects.',
    "",
    "Be conservative. If uncertain, return review."
  ].join("\n");

  const data = await fetchJson(
    OPENAI_API,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: prompt,
        max_output_tokens: 500
      })
    },
    15000
  );

  const rawText = extractOpenAIText(data);
  const sanitized = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const parsedVerdict = JSON.parse(sanitized);
    return normalizeVerdict(parsedVerdict, parsed);
  } catch (error) {
    debugLog("failed to parse openai response");
    return buildReviewVerdict(
      "OpenAI returned an unexpected response, so SignSafe could not fully verify this transaction.",
      buildHumanActions(parsed),
      ["The AI response could not be parsed into the expected verdict format."]
    );
  }
}

function normalizeVerdict(verdict, parsed) {
  const fallbackActions = buildHumanActions(parsed);
  const normalizedRisk = ["safe", "review", "danger"].includes(verdict?.risk) ? verdict.risk : "review";

  return {
    risk: normalizedRisk,
    summary: safeString(verdict?.summary) || "Could not summarize this transaction clearly.",
    actions: normalizeStringArray(verdict?.actions, fallbackActions),
    risk_reasons: normalizeStringArray(verdict?.risk_reasons, []),
    verdict:
      safeString(verdict?.verdict) ||
      "Review the simulated effects carefully before approving this transaction."
  };
}

function buildHumanActions(parsed) {
  const actions = [];

  for (const change of parsed.solChanges) {
    const direction = change.deltaSol > 0 ? "receives" : "spends";
    actions.push(`Account #${change.accountIndex} ${direction} ${Math.abs(change.deltaSol)} SOL.`);
  }

  for (const change of parsed.tokenChanges) {
    const direction = change.delta > 0 ? "receives" : "sends";
    actions.push(
      `Token account #${change.accountIndex} ${direction} ${Math.abs(change.delta)} units of mint ${shorten(change.mint)}.`
    );
  }

  if (actions.length === 0 && Array.isArray(parsed.programs) && parsed.programs.length > 0) {
    for (const program of parsed.programs.slice(0, 5)) {
      actions.push(
        `Invoke ${program.label || "unknown"} program ${shorten(program.programId)} during ${parsed.method}.`
      );
    }
  }

  if (actions.length === 0) {
    actions.push("No balance deltas were extracted from the simulation.");
    actions.push(`Transaction source: ${parsed.sourceUrl || "unknown page"}.`);
  }

  return actions.slice(0, 8);
}

function buildReviewVerdict(summary, actions, riskReasons) {
  return {
    risk: "review",
    summary,
    actions: normalizeStringArray(actions, ["Review the transaction details manually before signing."]),
    risk_reasons: normalizeStringArray(riskReasons, []),
    verdict: "Proceed only if you fully understand the transaction effects."
  };
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback.slice();
  }

  const cleaned = value
    .map((entry) => safeString(entry))
    .filter(Boolean);

  return cleaned.length > 0 ? cleaned : fallback.slice();
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function shorten(value) {
  if (!value || value.length < 10) {
    return value || "unknown";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function getApiKey() {
  const result = await chrome.storage.local.get("openai_api_key");
  return safeString(result?.openai_api_key);
}

function extractOpenAIText(data) {
  if (!Array.isArray(data?.output)) {
    return "";
  }

  const parts = [];
  for (const item of data.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      debugLog("http error", url, response.status);
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }

  console.log("[SignSafe background]", ...args);
}
