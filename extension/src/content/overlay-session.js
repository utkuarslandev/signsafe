(function initSignSafeOverlaySession() {
  const CONSTANTS = globalThis.SIGNSAFE_SHARED?.constants || {};
  const OVERLAY_CHANNEL = CONSTANTS.OVERLAY_CHANNEL || "SIGNSAFE_OVERLAY";
  const OVERLAY_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.OVERLAY || {};

  const contentRoot = globalThis.SIGNSAFE_CONTENT || (globalThis.SIGNSAFE_CONTENT = {});

  contentRoot.createOverlaySession = function createOverlaySession(debugLog) {
    const overlayUrl = getRuntimeUrl("overlay.html");
    const sessionId = `signsafe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    const ready = new Promise((resolve) => {
      iframe.addEventListener("load", resolve, { once: true });
    });
    const pendingHandlers = [];

    iframe.id = "signsafe-overlay";
    iframe.src = overlayUrl;
    iframe.setAttribute("allowtransparency", "true");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
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
            message.type !== (OVERLAY_MESSAGE_TYPES.DECISION || "DECISION")
          ) {
            return;
          }

          const idx = pendingHandlers.indexOf(handler);
          if (idx >= 0) pendingHandlers.splice(idx, 1);
          window.removeEventListener("message", handler);
          resolve(Boolean(message.approved));
        };

        pendingHandlers.push(handler);
        window.addEventListener("message", handler);
        await post({ type, payload });
      });
    }

    return {
      showLoading(payload) {
        debugLog?.("overlay loading");
        return post({ type: OVERLAY_MESSAGE_TYPES.SHOW_LOADING || "SHOW_LOADING", payload });
      },
      showVerdict(verdict, meta) {
        debugLog?.("overlay verdict", verdict?.risk, meta?.current, meta?.total);
        return awaitDecision(OVERLAY_MESSAGE_TYPES.SHOW_VERDICT || "SHOW_VERDICT", { verdict, meta });
      },
      showBatchSummary(verdicts) {
        debugLog?.("overlay batch summary", verdicts.length);
        return awaitDecision(OVERLAY_MESSAGE_TYPES.SHOW_BATCH || "SHOW_BATCH", { verdicts });
      },
      close() {
        for (const handler of pendingHandlers) {
          window.removeEventListener("message", handler);
        }
        pendingHandlers.length = 0;
        if (iframe.isConnected) {
          debugLog?.("overlay closed");
          iframe.remove();
        }
      }
    };
  };

  function getRuntimeUrl(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch (_error) {
      throw new Error("SignSafe was reloaded or updated. Reload this page and try again.");
    }
  }
})();
