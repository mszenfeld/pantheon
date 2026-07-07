import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import { hashPlan } from "../../../src/modules/qa-loop/plan-hash.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

/** Minimal ToolContext — only sessionID is read by qa_loop_step. */
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

const PLAN_TEXT = "# Plan\n\n## FE-01 — login\nNavigate.\n\n## BE-01 — health\nGET /health.\n"

function baseSidecar(dir: string): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: join(dir, "p.md"), plan_sha256: hashPlan(PLAN_TEXT), report_path: join(dir, "2026-06-26-demo-report.md"),
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null, baseline_recorded: true,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    teardowns: [],
    auto_reverting: [],
    scenarios: {
      "FE-01": { qa_ids: ["QA-001"], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null },
      "BE-01": { qa_ids: [], kind: "sanity", section: "BE", mutating: false, baseline: "pass", current: "pass", reason: null },
    },
    issues: {
      "QA-001": { severity: "HIGH", scenario: "FE-01", location: "x:1", title: "t", problem: "p", remediation: "r", status: "open", fixed_at: null, fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] } },
    },
    iterations: [],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_step", () => {
  let dir: string
  let state: QaLoopState
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-loop-step-"))
    writeFileSync(join(dir, "p.md"), PLAN_TEXT)
    state = new QaLoopState()
    state.save("perun", baseSidecar(dir))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("rejects a non-coordinator caller", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    const res = resultJson(await tools.qa_loop_step.execute({ phase: "enter" }, ctx("child")))
    expect(res.status).toBe("forbidden")
  })

  it("enter refuses before the baseline wave is ingested (baseline_recorded:false)", async () => {
    // A premature enter — no baseline ingested, only scaffold placeholders — must NOT return the
    // confusing { action:"fix", issues:[] }. It surfaces an actionable error naming the missing
    // baseline wave so Perun runs it, rather than reverse-engineering a phantom fix-phase.
    const s0 = state.load("perun")!
    s0.baseline_recorded = false
    state.save("perun", s0)
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    const res = resultJson(await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun")))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/baseline not yet ingested/)
    // The guard returns before any accounting: no iteration opened, counter not advanced.
    const s = state.load("perun")!
    expect(s.budgets.iteration).toBe(0)
    expect(s.iterations.length).toBe(0)
  })

  it("enter increments the iteration once and returns the failing fix-set", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    const res = resultJson(await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun")))
    expect(res.action).toBe("fix")
    expect(res.issues).toEqual(["QA-001"])
    const s = state.load("perun")!
    expect(s.budgets.iteration).toBe(1)
    expect(s.iterations.length).toBe(1)
    expect(s.iterations[0]!.phase).toBe("selecting")
  })

  it("enter is idempotent: re-entering a non-evaluated iteration does NOT re-increment", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun"))
    // simulate the gate advancing the phase
    const mid = state.load("perun")!
    mid.iterations[0]!.phase = "awaiting_fix_gate"
    state.save("perun", mid)

    const res = resultJson(await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun")))
    expect(res.action).toBe("fix")
    const s = state.load("perun")!
    expect(s.budgets.iteration).toBe(1) // NOT 2
    expect(s.iterations.length).toBe(1)
  })

  it("evaluate advances the row to evaluated and returns the state-machine action", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun"))
    // mark FE-01 now passing so evaluate sees progress, no regression
    const mid = state.load("perun")!
    mid.scenarios["FE-01"]!.current = "pass"
    mid.iterations[0]!.phase = "retested"
    state.save("perun", mid)

    const res = resultJson(await tools.qa_loop_step.execute({ phase: "evaluate" }, ctx("perun")))
    expect(["continue", "stop", "final"]).toContain(res.action)
    const s = state.load("perun")!
    expect(s.iterations[0]!.phase).toBe("evaluated")
  })

  it("enter stops with plan-tamper when the plan file changed mid-run", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    // Edit the plan on disk after start so its hash no longer matches the sidecar baseline.
    writeFileSync(join(dir, "p.md"), PLAN_TEXT + "\n## FE-99 — injected\nextra\n")
    const res = resultJson(await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun")))
    expect(res.action).toBe("stop")
    expect(res.stop_cause).toBe("plan-tamper")
    const s = state.load("perun")!
    expect(s.iterations[s.iterations.length - 1]!.stop_cause).toBe("plan-tamper")
  })

  it("evaluate populates now_passing / still_failing / regressions", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    await tools.qa_loop_step.execute({ phase: "enter" }, ctx("perun"))
    const mid = state.load("perun")!
    mid.scenarios["FE-01"]!.current = "pass" // baseline fail → now passing
    mid.iterations[0]!.phase = "retested"
    state.save("perun", mid)
    await tools.qa_loop_step.execute({ phase: "evaluate" }, ctx("perun"))
    const s = state.load("perun")!
    expect(s.iterations[0]!.now_passing).toEqual(["FE-01"])
    expect(s.iterations[0]!.still_failing).toEqual([])
    expect(s.iterations[0]!.regressions).toEqual([])
  })
})
