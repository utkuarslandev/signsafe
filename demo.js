(function bootstrapDemoPage() {
  const CHANNEL = "SIGNSAFE_OVERLAY";
  const fixtures = window.SIGNSAFE_DEMO_TRANSACTIONS || [];
  const grid = document.getElementById("grid");
  const statusEl = document.getElementById("status");
  const iframe = document.getElementById("overlay-frame");
  let currentSessionId = null;

  iframe.addEventListener("load", () => {
    iframe.dataset.ready = "true";
  });

  for (const fixture of fixtures) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="badge">${fixture.verdict.risk}</div>
      <h2>${fixture.name}</h2>
      <p>${fixture.description}</p>
      <button type="button">Preview overlay</button>
    `;

    card.querySelector("button").addEventListener("click", () => previewFixture(fixture));
    grid.appendChild(card);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== "DECISION") {
      return;
    }

    if (message.sessionId !== currentSessionId) {
      return;
    }

    iframe.style.display = "none";
    statusEl.textContent = message.approved
      ? "Demo overlay approved."
      : "Demo overlay blocked.";
  });

  async function previewFixture(fixture) {
    currentSessionId = `demo-${fixture.id}-${Date.now()}`;
    iframe.style.display = "block";
    statusEl.textContent = `Previewing ${fixture.name}.`;

    await waitForIframe();
    iframe.contentWindow.postMessage(
      {
        channel: CHANNEL,
        sessionId: currentSessionId,
        type: "SHOW_VERDICT",
        payload: {
          verdict: fixture.verdict,
          meta: { current: 1, total: 1 }
        }
      },
      "*"
    );
  }

  function waitForIframe() {
    if (iframe.dataset.ready === "true") {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      iframe.addEventListener(
        "load",
        () => {
          iframe.dataset.ready = "true";
          resolve();
        },
        { once: true }
      );
    });
  }
})();
