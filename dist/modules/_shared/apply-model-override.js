import { loadPantheonConfig } from "../pantheon-config/index.js";
const knownSlugs = /* @__PURE__ */ new Set();
function registerKnownSlug(slug) {
  knownSlugs.add(slug);
}
function getKnownSlugs() {
  return [...knownSlugs].sort();
}
function applyModelOverride(config, slug, agentKeys, defaultModel, userModels) {
  registerKnownSlug(slug);
  const keys = typeof agentKeys === "string" ? [agentKeys] : agentKeys;
  const override = loadPantheonConfig().agents[slug]?.model;
  const agents = config.agent;
  if (agents === void 0) return;
  for (const key of keys) {
    const agent = agents[key];
    if (agent === void 0) continue;
    const model = userModels?.get(key) ?? override ?? defaultModel;
    if (model === void 0) continue;
    agent.model = model;
  }
}
function getUnknownAgentDiagnostics() {
  const configured = Object.keys(loadPantheonConfig().agents);
  if (configured.length === 0) return [];
  const known = getKnownSlugs();
  const knownSet = new Set(known);
  const diagnostics = [];
  for (const name of configured) {
    if (knownSet.has(name)) continue;
    const knownList = known.length > 0 ? known.join(", ") : "(none registered)";
    diagnostics.push(`[pantheon] unknown agent "${name}" \u2014 known: ${knownList}`);
  }
  return diagnostics;
}
function captureUserModels(config, agentKeys) {
  const keys = typeof agentKeys === "string" ? [agentKeys] : agentKeys;
  const captured = /* @__PURE__ */ new Map();
  const agents = config.agent;
  if (agents === void 0) return captured;
  for (const key of keys) {
    const model = agents[key]?.model;
    if (typeof model === "string" && model.length > 0) captured.set(key, model);
  }
  return captured;
}
function __resetKnownSlugsForTests() {
  knownSlugs.clear();
}
export {
  __resetKnownSlugsForTests,
  applyModelOverride,
  captureUserModels,
  getKnownSlugs,
  getUnknownAgentDiagnostics,
  registerKnownSlug
};
