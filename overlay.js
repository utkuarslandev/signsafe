(function bootstrapSignSafeOverlay() {
  const CHANNEL = "SIGNSAFE_OVERLAY";
  const DEBUG = false;
  const riskLabels = {
    safe: "Safe",
    review: "Review",
    danger: "Danger"
  };

  let currentSessionId = null;

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.channel !== CHANNEL) {
      return;
    }

    debugLog("received", message.type, message.sessionId);
    currentSessionId = message.sessionId;
    revealPanel();

    if (message.type === "SHOW_LOADING") {
      renderLoading(message.payload || {});
      return;
    }

    if (message.type === "SHOW_VERDICT") {
      renderVerdict(message.payload?.verdict || {}, message.payload?.meta || {});
      return;
    }

    if (message.type === "SHOW_BATCH") {
      renderBatch(Array.isArray(message.payload?.verdicts) ? message.payload.verdicts : []);
    }
  });

  document.getElementById("btn-block").addEventListener("click", () => {
    emitDecision(false, currentSessionId);
  });

  document.getElementById("btn-proceed").addEventListener("click", () => {
    emitDecision(true, currentSessionId);
  });

  function emitDecision(approved, sessionId) {
    debugLog("decision", approved, sessionId);
    window.parent.postMessage(
      {
        channel: CHANNEL,
        sessionId,
        type: "DECISION",
        approved
      },
      "*"
    );
  }

  function renderLoading(payload) {
    revealPanel();
    activateState("loading-state");
    setText("loading-phase", phaseLabel(payload.phase));
    setText("loading-title", payload.title || "Analyzing transaction");
    setText("loading-detail", payload.detail || "Simulating on-chain effects and preparing a plain-English verdict.");
    setButtonState({ loading: true });
  }

  function renderVerdict(verdict, meta) {
    revealPanel();
    activateState("verdict-state");

    const risk = normalizeRisk(verdict.risk);
    const facts = normalizeFacts(verdict);
    const method = facts.intercepted_method || verdict.intercepted_method || verdict.method || "transaction";
    const source = facts.source || verdict.source || "unknown";
    const reasonCodes = normalizeArray(verdict.reason_codes);

    document.getElementById("risk-badge").className = risk;
    setText("risk-badge", riskLabels[risk]);
    setText("method-badge", method ? `Method: ${method}` : "");
    setText("progress-label", meta && meta.total > 1 ? `Transaction ${meta.current} of ${meta.total}` : "");
    setText("summary", verdict.summary || "Unable to analyze this transaction clearly.");

    renderFacts("facts-grid", facts);
    fillList("actions-list", normalizeArray(verdict.actions), "No visible actions were extracted.");

    const riskReasons = normalizeArray(verdict.risk_reasons);
    const risksSection = document.getElementById("risks-section");
    if (riskReasons.length > 0) {
      risksSection.classList.remove("hidden");
      fillList("risks-list", riskReasons, "");
    } else {
      risksSection.classList.add("hidden");
      fillList("risks-list", [], "");
    }

    setText("verdict-text", verdict.verdict || "Proceed only if you fully understand the transaction.");
    setText(
      "debug-meta",
      [
        `Source: ${source}`,
        `Simulation: ${facts.simulation_status || verdict.simulation_status || "unknown"}`,
        `Risk codes: ${reasonCodes.length > 0 ? reasonCodes.join(", ") : "none"}`
      ].join(" | ")
    );
    setText("debug-json", JSON.stringify({ verdict, facts, meta }, null, 2));
    document.getElementById("debug-details").open = reasonCodes.length > 0 || Boolean(facts.message_preview);

    setButtonState({ loading: false, risk });
  }

  function renderBatch(verdicts) {
    revealPanel();
    activateState("batch-state");

    const combinedFacts = summarizeBatchFacts(verdicts);
    const actionItems = verdicts
      .flatMap((verdict) => normalizeArray(verdict.actions))
      .slice(0, 8);
    const unsafeCount = verdicts.filter((verdict) => normalizeRisk(verdict.risk) !== "safe").length;

    setText(
      "batch-summary",
      unsafeCount === 0
        ? `${verdicts.length} transactions look safe overall.`
        : `${unsafeCount} of ${verdicts.length} transactions need review.`
    );
    setText(
      "batch-detail",
      unsafeCount === 0
        ? "SignSafe did not detect suspicious effects in this batch. Review the combined actions below before continuing."
        : "One or more items in this batch need attention. Review the combined facts below before continuing."
    );
    renderFacts("batch-facts-grid", combinedFacts);
    fillList("batch-actions", actionItems, "No suspicious effects were detected during simulation.");
    setText(
      "batch-debug-meta",
      `Source: batch | Risk codes: ${Array.from(new Set(verdicts.flatMap((verdict) => normalizeArray(verdict.reason_codes)))).join(", ") || "none"}`
    );
    setText("batch-debug-json", JSON.stringify({ verdicts, combinedFacts }, null, 2));
    document.getElementById("batch-debug-details").open = unsafeCount > 0;

    setButtonState({ loading: false, risk: unsafeCount === 0 ? "safe" : "review" });
  }

  function renderFacts(containerId, facts) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    const entries = [];
    if (facts.intercepted_method) {
      entries.push(["Method", facts.intercepted_method]);
    }
    if (facts.simulation_status) {
      entries.push(["Simulation", facts.simulation_status]);
    }
    if (facts.source) {
      entries.push(["Source", facts.source]);
    }
    if (facts.reason_codes && facts.reason_codes.length > 0) {
      entries.push(["Reason codes", facts.reason_codes.join(", ")]);
    }
    if (facts.sol_changes && facts.sol_changes.length > 0) {
      entries.push(["SOL delta", formatSolChanges(facts.sol_changes)]);
    }
    if (facts.token_changes && facts.token_changes.length > 0) {
      entries.push(["Token delta", formatTokenChanges(facts.token_changes)]);
    }
    if (facts.programs && facts.programs.length > 0) {
      entries.push(["Programs", formatPrograms(facts.programs)]);
    }
    if (facts.message_preview) {
      entries.push(["Message preview", formatMessagePreview(facts.message_preview)]);
    }

    const visible = entries.length > 0 ? entries : [["Facts", "No structured facts were supplied."]];
    for (const [label, value] of visible) {
      const card = document.createElement("div");
      card.className = `fact-card ${label === "Message preview" || value.length > 120 ? "wide" : ""}`.trim();

      const labelEl = document.createElement("div");
      labelEl.className = "fact-label";
      labelEl.textContent = label;

      const valueEl = document.createElement("div");
      valueEl.className = "fact-value";
      if (Array.isArray(value)) {
        valueEl.innerHTML = "";
      } else {
        valueEl.textContent = value;
      }

      if (label === "Message preview") {
        valueEl.innerHTML = "";
        const pre = document.createElement("pre");
        pre.textContent = value;
        valueEl.appendChild(pre);
      } else if (typeof value === "string" && value.includes("\n")) {
        valueEl.innerHTML = "";
        const lines = value.split("\n");
        for (const line of lines) {
          const span = document.createElement("div");
          span.textContent = line;
          valueEl.appendChild(span);
        }
      }

      card.appendChild(labelEl);
      card.appendChild(valueEl);
      container.appendChild(card);
    }
  }

  function summarizeBatchFacts(verdicts) {
    const facts = {
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

    return facts;
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

  function shorten(value) {
    const text = String(value || "");
    if (text.length <= 12) {
      return text;
    }
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
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

  function fillList(id, items, fallback) {
    const list = document.getElementById(id);
    list.innerHTML = "";

    const values = Array.isArray(items) && items.length > 0 ? items : fallback ? [fallback] : [];
    for (const value of values) {
      const item = document.createElement("li");
      item.textContent = value;
      list.appendChild(item);
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }

    el.textContent = value || "";
  }

  function setButtonState({ loading, risk }) {
    const proceed = document.getElementById("btn-proceed");
    const block = document.getElementById("btn-block");

    if (loading) {
      proceed.disabled = true;
      block.disabled = false;
      block.textContent = "Cancel";
      return;
    }

    block.disabled = false;
    block.textContent = "Block";
    proceed.disabled = false;
    proceed.className = normalizeRisk(risk);
    proceed.textContent = normalizeRisk(risk) === "safe" ? "Proceed" : "Proceed";
  }

  function activateState(activeId) {
    for (const state of document.querySelectorAll(".state")) {
      state.classList.toggle("hidden", state.id !== activeId);
    }
  }

  function revealPanel() {
    const panel = document.getElementById("panel");
    if (!panel) {
      return;
    }

    requestAnimationFrame(() => {
      panel.classList.add("visible");
    });
  }

  function debugLog(...args) {
    if (!DEBUG) {
      return;
    }

    console.log("[SignSafe overlay]", ...args);
  }
})();
