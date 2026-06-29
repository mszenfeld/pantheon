import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import { deriveCoverage } from "../../../src/modules/qa-loop/coverage.js"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

/** Minimal ToolContext — only sessionID is read by qa_loop_start. */
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

// A caller gate that classifies a fixed coordinator session id as Perun and
// everything else as a dispatched child (mirrors caller-gate.ts semantics).
function fakeGate(coordinatorId: string) {
  return {
    isCoordinatorCaller: (sessionID: string) => sessionID === coordinatorId,
    isSetupCaller: () => false,
  }
}

/** Extract the JSON string from a ToolResult (string | { output: string }). */
function resultJson(r: unknown): Record<string, unknown> {
  const s = typeof r === "string" ? r : (r as { output: string }).output
  return JSON.parse(s) as Record<string, unknown>
}

const PLAN = `# Test Plan

## FE-01 — login page renders [feature]
Navigate to /login and assert the form is visible.

## BE-01 — GET /health returns 200 [sanity]
Send GET /health, expect 200.

## BE-02 — POST /orders creates an order [feature]
Send POST /orders with a valid payload, expect 201.

## BE-03 — POST /orders without auth is blocked [negative]
Send POST /orders with no token, expect 401 and no state change.
`

// No-op assignIssueIds — qa_loop_start doesn't mint QA-IDs, but the dep is required.
const noopAssignIssueIds = async ({ findings }: { findings: any[]; startAt?: number }) =>
  findings.map((f) => ({ ...f, id: "QA-000" }))

describe("qa_loop_start", () => {
  let cwd: string
  let state: QaLoopState

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "qa-loop-start-"))
    git(cwd, ["init", "-q"])
    git(cwd, ["config", "user.email", "t@t.dev"])
    git(cwd, ["config", "user.name", "t"])
    mkdirSync(join(cwd, "docs/testing/reports"), { recursive: true })
    mkdirSync(join(cwd, "docs/testing/plans"), { recursive: true })
    writeFileSync(join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"), PLAN)
    git(cwd, ["add", "-A"])
    git(cwd, ["commit", "-q", "-m", "init"])
    state = new QaLoopState()
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  it("rejects a non-coordinator caller", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("child"),
    ))
    expect(res.status).toBe("forbidden")
  })

  it("FRESH: hashes the plan, classifies, strips mutating-expected-success, captures pre-loop ref", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))

    expect(res.status).toBe("ok")
    expect(res.disposition).toBe("FRESH")
    // pre-loop ref captured and resolvable
    expect(res.pre_loop_ref).toBe(`refs/qa-loop/pre/${res.run_id as string}`)
    expect(() => git(cwd, ["rev-parse", "--verify", res.pre_loop_ref as string])).not.toThrow()

    const s = state.load("perun")!
    expect(s.plan_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(s.scenarios["FE-01"]!.kind).toBe("feature")
    expect(s.scenarios["BE-03"]!.kind).toBe("negative")
    // mutation guard: BE-02 (POST, expected success) stripped; BE-03 (negative-blocked) kept
    expect(s.scenarios["BE-02"]!.mutating).toBe(true)
    expect(s.scenarios["BE-02"]!.current).toBe("skip")
    expect(s.scenarios["BE-02"]!.reason).toMatch(/mutation-guard/)
    expect(deriveCoverage(s).not_verified["mutation-guard"]).toBe(1)
    expect(s.scenarios["BE-03"]!.current).not.toBe("skip")
    // dispatch_set excludes BE-02, includes BE-03
    expect(res.dispatch_set).toContain("BE-03")
    expect(res.dispatch_set).not.toContain("BE-02")
  })

  it("--allow-mutations keeps mutating-expected-success in the dispatch set", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md", allow_mutations: true },
      ctx("perun"),
    ))
    expect(res.dispatch_set).toContain("BE-02")
    const s = state.load("perun")!
    expect(s.scenarios["BE-02"]!.current).not.toBe("skip")
  })

  it("REUSE (cold-map cross-session): loadFromDisk finds on-disk sidecar and returns prior run state", async () => {
    // First call: FRESH — produces the on-disk sidecar.
    const tools1 = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res1 = resultJson(await tools1.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res1.disposition).toBe("FRESH")

    // Simulate a new server start: brand-new QaLoopState (cold in-process map) + new tools.
    const coldState = new QaLoopState()
    const tools2 = makeQaLoopTools({ gate: fakeGate("perun"), state: coldState, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })

    // Second call with the SAME plan + report paths — cold map, but sidecar is on disk.
    const res2 = resultJson(await tools2.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))

    expect(res2.status).toBe("ok")
    expect(res2.disposition).toBe("REUSE")

    // The tool carries over the prior run_id from the on-disk sidecar.
    expect(res2.run_id).toBe(res1.run_id)

    // The pre-loop ref points to the same git ref captured in the first run.
    expect(res2.pre_loop_ref).toBe(res1.pre_loop_ref)

    // The warm-map sidecar now holds the resumed state (saved from REUSE path).
    const resumed = coldState.load("perun")!
    expect(resumed).toBeDefined()
    // Scenario classification is preserved from the prior run (carry-over observable).
    expect(Object.keys(resumed.scenarios)).toContain("FE-01")
    expect(resumed.scenarios["BE-02"]!.current).toBe("skip")
  })

  it("ADOPT: seeds qa_id_start_at beyond the highest existing QA-N in the report", async () => {
    // Seed a report file containing QA-IDs up to QA-007 (max = 7).
    const reportPath = join(cwd, "docs/testing/reports/2026-06-26-demo-report.md")
    writeFileSync(
      reportPath,
      [
        "# QA Report",
        "",
        "## QA-001 — first issue",
        "Some content.",
        "",
        "## QA-007 — seventh issue",
        "More content.",
        "",
        "### QA-003 referenced inline",
      ].join("\n"),
    )
    // No sidecar on disk → ADOPT (not REUSE).

    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))

    expect(res.status).toBe("ok")
    expect(res.disposition).toBe("ADOPT")

    // qa_id_start_at must be max(existing)+1 = 7+1 = 8.
    expect(res.qa_id_start_at).toBe(8)
  })

  it("rejects a report_path that escapes the repo (SEC-001 containment guard)", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "/tmp/qa-loop-escape.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/within the repository/)
  })
})
