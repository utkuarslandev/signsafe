(function bootstrapSignSafePageHook() {
  const CHANNEL = "SIGNSAFE_PAGE_BRIDGE";
  const WRAPPED = "__signsafeWrapped";
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

  setInterval(() => {
    for (const provider of discoverProviders()) {
      wrapProvider(provider.instance, provider.label);
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

    const originalSignTransaction =
      typeof provider.signTransaction === "function" ? provider.signTransaction.bind(provider) : null;
    const originalSignAllTransactions =
      typeof provider.signAllTransactions === "function"
        ? provider.signAllTransactions.bind(provider)
        : null;

    if (!originalSignTransaction && !originalSignAllTransactions) {
      return;
    }

    if (originalSignTransaction) {
      provider.signTransaction = async function signTransactionWithSignSafe(transaction, ...args) {
        const result = await requestApproval({
          method: "signTransaction",
          providerLabel: label,
          transactions: [trySerializeTransaction(transaction)]
        });

        if (!result.approved) {
          throw new Error(result.error || "SignSafe blocked this transaction.");
        }

        return originalSignTransaction(transaction, ...args);
      };
    }

    if (originalSignAllTransactions) {
      provider.signAllTransactions = async function signAllTransactionsWithSignSafe(transactions, ...args) {
        const serializedTransactions = transactions.map((transaction) => trySerializeTransaction(transaction));
        const result = await requestApproval({
          method: "signAllTransactions",
          providerLabel: label,
          transactions: serializedTransactions
        });

        if (!result.approved) {
          throw new Error(result.error || "SignSafe blocked this transaction batch.");
        }

        return originalSignAllTransactions(transactions, ...args);
      };
    }

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

  function serializeTransaction(transaction) {
    if (!transaction || typeof transaction.serialize !== "function") {
      return null;
    }

    try {
      const bytes = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      return bytesToBase64(bytes);
    } catch (_error) {
      try {
        const bytes = transaction.serialize({
          requireAllSignatures: false
        });
        return bytesToBase64(bytes);
      } catch (_nestedError) {
        return null;
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

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", handler);
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
})();
