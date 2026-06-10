import { isAbsolute, resolve } from "node:path";
import { STRIBOG_AGENT_KEY, STRIBOG_ALLOWED_TOOL_IDS, STRIBOG_EDIT_BUDGET } from "./stribog.metadata.js";
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
  const hook = async (input, output) => {
    try {
      const agent = await deps.resolveAgent(input.sessionID);
      if (agent !== STRIBOG_AGENT_KEY) return;
      if (!STRIBOG_ALLOWED_TOOL_IDS.has(input.tool)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${input.tool}" is outside Stribog's allow-list (read/glob/grep/edit/write/bash only). Stribog is a leaf actuator \u2014 it does not mint secrets or dispatch. If the task requires this tool, return the ESCALATE result.`
        );
      }
      if (input.tool === "edit" || input.tool === "write") {
        const filePath = output.args?.filePath;
        if (typeof filePath !== "string" || !isAbsolute(filePath)) return;
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
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SCOPE_VIOLATION)) throw error;
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
