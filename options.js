const apiKeyInput = document.getElementById("api-key");
const statusEl = document.getElementById("status");
const saveButton = document.getElementById("save");

restore();
saveButton.addEventListener("click", save);

async function restore() {
  const stored = await chrome.storage.local.get("anthropic_api_key");
  apiKeyInput.value = stored?.anthropic_api_key || "";
}

async function save() {
  await chrome.storage.local.set({
    anthropic_api_key: apiKeyInput.value.trim()
  });

  statusEl.textContent = apiKeyInput.value.trim()
    ? "Saved. Live analysis is ready."
    : "Saved. The API key is currently empty.";
}
