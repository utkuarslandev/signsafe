(function initSignSafeOverlayHelpers(root) {
  const globalRoot = root || globalThis;
  const shared = globalRoot.SIGNSAFE_SHARED || (globalRoot.SIGNSAFE_SHARED = {});

  shared.overlayHelpers = {
    normalizeFacts,
    normalizeFact,
    normalizeArray,
    normalizeRisk,
    formatSolChanges,
    formatTokenChanges,
    formatPrograms,
    formatMessagePreview,
    summarizeBatchFacts,
    phaseLabel
  };

  function summarizeBatchFacts(verdicts) {
    return {
      intercepted_method: "batch",
      simulation_status: verdicts.some((verdict) => normalizeFact(verdict, "simulation_status") === "failed")
        ? "mixed"
        : "confirmed",
      source: "batch",
      reason_codes: Array.from(new Set(verdicts.flatMap((verdict) => normalizeArray(verdict.reason_codes)))),
      sol_changes: verdicts.flatMap((verdict) => normalizeFact(verdict, "facts").sol_changes || []).slice(0, 3),
      token_changes: verdicts.flatMap((verdict) => normalizeFact(verdict, "facts").token_changes || []).slice(0, 3),
      programs: Array.from(
        new Map(
          verdicts
            .flatMap((verdict) => normalizeFact(verdict, "facts").programs || [])
            .map((program) => [program.programId || program, program])
        ).values()
      ).slice(0, 4),
      message_preview: ""
    };
  }

  function normalizeFact(verdict, key) {
    if (key === "facts") {
      return normalizeFacts(verdict);
    }

    const facts = normalizeFacts(verdict);
    return facts[key] || verdict[key] || "";
  }

  function normalizeFacts(verdict) {
    const facts = verdict?.facts && typeof verdict.facts === "object" ? verdict.facts : {};
    return {
      intercepted_method: facts.intercepted_method || verdict.intercepted_method || verdict.method || "",
      simulation_status: facts.simulation_status || verdict.simulation_status || verdict.source_status || "",
      source: facts.source || verdict.source || "",
      reason_codes: normalizeArray(facts.reason_codes || verdict.reason_codes),
      sol_changes: Array.isArray(facts.sol_changes) ? facts.sol_changes : Array.isArray(verdict.sol_changes) ? verdict.sol_changes : [],
      token_changes: Array.isArray(facts.token_changes) ? facts.token_changes : Array.isArray(verdict.token_changes) ? verdict.token_changes : [],
      programs: Array.isArray(facts.programs) ? facts.programs : Array.isArray(verdict.programs) ? verdict.programs : [],
      message_preview: facts.message_preview || verdict.message_preview || ""
    };
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
  }

  function normalizeRisk(value) {
    return ["safe", "review", "danger"].includes(value) ? value : "review";
  }

  function formatSolChanges(items) {
    return items
      .map((item) => {
        const delta = Number(item.deltaSol ?? item.changeSOL ?? 0);
        const sign = delta > 0 ? "+" : "";
        return `${sign}${delta} SOL`;
      })
      .join(", ");
  }

  function formatTokenChanges(items) {
    return items
      .map((item) => {
        const delta = Number(item.delta ?? item.change ?? 0);
        const sign = delta > 0 ? "+" : "";
        const mint = item.mint ? ` ${shorten(item.mint)}` : "";
        return `${sign}${delta}${mint}`;
      })
      .join(", ");
  }

  function formatPrograms(items) {
    return items
      .map((item) => {
        if (typeof item === "string") {
          return shorten(item);
        }
        return `${item.label || "Program"} ${shorten(item.programId || "")}`.trim();
      })
      .join(", ");
  }

  function formatMessagePreview(value) {
    return String(value).trim();
  }

  function phaseLabel(phase) {
    const labels = {
      simulate: "Simulating transaction",
      rules: "Running deterministic checks",
      model: "Generating explanation",
      batch: "Analyzing batch",
      message: "Reviewing message",
      review: "Preparing review"
    };
    return labels[phase] || "Preparing";
  }

  function shorten(value) {
    const text = String(value || "");
    if (text.length <= 12) {
      return text;
    }
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
