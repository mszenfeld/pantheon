import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import * as gitOps from "../../../src/modules/qa-loop/git-ops.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

/** Minimal ToolContext — only sessionID is read by qa_loop_record_fix. */
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

function sidecarWithIteration(reportPath: string): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: reportPath,
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 1, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: { "FE-01": { qa_ids: ["QA-001"], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null }, "BE-02": { qa_ids: ["QA-002"], kind: "feature", section: "BE", mutating: false, baseline: "fail", current: "fail", reason: null } },
    issues: {
      "QA-001": { severity: "HIGH", scenario: "FE-01", location: "x:1", title: "t", problem: "p", remediation: "r", status: "open", fixed_at: null, fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] } },
      "QA-002": { severity: "HIGH", scenario: "BE-02", location: "y:2", title: "t2", problem: "p2", remediation: "r2", status: "open", fixed_at: null, fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] } },
    },
    iterations: [{ n: 1, phase: "fixing", pending: ["QA-001"], in_flight: "QA-001", attempted_so_far: [], now_passing: [], still_failing: ["FE-01"], stop_cause: null, regressions: [], warnings: [], dispatches_this_iter: 0, elapsed_s: 0 }],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_record_fix", () => {
  let state: QaLoopState
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-loop-record-fix-"))
    state = new QaLoopState()
    state.save("perun", sidecarWithIteration(join(dir, "r.md")))
    vi.restoreAllMocks()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function tools() {
    return makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
  }

  it("rejects a non-coordinator caller", async () => {
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_a", svarog_status: "READY", changed: [], reason: "" },
      ctx("child"),
    ))
    expect(res.status).toBe("forbidden")
  })

  it("READY with an existing ckpt ref binds it, runs anti-hardcoding, marks fix-attempted, MAXD++", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    vi.spyOn(gitOps, "antiHardcodeDiff").mockReturnValue(["literal 'gold' matches BE payload"])
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_a", svarog_status: "READY", changed: ["src/x.ts"], reason: "" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    const s = state.load("perun")!
    expect(s.issues["QA-001"]!.status).toBe("fix-attempted")
    expect(s.issues["QA-001"]!.fix.child_session_id).toBe("ses_a")
    expect(s.issues["QA-001"]!.fix.checkpoint_ref).toBe("refs/svarog/ckpt/ses_a")
    expect(s.issues["QA-001"]!.fix.hardcode_warnings).toEqual(["literal 'gold' matches BE payload"])
    expect(s.budgets.dispatch_count_total).toBe(1)
    expect(s.iterations[0]!.in_flight).toBeNull()
    expect(s.iterations[0]!.attempted_so_far).toContain("QA-001")
  })

  it("FAIL auto-restores the issue's checkpoint and marks fix-failed (still MAXD++)", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    const restore = vi.spyOn(gitOps, "restoreFailRef").mockReturnValue(undefined)
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_b", svarog_status: "FAIL", changed: ["src/x.ts"], reason: "build red" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    expect(restore).toHaveBeenCalledWith("/tmp", "refs/svarog/ckpt/ses_b")
    const s = state.load("perun")!
    expect(s.issues["QA-001"]!.status).toBe("fix-failed")
    expect(s.budgets.dispatch_count_total).toBe(1)
  })

  it("ESCALATE marks deferred with the reason, no ref needed, MAXD++", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_c", svarog_status: "ESCALATE", changed: [], reason: "needs product decision" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    const s = state.load("perun")!
    expect(s.issues["QA-001"]!.status).toBe("deferred")
    expect(s.issues["QA-001"]!.fix.escalate_reason).toBe("needs product decision")
    expect(s.budgets.dispatch_count_total).toBe(1)
  })

  it("Existence integrity: READY reports changed[] but ref missing → checkpoint-integrity stop, no restore", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const restore = vi.spyOn(gitOps, "restoreFailRef")
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_d", svarog_status: "READY", changed: ["src/x.ts"], reason: "" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    expect(res.stop_cause).toBe("checkpoint-integrity")
    expect(restore).not.toHaveBeenCalled()
    const s = state.load("perun")!
    expect(s.iterations[0]!.stop_cause).toBe("checkpoint-integrity")
  })

  it("no-op READY (empty changed, no ref) is NOT an integrity failure", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_e", svarog_status: "READY", changed: [], reason: "" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    expect(res.stop_cause).toBeUndefined()
    const s = state.load("perun")!
    expect(s.issues["QA-001"]!.status).toBe("fix-attempted")
  })

  it("rejects a malformed child_session_id before any git/MAXD effect", async () => {
    const res = resultJson(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "../evil", svarog_status: "READY", changed: ["src/x.ts"], reason: "" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/child_session_id/)
    const s = state.load("perun")!
    expect(s.budgets.dispatch_count_total).toBe(0) // rejected before MAXD++
    expect(s.issues["QA-001"]!.status).toBe("open") // untouched
  })
})
