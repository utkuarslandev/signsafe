(function bootstrapSignSafePageHook() {
  const CHANNEL = "SIGNSAFE_PAGE_BRIDGE";
  const WRAPPED = "__signsafeWrapped";
  const METHOD_WRAPPED = "__signsafeMethodWrapped";
  const ACTIVE_METHOD = "__signsafeActiveMethod";
  const DEBUG = false;
  let nextRequestId = 1;
  installProviderSlotTraps();

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== "PING") {
      return;
    }

    window.postMessage({ channel: CHANNEL, type: "PONG" }, "*");
  });

  let stableCount = 0;
  const discoveryInterval = setInterval(() => {
    let foundNew = false;
    for (const provider of discoverProviders()) {
      if (!provider.instance[WRAPPED]) {
        foundNew = true;
      }
      wrapProvider(provider.instance, provider.label);
    }
    if (foundNew) {
      stableCount = 0;
    } else {
      stableCount++;
      if (stableCount >= 8) {
        clearInterval(discoveryInterval);
      }
    }
  }, 250);

  function discoverProviders() {
    const candidates = [
      { instance: window.solana, label: "window.solana" },
      { instance: window.phantom?.solana, label: "window.phantom.solana" },
      { instance: window.solflare, label: "window.solflare" },
      { instance: window.backpack?.solana, label: "window.backpack.solana" }
    ];

    const seen = new Set();
    return candidates.filter((candidate) => {
      if (!candidate.instance || seen.has(candidate.instance)) {
        return false;
      }

      seen.add(candidate.instance);
      return true;
    });
  }

  function wrapProvider(provider, label) {
    if (!provider || provider[WRAPPED]) {
      return;
    }

    debugLog("wrapping provider", label, availableMethods(provider));

    const hasSupportedMethods = [
      "signTransaction",
      "signAllTransactions",
      "signMessage",
      "sendTransaction",
      "signAndSendTransaction",
      "request"
    ].some((method) => typeof provider[method] === "function");

    if (!hasSupportedMethods) {
      return;
    }

    wrapMethod(provider, "signTransaction", function wrapSignTransaction(original) {
      return async function signTransactionWithSignSafe(transaction, ...args) {
        debugLog("intercepted signTransaction", label);
        const result = await requestApproval({
          method: "signTransaction",
          providerLabel: label,
          transactions: [trySerializeTransaction(transaction)]
        });

        if (!result.approved) {
          throw new Error(result.error || "SignSafe blocked this transaction.");
        }

        return withActiveMethod(provider, "signTransaction", () => original(transaction, ...args));
      };
    });

    wrapMethod(provider, "signAllTransactions", function wrapSignAllTransactions(original) {
      return async function signAllTransactionsWithSignSafe(transactions, ...args) {
        debugLog("intercepted signAllTransactions", label, transactions?.length || 0);
        const serializedTransactions = transactions.map((transaction) => trySerializeTransaction(transaction));
        const result = await requestApproval({
          method: "signAllTransactions",
          providerLabel: label,
          transactions: serializedTransactions
        });

        if (!result.approved) {
          throw new Error(result.error || "SignSafe blocked this transaction batch.");
        }

        return withActiveMethod(provider, "signAllTransactions", () => original(transactions, ...args));
      };
    });

    wrapMethod(provider, "signMessage", function wrapSignMessage(original) {
      return async function signMessageWithSignSafe(message, ...args) {
        debugLog("intercepted signMessage", label);
        const approved = await requestSignMessageApproval(label, message);
        if (!approved) {
          throw new Error("SignSafe blocked this signMessage request.");
        }
        return withActiveMethod(provider, "signMessage", () => original(message, ...args));
      };
    });

    wrapMethod(provider, "sendTransaction", function wrapSendTransaction(original) {
      return async function sendTransactionWithSignSafe(transaction, ...args) {
        debugLog("intercepted sendTransaction", label);
        const result = await requestApproval({
          method: "sendTransaction",
          providerLabel: label,
          transactions: [trySerializeTransaction(transaction)]
        });

        if (!result.approved) {
          throw new Error(result.error || "SignSafe blocked this sendTransaction request.");
        }

        return withActiveMethod(provider, "sendTransaction", () => original(transaction, ...args));
      };
    });

    wrapMethod(provider, "signAndSendTransaction", function wrapSignAndSendTransaction(original) {
      return async function signAndSendTransactionWithSignSafe(transaction, ...args) {
        debugLog("intercepted signAndSendTransaction", label);
        const result = await requestApproval({
          method: "signAndSendTransaction",
          providerLabel: label,
          transactions: [trySerializeTransaction(transaction)]
        });

        if (!result.approved) {
          throw new Error(result.error || "SignSafe blocked this signAndSendTransaction request.");
        }

        return withActiveMethod(provider, "signAndSendTransaction", () => original(transaction, ...args));
      };
    });

    wrapMethod(provider, "request", function wrapRequest(original) {
      return async function requestWithSignSafe(payload, ...args) {
        const method = payload?.method;
        if (!method) {
          return original(payload, ...args);
        }

        debugLog("intercepted request", label, method);

        if (method === "signMessage") {
          if (getActiveMethod(provider) === "signMessage") {
            return original(payload, ...args);
          }
          const approved = await requestSignMessageApproval(label, extractMessageFromRequest(payload));
          if (!approved) {
            throw new Error("SignSafe blocked this signMessage request.");
          }
          return withActiveMethod(provider, "signMessage", () => original(payload, ...args));
        }

        if (isTransactionMethod(method)) {
          if (getActiveMethod(provider) === method) {
            return original(payload, ...args);
          }

          const transactions = extractTransactionsFromRequest(payload, method);

          const result = await requestApproval({
            method,
            providerLabel: label,
            transactions: transactions.length > 0 ? transactions : [""]
          });

          if (!result.approved) {
            throw new Error(result.error || `SignSafe blocked this ${method} request.`);
          }

          return withActiveMethod(provider, method, () => original(payload, ...args));
        }

        return original(payload, ...args);
      };
    });

    try {
      Object.defineProperty(provider, WRAPPED, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch (_error) {
      provider[WRAPPED] = true;
    }
  }

  function wrapMethod(provider, methodName, createWrapped) {
    if (typeof provider[methodName] !== "function") {
      return;
    }

    const current = provider[methodName];
    if (current[METHOD_WRAPPED]) {
      return;
    }

    const original = current.bind(provider);
    const wrapped = createWrapped(original);

    try {
      Object.defineProperty(wrapped, METHOD_WRAPPED, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch (_error) {
      wrapped[METHOD_WRAPPED] = true;
    }

    provider[methodName] = wrapped;
  }

  async function withActiveMethod(provider, methodName, callback) {
    const previous = provider[ACTIVE_METHOD];
    provider[ACTIVE_METHOD] = methodName;

    try {
      return await callback();
    } finally {
      provider[ACTIVE_METHOD] = previous || null;
    }
  }

  function getActiveMethod(provider) {
    return provider?.[ACTIVE_METHOD] || null;
  }

  function isTransactionMethod(method) {
    return method === "signTransaction" || method === "signAllTransactions" || method === "sendTransaction" || method === "signAndSendTransaction";
  }

  function extractTransactionsFromRequest(payload, method) {
    const params = payload?.params;
    const items = [];

    const pushTransactionLike = (value) => {
      const serialized = trySerializeTransaction(value);
      if (serialized != null) {
        items.push(serialized);
      }
    };

    if (Array.isArray(params)) {
      if (method === "signAllTransactions") {
        for (const item of params) {
          if (Array.isArray(item)) {
            item.forEach(pushTransactionLike);
          } else {
            pushTransactionLike(item);
          }
        }
      } else {
        const first = params[0];
        if (Array.isArray(first)) {
          first.forEach(pushTransactionLike);
        } else {
          pushTransactionLike(first);
        }
      }
    } else if (params && typeof params === "object") {
      if (Array.isArray(params.transactions)) {
        params.transactions.forEach(pushTransactionLike);
      } else if (params.transaction) {
        pushTransactionLike(params.transaction);
      } else {
        pushTransactionLike(params);
      }
    }

    return items;
  }

  function installProviderSlotTraps() {
    trapWindowSlot("solana", "window.solana");
    trapWindowSlot("solflare", "window.solflare");
    trapWindowSlot("backpack", "window.backpack", "solana");
    trapWindowSlot("phantom", "window.phantom", "solana");
  }

  function trapWindowSlot(slotName, label, innerSlotName = null) {
    let currentValue = window[slotName];
    const descriptor = Object.getOwnPropertyDescriptor(window, slotName);

    if (currentValue) {
      wrapProvider(currentValue, label);
      if (innerSlotName && currentValue && typeof currentValue === "object") {
        trapNestedSlot(currentValue, innerSlotName, `${label}.${innerSlotName}`);
      }
    }

    try {
      Object.defineProperty(window, slotName, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return currentValue;
        },
        set(value) {
          currentValue = value;
          wrapProvider(value, label);
          if (innerSlotName && value && typeof value === "object") {
            trapNestedSlot(value, innerSlotName, `${label}.${innerSlotName}`);
          }
        }
      });
    } catch (_error) {
      // Some properties may be non-configurable; keep polling as a fallback.
    }
  }

  function trapNestedSlot(target, slotName, label) {
    if (!target || typeof target !== "object") {
      return;
    }

    let currentValue = target[slotName];
    const descriptor = Object.getOwnPropertyDescriptor(target, slotName);

    if (currentValue) {
      wrapProvider(currentValue, label);
    }

    try {
      Object.defineProperty(target, slotName, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return currentValue;
        },
        set(value) {
          currentValue = value;
          wrapProvider(value, label);
        }
      });
    } catch (_error) {
      // Fallback polling still covers late assignments if this object is sealed.
    }
  }

  function serializeTransaction(transaction) {
    if (!transaction) {
      return null;
    }

    if (typeof transaction === "string") {
      return looksLikeBase64(transaction) ? transaction : null;
    }

    if (transaction instanceof Uint8Array) {
      return bytesToBase64(transaction);
    }

    if (transaction instanceof ArrayBuffer) {
      return bytesToBase64(new Uint8Array(transaction));
    }

    if (Array.isArray(transaction) && transaction.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return bytesToBase64(Uint8Array.from(transaction));
    }

    if (typeof transaction.serialize !== "function") {
      return null;
    }

    // VersionedTransaction (v0) takes no args; legacy Transaction takes options.
    // Try VersionedTransaction path first (no-arg), then legacy with options.
    try {
      const bytes = transaction.serialize();
      return bytesToBase64(bytes);
    } catch (_e0) {
      try {
        const bytes = transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false
        });
        return bytesToBase64(bytes);
      } catch (_e1) {
        try {
          const bytes = transaction.serialize({ requireAllSignatures: false });
          return bytesToBase64(bytes);
        } catch (_e2) {
          return null;
        }
      }
    }
  }

  function bytesToBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";

    for (let index = 0; index < view.length; index += 0x8000) {
      binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
    }

    return btoa(binary);
  }

  function trySerializeTransaction(transaction) {
    try {
      return serializeTransaction(transaction);
    } catch (_error) {
      return "";
    }
  }

  function requestApproval(payload) {
    const requestId = `req-${Date.now()}-${nextRequestId++}`;
    debugLog("requesting approval", payload.providerLabel, payload.method);

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", handler);
        debugLog("approval timed out", payload.providerLabel, payload.method);
        resolve({
          approved: false,
          error: "SignSafe timed out before analysis completed."
        });
      }, 30000);

      const handler = (event) => {
        if (event.source !== window) {
          return;
        }

        const message = event.data;
        if (!message || message.channel !== CHANNEL || message.type !== "ANALYZE_RESPONSE") {
          return;
        }

        if (message.requestId !== requestId) {
          return;
        }

        window.removeEventListener("message", handler);
        window.clearTimeout(timeoutId);
        debugLog("approval response", payload.providerLabel, payload.method, Boolean(message.approved));
        resolve({
          approved: Boolean(message.approved),
          error: message.error || ""
        });
      };

      window.addEventListener("message", handler);
      window.postMessage(
        {
          channel: CHANNEL,
          type: "ANALYZE_REQUEST",
          requestId,
          method: payload.method,
          providerLabel: payload.providerLabel,
          sourceUrl: window.location.href,
          transactions: payload.transactions
        },
        "*"
      );
    });
  }

  function requestSignMessageApproval(providerLabel, message) {
    const requestId = `req-msg-${Date.now()}-${nextRequestId++}`;
    debugLog("requesting signMessage approval", providerLabel);

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", handler);
        debugLog("signMessage approval timed out", providerLabel);
        resolve(false);
      }, 30000);

      const handler = (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.channel !== CHANNEL || msg.type !== "ANALYZE_RESPONSE" || msg.requestId !== requestId) return;
        window.removeEventListener("message", handler);
        window.clearTimeout(timeoutId);
        debugLog("signMessage approval response", providerLabel, Boolean(msg.approved));
        resolve(Boolean(msg.approved));
      };

      window.addEventListener("message", handler);
      window.postMessage(
        {
          channel: CHANNEL,
          type: "ANALYZE_REQUEST",
          requestId,
          method: "signMessage",
          providerLabel,
          sourceUrl: window.location.href,
          transactions: [],
          isSignMessage: true,
          messagePreview: previewMessage(message)
        },
        "*"
      );
    });
  }

  function extractMessageFromRequest(payload) {
    const params = payload?.params;
    if (Array.isArray(params) && params.length > 0) {
      return params[0];
    }
    if (params && typeof params === "object" && "message" in params) {
      return params.message;
    }
    return null;
  }

  function previewMessage(message) {
    if (!message) {
      return "";
    }

    const bytes = normalizeBytes(message);
    if (!bytes) {
      return "";
    }

    const utf8 = decodeUtf8(bytes);
    if (utf8 && isMostlyPrintable(utf8)) {
      return truncatePreview(utf8);
    }

    const hex = Array.from(bytes.slice(0, 64))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    return truncatePreview(`hex (${bytes.length} bytes): ${hex}`);
  }

  function normalizeBytes(value) {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return Uint8Array.from(value);
    }
    if (typeof value === "string") {
      return new TextEncoder().encode(value);
    }
    return null;
  }

  function decodeUtf8(bytes) {
    try {
      return new TextDecoder().decode(bytes);
    } catch (_error) {
      return "";
    }
  }

  function isMostlyPrintable(text) {
    const cleaned = text.replace(/[\r\n\t]/g, "");
    if (!cleaned) {
      return false;
    }
    const printable = cleaned.split("").filter((char) => char >= " " && char <= "~").length;
    return printable / cleaned.length > 0.85;
  }

  function truncatePreview(text) {
    return text.length > 280 ? `${text.slice(0, 277)}...` : text;
  }

  function looksLikeBase64(value) {
    return /^[A-Za-z0-9+/=]+$/.test(value) && value.length % 4 === 0;
  }

  function availableMethods(provider) {
    return [
      "connect",
      "request",
      "signMessage",
      "signTransaction",
      "signAllTransactions",
      "sendTransaction",
      "signAndSendTransaction"
    ].filter((method) => typeof provider?.[method] === "function");
  }

  function debugLog(...args) {
    if (!DEBUG) {
      return;
    }

    console.log("[SignSafe page_hook]", ...args);
  }

  function isDebugEnabled() {
    try {
      return Boolean(window.__SIGNSAFE_DEBUG__) || localStorage.getItem("signsafe-debug") === "1";
    } catch (_error) {
      return false;
    }
  }
})();
