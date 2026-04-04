(function bootstrapSignSafeContentScript() {
  const PAGE_CHANNEL = "SIGNSAFE_PAGE_BRIDGE";
  const OVERLAY_CHANNEL = "SIGNSAFE_OVERLAY";
  const DEBUG = false;
  let analysisInProgress = false;

  syncDebugState();
  injectPageHook();

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.channel !== PAGE_CHANNEL || message.type !== "ANALYZE_REQUEST") {
      return;
    }

    debugLog("received page analyze request", message.method, message.providerLabel);

    if (analysisInProgress) {
      debugLog("rejecting overlapping analysis", message.method, message.providerLabel);
      window.postMessage(
        {
          channel: PAGE_CHANNEL,
          type: "ANALYZE_RESPONSE",
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
        type: "ANALYZE_RESPONSE",
        requestId: message.requestId,
        ...response
      },
      "*"
    );
  });

  function injectPageHook() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page_hook.js");
    script.dataset.signsafe = "true";
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    debugLog("injected page hook");
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
            type: "ANALYZE_TX",
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

  function createOverlaySession() {
    const sessionId = `signsafe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    const ready = new Promise((resolve) => {
      iframe.addEventListener("load", resolve, { once: true });
    });

    iframe.id = "signsafe-overlay";
    iframe.src = chrome.runtime.getURL("overlay.html");
    iframe.setAttribute("allowtransparency", "true");
    iframe.style.cssText = [
      "position:fixed",
      "inset:0",
      "width:100%",
      "height:100%",
      "border:none",
      "background:transparent",
      "z-index:2147483647"
    ].join(";");

    const host = document.documentElement || document.body;
    host.appendChild(iframe);

    async function post(message) {
      await ready;
      iframe.contentWindow.postMessage(
        {
          channel: OVERLAY_CHANNEL,
          sessionId,
          ...message
        },
        "*"
      );
    }

    function awaitDecision(type, payload) {
      return new Promise(async (resolve) => {
        const handler = (event) => {
          const message = event.data;
          if (
            event.source !== iframe.contentWindow ||
            !message ||
            message.channel !== OVERLAY_CHANNEL ||
            message.sessionId !== sessionId ||
            message.type !== "DECISION"
          ) {
            return;
          }

          window.removeEventListener("message", handler);
          resolve(Boolean(message.approved));
        };

        window.addEventListener("message", handler);
        await post({ type, payload });
      });
    }

    return {
      showLoading(payload) {
        debugLog("overlay loading");
        return post({ type: "SHOW_LOADING", payload });
      },
      showVerdict(verdict, meta) {
        debugLog("overlay verdict", verdict?.risk, meta?.current, meta?.total);
        return awaitDecision("SHOW_VERDICT", { verdict, meta });
      },
      showBatchSummary(verdicts) {
        debugLog("overlay batch summary", verdicts.length);
        return awaitDecision("SHOW_BATCH", { verdicts });
      },
      close() {
        if (iframe.isConnected) {
          debugLog("overlay closed");
          iframe.remove();
        }
      }
    };
  }

  function debugLog(...args) {
    if (!DEBUG) {
      return;
    }

    console.log("[SignSafe content]", ...args);
  }

  function isDebugEnabled() {
    try {
      return Boolean(window.__SIGNSAFE_DEBUG__) || localStorage.getItem("signsafe-debug") === "1";
    } catch (_error) {
      return false;
    }
  }

  function syncDebugState() {
    chrome.runtime.sendMessage({ type: "SET_DEBUG", enabled: DEBUG }, () => {
      void chrome.runtime.lastError;
    });
  }
})();
