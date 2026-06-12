import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
function providerIdOf(model) {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(0, slash);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function defaultAuthFilePath() {
  const dataDir = process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share");
  return path.join(dataDir, "opencode", "auth.json");
}
function loadAuthConfiguredProviders(authFilePath = defaultAuthFilePath()) {
  try {
    const parsed = JSON.parse(readFileSync(authFilePath, "utf-8"));
    if (!isRecord(parsed)) return /* @__PURE__ */ new Set();
    const ids = /* @__PURE__ */ new Set();
    for (const [providerId, entry] of Object.entries(parsed)) {
      if (isRecord(entry) && typeof entry["type"] === "string") {
        ids.add(providerId);
      }
    }
    return ids;
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function isProviderConfigured(config, providerId, authProviders = loadAuthConfiguredProviders()) {
  const disabled = config.disabled_providers;
  if (Array.isArray(disabled) && disabled.includes(providerId)) return false;
  const enabled = config.enabled_providers;
  if (Array.isArray(enabled) && enabled.length > 0 && !enabled.includes(providerId))
    return false;
  const providers = config.provider;
  if (providers !== null && typeof providers === "object" && Object.prototype.hasOwnProperty.call(providers, providerId))
    return true;
  return authProviders.has(providerId);
}
export {
  isProviderConfigured,
  loadAuthConfiguredProviders,
  providerIdOf
};
