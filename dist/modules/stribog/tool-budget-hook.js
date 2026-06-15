import { isAbsolute, resolve } from "node:path";
import {
  STRIBOG_AGENT_KEY,
  CORE_BUILTINS,
  STRIBOG_EDIT_BUDGET,
  isImmutableDeny,
  matchesExtraToolsPattern
} from "./stribog.metadata.js";
const TOOL_DENIED = "STRIBOG_TOOL_DENIED";
const SCOPE_VIOLATION = "STRIBOG_SCOPE_VIOLATION";
function makeStribogToolHook(deps) {
  const editedPaths = /* @__PURE__ */ new Map();
  function pathsFor(sessionID) {
    let set = editedPaths.get(sessionID);
    if (set === void 0) {
      set = /* @__PURE__ */ new Set();
      editedPaths.set(sessionID, set);
    }
    return set;
  }
  const extraPatterns = deps.extraPatterns ?? [];
  const hook = async (input, output) => {
    try {
      const raw = input.tool;
      const isEditWrite = raw === "edit" || raw === "write";
      if (!isEditWrite && CORE_BUILTINS.has(raw)) return;
      const agent = await deps.resolveAgent(input.sessionID);
      if (agent !== STRIBOG_AGENT_KEY) return;
      const denyKey = raw.toLowerCase();
      if (isImmutableDeny(denyKey)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Stribog (capability class: secret-mint / dispatch / code-write / shell). No config can re-enable it. Stribog is a leaf actuator \u2014 if the task requires this, return the ESCALATE result.`
        );
      }
      if (!CORE_BUILTINS.has(raw)) {
        if (extraPatterns.some((p) => matchesExtraToolsPattern(p, denyKey))) {
          return;
        }
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is outside Stribog's allow-list (read/glob/grep/edit/write/bash + configured extraTools only). Stribog is a leaf actuator \u2014 it does not mint secrets or dispatch. If the task requires this tool, return the ESCALATE result.`
        );
      }
      {
        const filePath = output.args?.filePath;
        if (typeof filePath !== "string" || !isAbsolute(filePath)) {
          const kind = typeof filePath === "string" ? "relative" : `absent (${typeof filePath})`;
          throw new Error(
            `${SCOPE_VIOLATION}: edit/write refused \u2014 filePath must be an absolute path but was ${kind}; a non-absolute path cannot be bound to the edit budget. This task exceeds Stribog's scope. Return the ESCALATE result now.`
          );
        }
        const path = resolve(filePath);
        const set = pathsFor(input.sessionID);
        if (!set.has(path) && set.size >= STRIBOG_EDIT_BUDGET) {
          const alreadyModified = [...set].join(", ");
          throw new Error(
            `${SCOPE_VIOLATION}: edit budget exhausted (${STRIBOG_EDIT_BUDGET} distinct files already modified: ${alreadyModified}; refused: ${path}). This task exceeds Stribog's scope. Return the ESCALATE result now, listing the files you already touched in \`reason\`.`
          );
        }
        set.add(path);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SCOPE_VIOLATION))
        throw error;
    }
  };
  const clearSession = (sessionID) => {
    editedPaths.delete(sessionID);
  };
  return { hook, clearSession };
}
export {
  makeStribogToolHook
};
