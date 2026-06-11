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
function isNative(agent) {
  return agent.native === true || agent.builtIn === true;
}
function findUncoveredNatives(agents) {
  const covered = new Set(NATIVE_BUILTINS);
  const uncovered = /* @__PURE__ */ new Set();
  for (const agent of agents) {
    if (!isNative(agent)) continue;
    const name = agent.name;
    if (name === void 0 || name.length === 0) continue;
    if (agent.mode === "subagent") continue;
    if (agent.hidden === true) continue;
    if (covered.has(name)) continue;
    uncovered.add(name);
  }
  return [...uncovered].sort();
}
function buildDriftWarning(uncovered) {
  return `Native visible-primary agent(s) not covered by the roster policy: ${uncovered.join(", ")}. These will leak into the picker \u2014 add them to NATIVE_BUILTINS in src/modules/agent-roster/index.ts and re-verify against the actual picker.`;
}
const AppVerkAgentRosterPlugin = async ({ client }) => {
  let checked = false;
  return {
    event: async ({ event }) => {
      if (event.type !== "session.created") return;
      if (checked) return;
      checked = true;
      try {
        const result = await client.app.agents();
        const agents = result.data ?? [];
        const uncovered = findUncoveredNatives(agents);
        if (uncovered.length === 0) return;
        const message = buildDriftWarning(uncovered);
        console.error(`Pantheon: ${message}`);
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message }
        });
      } catch {
      }
    }
  };
};
var agent_roster_default = AppVerkAgentRosterPlugin;
export {
  AppVerkAgentRosterPlugin,
  COORDINATOR_AGENT,
  NATIVE_BUILTINS,
  applyRosterPolicy,
  buildDriftWarning,
  agent_roster_default as default,
  findUncoveredNatives,
  getDefaultAgent,
  setDefaultAgent
};
