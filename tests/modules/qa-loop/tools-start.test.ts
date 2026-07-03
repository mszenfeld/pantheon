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

// Uses the documented test-plan-format heading shape: `### FE-01:` / `### BE-01:`
// (H3 + colon) under `## FE/BE Test Scenarios` sections. Classification is derived
// from the scenario BODIES (verbs / block words), not from any `[kind]` tag.
const PLAN = `# Test Plan

## FE Test Scenarios

### FE-01: login page renders
Navigate to /login and assert the form is visible.

## BE Test Scenarios

### BE-01: GET /health returns 200
Send GET /health and assert a 200 smoke response.

### BE-02: POST /orders creates an order
Send POST /orders with a valid payload, expect 201 and a new row.

### BE-03: POST /orders without auth is blocked
Send POST /orders with no token; expect 401 and no state change.
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

  it("rejects a report_path that escapes the repo (containment guard)", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "/tmp/qa-loop-escape.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/within the repository/)
  })

  it("errors loudly when the plan parses to zero scenarios (heading-format guard)", async () => {
    // A plan whose headings don't match the documented '### FE-01:' shape must NOT
    // silently return ok + [] — the caller would sail past it (the real-world failure).
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      "# Test Plan\n\n## Notes\n\nGET /health returns 200.\n",
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/0 scenarios/)
    // The guard must return BEFORE any side effects: no run_id minted and no
    // pre-loop git ref created (capturePreLoopRef is never reached on this path).
    expect(res.run_id).toBeUndefined()
    expect(git(cwd, ["for-each-ref", "--format=%(refname)", "refs/qa-loop/pre/"])).toBe("")
  })

  it("seed INSERT is gated on allow_mutations alone, even with blocked-phrasing in the block", async () => {
    // A plan-declared Seed INSERT is a fixture WRITE. A "blocked/403/no state change"
    // phrase elsewhere in the same block must NOT flip its expected-outcome and exempt
    // the write from the consent gate — without allow_mutations it must be stripped.
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      [
        "# Test Plan",
        "",
        "## BE Test Scenarios",
        "",
        "### BE-01: seeded order is visible",
        "**Seed (psql/sqlite3):**",
        "```sql",
        "INSERT INTO orders (id, status) VALUES (1, 'new');",
        "```",
        "Then GET /orders/1 and assert 200. A missing row would be a 403 with no state change.",
        "",
      ].join("\n"),
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })

    // Without consent: the seed write is stripped despite the "403 / no state change"
    // phrasing. It is the only scenario, so stripping it empties the dispatch set and the
    // loud all-stripped guard fires — proving the seed was NOT exempted by the negative
    // wording (the pre-fix bug would have kept it and returned ok with BE-01 dispatchable).
    const resNo = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(resNo.status).toBe("error")
    expect(String(resNo.reason)).toMatch(/mutation guard|allow_mutations/)

    // With consent: the seed write is dispatched.
    const state2 = new QaLoopState()
    const tools2 = makeQaLoopTools({ gate: fakeGate("perun"), state: state2, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const resYes = resultJson(await tools2.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md", allow_mutations: true },
      ctx("perun"),
    ))
    expect(resYes.status).toBe("ok")
    expect(resYes.dispatch_set).toContain("BE-01")
  })

  it("a Seed block with a NON-INSERT write verb is gated on allow_mutations alone, even with blocked-phrasing", async () => {
    // The seed-consent gate keys on the `**Seed (psql/sqlite3):**` marker ALONE, not on the
    // write verb — so UPDATE / DELETE / TRUNCATE / INSERT OR REPLACE seed writes strip under
    // the default allow_mutations:false exactly like INSERT, even when a "403 / no state
    // change" phrase elsewhere in the block would otherwise flip expectsSuccess=false. A
    // verb-keyed gate (INSERT-only) would let these destructive verbs bypass consent.
    const seeds: Record<string, string> = {
      UPDATE: "UPDATE users SET role = 'admin' WHERE id = 1;",
      DELETE: "DELETE FROM users WHERE id = 1;",
      TRUNCATE: "TRUNCATE audit_log;",
      UPSERT: "INSERT OR REPLACE INTO orders (id, status) VALUES (1, 'new');",
    }
    for (const [verb, sql] of Object.entries(seeds)) {
      writeFileSync(
        join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
        [
          "# Test Plan",
          "",
          "## BE Test Scenarios",
          "",
          `### BE-01: seeded state via ${verb}`,
          "**Seed (psql/sqlite3):**",
          "```sql",
          sql,
          "```",
          "Then GET /orders/1 and assert 200. A missing row would be a 403 with no state change.",
          "",
        ].join("\n"),
      )
      // Without consent: the seed write is stripped (only scenario → empty dispatch set → the
      // loud all-stripped guard fires). A verb-keyed gate would instead return ok with BE-01
      // dispatchable — the SEC bypass this test pins shut for every non-INSERT write verb.
      const stNo = new QaLoopState()
      const toolsNo = makeQaLoopTools({ gate: fakeGate("perun"), state: stNo, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
      const resNo = resultJson(await toolsNo.qa_loop_start.execute(
        { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
        ctx("perun"),
      ))
      expect(resNo.status, `${verb} seed must strip without consent`).toBe("error")
      expect(String(resNo.reason)).toMatch(/mutation guard|allow_mutations/)

      // With consent: the seed write is dispatched.
      const stYes = new QaLoopState()
      const toolsYes = makeQaLoopTools({ gate: fakeGate("perun"), state: stYes, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
      const resYes = resultJson(await toolsYes.qa_loop_start.execute(
        { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md", allow_mutations: true },
        ctx("perun"),
      ))
      expect(resYes.status, `${verb} seed must dispatch with consent`).toBe("ok")
      expect(resYes.dispatch_set).toContain("BE-01")
    }
  })

  it("a Seed marker VARIANT (list-dash prefix / incidental whitespace) is still consent-gated, even with blocked-phrasing", async () => {
    // The consent gate must be a SUPERSET of be-testing's semantic marker recognition: a
    // list-dash-prefixed or whitespace-variant `**Seed (psql/sqlite3):**` marker that the LLM
    // executor would run must ALSO strip under the default allow_mutations:false. A byte-exact
    // gate would miss these variants and dispatch a destructive write unguarded.
    const variants: Record<string, string> = {
      "list-dash prefix": "- **Seed (psql/sqlite3):**",
      "asterisk bullet": "* **Seed (psql/sqlite3):**",
      "blockquote prefix": "> **Seed (psql/sqlite3):**",
      "double space": "**Seed  (psql/sqlite3):**",
      "no space": "**Seed(psql/sqlite3):**",
      "spaces around slash": "**Seed (psql / sqlite3):**",
    }
    for (const [label, marker] of Object.entries(variants)) {
      writeFileSync(
        join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
        [
          "# Test Plan",
          "",
          "## BE Test Scenarios",
          "",
          `### BE-01: seeded state via ${label}`,
          marker,
          "```sql",
          "DELETE FROM users WHERE id = 1;",
          "```",
          "Then GET /users/1 and assert 401 with no state change.",
          "",
        ].join("\n"),
      )
      // Variant marker + blocked phrasing must strip (only scenario → empty dispatch →
      // all-stripped guard fires). A byte-exact gate would return ok with BE-01 dispatchable.
      const st = new QaLoopState()
      const tools = makeQaLoopTools({ gate: fakeGate("perun"), state: st, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
      const resNo = resultJson(await tools.qa_loop_start.execute(
        { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
        ctx("perun"),
      ))
      expect(resNo.status, `${label} seed must strip without consent`).toBe("error")
      expect(String(resNo.reason)).toMatch(/mutation guard|allow_mutations/)
    }
  })

  it("a bold 'Seed…' PROSE assertion (no psql/sqlite3 clause) is NOT treated as a seed write", async () => {
    // The permissive marker must not over-match prose that merely mentions seeding. A
    // read-only scenario asserting `**Seeded rows are visible**` carries no fixture write, so
    // it must dispatch normally — never be silently stripped as a phantom seed.
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      [
        "# Test Plan",
        "",
        "## BE Test Scenarios",
        "",
        "### BE-01: seeded rows are readable",
        "**Seeded rows are visible**",
        "Send GET /orders/1 and assert a 200 response with the row present.",
        "",
      ].join("\n"),
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    expect(res.dispatch_set).toContain("BE-01")
    expect(state.load("perun")!.scenarios["BE-01"]!.current).not.toBe("skip")
  })

  it("errors with a HEADING diagnosis (not allow_mutations) when every heading is malformed", async () => {
    // An all-malformed plan yields a non-empty scenarios map but an empty dispatch set. The
    // general all-stripped guard would misattribute this to the mutation guard and advise
    // `allow_mutations` — which cannot help (malformed blocks never dispatch). The dedicated
    // guard must instead name the heading-format problem.
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      [
        "# Test Plan",
        "",
        "## BE Test Scenarios",
        "",
        "### BE-01a: typo suffix heading",
        "Send GET /health and assert 200.",
        "",
        "### FE-02x: another typo heading",
        "Open /dashboard and assert it renders.",
        "",
      ].join("\n"),
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/heading|recognised prefix/)
    // Must NOT misdirect the operator to a flag that cannot fix a heading typo.
    expect(String(res.reason)).not.toMatch(/allow_mutations/)
  })

  it("a suffixed heading (### FE-01a) is surfaced standalone, not merged into the previous scenario", async () => {
    // The malformed heading must NOT absorb the prior scenario's tail. It becomes its own
    // id-carrying block; the trailing content ('blocked' phrasing) stays out of the seed block.
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      [
        "# Test Plan",
        "",
        "## BE Test Scenarios",
        "",
        "### BE-01: GET /health returns 200",
        "Send GET /health and assert a 200 smoke response.",
        "",
        "### BE-02a: malformed suffix heading",
        "Send POST /orders with no token; expect 401 and no state change.",
        "",
      ].join("\n"),
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("ok")
    const s = state.load("perun")!
    // The well-formed BE-01 stays classified as a sanity smoke (its body was not
    // polluted by the malformed heading's 'blocked/401/no state change' tail).
    expect(s.scenarios["BE-01"]!.kind).toBe("sanity")
    // The malformed heading is present as its own scenario key (surfaced, not swallowed).
    expect(Object.keys(s.scenarios)).toContain("BE-02A")
    // ...but it is recorded as a visible SKIP with a "no recognised prefix" reason and is
    // NEVER dispatched — recording it as `fail` would keep stillFailing() non-empty forever
    // (no Zmora wave ever ingests it), so the loop could never reach `final` and the run
    // verdict/coverage would corrupt. Only the well-formed BE-01 is dispatched.
    expect(s.scenarios["BE-02A"]!.current).toBe("skip")
    expect(s.scenarios["BE-02A"]!.baseline).toBe("skip")
    expect(s.scenarios["BE-02A"]!.reason).toMatch(/no recognised prefix/)
    expect(res.dispatch_set).not.toContain("BE-02A")
    expect(res.dispatch_set).toContain("BE-01")
  })

  it("errors loudly when every scenario is stripped by the mutation guard", async () => {
    // All scenarios mutating-expected-success → empty dispatch set without allow_mutations.
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      "# Test Plan\n\n## BE Test Scenarios\n\n### BE-01: POST /orders creates an order\nSend POST /orders with a valid payload, expect 201 and a new row.\n\n### BE-02: PUT /orders/1 updates an order\nSend PUT /orders/1 with a valid payload, expect 200.\n",
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/mutation guard|allow_mutations/)
    // The guard must return BEFORE any side effects: no run_id minted and no
    // pre-loop git ref created (capturePreLoopRef is never reached on this path).
    expect(res.run_id).toBeUndefined()
    expect(git(cwd, ["for-each-ref", "--format=%(refname)", "refs/qa-loop/pre/"])).toBe("")
  })

  it("collapses case/duplicate malformed headings to ONE id and still gives the heading diagnosis", async () => {
    // Two malformed headings that normalize to the SAME id (### BE-01a / ### BE-01A → BE-01A)
    // dedupe in the keyed scenarios map. The heading diagnosis must key on the recorded
    // reasons (no mutation strips), not a block counter, so a block-vs-key count mismatch
    // can't drop it back to the misleading allow_mutations message.
    writeFileSync(
      join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"),
      [
        "# Test Plan",
        "",
        "## BE Test Scenarios",
        "",
        "### BE-01a: typo suffix heading",
        "Send GET /health and assert 200.",
        "",
        "### BE-01A: same id different case",
        "Send GET /status and assert 200.",
        "",
      ].join("\n"),
    )
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssignIssueIds })
    const res = resultJson(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      ctx("perun"),
    ))
    expect(res.status).toBe("error")
    expect(String(res.reason)).toMatch(/heading|recognised prefix/)
    // Still must NOT misdirect to allow_mutations despite the block-vs-key count mismatch.
    expect(String(res.reason)).not.toMatch(/allow_mutations/)
  })
})
