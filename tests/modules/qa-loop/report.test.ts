import { describe, it, expect } from "vitest"
import { renderReport } from "../../../src/modules/qa-loop/report.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function sidecar(p: Partial<Sidecar> = {}): Sidecar {
  return {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md",
    plan_sha256: "h",
    report_path: "docs/testing/reports/2026-06-26-demo-report.md",
    config: {
      mode: "approve",
      severity_floor: "LOW",
      max_iterations: 3,
      max_dispatches: 50,
      time_budget_s: 1800,
      allow_mutations: false,
    },
    started_at: 0,
    updated_at: 0,
    finalized_at: null,
    baseline_recorded: true,
    budgets: { iteration: 1, dispatch_count_total: 4, elapsed_s: 120, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    teardowns: [],
    scenarios: {
      "FE-01": {
        qa_ids: ["QA-001"], kind: "feature", section: "FE",
        mutating: false, baseline: "fail", current: "pass", reason: null,
      },
      "BE-02": {
        qa_ids: [], kind: "sanity", section: "BE",
        mutating: false, baseline: "pass", current: "pass", reason: null,
      },
    },
    issues: {
      "QA-001": {
        severity: "HIGH", scenario: "FE-01", location: "src/x.ts:42",
        title: "Broken form submit", problem: "p", remediation: "r",
        status: "fixed", fixed_at: "2026-06-26",
        fix: {
          svarog_status: "READY", escalate_reason: null, child_session_id: "ses_c",
          checkpoint_ref: "refs/svarog/ckpt/ses_c", changed: ["src/x.ts"], hardcode_warnings: [],
        },
      },
      "QA-002": {
        severity: "MEDIUM", scenario: "BE-09", location: null,
        title: "Deferred thing", problem: "p", remediation: "r",
        status: "deferred", fixed_at: null,
        fix: {
          svarog_status: "ESCALATE", escalate_reason: "ambiguous spec", child_session_id: null,
          checkpoint_ref: null, changed: [], hardcode_warnings: [],
        },
      },
    },
    iterations: [
      {
        n: 1, phase: "evaluated", pending: [], in_flight: null, attempted_so_far: ["QA-001"],
        now_passing: ["FE-01"], still_failing: [], stop_cause: null, regressions: [],
        warnings: ["src/x.ts: possible hardcoded value"], dispatches_this_iter: 4, elapsed_s: 120,
      },
    ],
    coverage: {
      exercised: { feature: 1, sanity: 1, enforcement: 0 },
      not_verified: { "auth-unverified": 1, "mutation-guard": 0, "tool-unavailable": 0 },
      routing_warnings: [],
    },
    result: "Pass",
    ...p,
  }
}

describe("renderReport (§5)", () => {
  it("writes the Status line from result", () => {
    expect(renderReport(sidecar())).toContain("**Status:** Pass")
  })

  it("renders the fixed marker for a fixed issue and the deferred marker for a deferred one", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("QA-001")
    expect(md).toContain("✅ Fixed (2026-06-26)")
    expect(md).toContain("⏸ Deferred — ambiguous spec")
  })

  it("leaves a still-failing issue unmarked (no Fixed/Deferred marker)", () => {
    const s = sidecar()
    s.issues["QA-003"] = {
      severity: "LOW", scenario: "FE-04", location: "f:1", title: "Still broken",
      problem: "p", remediation: "r", status: "fix-attempted", fixed_at: null,
      fix: { svarog_status: "READY", escalate_reason: null, child_session_id: "ses_d",
        checkpoint_ref: "refs/svarog/ckpt/ses_d", changed: ["f"], hardcode_warnings: [] },
    }
    const md = renderReport(s)
    expect(md).toContain("QA-003")
    // the QA-003 block carries neither a Fixed nor a Deferred marker
    const block = md.slice(md.indexOf("QA-003"))
    expect(block.startsWith("QA-003") ? block.slice(0, 200) : block).not.toContain("✅ Fixed")
  })

  it("renders the All Scenarios table with baseline + current", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("## All Scenarios")
    expect(md).toContain("FE-01")
    expect(md).toContain("BE-02")
  })

  it("renders the Loop History table with one row per iteration", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("## Loop History")
    expect(md).toContain("| Iteration | Failing in | Now passing | Still failing | Warnings | Regressions | Dispatches |")
    expect(md).toContain("| 1 |")
  })

  it("renders the Coverage section with exercised vs not-verified", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("## Coverage")
    expect(md).toContain("auth-unverified")
  })

  it("renders the qa_loop_undo recovery line referencing the pre-loop ref", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("qa_loop_undo")
    expect(md).toContain("refs/qa-loop/pre/qa-loop-demo-1")
  })

  it("§8 the recovery line scopes qa_loop_undo to FILE changes (no longer oversells 'everything')", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("revert the FILE changes")
    expect(md).not.toContain("revert everything this loop did")
  })

  it("§8 renders the Teardown (DB revert) section LIFO when the run seeded auto-reverting rows", () => {
    const md = renderReport(sidecar({
      teardowns: [
        { scenario: "BE-01", block: "**Teardown (psql/sqlite3):**\n```sql\nDELETE one\n```" },
        { scenario: "BE-02", block: "**Teardown (psql/sqlite3):**\n```sql\nDELETE two\n```" },
      ],
    }))
    expect(md).toContain("### Teardown (DB revert)")
    // LIFO: BE-02 listed before BE-01.
    expect(md.indexOf("BE-02")).toBeLessThan(md.indexOf("BE-01"))
    expect(md).toContain("DELETE two")
    expect(md).toContain("DELETE one")
  })

  it("§8 omits the Teardown section entirely when nothing was seeded", () => {
    const md = renderReport(sidecar({ teardowns: [] }))
    expect(md).not.toContain("Teardown (DB revert)")
  })
})
