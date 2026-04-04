const apiKeyInput = document.getElementById("api-key");
const statusEl = document.getElementById("status");
const saveButton = document.getElementById("save");
const STORAGE_KEY =
  globalThis.SIGNSAFE_SHARED?.constants?.STORAGE_KEYS?.OPENAI_API_KEY || "openai_api_key";

restore();
saveButton.addEventListener("click", save);

async function restore() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  apiKeyInput.value = stored?.[STORAGE_KEY] || "";
}

async function save() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: apiKeyInput.value.trim()
  });

  statusEl.textContent = apiKeyInput.value.trim()
    ? "Saved. Live analysis is ready."
    : "Saved. The API key is currently empty.";
}
