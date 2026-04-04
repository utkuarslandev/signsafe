const apiKeyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key");
const eyeIcon = document.getElementById("eye-icon");
const statusEl = document.getElementById("status");
const saveButton = document.getElementById("save");
const testButton = document.getElementById("test-connection");
const keyHint = document.getElementById("key-hint");
const nextSteps = document.getElementById("next-steps");
const reloadExtBtn = document.getElementById("reload-ext");

const STORAGE_KEYS = globalThis.SIGNSAFE_SHARED?.constants?.STORAGE_KEYS || {};
const API_KEY_STORAGE_KEY = STORAGE_KEYS.OPENAI_API_KEY || "openai_api_key";

const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

restore();
saveButton.addEventListener("click", save);
testButton.addEventListener("click", testConnection);
toggleKeyBtn.addEventListener("click", toggleKeyVisibility);
apiKeyInput.addEventListener("input", validateKeyFormat);
apiKeyInput.addEventListener("blur", validateKeyFormat);

// Open demo page link
const openDemoLink = document.getElementById("open-demo");
if (openDemoLink) {
  openDemoLink.href = chrome.runtime.getURL("demo.html");
}

// Reload extension
if (reloadExtBtn) {
  reloadExtBtn.addEventListener("click", () => {
    chrome.runtime.reload();
  });
  reloadExtBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") chrome.runtime.reload();
  });
}

async function restore() {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const key = stored?.[API_KEY_STORAGE_KEY] || "";
  apiKeyInput.value = key;
  if (key) {
    nextSteps.classList.add("visible");
  }
}

async function save() {
  const key = apiKeyInput.value.trim();
  if (!validateKeyFormat()) return;
  await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: key });
  if (key) {
    showStatus("success", "Key saved. Live analysis is ready.");
    nextSteps.classList.add("visible");
  } else {
    showStatus("error", "Key cleared. Analysis will be unavailable.");
    nextSteps.classList.remove("visible");
  }
}

async function testConnection() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus("error", "Enter a key first.");
    return;
  }

  testButton.disabled = true;
  showStatus("testing", "Testing connection…");

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` }
    });

    if (res.ok) {
      showStatus("success", "✓ Key accepted by OpenAI.");
      nextSteps.classList.add("visible");
    } else if (res.status === 401) {
      showStatus("error", "✗ OpenAI rejected this key (401 Unauthorized).");
    } else {
      showStatus("error", `✗ OpenAI returned status ${res.status}.`);
    }
  } catch (_err) {
    showStatus("error", "✗ Could not reach OpenAI. Check your network.");
  } finally {
    testButton.disabled = false;
  }
}

function validateKeyFormat() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyHint.textContent = "";
    apiKeyInput.classList.remove("invalid");
    return true;
  }
  if (!key.startsWith("sk-")) {
    keyHint.textContent = "This doesn't look like an OpenAI key — they start with sk-";
    apiKeyInput.classList.add("invalid");
    return false;
  }
  keyHint.textContent = "";
  apiKeyInput.classList.remove("invalid");
  return true;
}

function toggleKeyVisibility() {
  const isHidden = apiKeyInput.type === "password";
  apiKeyInput.type = isHidden ? "text" : "password";
  eyeIcon.innerHTML = isHidden ? EYE_CLOSED : EYE_OPEN;
  toggleKeyBtn.setAttribute("aria-label", isHidden ? "Hide API key" : "Show API key");
}

function showStatus(type, message) {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    testing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`
  };
  statusEl.innerHTML = `${icons[type] || icons.error}<span>${message}</span>`;
  statusEl.className = type;
}
