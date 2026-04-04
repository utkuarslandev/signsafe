/**
 * Deterministic instruction semantic labels (Phase 1 stubs for Phase 2 signals).
 * Pure functions: no @solana/web3 dependency.
 */
(function initSignSafeIxSemantics(root) {
  const globalRoot = root || globalThis;
  const shared = globalRoot.SIGNSAFE_SHARED || (globalRoot.SIGNSAFE_SHARED = {});

  const SYSTEM_PROGRAM = "11111111111111111111111111111111";
  const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const SPL_TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

  const U64_MAX_BIG = 18446744073709551615n;
  /** Approvals at or above this (base units) are treated like unlimited-delegate phishing (includes u64::MAX). */
  const LARGE_APPROVE_AMOUNT_THRESHOLD = 1_000_000_000_000n; // 10^12

  function readU32LE(data, offset) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return view.getUint32(0, true);
  }

  function readU64LE(data, offset) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 8);
    const lo = view.getUint32(0, true);
    const hi = view.getUint32(4, true);
    return (BigInt(hi) << 32n) | BigInt(lo);
  }

  /**
   * SPL SetAuthority: [u8 tag=6][u8 authorityType][COption<Pubkey> newAuthority]
   * COption: 0 = None (revoke), 1 = Some + 32-byte pubkey (total 35 bytes after tag+type).
   */
  function decodeSetAuthoritySemantics(data) {
    const authorityType = data.length >= 2 ? data[1] : 0;
    if (data.length < 3) {
      return {
        family: "spl_token",
        type: "SET_AUTHORITY",
        authorityType,
        newAuthoritySet: false,
        newAuthorityRevoked: false
      };
    }
    const opt = data[2];
    if (opt === 0) {
      return {
        family: "spl_token",
        type: "SET_AUTHORITY",
        authorityType,
        newAuthoritySet: false,
        newAuthorityRevoked: true
      };
    }
    if (opt === 1 && data.length >= 35) {
      return {
        family: "spl_token",
        type: "SET_AUTHORITY",
        authorityType,
        newAuthoritySet: true,
        newAuthorityRevoked: false
      };
    }
    return {
      family: "spl_token",
      type: "SET_AUTHORITY",
      authorityType,
      newAuthoritySet: false,
      newAuthorityUnclear: true
    };
  }

  function decodeSystemInstruction(data) {
    if (!data || data.length < 4) {
      return { family: "system", type: "SYSTEM_UNKNOWN", raw: "too_short" };
    }
    const kind = readU32LE(data, 0);
    if (kind === 0) return { family: "system", type: "CREATE_ACCOUNT" };
    if (kind === 1) return { family: "system", type: "ASSIGN" };
    if (kind === 2) {
      const lamports = readU64LE(data, 4);
      return { family: "system", type: "TRANSFER", lamports: Number(lamports) };
    }
    if (kind === 3) return { family: "system", type: "CREATE_ACCOUNT_WITH_SEED" };
    if (kind === 4) return { family: "system", type: "ADVANCE_NONCE_ACCOUNT" };
    if (kind === 5) return { family: "system", type: "WITHDRAW_NONCE_ACCOUNT" };
    if (kind === 8) return { family: "system", type: "ALLOCATE" };
    if (kind === 9) return { family: "system", type: "ALLOCATE_WITH_SEED" };
    if (kind === 10) return { family: "system", type: "ASSIGN_WITH_SEED" };
    if (kind === 11) return { family: "system", type: "UPGRADE_NONCE_ACCOUNT" };
    if (kind === 12) {
      const lamports = data.length >= 12 ? readU64LE(data, 4) : 0n;
      return { family: "system", type: "CREATE_NONCE_ACCOUNT", lamports: Number(lamports) };
    }
    return { family: "system", type: `SYSTEM_UNKNOWN_${kind}` };
  }

  function decodeSplTokenInstruction(programId, data) {
    if (!data || data.length < 1) {
      return { family: "spl_token", type: "SPL_UNKNOWN", raw: "empty" };
    }
    const tag = data[0];
    // Token-2022 extension instructions (see spl_token-2022 program)
    if (programId === SPL_TOKEN_2022 && tag === 35) {
      return { family: "spl_token_2022", type: "INITIALIZE_PERMANENT_DELEGATE" };
    }
    const u64At1 = data.length >= 9 ? readU64LE(data, 1) : 0n;
    const amountNum = Number(u64At1);
    const isUnlimited =
      u64At1 === U64_MAX_BIG || u64At1 >= LARGE_APPROVE_AMOUNT_THRESHOLD;

    if (tag === 0) return { family: "spl_token", type: "INITIALIZE_MINT" };
    if (tag === 1) return { family: "spl_token", type: "INITIALIZE_ACCOUNT" };
    if (tag === 2) return { family: "spl_token", type: "INITIALIZE_MULTISIG" };
    if (tag === 3) return { family: "spl_token", type: "TRANSFER", amount: amountNum };
    if (tag === 4) {
      return { family: "spl_token", type: "APPROVE", amount: amountNum, isUnlimited };
    }
    if (tag === 5) return { family: "spl_token", type: "REVOKE" };
    if (tag === 6) {
      return decodeSetAuthoritySemantics(data);
    }
    if (tag === 7) return { family: "spl_token", type: "MINT_TO", amount: amountNum };
    if (tag === 8) return { family: "spl_token", type: "BURN", amount: amountNum };
    if (tag === 9) return { family: "spl_token", type: "CLOSE_ACCOUNT" };
    if (tag === 10) return { family: "spl_token", type: "FREEZE_ACCOUNT" };
    if (tag === 11) return { family: "spl_token", type: "THAW_ACCOUNT" };
    if (tag === 12) {
      const amt = data.length >= 10 ? readU64LE(data, 1) : 0n;
      return { family: "spl_token", type: "TRANSFER_CHECKED", amount: Number(amt) };
    }
    if (tag === 13) {
      const amt = data.length >= 10 ? readU64LE(data, 1) : 0n;
      const unlim = amt === U64_MAX_BIG || amt >= LARGE_APPROVE_AMOUNT_THRESHOLD;
      return { family: "spl_token", type: "APPROVE_CHECKED", amount: Number(amt), isUnlimited: unlim };
    }
    if (tag === 14) return { family: "spl_token", type: "MINT_TO_CHECKED", amount: amountNum };
    if (tag === 15) return { family: "spl_token", type: "BURN_CHECKED", amount: amountNum };
    if (tag === 16) return { family: "spl_token", type: "INITIALIZE_ACCOUNT2" };
    if (tag === 17) return { family: "spl_token", type: "SYNC_NATIVE" };
    if (tag === 18) return { family: "spl_token", type: "INITIALIZE_ACCOUNT3" };
    return { family: "spl_token", type: `SPL_UNKNOWN_${tag}` };
  }

  function decodeMemoInstruction(data) {
    try {
      const text = new TextDecoder().decode(data);
      return { family: "memo", type: "MEMO", preview: text.slice(0, 200) };
    } catch (_e) {
      return { family: "memo", type: "MEMO", preview: "" };
    }
  }

  /**
   * @param {string} programId
   * @param {Uint8Array} data
   * @returns {{ family: string, type: string, [key: string]: unknown }}
   */
  function enrichInstructionSemantics(programId, data) {
    if (!data) {
      return { family: "unknown", type: "NO_DATA" };
    }
    if (programId === SYSTEM_PROGRAM) {
      return decodeSystemInstruction(data);
    }
    if (programId === SPL_TOKEN || programId === SPL_TOKEN_2022) {
      return decodeSplTokenInstruction(programId, data);
    }
    if (programId === MEMO_PROGRAM) {
      return decodeMemoInstruction(data);
    }
    return { family: "unknown", type: "UNKNOWN_PROGRAM" };
  }

  shared.ixSemantics = Object.freeze({
    SYSTEM_PROGRAM,
    SPL_TOKEN,
    SPL_TOKEN_2022,
    MEMO_PROGRAM,
    enrichInstructionSemantics
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
