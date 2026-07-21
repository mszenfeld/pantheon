import { COORDINATOR_AGENT_NAME } from "../_shared/session-identity.js";
const READ_ONLY_DISPATCH_CALLERS = /* @__PURE__ */ new Map([
  ["Veles - Planner", /* @__PURE__ */ new Set(["triglav"])]
]);
function authorizeDispatchCaller(caller, targets) {
  if (caller === COORDINATOR_AGENT_NAME) {
    if (targets.includes(caller)) {
      throw new Error(`${caller} cannot dispatch itself`);
    }
    return;
  }
  const allowedTargets = READ_ONLY_DISPATCH_CALLERS.get(caller);
  if (allowedTargets === void 0) {
    throw new Error("dispatch tools are restricted to Perun - Coordinator");
  }
  if (targets.some((target) => !allowedTargets.has(target))) {
    throw new Error(`${caller} may dispatch only read-only targets`);
  }
}
const DISPATCHABLE_ALL_AGENTS = /* @__PURE__ */ new Set([
  "Veles - Planner"
]);
function validateDispatchable(agentRegistry, name, callerMode) {
  const agentInfo = agentRegistry[name];
  if (agentInfo === void 0) {
    throw new Error(`Unknown agent: ${name}`);
  }
  if (agentInfo.mode === "subagent") return;
  if (agentInfo.mode === "all" && DISPATCHABLE_ALL_AGENTS.has(name) && callerMode === "primary") {
    return;
  }
  throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${name}`);
}
export {
  DISPATCHABLE_ALL_AGENTS,
  authorizeDispatchCaller,
  validateDispatchable
};
