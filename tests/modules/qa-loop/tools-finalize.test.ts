import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

/** Minimal ToolContext — only sessionID is read by qa_loop_finalize. */
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

function sidecar(reportPath: string, fe01Current: "pass" | "fail"): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: reportPath,
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 1, dispatch_count_total: 4, elapsed_s: 120, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: { "FE-01": { qa_ids: ["QA-001"], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: fe01Current, reason: null } },
    issues: { "QA-001": { severity: "HIGH", scenario: "FE-01", location: "x:1", title: "t", problem: "p", remediation: "r", status: "fix-attempted", fixed_at: null, fix: { svarog_status: "READY", escalate_reason: null, child_session_id: "ses_a", checkpoint_ref: "refs/svarog/ckpt/ses_a", changed: ["src/x.ts"], hardcode_warnings: [] } } },
    iterations: [{ n: 1, phase: "evaluated", pending: [], in_flight: null, attempted_so_far: ["QA-001"], now_passing: [], still_failing: [], stop_cause: null, regressions: [], warnings: [], dispatches_this_iter: 4, elapsed_s: 120 }],
    coverage: { exercised: { feature: 1, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_finalize", () => {
  let cwd: string
  let state: QaLoopState
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "qa-loop-fin-"))
    mkdirSync(join(cwd, "docs/testing/reports"), { recursive: true })
    state = new QaLoopState()
    vi.restoreAllMocks()
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  function tools() {
    return makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssign })
  }

  it("rejects a non-coordinator caller", async () => {
    state.save("perun", sidecar(join(cwd, "docs/testing/reports/r.md"), "pass"))
    const res = resultJson(await tools().qa_loop_finalize.execute({ final_pass_elapsed_s: 0 }, ctx("child")))
    expect(res.status).toBe("forbidden")
  })

  it("FINAL pass: transitions fix-attempted→fixed, result Pass, writes report", async () => {
    state.save("perun", sidecar(join(cwd, "docs/testing/reports/r.md"), "pass"))
    const res = resultJson(await tools().qa_loop_finalize.execute({ final_pass_elapsed_s: 30 }, ctx("perun")))
    expect(res.status).toBe("ok")
    expect(res.result).toBe("Pass")
    const s = state.load("perun")!
    expect(s.issues["QA-001"]!.status).toBe("fixed")
    expect(s.issues["QA-001"]!.fixed_at).not.toBeNull()
    expect(s.budgets.final_pass_elapsed_s).toBe(30)
    expect(s.finalized_at).not.toBeNull()
    const report = readFileSync(join(cwd, "docs/testing/reports/r.md"), "utf8")
    expect(report).toContain("✅ Fixed")
  })

  it("FINAL still-failing: does NOT transition to fixed; result Fail", async () => {
    state.save("perun", sidecar(join(cwd, "docs/testing/reports/r.md"), "fail"))
    const res = resultJson(await tools().qa_loop_finalize.execute({ final_pass_elapsed_s: 30 }, ctx("perun")))
    expect(res.result).toBe("Fail")
    const s = state.load("perun")!
    expect(s.issues["QA-001"]!.status).toBe("fix-attempted") // never promoted
    const report = readFileSync(join(cwd, "docs/testing/reports/r.md"), "utf8")
    expect(report).not.toContain("✅ Fixed")
  })
})
