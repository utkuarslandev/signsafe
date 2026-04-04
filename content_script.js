(function bootstrapSignSafeContentScript() {
  const PAGE_CHANNEL = "SIGNSAFE_PAGE_BRIDGE";
  const OVERLAY_CHANNEL = "SIGNSAFE_OVERLAY";

  injectPageHook();

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.channel !== PAGE_CHANNEL || message.type !== "ANALYZE_REQUEST") {
      return;
    }

    const response = await handleAnalyzeRequest(message);
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
  }

  async function handleAnalyzeRequest(message) {
    const session = createOverlaySession();

    try {
      await session.showLoading({
        title:
          message.transactions.length > 1
            ? `Analyzing ${message.transactions.length} transactions`
            : "Analyzing transaction",
        detail: "Simulating on-chain effects and preparing a plain-English verdict."
      });

      const verdicts = [];
      for (const tx of message.transactions) {
        verdicts.push(
          await sendRuntimeMessage({
            type: "ANALYZE_TX",
            tx,
            method: message.method,
            sourceUrl: message.sourceUrl
          })
        );
      }

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
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            risk: "review",
            summary: "The extension could not reach its background worker.",
            actions: ["Retry the transaction after reloading the page."],
            risk_reasons: [chrome.runtime.lastError.message],
            verdict: "Proceed only if you can independently verify this transaction."
          });
          return;
        }

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
        return post({ type: "SHOW_LOADING", payload });
      },
      showVerdict(verdict, meta) {
        return awaitDecision("SHOW_VERDICT", { verdict, meta });
      },
      showBatchSummary(verdicts) {
        return awaitDecision("SHOW_BATCH", { verdicts });
      },
      close() {
        if (iframe.isConnected) {
          iframe.remove();
        }
      }
    };
  }
})();
