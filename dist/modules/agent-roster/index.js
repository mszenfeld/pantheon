const NATIVE_BUILTINS = ["build", "plan"];
function getDefaultAgent(config) {
  return config.default_agent;
}
function setDefaultAgent(config, name) {
  ;
  config.default_agent = name;
}
const HIDE = { hidden: true };
const COORDINATOR_AGENT = "Perun - Coordinator";
function isVisibleSessionTarget(entry) {
  if (entry === void 0) return false;
  const e = entry;
  return e.mode !== "subagent" && e.mode !== void 0 && e.hidden !== true;
}
function applyRosterPolicy(config, preExisting) {
  config.agent ??= {};
  const agents = config.agent;
  const hidden = (entry) => ({ ...entry ?? {}, ...HIDE });
  for (const key of Object.keys(agents)) {
    if (!preExisting.has(key)) continue;
    if (agents[key].hidden === true) continue;
    agents[key] = hidden(agents[key]);
  }
  for (const name of NATIVE_BUILTINS) {
    agents[name] = hidden(agents[name]);
  }
  const current = getDefaultAgent(config);
  if (current !== void 0 && isVisibleSessionTarget(agents[current])) return;
  if (isVisibleSessionTarget(agents[COORDINATOR_AGENT])) {
    setDefaultAgent(config, COORDINATOR_AGENT);
    return;
  }
  const fallback = Object.keys(agents).sort().find((k) => isVisibleSessionTarget(agents[k]));
  if (fallback !== void 0) setDefaultAgent(config, fallback);
}
export {
  COORDINATOR_AGENT,
  NATIVE_BUILTINS,
  applyRosterPolicy,
  getDefaultAgent,
  setDefaultAgent
};
