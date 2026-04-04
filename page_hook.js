(function bootstrapSignSafePageHook() {
  const CHANNEL = "SIGNSAFE_PAGE_BRIDGE";
  const WRAPPED = "__signsafeWrapped";
  const METHOD_WRAPPED = "__signsafeMethodWrapped";
  const DEBUG = true;
  let nextRequestId = 1;

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
        stableCount = 0;
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

        return original(transaction, ...args);
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

        return original(transactions, ...args);
      };
    });

    wrapMethod(provider, "signMessage", function wrapSignMessage(original) {
      return async function signMessageWithSignSafe(message, ...args) {
        debugLog("intercepted signMessage", label);
        const approved = await requestSignMessageApproval(label);
        if (!approved) {
          throw new Error("SignSafe blocked this signMessage request.");
        }
        return original(message, ...args);
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

        return original(transaction, ...args);
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

        return original(transaction, ...args);
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
          const approved = await requestSignMessageApproval(label);
          if (!approved) {
            throw new Error("SignSafe blocked this signMessage request.");
          }
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

  function serializeTransaction(transaction) {
    if (!transaction || typeof transaction.serialize !== "function") {
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

  function requestSignMessageApproval(providerLabel) {
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
          isSignMessage: true
        },
        "*"
      );
    });
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
})();
