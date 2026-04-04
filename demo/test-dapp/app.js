(function bootstrapSignSafeTestDapp() {
  const DEVNET_RPC = "https://api.devnet.solana.com";
  const WEB3_IMPORT_URL = "https://esm.sh/@solana/web3.js@1.98.4";

  const providerNameEl = document.getElementById("provider-name");
  const publicKeyEl = document.getElementById("public-key");
  const logOutputEl = document.getElementById("log-output");

  const buttons = {
    connect: document.getElementById("btn-connect"),
    signMessage: document.getElementById("btn-sign-message"),
    signTransaction: document.getElementById("btn-sign-transaction"),
    sendTransaction: document.getElementById("btn-send-transaction"),
    batchSign: document.getElementById("btn-batch-sign"),
    complexSend: document.getElementById("btn-complex-send")
  };

  let inflightAction = null;

  bind();
  renderProviderState();
  log("Ready. Open DevTools and look for [SignSafe ...] logs while using this page.");

  function bind() {
    buttons.connect.addEventListener("click", () => runAction("connect", connectWallet));
    buttons.signMessage.addEventListener("click", () => runAction("signMessage", signMessage));
    buttons.signTransaction.addEventListener("click", () => runAction("signTransaction", signTransaction));
    buttons.sendTransaction.addEventListener("click", () => runAction("sendTransaction", sendTransaction));
    buttons.batchSign.addEventListener("click", () => runAction("batchSignAll", batchSignAll));
    buttons.complexSend.addEventListener("click", () => runAction("complexSend", complexSend));
    document.getElementById("btn-clear-log").addEventListener("click", clearLog);

    window.addEventListener("focus", renderProviderState);
  }

  async function runAction(actionName, action) {
    if (inflightAction) {
      log(`Busy with ${inflightAction}. Wait for it to finish first.`);
      return;
    }

    inflightAction = actionName;
    setBusyState(true);
    log(`${actionName} start`);

    try {
      const result = await action();
      log(`${actionName} success`, summarize(result));
    } catch (error) {
      log(`${actionName} error`, error?.message || String(error));
      console.error(error);
    } finally {
      inflightAction = null;
      renderProviderState();
      setBusyState(false);
    }
  }

  async function connectWallet() {
    const provider = getProvider();
    const response = await provider.connect();
    return {
      publicKey: response?.publicKey?.toString() || provider.publicKey?.toString() || "unknown"
    };
  }

  async function signMessage() {
    const provider = await ensureConnected();
    if (typeof provider.signMessage !== "function") {
      throw new Error("Wallet does not expose signMessage.");
    }

    const message = new TextEncoder().encode(
      `SignSafe local devnet test at ${new Date().toISOString()}`
    );

    const response = await provider.signMessage(message, "utf8");
    return {
      signature:
        response?.signature instanceof Uint8Array
          ? `${response.signature.length} bytes`
          : response?.signature || "signature returned",
      message: new TextDecoder().decode(message)
    };
  }

  async function signTransaction() {
    const { provider, transaction } = await buildSelfTransferTransaction();
    if (typeof provider.signTransaction !== "function") {
      throw new Error("Wallet does not expose signTransaction.");
    }

    const signed = await provider.signTransaction(transaction);
    return {
      recentBlockhash: transaction.recentBlockhash,
      signatures: Array.isArray(signed?.signatures) ? signed.signatures.length : "unknown"
    };
  }

  async function sendTransaction() {
    const { provider, connection, transaction } = await buildSelfTransferTransaction();

    if (typeof provider.signAndSendTransaction === "function") {
      const result = await provider.signAndSendTransaction(transaction);
      return {
        path: "signAndSendTransaction",
        signature: result?.signature || "unknown"
      };
    }

    if (typeof provider.sendTransaction === "function") {
      const signature = await provider.sendTransaction(transaction, connection);
      return {
        path: "sendTransaction",
        signature
      };
    }

    throw new Error("Wallet does not expose signAndSendTransaction or sendTransaction.");
  }

  async function batchSignAll() {
    const provider = await ensureConnected();
    if (typeof provider.signAllTransactions !== "function") {
      throw new Error("Wallet does not expose signAllTransactions.");
    }

    const txA = await buildSelfTransferTransaction();
    const txB = await buildSelfTransferTransaction();
    const signed = await provider.signAllTransactions([txA.transaction, txB.transaction]);
    return {
      count: Array.isArray(signed) ? signed.length : 0,
      shape: "two self-transfer transactions"
    };
  }

  async function complexSend() {
    const { provider, connection, transaction } = await buildMultiInstructionTransaction();

    if (typeof provider.signAndSendTransaction === "function") {
      const result = await provider.signAndSendTransaction(transaction);
      return {
        path: "signAndSendTransaction",
        signature: result?.signature || "unknown",
        instructions: transaction.instructions.length
      };
    }

    if (typeof provider.sendTransaction === "function") {
      const signature = await provider.sendTransaction(transaction, connection);
      return {
        path: "sendTransaction",
        signature,
        instructions: transaction.instructions.length
      };
    }

    throw new Error("Wallet does not expose signAndSendTransaction or sendTransaction.");
  }

  async function ensureConnected() {
    const provider = getProvider();
    if (!provider.publicKey) {
      await provider.connect();
    }
    return provider;
  }

  async function buildSelfTransferTransaction() {
    const provider = await ensureConnected();
    const { Connection, PublicKey, SystemProgram, Transaction } = await loadWeb3();
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const publicKey = new PublicKey(provider.publicKey.toString());
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer: publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }).add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: publicKey,
        lamports: 1
      })
    );

    return { provider, connection, transaction };
  }

  async function buildMultiInstructionTransaction() {
    const provider = await ensureConnected();
    const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } = await loadWeb3();
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const publicKey = new PublicKey(provider.publicKey.toString());
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    const memoProgramId = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

    const transaction = new Transaction({
      feePayer: publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    })
      .add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: publicKey,
          lamports: 1
        })
      )
      .add(
        new TransactionInstruction({
          keys: [],
          programId: memoProgramId,
          data: new TextEncoder().encode("SignSafe localhost multi-instruction test")
        })
      );

    return { provider, connection, transaction };
  }

  function getProvider() {
    const candidates = [
      { provider: window.solana, name: "window.solana" },
      { provider: window.phantom?.solana, name: "window.phantom.solana" },
      { provider: window.solflare, name: "window.solflare" },
      { provider: window.backpack?.solana, name: "window.backpack.solana" }
    ];

    for (const candidate of candidates) {
      if (candidate.provider) {
        candidate.provider.__signsafeLabel = candidate.name;
        return candidate.provider;
      }
    }

    throw new Error("No Solana wallet provider found. Enable Phantom or Solflare on this page.");
  }

  async function loadWeb3() {
    return import(WEB3_IMPORT_URL);
  }

  function renderProviderState() {
    try {
      const provider = getProvider();
      providerNameEl.textContent = provider.__signsafeLabel || "Detected";
      publicKeyEl.textContent = provider.publicKey?.toString() || "Not connected";
    } catch (_error) {
      providerNameEl.textContent = "Not detected";
      publicKeyEl.textContent = "Not connected";
    }
  }

  function setBusyState(busy) {
    Object.values(buttons).forEach((button) => {
      button.disabled = busy;
    });
  }

  function clearLog() {
    logOutputEl.textContent = "Cleared.";
  }

  function log(message, details) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}${details ? ` :: ${details}` : ""}`;
    logOutputEl.textContent = `${logOutputEl.textContent}\n${line}`.trim();
    logOutputEl.scrollTop = logOutputEl.scrollHeight;
  }

  function summarize(value) {
    if (value == null) {
      return "";
    }

    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
})();
