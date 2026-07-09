import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import * as gitOps from "../../../src/modules/qa-loop/git-ops.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

/** Minimal ToolContext — only sessionID is read by qa_loop_undo. */
function ctx(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "",
    agent: "",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  } as never
}

/** Extract the JSON string from a ToolResult (string | { output: string }). */
function resultJson(r: unknown): Record<string, unknown> {
  const s = typeof r === "string" ? r : (r as { output: string }).output
  return JSON.parse(s) as Record<string, unknown>
}

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

function minimalSidecar(reportPath: string): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: reportPath,
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null, baseline_recorded: true,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    teardowns: [],
    auto_reverting: [],
    scenarios: {}, issues: {}, iterations: [],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_undo", () => {
  let state: QaLoopState
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-loop-undo-"))
    state = new QaLoopState()
    state.save("perun", minimalSidecar(join(dir, "r.md")))
    vi.restoreAllMocks()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function tools() {
    return makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
  }

  it("rejects a non-coordinator caller", async () => {
    const res = resultJson(await tools().qa_loop_undo.execute({}, ctx("child")))
    expect(res.status).toBe("forbidden")
  })

  it("reverts the tree to the pre-loop ref", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    const undo = vi.spyOn(gitOps, "undoToPreLoop").mockReturnValue(undefined)
    const res = resultJson(await tools().qa_loop_undo.execute({}, ctx("perun")))
    expect(res.status).toBe("ok")
    expect(undo).toHaveBeenCalledWith("/tmp", "refs/qa-loop/pre/qa-loop-demo-1")
    expect(res.restored_ref).toBe("refs/qa-loop/pre/qa-loop-demo-1")
  })

  it("§8 hands back teardowns_pending LIFO so a manual undo also un-seeds the DB", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    vi.spyOn(gitOps, "undoToPreLoop").mockReturnValue(undefined)
    const s = minimalSidecar(join(dir, "r.md"))
    s.teardowns = [
      { scenario: "BE-01", block: "DELETE a" },
      { scenario: "BE-02", block: "DELETE b" },
    ]
    state.save("perun", s)
    const res = resultJson(await tools().qa_loop_undo.execute({}, ctx("perun")))
    expect(res.status).toBe("ok")
    expect(res.restored_ref).toBe("refs/qa-loop/pre/qa-loop-demo-1")
    expect(res.teardowns_pending).toEqual([
      { scenario: "BE-02", block: "DELETE b" },
      { scenario: "BE-01", block: "DELETE a" },
    ])
  })

  it("errors when the pre-loop ref is missing", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const undo = vi.spyOn(gitOps, "undoToPreLoop")
    const res = resultJson(await tools().qa_loop_undo.execute({}, ctx("perun")))
    expect(res.status).toBe("error")
    expect(undo).not.toHaveBeenCalled()
  })
})
