(function bootstrapSignSafeContentScript() {
  const CONSTANTS = globalThis.SIGNSAFE_SHARED?.constants || {};
  const PAGE_CHANNEL = CONSTANTS.PAGE_CHANNEL || "SIGNSAFE_PAGE_BRIDGE";
  const OVERLAY_CHANNEL = CONSTANTS.OVERLAY_CHANNEL || "SIGNSAFE_OVERLAY";
  const PAGE_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.PAGE || {};
  const OVERLAY_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.OVERLAY || {};
  const RUNTIME_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.RUNTIME || {};
  const DEBUG_STORAGE_KEY = CONSTANTS.DEBUG_STORAGE_KEY || "signsafe-debug";
  const DEBUG = isDebugEnabled();
  const createOverlaySession = globalThis.SIGNSAFE_CONTENT?.createOverlaySession;
  let analysisInProgress = false;

  syncDebugState();
  injectPageHook();

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.channel !== PAGE_CHANNEL || message.type !== (PAGE_MESSAGE_TYPES.ANALYZE_REQUEST || "ANALYZE_REQUEST")) {
      return;
    }

    debugLog("received page analyze request", message.method, message.providerLabel);

    if (analysisInProgress) {
      debugLog("rejecting overlapping analysis", message.method, message.providerLabel);
      window.postMessage(
        {
          channel: PAGE_CHANNEL,
          type: PAGE_MESSAGE_TYPES.ANALYZE_RESPONSE || "ANALYZE_RESPONSE",
          requestId: message.requestId,
          approved: false,
          error: "Another SignSafe analysis is already in progress."
        },
        "*"
      );
      return;
    }

    analysisInProgress = true;
    const response = await handleAnalyzeRequest(message);
    analysisInProgress = false;
    debugLog("sending page analyze response", message.method, response.approved);
    window.postMessage(
      {
        channel: PAGE_CHANNEL,
        type: PAGE_MESSAGE_TYPES.ANALYZE_RESPONSE || "ANALYZE_RESPONSE",
        requestId: message.requestId,
        ...response
      },
      "*"
    );
  });

  function injectPageHook() {
    injectPageScript("shared/constants.js")
      .then(() => injectPageScript("shared/page-helpers.js"))
      .then(() => injectPageScript("src/page/page-hook.js"))
      .then(() => debugLog("injected page hook"))
      .catch((error) => debugLog("page hook injection failed", error?.message || String(error)));
  }

  function injectPageScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(path);
      script.dataset.signsafe = "true";
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Failed to load ${path}`));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function handleAnalyzeRequest(message) {
    if (message.isSignMessage) {
      const session = createOverlaySession();
      try {
        await session.showLoading({
          phase: "message",
          title: "Reviewing signature request",
          detail: "Preparing a blind-signature warning before your wallet prompt appears."
        });
        debugLog("showing signMessage overlay");
        const approved = await session.showVerdict(
          {
            risk: "review",
            intercepted_method: "signMessage",
            simulation_status: "not-applicable",
            source: "heuristics",
            reason_codes: ["raw_message_signature"],
            summary: "A dApp is requesting your wallet signature on a raw message.",
            actions: [
              "Sign arbitrary bytes that could represent any off-chain action.",
              "This is not a transaction — no on-chain simulation is available."
            ],
            risk_reasons: [
              "signMessage is often used in phishing attacks to capture blind signatures.",
              "Only approve if you initiated this action and trust the dApp."
            ],
            verdict: "Only sign if you understand what you are authorizing.",
            facts: {
              intercepted_method: "signMessage",
              simulation_status: "not-applicable",
              source: "heuristics",
              reason_codes: ["raw_message_signature"],
              message_preview: message.messagePreview || "Preview unavailable.",
              sol_changes: [],
              token_changes: [],
              programs: []
            }
          },
          { current: 1, total: 1 }
        );
        return { approved };
      } finally {
        session.close();
      }
    }

    const session = createOverlaySession();

    try {
      debugLog("showing loading overlay", message.method, message.transactions.length);
      await session.showLoading({
        phase: "review",
        title:
          message.transactions.length > 1
            ? `Analyzing ${message.transactions.length} transactions`
            : "Analyzing transaction",
        detail: "Running simulation, deterministic checks, and explanation generation."
      });

      const verdicts = await Promise.all(
        message.transactions.map((tx) =>
          sendRuntimeMessage({
            type: RUNTIME_MESSAGE_TYPES.ANALYZE_TX || "ANALYZE_TX",
            tx,
            method: message.method,
            sourceUrl: message.sourceUrl
          })
        )
      );
      debugLog("received verdicts", verdicts.length);

      if (message.transactions.length === 1) {
        const approved = await session.showVerdict(verdicts[0], {
          current: 1,
          total: 1
        });
        return { approved };
      }

      const flagged = verdicts
        .map((verdict, index) => ({ verdict, index }))
        .filter((entry) => entry.verdict.risk !== "safe");

      if (flagged.length === 0) {
        const approved = await session.showBatchSummary(verdicts);
        return { approved };
      }

      for (const entry of flagged) {
        const approved = await session.showVerdict(entry.verdict, {
          current: entry.index + 1,
          total: verdicts.length
        });

        if (!approved) {
          return { approved: false };
        }
      }

      return { approved: true };
    } catch (error) {
      return {
        approved: false,
        error: error.message || "SignSafe could not complete analysis."
      };
    } finally {
      session.close();
    }
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      debugLog("sending runtime message", payload.type, payload.method);
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          debugLog("runtime error", chrome.runtime.lastError.message);
          resolve({
            risk: "review",
            summary: "The extension could not reach its background worker.",
            actions: ["Retry the transaction after reloading the page."],
            risk_reasons: [chrome.runtime.lastError.message],
            verdict: "Proceed only if you can independently verify this transaction."
          });
          return;
        }

        debugLog("runtime response", payload.type, payload.method);
        resolve(response);
      });
    });
  }

  function debugLog(...args) {
    if (!DEBUG) {
      return;
    }

    console.log("[SignSafe content]", ...args);
  }

  function isDebugEnabled() {
    try {
      return Boolean(window.__SIGNSAFE_DEBUG__) || localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function syncDebugState() {
    chrome.runtime.sendMessage({ type: RUNTIME_MESSAGE_TYPES.SET_DEBUG || "SET_DEBUG", enabled: DEBUG }, () => {
      void chrome.runtime.lastError;
    });
  }
})();
