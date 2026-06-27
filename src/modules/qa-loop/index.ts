import { type Plugin } from "@opencode-ai/plugin"
import { makeCallerGate, SETUP_AGENT_KEY } from "../qa/caller-gate.js"
import { SessionAgentRegistry } from "../_shared/session-agent-registry.js"
import { makeQaLoopTools, type QaLoopToolDeps } from "./tools.js"
import { QaLoopState } from "./sidecar.js"

export { QaLoopState } from "./sidecar.js"
export { makeQaLoopTools } from "./tools.js"

// Canonical name list — the single source of truth mirrored into Perun's
// allowed-tools frontmatter + PERUN_TOOLS + perun-tools-sync.test.ts (Task 17).
export const QA_LOOP_TOOL_NAMES = [
  "qa_loop_start",
  "qa_loop_ingest",
  "qa_loop_step",
  "qa_loop_record_fix",
  "qa_loop_finalize",
  "qa_loop_undo",
] as const

export const AppVerkQaLoopPlugin: Plugin = async ({ client }) => {
  const state = new QaLoopState()
  // The qa-loop tools are Perun-only. Reuse the QA module's caller gate
  // semantics: a registry MISS means the coordinator (Perun is never a
  // dispatched child). A fresh registry here is fine — these tools never need
  // to recognise a specific specialist, only "is the caller a dispatched child".
  const registry = new SessionAgentRegistry()
  const gate = makeCallerGate({ registry, setupAgentKey: SETUP_AGENT_KEY })

  // Cache child→parent lookups positively: once resolved, the mapping never
  // changes for the life of a session (sessions don't re-parent). Skipping the
  // SDK round-trip is a pure perf win on the hot resolveParentID path.
  const parentIDCache = new Map<string, string>()
  async function resolveParentID(sessionID: string): Promise<string> {
    const cached = parentIDCache.get(sessionID)
    if (cached !== undefined) return cached
    try {
      const result = await client.session.get({ path: { id: sessionID } })
      const parentID = result.data?.parentID
      if (typeof parentID === "string" && parentID.length > 0) {
        parentIDCache.set(sessionID, parentID)
        return parentID
      }
    } catch {
      // fall through
    }
    return sessionID
  }

  // assign_issue_ids passthrough: the qa-loop tools mint QA-IDs via the existing
  // coordinator minter. The coordinator owns the canonical implementation; here
  // we thread a thin call through the SDK tool surface so qa_loop_ingest reuses
  // it rather than minting a second time (§5 "reuses the existing tool").
  //
  // Deterministic local fan-out matching assign_issue_ids' QA-NNN contract.
  // Wired to the coordinator tool at integration time (Phase 3); kept
  // self-contained so the module has no coordinator import cycle.
  const assignIssueIds: QaLoopToolDeps["assignIssueIds"] = async ({ findings, startAt }) => {
    let n = startAt ?? 1
    return findings.map((f) => ({ ...f, id: `QA-${String(n++).padStart(3, "0")}` }))
  }

  const tools = makeQaLoopTools({
    gate,
    state,
    cwd: process.cwd(),
    resolveParentID,
    assignIssueIds,
  })

  return {
    tool: tools,
    event: async ({ event }) => {
      // Defensive cleanup on `session.deleted`. The SDK emits this for both
      // parent (Perun) and child sessions. Every call is safe for either kind.
      if (event.type !== "session.deleted") return
      const deletedID = event.properties?.info?.id
      if (typeof deletedID !== "string" || deletedID.length === 0) return
      registry.unregister(deletedID)
      parentIDCache.delete(deletedID)
      state.clearRun(deletedID)
      // Sweep child entries whose cached parent is the deleted ID.
      for (const [childID, parentID] of parentIDCache.entries()) {
        if (parentID === deletedID) parentIDCache.delete(childID)
      }
    },
  }
}

export default AppVerkQaLoopPlugin
