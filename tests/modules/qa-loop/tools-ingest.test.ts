import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"
import { deriveCoverage, MALFORMED_HEADING_REASON } from "../../../src/modules/qa-loop/coverage.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}

/** Minimal ToolContext — only sessionID is read by qa_loop_ingest. */
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

function seedSidecar(state: QaLoopState, parentId: string, dir: string) {
  const now = Date.now()
  const s: Sidecar = {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: join(dir, "p.md"),
    plan_sha256: "x".repeat(64),
    report_path: join(dir, "2026-06-26-demo-report.md"),
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null, baseline_recorded: false,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {
      "FE-01": { qa_ids: [], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null },
      "BE-01": { qa_ids: [], kind: "sanity", section: "BE", mutating: false, baseline: "pass", current: "pass", reason: null },
      "BE-03": { qa_ids: [], kind: "negative", section: "BE", mutating: false, baseline: "fail", current: "fail", reason: null },
      "FE-09": { qa_ids: [], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null },
    },
    issues: {},
    iterations: [],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
  state.save(parentId, s)
}

describe("qa_loop_ingest", () => {
  let dir: string
  let state: QaLoopState
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-loop-ingest-"))
    state = new QaLoopState()
    seedSidecar(state, "perun", dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // Fake the coordinator assign_issue_ids: deterministic QA-NNN from startAt.
  const assignIssueIds = async ({ findings, startAt }: { findings: any[]; startAt?: number }) => {
    let n = startAt ?? 1
    return findings.map((f) => ({ ...f, id: `QA-${String(n++).padStart(3, "0")}` }))
  }

  it("rejects a non-coordinator caller", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    const res = resultJson(await tools.qa_loop_ingest.execute(
      { phase: "baseline", results: [] },
      ctx("child"),
    ))
    expect(res.status).toBe("forbidden")
  })

  it("records states, buckets coverage, and mints QA-IDs for new failures", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    const res = resultJson(await tools.qa_loop_ingest.execute(
      {
        phase: "baseline",
        results: [
          { scenario: "FE-01", state: "fail", severity: "HIGH", title: "login broken", problem: "500", remediation: "fix handler", location: "src/login.ts:10" },
          { scenario: "BE-01", state: "pass" },
          { scenario: "BE-03", state: "pass" }, // passing negative → enforcement
          { scenario: "FE-09", state: "skip", reason: "auth required to reach dashboard" },
        ],
      },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")

    const s = state.load("perun")!
    expect(s.scenarios["FE-01"]!.current).toBe("fail")
    expect(s.scenarios["BE-01"]!.current).toBe("pass")
    expect(s.scenarios["BE-03"]!.current).toBe("pass")
    expect(s.scenarios["FE-09"]!.current).toBe("skip")

    // coverage is a render-time projection of current scenario states (deriveCoverage):
    // sanity(BE-01 pass), enforcement(BE-03 passing negative), FE-09 skip(auth) → auth-unverified.
    const cov = deriveCoverage(s)
    expect(cov.exercised.sanity).toBe(1)
    expect(cov.exercised.enforcement).toBe(1)
    expect(cov.not_verified["auth-unverified"]).toBe(1)

    // QA-ID minted for the new failure and attached to the scenario + issues map
    expect(s.scenarios["FE-01"]!.qa_ids).toEqual(["QA-001"])
    expect(s.issues["QA-001"]!.severity).toBe("HIGH")
    expect(s.issues["QA-001"]!.location).toBe("src/login.ts:10")
    expect(s.issues["QA-001"]!.status).toBe("open")
    expect(res.new_qa_ids).toEqual(["QA-001"])
  })

  it("a baseline ingest sets baseline_recorded; a retest ingest leaves it unchanged", async () => {
    // baseline_recorded is the signal that a real Zmora wave has run — it gates REUSE-resume and
    // the fix-loop `enter` guard. Only a phase:"baseline" ingest may set it; retest/final (which
    // run AFTER baseline) must never be the thing that flips it, or a resume could skip baseline.
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    expect(state.load("perun")!.baseline_recorded).toBe(false)

    // A retest ingest on a not-yet-baselined sidecar must NOT set the marker.
    await tools.qa_loop_ingest.execute(
      { phase: "retest", results: [{ scenario: "FE-01", state: "pass" }] },
      ctx("perun"),
    )
    expect(state.load("perun")!.baseline_recorded).toBe(false)

    // The baseline wave records it.
    await tools.qa_loop_ingest.execute(
      { phase: "baseline", results: [{ scenario: "FE-01", state: "pass" }] },
      ctx("perun"),
    )
    expect(state.load("perun")!.baseline_recorded).toBe(true)
  })

  it("routes an unknown SKIP reason to tool-unavailable + a routing warning", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    await tools.qa_loop_ingest.execute(
      { phase: "baseline", results: [{ scenario: "FE-09", state: "skip", reason: "something weird happened" }] },
      ctx("perun"),
    )
    const s = state.load("perun")!
    expect(deriveCoverage(s).not_verified["tool-unavailable"]).toBe(1)
    expect(s.coverage.routing_warnings.length).toBe(1)
  })

  it("excludes a malformed-heading skip from the coverage rollup (not miscounted as tool-unavailable)", () => {
    // A malformed-heading SKIP is a parse artifact (an authoring/heading-format defect,
    // shown verbatim in the All Scenarios table), not a scenario that went unverified for a
    // tooling reason. deriveCoverage must NOT count it in not_verified — otherwise it lands in
    // the tool-unavailable catch-all and misreads a heading typo as a tooling gap.
    const s = state.load("perun")!
    // FE-09 → a malformed-heading skip (excluded); BE-01 → a genuine tool gap (counted, control).
    s.scenarios["FE-09"]!.current = "skip"
    s.scenarios["FE-09"]!.reason = MALFORMED_HEADING_REASON
    s.scenarios["BE-01"]!.current = "skip"
    s.scenarios["BE-01"]!.reason = "psql client not installed"
    // Only the genuine tooling gap is counted; the malformed heading is excluded entirely.
    // The pre-fix default fall-through would have made this 2 (malformed miscounted here).
    expect(deriveCoverage(s).not_verified["tool-unavailable"]).toBe(1)
  })

  it("ADOPT: mints from start_at_qa_id", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    const res = resultJson(await tools.qa_loop_ingest.execute(
      {
        phase: "baseline",
        start_at_qa_id: 42,
        results: [{ scenario: "FE-01", state: "fail", severity: "LOW", title: "t", problem: "p", remediation: "r", location: "x:1" }],
      },
      ctx("perun"),
    ))
    expect(res.new_qa_ids).toEqual(["QA-042"])
  })

  it("coverage does NOT inflate across baseline → final re-ingests", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    await tools.qa_loop_ingest.execute(
      { phase: "baseline", results: [{ scenario: "FE-01", state: "pass" }, { scenario: "BE-01", state: "pass" }] },
      ctx("perun"),
    )
    const afterBaseline = deriveCoverage(state.load("perun")!).exercised
    // Re-ingest the SAME scenarios at final — the projection must not double-count.
    await tools.qa_loop_ingest.execute(
      { phase: "final", results: [{ scenario: "FE-01", state: "pass" }, { scenario: "BE-01", state: "pass" }] },
      ctx("perun"),
    )
    const afterFinal = deriveCoverage(state.load("perun")!).exercised
    expect(afterFinal).toEqual(afterBaseline)
    expect(afterFinal).toEqual({ feature: 2, sanity: 1, enforcement: 1 })
  })
})
