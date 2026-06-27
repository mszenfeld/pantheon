import { makeCallerGate, SETUP_AGENT_KEY } from "../qa/caller-gate.js";
import { SessionAgentRegistry } from "../_shared/session-agent-registry.js";
import { makeQaLoopTools } from "./tools.js";
import { QaLoopState } from "./sidecar.js";
import { QaLoopState as QaLoopState2 } from "./sidecar.js";
import { makeQaLoopTools as makeQaLoopTools2 } from "./tools.js";
const QA_LOOP_TOOL_NAMES = [
  "qa_loop_start",
  "qa_loop_ingest",
  "qa_loop_step",
  "qa_loop_record_fix",
  "qa_loop_finalize",
  "qa_loop_undo"
];
const AppVerkQaLoopPlugin = async ({ client }) => {
  const state = new QaLoopState();
  const registry = new SessionAgentRegistry();
  const gate = makeCallerGate({ registry, setupAgentKey: SETUP_AGENT_KEY });
  const parentIDCache = /* @__PURE__ */ new Map();
  async function resolveParentID(sessionID) {
    const cached = parentIDCache.get(sessionID);
    if (cached !== void 0) return cached;
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const parentID = result.data?.parentID;
      if (typeof parentID === "string" && parentID.length > 0) {
        parentIDCache.set(sessionID, parentID);
        return parentID;
      }
    } catch {
    }
    return sessionID;
  }
  const assignIssueIds = async ({ findings, startAt }) => {
    let n = startAt ?? 1;
    return findings.map((f) => ({ ...f, id: `QA-${String(n++).padStart(3, "0")}` }));
  };
  const tools = makeQaLoopTools({
    gate,
    state,
    cwd: process.cwd(),
    resolveParentID,
    assignIssueIds
  });
  return {
    tool: tools,
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const deletedID = event.properties?.info?.id;
      if (typeof deletedID !== "string" || deletedID.length === 0) return;
      registry.unregister(deletedID);
      parentIDCache.delete(deletedID);
      state.clearRun(deletedID);
      for (const [childID, parentID] of parentIDCache.entries()) {
        if (parentID === deletedID) parentIDCache.delete(childID);
      }
    }
  };
};
var qa_loop_default = AppVerkQaLoopPlugin;
export {
  AppVerkQaLoopPlugin,
  QA_LOOP_TOOL_NAMES,
  QaLoopState2 as QaLoopState,
  qa_loop_default as default,
  makeQaLoopTools2 as makeQaLoopTools
};
