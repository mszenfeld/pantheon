import { describe, it, expect } from "vitest"
import { QA_LOOP_TOOL_NAMES } from "../../../src/modules/qa-loop/index.js"

describe("qa-loop module wiring", () => {
  it("exports the six tool names in a stable order", () => {
    expect(QA_LOOP_TOOL_NAMES).toEqual([
      "qa_loop_start",
      "qa_loop_ingest",
      "qa_loop_step",
      "qa_loop_record_fix",
      "qa_loop_finalize",
      "qa_loop_undo",
    ])
  })

  it("the tool map keys match QA_LOOP_TOOL_NAMES exactly", async () => {
    // Re-build the tool map the same way the plugin does, with stub deps, and
    // assert the keys line up 1:1 with the exported names.
    const { makeQaLoopTools } = await import("../../../src/modules/qa-loop/tools.js")
    const tools = makeQaLoopTools({
      gate: { isCoordinatorCaller: () => true },
      state: new (await import("../../../src/modules/qa-loop/sidecar.js")).QaLoopState(),
      cwd: "/tmp",
      resolveParentID: async (s) => s,
      assignIssueIds: async () => [],
    })
    expect(Object.keys(tools).sort()).toEqual([...QA_LOOP_TOOL_NAMES].sort())
  })
})
