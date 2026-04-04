(function bootstrapSignSafeOverlay() {
  const CHANNEL = "SIGNSAFE_OVERLAY";
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

    currentSessionId = message.sessionId;

    if (message.type === "SHOW_LOADING") {
      renderLoading(message.payload);
      return;
    }

    if (message.type === "SHOW_VERDICT") {
      renderVerdict(message.payload.verdict, message.payload.meta);
      return;
    }

    if (message.type === "SHOW_BATCH") {
      renderBatch(message.payload.verdicts);
    }
  });

  document.getElementById("btn-block").addEventListener("click", () => {
    const sid = currentSessionId;
    emitDecision(false, sid);
  });

  document.getElementById("btn-proceed").addEventListener("click", () => {
    const sid = currentSessionId;
    emitDecision(true, sid);
  });

  function emitDecision(approved, sessionId) {
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
    activateState("loading-state");
    document.getElementById("loading-title").textContent = payload?.title || "Analyzing transaction";
    document.getElementById("loading-detail").textContent =
      payload?.detail || "Simulating on-chain effects and preparing a plain-English verdict.";
    document.getElementById("btn-proceed").disabled = true;
    const blockBtn = document.getElementById("btn-block");
    blockBtn.disabled = false;
    blockBtn.textContent = "Cancel";
  }

  function renderVerdict(verdict, meta) {
    activateState("verdict-state");
    const risk = ["safe", "review", "danger"].includes(verdict?.risk) ? verdict.risk : "review";
    const badge = document.getElementById("risk-badge");
    badge.className = risk;
    badge.textContent = riskLabels[risk];

    document.getElementById("progress-label").textContent =
      meta && meta.total > 1 ? `Transaction ${meta.current} of ${meta.total}` : "";
    document.getElementById("summary").textContent =
      verdict?.summary || "Unable to analyze this transaction clearly.";

    fillList("actions-list", verdict?.actions, "No visible actions were extracted.");

    const risksSection = document.getElementById("risks-section");
    const riskReasons = Array.isArray(verdict?.risk_reasons) ? verdict.risk_reasons : [];
    if (riskReasons.length > 0) {
      risksSection.classList.remove("hidden");
      fillList("risks-list", riskReasons, "");
    } else {
      risksSection.classList.add("hidden");
      fillList("risks-list", [], "");
    }

    document.getElementById("verdict-text").textContent =
      verdict?.verdict || "Proceed only if you fully understand the transaction.";

    const proceed = document.getElementById("btn-proceed");
    proceed.disabled = false;
    proceed.className = risk;
    document.getElementById("btn-block").disabled = false;
    document.getElementById("btn-block").textContent = "Block";
  }

  function renderBatch(verdicts) {
    activateState("batch-state");
    const actionItems = verdicts
      .flatMap((verdict) => (Array.isArray(verdict.actions) ? verdict.actions : []))
      .slice(0, 8);

    document.getElementById("batch-summary").textContent = `${verdicts.length} transactions look safe overall.`;
    document.getElementById("batch-detail").textContent =
      "SignSafe did not detect suspicious effects in this batch. Review the combined actions below before continuing.";
    fillList("batch-actions", actionItems, "No suspicious effects were detected during simulation.");

    const proceed = document.getElementById("btn-proceed");
    proceed.disabled = false;
    proceed.className = "safe";
    document.getElementById("btn-block").disabled = false;
    document.getElementById("btn-block").textContent = "Block";
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

  function activateState(activeId) {
    for (const state of document.querySelectorAll(".state")) {
      state.classList.toggle("hidden", state.id !== activeId);
    }
  }
})();
