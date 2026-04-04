(function bootstrapDemoPage() {
  const CONSTANTS = globalThis.SIGNSAFE_SHARED?.constants || {};
  const CHANNEL = CONSTANTS.OVERLAY_CHANNEL || "SIGNSAFE_OVERLAY";
  const OVERLAY_MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES?.OVERLAY || {};
  const fixtures = globalThis.SIGNSAFE_SHARED?.demoFixtures || window.SIGNSAFE_DEMO_TRANSACTIONS || [];
  const grid = document.getElementById("grid");
  const resultBanner = document.getElementById("result-banner");
  const iframe = document.getElementById("overlay-frame");
  let currentSessionId = null;
  let currentFixtureId = null;
  let bannerTimerId = null;
  const cardEls = new Map(); // fixtureId → card element

  const FIXTURE_TYPES = {
    DEMO_JUPITER_SWAP: "DEX swap",
    DEMO_DRAINER:      "Phishing",
    DEMO_NFT_MINT:     "Metaplex mint",
    DEMO_RAW_MESSAGE:  "Message signing"
  };

  iframe.addEventListener("load", () => {
    iframe.dataset.ready = "true";
  });

  for (const fixture of fixtures) {
    const risk = fixture.verdict.risk;
    const typeTag = FIXTURE_TYPES[fixture.id] || "Transaction";

    const card = document.createElement("article");
    card.className = `card ${risk}`;

    const badgeDot = badgeSvg(risk);
    card.innerHTML = `
      <div class="card-top">
        <div class="badge ${risk}">${badgeDot}${capitalize(risk)}</div>
        <div class="played-badge hidden" id="played-${fixture.id}"></div>
      </div>
      <div class="type-tag">${typeTag}</div>
      <h2>${fixture.name}</h2>
      <p>${fixture.description}</p>
      <div class="card-trigger" aria-hidden="true">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg>
        Preview overlay
      </div>
    `;

    card.addEventListener("click", () => previewFixture(fixture));
    grid.appendChild(card);
    cardEls.set(fixture.id, card);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== (OVERLAY_MESSAGE_TYPES.DECISION || "DECISION")) {
      return;
    }

    if (message.sessionId !== currentSessionId) {
      return;
    }

    iframe.style.display = "none";
    showResultBanner(message.approved);
    markCardPlayed(currentFixtureId, message.approved);
  });

  async function previewFixture(fixture) {
    currentSessionId = `demo-${fixture.id}-${Date.now()}`;
    currentFixtureId = fixture.id;
    iframe.style.display = "block";

    clearTimeout(bannerTimerId);
    resultBanner.className = "";
    resultBanner.textContent = "";

    await waitForIframe();
    iframe.contentWindow.postMessage(
      {
        channel: CHANNEL,
        sessionId: currentSessionId,
        type: OVERLAY_MESSAGE_TYPES.SHOW_VERDICT || "SHOW_VERDICT",
        payload: {
          verdict: fixture.verdict,
          meta: { current: 1, total: 1 }
        }
      },
      "*"
    );
  }

  function markCardPlayed(fixtureId, approved) {
    if (!fixtureId) return;
    const badge = document.getElementById(`played-${fixtureId}`);
    if (!badge) return;
    badge.textContent = approved ? "✓ Proceeded" : "✗ Blocked";
    badge.className = `played-badge ${approved ? "approved" : "blocked"}`;
  }

  function showResultBanner(approved) {
    const icon = approved
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const label = approved ? "Approved — transaction would proceed." : "Blocked — transaction rejected by user.";

    resultBanner.innerHTML = `${icon}<span>${label}</span>`;
    resultBanner.className = approved ? "approved" : "blocked";

    bannerTimerId = setTimeout(() => {
      resultBanner.className = "";
      resultBanner.textContent = "";
    }, 6000);
  }

  function badgeSvg(risk) {
    return `<svg viewBox="0 0 8 8" style="width:7px;height:7px;flex-shrink:0"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>`;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
