/*
Paste this file into the browser console on https://beta.solpg.io.

Prereqs:
- Use Phantom or Solflare on devnet.
- Connect the external wallet to the page first.
- Reload SignSafe after code changes in chrome://extensions.

Recommended order:
1. await signsafePlaygroundTests.signMessage()
2. await signsafePlaygroundTests.signTransaction()
3. await signsafePlaygroundTests.signAndSendTransaction()
*/

window.signsafePlaygroundTests = (() => {
  const DEVNET_RPC = "https://api.devnet.solana.com";
  const IMPORT_URL = "https://esm.sh/@solana/web3.js@1.98.4";

  async function loadWeb3() {
    return import(IMPORT_URL);
  }

  function getProvider() {
    const provider =
      window.solana ||
      window.phantom?.solana ||
      window.solflare ||
      window.backpack?.solana;

    if (!provider) {
      throw new Error("No Solana wallet provider found on window.");
    }

    return provider;
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    const transaction = new Transaction({
      feePayer: publicKey,
      blockhash,
      lastValidBlockHeight
    }).add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: publicKey,
        lamports: 1
      })
    );

    return { provider, connection, publicKey, transaction };
  }

  async function signMessage() {
    const provider = await ensureConnected();
    if (typeof provider.signMessage !== "function") {
      throw new Error("Wallet does not expose signMessage.");
    }

    const message = new TextEncoder().encode(
      `SignSafe playground test at ${new Date().toISOString()}`
    );

    console.log("[Playground test] signMessage start");
    const result = await provider.signMessage(message, "utf8");
    console.log("[Playground test] signMessage done", result);
    return result;
  }

  async function signTransaction() {
    const { provider, transaction } = await buildSelfTransferTransaction();
    if (typeof provider.signTransaction !== "function") {
      throw new Error("Wallet does not expose signTransaction.");
    }

    console.log("[Playground test] signTransaction start");
    const signed = await provider.signTransaction(transaction);
    console.log("[Playground test] signTransaction done", signed);
    return signed;
  }

  async function signAndSendTransaction() {
    const { provider, connection, transaction } = await buildSelfTransferTransaction();

    console.log("[Playground test] signAndSendTransaction start");
    if (typeof provider.signAndSendTransaction === "function") {
      const result = await provider.signAndSendTransaction(transaction);
      console.log("[Playground test] signAndSendTransaction done", result);
      return result;
    }

    if (typeof provider.sendTransaction === "function") {
      const signature = await provider.sendTransaction(transaction, connection);
      console.log("[Playground test] sendTransaction done", signature);
      return { signature };
    }

    throw new Error("Wallet does not expose signAndSendTransaction or sendTransaction.");
  }

  return {
    signMessage,
    signTransaction,
    signAndSendTransaction
  };
})();
