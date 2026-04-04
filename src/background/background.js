try {
  importScripts(
    "../../shared/constants.js",
    "../../shared/demo-fixtures.js",
    "../../shared/background-analysis.js"
  );
} catch (_error) {
  // Shared assets are optional during local static checks.
}

const SHARED = self.SIGNSAFE_SHARED || {};
const CONSTANTS = SHARED.constants || {};
const RUNTIME_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.RUNTIME || {};
const STORAGE_KEYS = CONSTANTS.STORAGE_KEYS || {};
const DEMO_VERDICTS = SHARED.demoVerdictsById || {};

const RPC_ENDPOINT = "https://api.devnet.solana.com";
const OPENAI_API = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-5.4-nano";
const LARGE_SOL_TRANSFER_THRESHOLD = 1;
const VERDICT_CACHE_TTL_MS = 60_000;

let DEBUG = false;

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

const analysisService = SHARED.createBackgroundAnalysisService({
  rpcEndpoint: RPC_ENDPOINT,
  openaiApi: OPENAI_API,
  openaiModel: OPENAI_MODEL,
  largeSolTransferThreshold: LARGE_SOL_TRANSFER_THRESHOLD,
  verdictCacheTtlMs: VERDICT_CACHE_TTL_MS,
  knownPrograms: KNOWN_PROGRAMS,
  storageKeys: STORAGE_KEYS,
  debugLog
});

const RISK_COLORS = {
  safe:    "#22c55e",
  review:  "#f59e0b",
  danger:  "#ef3a3a",
  default: "#5a5a6e"
};

function drawShieldIcon(size, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const s = size / 128;

  // Shield path scaled from 128×128 viewBox
  const shield = new Path2D();
  shield.moveTo(64 * s, 20 * s);
  shield.lineTo(96 * s, 33 * s);
  shield.lineTo(96 * s, 62 * s);
  shield.bezierCurveTo(96 * s, 80 * s, 80 * s, 93 * s, 64 * s, 100 * s);
  shield.bezierCurveTo(48 * s, 93 * s, 32 * s, 80 * s, 32 * s, 62 * s);
  shield.lineTo(32 * s, 33 * s);
  shield.closePath();

  ctx.fillStyle = color + "30";
  ctx.fill(shield);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, 2 * s);
  ctx.lineJoin = "round";
  ctx.stroke(shield);

  // Brand dot at shield top
  ctx.beginPath();
  ctx.arc(64 * s, 20 * s, 3 * s, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

function setTabIcon(tabId, risk) {
  const color = RISK_COLORS[risk] || RISK_COLORS.default;
  try {
    chrome.action.setIcon({
      tabId,
      imageData: {
        16: drawShieldIcon(16, color),
        32: drawShieldIcon(32, color)
      }
    });
  } catch (_) {
    // OffscreenCanvas unavailable — silently skip
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    setTabIcon(tabId, "default");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === (RUNTIME_MESSAGE_TYPES.SET_DEBUG || "SET_DEBUG")) {
    DEBUG = Boolean(message.enabled);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === (RUNTIME_MESSAGE_TYPES.ANALYZE_TX || "ANALYZE_TX")) {
    const tabId = sender?.tab?.id ?? null;
    debugLog("received ANALYZE_TX", message.method, sender?.url || "");
    analysisService
      .analyzeTransaction(message.tx, {
        method: message.method || "signTransaction",
        sourceUrl: message.sourceUrl || sender?.url || ""
      })
      .then(verdict => {
        if (tabId != null) setTabIcon(tabId, verdict.risk);
        sendResponse(verdict);
      });
    return true;
  }

  if (message.type === (RUNTIME_MESSAGE_TYPES.RUN_DEMO_ANALYSIS || "RUN_DEMO_ANALYSIS")) {
    sendResponse(
      DEMO_VERDICTS[message.demoId] ||
        analysisService.buildReviewVerdict(
          "Unknown demo fixture.",
          analysisService.buildFallbackFacts({}),
          ["unknown_fixture"]
        )
    );
    return false;
  }

  return false;
});

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }

  console.log("[SignSafe background]", ...args);
}
