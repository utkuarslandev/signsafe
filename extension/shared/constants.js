(function initSignSafeSharedConstants(root) {
  const globalRoot = root || globalThis;
  const shared = globalRoot.SIGNSAFE_SHARED || (globalRoot.SIGNSAFE_SHARED = {});

  shared.constants = Object.freeze({
    PAGE_CHANNEL: "SIGNSAFE_PAGE_BRIDGE",
    OVERLAY_CHANNEL: "SIGNSAFE_OVERLAY",
    DEBUG_STORAGE_KEY: "signsafe-debug",
    STORAGE_KEYS: Object.freeze({
      OPENAI_API_KEY: "openai_api_key",
      SIGNSAFE_API_KEY: "signsafe_api_key",
      INSTALL_ID: "signsafe_install_id"
    }),
    API: Object.freeze({
      ANALYZE_ENDPOINT: "https://api.signsafe.xyz/v1/analyze"
    }),
    MESSAGE_TYPES: Object.freeze({
      PAGE: Object.freeze({
        PING: "PING",
        PONG: "PONG",
        ANALYZE_REQUEST: "ANALYZE_REQUEST",
        ANALYZE_RESPONSE: "ANALYZE_RESPONSE"
      }),
      OVERLAY: Object.freeze({
        SHOW_LOADING: "SHOW_LOADING",
        SHOW_VERDICT: "SHOW_VERDICT",
        SHOW_BATCH: "SHOW_BATCH",
        DECISION: "DECISION"
      }),
      RUNTIME: Object.freeze({
        SET_DEBUG: "SET_DEBUG",
        ANALYZE_TX: "ANALYZE_TX",
        RUN_DEMO_ANALYSIS: "RUN_DEMO_ANALYSIS"
      })
    })
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
