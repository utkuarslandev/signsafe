(function bootstrapSignSafeOverlay() {
  const CONSTANTS = globalThis.SIGNSAFE_SHARED?.constants || {};
  const HELPERS = globalThis.SIGNSAFE_SHARED?.overlayHelpers || {};
  const CHANNEL = CONSTANTS.OVERLAY_CHANNEL || "SIGNSAFE_OVERLAY";
  const OVERLAY_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.OVERLAY || {};
  const DEBUG_STORAGE_KEY = CONSTANTS.DEBUG_STORAGE_KEY || "signsafe-debug";
  const DEBUG = isDebugEnabled();

  const normalizeFacts = HELPERS.normalizeFacts || ((verdict) => verdict?.facts || {});
  const normalizeArray = HELPERS.normalizeArray || ((value) => (Array.isArray(value) ? value : []));
  const SAFE_RISKS = ["safe", "review", "danger"];
  const normalizeRisk = HELPERS.normalizeRisk || ((value) => (SAFE_RISKS.includes(value) ? value : "review"));
  const formatSolChanges = HELPERS.formatSolChanges || ((items) => String(items || ""));
  const formatTokenChanges = HELPERS.formatTokenChanges || ((items) => String(items || ""));
  const formatPrograms = HELPERS.formatPrograms || ((items) => String(items || ""));
  const formatMessagePreview = HELPERS.formatMessagePreview || ((value) => String(value || ""));
  const summarizeBatchFacts = HELPERS.summarizeBatchFacts || (() => ({}));
  const phaseLabel = HELPERS.phaseLabel || (() => "Preparing");
  const shortMethodLabel = HELPERS.shortMethodLabel || ((value) => value || "");

  let currentSessionId = null;
  let stepTimerId = null;
  let parentOrigin = null;

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.channel !== CHANNEL) {
      return;
    }

    if (!parentOrigin && event.origin) {
      parentOrigin = event.origin;
    }

    debugLog("received", message.type, message.sessionId);
    currentSessionId = message.sessionId;
    revealPanel();

    if (message.type === (OVERLAY_MESSAGE_TYPES.SHOW_LOADING || "SHOW_LOADING")) {
      renderLoading(message.payload || {});
      return;
    }

    if (message.type === (OVERLAY_MESSAGE_TYPES.SHOW_VERDICT || "SHOW_VERDICT")) {
      renderVerdict(message.payload?.verdict || {}, message.payload?.meta || {});
      return;
    }

    if (message.type === (OVERLAY_MESSAGE_TYPES.SHOW_BATCH || "SHOW_BATCH")) {
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
        type: OVERLAY_MESSAGE_TYPES.DECISION || "DECISION",
        approved
      },
      parentOrigin || "*"
    );
  }

  function renderLoading(payload) {
    revealPanel();
    activateState("loading-state");
    setText("loading-phase", phaseLabel(payload.phase));
    setText("loading-title", payload.title || "Analyzing transaction");
    setButtonState({ loading: true });

    const tint = document.getElementById("backdrop-tint");
    if (tint) tint.className = "";

    const stepSimulate = document.getElementById("step-simulate");
    const stepAI = document.getElementById("step-ai");
    if (stepSimulate) stepSimulate.classList.add("active");
    if (stepAI) stepAI.classList.remove("active");
    clearTimeout(stepTimerId);
    stepTimerId = setTimeout(() => {
      if (stepAI) stepAI.classList.add("active");
    }, 1500);
  }

  function renderVerdict(verdict, meta) {
    revealPanel();
    activateState("verdict-state");
    clearTimeout(stepTimerId);

    const risk = normalizeRisk(verdict.risk);

    // Backdrop tint
    const tint = document.getElementById("backdrop-tint");
    if (tint) tint.className = risk === "safe" ? "" : risk;

    const facts = normalizeFacts(verdict);
    const method = facts.intercepted_method || verdict.intercepted_method || verdict.method || "transaction";
    const reasonCodes = normalizeArray(verdict.reason_codes);

    // Risk stamp (merged icon + label)
    const stampEl = document.getElementById("risk-stamp");
    if (stampEl) {
      stampEl.className = risk;
      stampEl.innerHTML = riskStampInner(risk);
    }

    const methodShort = shortMethodLabel(method);
    setText("method-badge", methodShort && methodShort !== "Transaction" ? methodShort : "");
    setText("progress-label", meta && meta.total > 1 ? `Transaction ${meta.current} of ${meta.total}` : "");
    setText("summary", verdict.summary || "Unable to analyze this transaction clearly.");

    // Verdict callout with risk-colored left border
    const verdictTextEl = document.getElementById("verdict-text");
    if (verdictTextEl) {
      verdictTextEl.textContent = verdict.verdict || "Proceed only if you fully understand the transaction.";
      verdictTextEl.className = `verdict-callout ${risk}`;
    }

    renderFindings(verdict, facts, risk);
    renderImpactGrid("impact-grid", buildImpactItems(facts, risk, verdict));
    renderFacts("facts-grid", facts);
    fillList("actions-list", normalizeArray(verdict.actions), "No visible actions were extracted.");

    const riskReasons = normalizeArray(verdict.risk_reasons);
    const risksSection = document.getElementById("risks-section");
    if (riskReasons.length > 0) {
      setVisibility(risksSection, true);
      fillList("risks-list", riskReasons, "");
    } else {
      setVisibility(risksSection, false);
      fillList("risks-list", [], "");
    }

    setText(
      "debug-meta",
      [
        `Method: ${method}`,
        `Simulation: ${facts.simulation_status || verdict.simulation_status || "unknown"}`,
        `Risk codes: ${reasonCodes.length > 0 ? reasonCodes.join(", ") : "none"}`
      ].join(" | ")
    );
    setText("debug-json", JSON.stringify({ verdict, facts, meta }, null, 2));
    document.getElementById("debug-details").open = false;

    setButtonState({ loading: false, risk });
  }

  function renderBatch(verdicts) {
    revealPanel();
    activateState("batch-state");
    clearTimeout(stepTimerId);

    const tint = document.getElementById("backdrop-tint");
    if (tint) tint.className = "";

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
        ? "SignSafe did not detect suspicious effects in this batch."
        : "One or more items in this batch need attention."
    );
    renderImpactGrid("batch-impact-grid", buildBatchImpactItems(verdicts, combinedFacts, unsafeCount));
    renderFacts("batch-facts-grid", combinedFacts);
    fillList("batch-actions", actionItems, "No suspicious effects were detected during simulation.");
    setText(
      "batch-debug-meta",
      `Source: batch | Risk codes: ${Array.from(new Set(verdicts.flatMap((verdict) => normalizeArray(verdict.reason_codes)))).join(", ") || "none"}`
    );
    setText("batch-debug-json", JSON.stringify({ verdicts, combinedFacts }, null, 2));
    document.getElementById("batch-debug-details").open = false;

    setButtonState({ loading: false, risk: unsafeCount === 0 ? "safe" : "review" });
  }

  function renderFacts(containerId, facts) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    const entries = [];
    if (facts.intercepted_method) entries.push(["Method", facts.intercepted_method]);
    if (facts.simulation_status) entries.push(["Simulation", facts.simulation_status]);
    if (facts.source) entries.push(["Source", facts.source]);
    if (facts.reason_codes && facts.reason_codes.length > 0) entries.push(["Reason codes", facts.reason_codes.join(", ")]);
    if (facts.sol_changes && facts.sol_changes.length > 0) entries.push(["SOL delta", formatSolChanges(facts.sol_changes)]);
    if (facts.token_changes && facts.token_changes.length > 0) entries.push(["Token delta", formatTokenChanges(facts.token_changes)]);
    if (facts.programs && facts.programs.length > 0) entries.push(["Programs", formatPrograms(facts.programs)]);
    if (facts.message_preview) entries.push(["Message preview", formatMessagePreview(facts.message_preview)]);

    const visibleEntries = entries.length > 0 ? entries : [["Facts", "No structured facts were supplied."]];
    for (const [label, value] of visibleEntries) {
      const card = document.createElement("div");
      card.className = `fact-card ${label === "Message preview" || value.length > 120 ? "wide" : ""}`.trim();

      const labelEl = document.createElement("div");
      labelEl.className = "fact-label";
      labelEl.textContent = label;

      const valueEl = document.createElement("div");
      valueEl.className = "fact-value";
      valueEl.textContent = value;

      if (label === "Message preview") {
        valueEl.innerHTML = "";
        const pre = document.createElement("pre");
        pre.textContent = value;
        valueEl.appendChild(pre);
      } else if (typeof value === "string" && value.includes("\n")) {
        valueEl.innerHTML = "";
        for (const line of value.split("\n")) {
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

  function renderFindings(verdict, facts, risk) {
    const riskReasons = normalizeArray(verdict.risk_reasons);
    const actions = normalizeArray(verdict.actions);
    const findings = [];

    if (risk === "danger") {
      findings.push(...riskReasons.slice(0, 3));
    } else {
      findings.push(...riskReasons.slice(0, 2));
      findings.push(...actions.slice(0, 1));
    }

    if (findings.length === 0 && facts.programs?.length > 0) {
      findings.push(`Touches ${facts.programs.slice(0, 2).join(" and ")}.`);
    }

    fillList("findings-list", dedupe(findings).slice(0, 3), "No major issues were highlighted.");
  }

  function renderImpactGrid(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    for (const item of items) {
      const card = document.createElement("div");
      card.className = `impact-card ${item.tone || ""}`.trim();

      const label = document.createElement("div");
      label.className = "impact-label";
      label.textContent = item.label;

      const value = document.createElement("div");
      value.className = "impact-value";
      value.textContent = item.value;

      if (item.detail) {
        const detail = document.createElement("div");
        detail.className = "impact-detail";
        detail.textContent = item.detail;
        card.append(label, value, detail);
      } else {
        card.append(label, value);
      }

      container.appendChild(card);
    }
  }

  function buildImpactItems(facts, risk, verdict) {
    const solSummary = summarizeSol(facts.sol_changes || []);
    const tokenSummary = summarizeTokens(facts.token_changes || []);
    const programs = Array.isArray(facts.programs) ? facts.programs : [];
    const items = [];

    items.push({
      label: "Verdict",
      value: risk === "safe" ? "Looks clear" : risk === "danger" ? "High risk" : "Needs review",
      detail: risk === "safe" ? "No major anomalies detected" : risk === "danger" ? "Block unless you expected this" : "Read the reasons before signing",
      tone: risk
    });

    items.push({
      label: "You send",
      value: solSummary.out || tokenSummary.out || "No clear outflow",
      tone: solSummary.out || tokenSummary.out ? "danger" : ""
    });

    items.push({
      label: "You receive",
      value: tokenSummary.in || solSummary.in || "No clear inflow",
      tone: tokenSummary.in || solSummary.in ? "safe" : ""
    });

    items.push({
      label: "Programs",
      value: programs.length > 0 ? programs.slice(0, 2).join(", ") : "Not identified",
      detail: programs.length > 2 ? `+${programs.length - 2} more` : "",
      tone: programs.length > 0 ? "" : "review"
    });

    if ((facts.message_preview || "").trim()) {
      items[1] = {
        label: "Request",
        value: "Message signature",
        detail: "No on-chain simulation is available",
        tone: "review"
      };
      items[2] = {
        label: "Message",
        value: truncateSingleLine(facts.message_preview, 56),
        tone: ""
      };
    }

    if (verdict.simulation_status === "failed") {
      items[3] = {
        label: "Simulation",
        value: "Failed",
        detail: "Effects could not be verified",
        tone: "danger"
      };
    }

    return items.slice(0, 4);
  }

  function buildBatchImpactItems(verdicts, combinedFacts, unsafeCount) {
    const solSummary = summarizeSol(combinedFacts.sol_changes || []);
    const tokenSummary = summarizeTokens(combinedFacts.token_changes || []);

    return [
      {
        label: "Batch",
        value: `${verdicts.length} requests`,
        detail: unsafeCount === 0 ? "All appear safe" : `${unsafeCount} need review`,
        tone: unsafeCount === 0 ? "safe" : "review"
      },
      {
        label: "Likely outflow",
        value: solSummary.out || tokenSummary.out || "No clear outflow",
        tone: solSummary.out || tokenSummary.out ? "danger" : ""
      },
      {
        label: "Likely inflow",
        value: tokenSummary.in || solSummary.in || "No clear inflow",
        tone: tokenSummary.in || solSummary.in ? "safe" : ""
      },
      {
        label: "Programs",
        value: Array.isArray(combinedFacts.programs) && combinedFacts.programs.length > 0
          ? combinedFacts.programs.slice(0, 2).map(formatProgramLabel).join(", ")
          : "Mixed",
        tone: ""
      }
    ];
  }

  function summarizeSol(items) {
    let out = 0;
    let inbound = 0;
    for (const item of items || []) {
      const delta = Number(item.deltaSol ?? item.changeSOL ?? 0);
      if (delta < 0) out += Math.abs(delta);
      if (delta > 0) inbound += delta;
    }

    return {
      out: out > 0 ? `${trimAmount(out)} SOL` : "",
      in: inbound > 0 ? `${trimAmount(inbound)} SOL` : ""
    };
  }

  function summarizeTokens(items) {
    const out = [];
    const inbound = [];
    for (const item of items || []) {
      const delta = Number(item.delta ?? item.change ?? 0);
      if (!delta) continue;
      const text = `${trimAmount(Math.abs(delta))} ${formatTokenLabel(item.mint)}`.trim();
      if (delta < 0) out.push(text);
      if (delta > 0) inbound.push(text);
    }

    return {
      out: out.slice(0, 2).join(", "),
      in: inbound.slice(0, 2).join(", ")
    };
  }

  function formatTokenLabel(mint) {
    const text = String(mint || "");
    return text.length > 12 ? `${text.slice(0, 4)}...${text.slice(-4)}` : text || "token";
  }

  function formatProgramLabel(program) {
    if (typeof program === "string") return program;
    return program?.label || program?.programId || "Program";
  }

  function trimAmount(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(4).replace(/\.?0+$/, "");
  }

  function truncateSingleLine(value, max) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function dedupe(items) {
    return Array.from(new Set(items.filter(Boolean)));
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

  function riskStampInner(risk) {
    const icons = {
      safe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,12 9,17 20,6"/></svg>`,
      review: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/></svg>`,
      danger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`
    };
    const labels = { safe: "Safe", review: "Review", danger: "Danger" };
    return `${icons[risk] || icons.review}<span>${labels[risk] || "Review"}</span>`;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || "";
  }

  function setButtonState({ loading, risk }) {
    const proceed = document.getElementById("btn-proceed");
    const block = document.getElementById("btn-block");
    const buttons = document.getElementById("buttons");

    if (loading) {
      proceed.disabled = true;
      proceed.className = "";
      block.disabled = false;
      block.className = "";
      block.textContent = "Cancel";
      if (buttons) buttons.removeAttribute("data-risk");
      return;
    }

    const r = normalizeRisk(risk);

    block.disabled = false;
    proceed.disabled = false;

    if (r === "danger") {
      // Danger: Block is primary, Proceed is demoted
      block.className = "danger-primary";
      block.textContent = "Block";
      proceed.className = "danger";
      proceed.textContent = "Proceed anyway";
      if (buttons) buttons.setAttribute("data-risk", "danger");
    } else {
      block.className = "";
      block.textContent = "Block";
      proceed.className = r;
      proceed.textContent = "Proceed";
      if (buttons) buttons.removeAttribute("data-risk");
    }
  }

  function activateState(activeId) {
    for (const state of document.querySelectorAll(".state")) {
      setVisibility(state, state.id === activeId);
    }
  }

  function setVisibility(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.classList.toggle("hidden", !visible);
    element.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function revealPanel() {
    const panel = document.getElementById("panel");
    if (!panel) return;
    requestAnimationFrame(() => {
      panel.classList.add("visible");
    });
  }

  function debugLog(...args) {
    if (!DEBUG) return;
    console.log("[SignSafe overlay]", ...args);
  }

  function isDebugEnabled() {
    try {
      return Boolean(window.__SIGNSAFE_DEBUG__) || localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }
})();
