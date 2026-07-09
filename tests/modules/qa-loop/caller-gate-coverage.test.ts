import { describe, it, expect } from "vitest"
import { QA_LOOP_TOOL_NAMES } from "../../../src/modules/qa-loop/index.js"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"

describe("every qa-loop tool guards on isCoordinatorCaller", () => {
  it("a non-coordinator caller is rejected by all six tools", async () => {
    const tools = makeQaLoopTools({
      gate: { isCoordinatorCaller: (s: string) => s === "perun" },
      state: new QaLoopState(),
      cwd: "/tmp",
      resolveParentID: async (s) => s,
      assignIssueIds: async () => [],
    })
    // Minimal arg stubs per tool; the gate check runs FIRST, before arg use.
    const stubs: Record<string, unknown> = {
      qa_loop_start: { plan_path: "p", topic: "t", report_path: "r" },
      qa_loop_ingest: { phase: "baseline", results: [] },
      qa_loop_step: { phase: "enter" },
      qa_loop_record_fix: { qa_id: "QA-001", child_session_id: "s", svarog_status: "READY", changed: [], reason: "" },
      qa_loop_finalize: { final_pass_elapsed_s: 0 },
      qa_loop_undo: {},
    }
    for (const name of QA_LOOP_TOOL_NAMES) {
      const res = JSON.parse(await (tools as any)[name].execute(stubs[name], { sessionID: "child" }))
      expect(res.status, `${name} must reject non-coordinator`).toBe("forbidden")
    }
  })
})
