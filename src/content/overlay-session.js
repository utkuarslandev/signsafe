(function initSignSafeOverlaySession() {
  const CONSTANTS = globalThis.SIGNSAFE_SHARED?.constants || {};
  const OVERLAY_CHANNEL = CONSTANTS.OVERLAY_CHANNEL || "SIGNSAFE_OVERLAY";
  const OVERLAY_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.OVERLAY || {};

  const contentRoot = globalThis.SIGNSAFE_CONTENT || (globalThis.SIGNSAFE_CONTENT = {});

  contentRoot.createOverlaySession = function createOverlaySession(debugLog) {
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
            message.type !== (OVERLAY_MESSAGE_TYPES.DECISION || "DECISION")
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
        if (iframe.isConnected) {
          debugLog?.("overlay closed");
          iframe.remove();
        }
      }
    };
  };
})();
