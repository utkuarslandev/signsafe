(function initSignSafePageHelpers(root) {
  const globalRoot = root || globalThis;
  const shared = globalRoot.SIGNSAFE_SHARED || (globalRoot.SIGNSAFE_SHARED = {});

  shared.pageHelpers = {
    availableMethods,
    extractMessageFromRequest,
    previewMessage,
    serializeTransaction,
    trySerializeTransaction
  };

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

    try {
      return bytesToBase64(transaction.serialize());
    } catch (_error0) {
      try {
        return bytesToBase64(
          transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false
          })
        );
      } catch (_error1) {
        try {
          return bytesToBase64(transaction.serialize({ requireAllSignatures: false }));
        } catch (_error2) {
          return null;
        }
      }
    }
  }

  function trySerializeTransaction(transaction) {
    try {
      return serializeTransaction(transaction);
    } catch (_error) {
      return "";
    }
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

  function bytesToBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";

    for (let index = 0; index < view.length; index += 0x8000) {
      binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
    }

    return btoa(binary);
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
})(typeof globalThis !== "undefined" ? globalThis : self);
