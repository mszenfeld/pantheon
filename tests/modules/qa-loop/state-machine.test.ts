import { describe, it, expect } from "vitest"
import {
  stepEnter,
  stepEvaluate,
  resultOf,
} from "../../../src/modules/qa-loop/state-machine.js"
import type { Sidecar, ScenarioRecord, IterationRecord } from "../../../src/modules/qa-loop/types.js"

function scenario(p: Partial<ScenarioRecord>): ScenarioRecord {
  return {
    qa_ids: [],
    kind: "feature",
    section: "FE",
    mutating: false,
    baseline: "pass",
    current: "pass",
    reason: null,
    ...p,
  }
}

function iter(p: Partial<IterationRecord>): IterationRecord {
  return {
    n: 1,
    phase: "selecting",
    pending: [],
    in_flight: null,
    attempted_so_far: [],
    now_passing: [],
    still_failing: [],
    stop_cause: null,
    regressions: [],
    warnings: [],
    dispatches_this_iter: 0,
    elapsed_s: 0,
    ...p,
  }
}

function base(p: Partial<Sidecar> = {}): Sidecar {
  return {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "p.md",
    plan_sha256: "h",
    report_path: "r-report.md",
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
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {},
    issues: {},
    iterations: [],
    coverage: {
      exercised: { feature: 0, sanity: 0, enforcement: 0 },
      not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 },
      routing_warnings: [],
    },
    result: null,
    ...p,
  }
}

describe("stepEnter — increment + admit iff iteration <= MAXI (§4)", () => {
  it("admits a fix-set while failures remain and iteration <= MAXI", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: {
        "QA-001": {
          severity: "HIGH", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "open", fixed_at: null,
          fix: { svarog_status: null, escalate_reason: null, child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
    })
    const r = stepEnter(s)
    expect(s.budgets.iteration).toBe(1)
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual(["QA-001"])
  })

  it("stops with max-iterations when the increment makes iteration > MAXI", () => {
    const s = base({
      budgets: { iteration: 3, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
    })
    const r = stepEnter(s)
    expect(s.budgets.iteration).toBe(4)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("max-iterations")
  })

  it("stops with max-dispatches when dispatch_count_total >= MAXD (the authoritative gate)", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 50, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("max-dispatches")
  })

  it("stops with time-budget when elapsed_s >= TB", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 1800, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("time-budget")
  })

  it("goes to final when no scenario is still failing", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "pass" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("final")
  })

  it("is idempotent on re-entry: an unfinished iteration row resumes WITHOUT a second increment", () => {
    const s = base({
      budgets: { iteration: 1, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: {
        "QA-001": {
          severity: "HIGH", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "open", fixed_at: null,
          fix: { svarog_status: null, escalate_reason: null, child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
      iterations: [iter({ n: 1, phase: "awaiting_fix_gate", pending: ["QA-001"], stop_cause: null })],
    })
    const r = stepEnter(s)
    expect(s.budgets.iteration).toBe(1) // NOT 2 — resumed, not re-entered
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual(["QA-001"])
  })

  it("resolves stop-cause by precedence when several fire (max-dispatches > time-budget)", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 50, elapsed_s: 1800, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEnter(s)
    // both budgets fired; precedence orders max-iterations/max-dispatches/time deterministically
    expect(r.stop_cause).toBe("max-dispatches")
  })
})

describe("stepEnter — §4-2a fix-set selection filter (location + severity_floor)", () => {
  function issue(p: {
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    location: string | null
    scenario: string
  }) {
    return {
      severity: p.severity,
      scenario: p.scenario,
      location: p.location,
      title: "t",
      problem: "p",
      remediation: "r",
      status: "open" as const,
      fixed_at: null,
      fix: {
        svarog_status: null,
        escalate_reason: null,
        child_session_id: null,
        checkpoint_ref: null,
        changed: [],
        hardcode_warnings: [],
      },
    }
  }

  it("includes a located issue at or above the floor", () => {
    const s = base({
      config: { ...base().config, severity_floor: "MEDIUM" },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: { "QA-001": issue({ severity: "MEDIUM", location: "src/foo.ts:10", scenario: "FE-01" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual(["QA-001"])
  })

  it("drops an issue whose location is null (Svarog can't anchor a fix)", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: { "QA-001": issue({ severity: "HIGH", location: null, scenario: "FE-01" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual([])
  })

  it("drops a sub-floor (LOW) issue when severity_floor is MEDIUM", () => {
    const s = base({
      config: { ...base().config, severity_floor: "MEDIUM" },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: { "QA-001": issue({ severity: "LOW", location: "src/bar.ts:5", scenario: "FE-01" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual([])
  })

  it("keeps MEDIUM and HIGH but drops LOW when floor is MEDIUM", () => {
    const s = base({
      config: { ...base().config, severity_floor: "MEDIUM" },
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-LOW"] }),
        "FE-02": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-MED"] }),
        "FE-03": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-HIGH"] }),
      },
      issues: {
        "QA-LOW":  issue({ severity: "LOW",    location: "src/a.ts:1", scenario: "FE-01" }),
        "QA-MED":  issue({ severity: "MEDIUM", location: "src/b.ts:2", scenario: "FE-02" }),
        "QA-HIGH": issue({ severity: "HIGH",   location: "src/c.ts:3", scenario: "FE-03" }),
      },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("fix")
    expect(r.issues).not.toContain("QA-LOW")
    expect(r.issues).toContain("QA-MED")
    expect(r.issues).toContain("QA-HIGH")
  })
})

describe("stepEvaluate — regression FIRST, then no-progress (§4)", () => {
  it("stops on regression: a baseline-pass scenario now fails", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "pass" }), // progress exists
        "BE-02": scenario({ baseline: "pass", current: "fail" }), // regression
      },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("regression")
  })

  it("regression beats no-progress when both could fire", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "fail" }), // no progress
        "BE-02": scenario({ baseline: "pass", current: "fail" }), // regression
      },
    })
    const r = stepEvaluate(s)
    expect(r.stop_cause).toBe("regression")
  })

  it("stops on no-progress when no scenario newly passes and no regression", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("no-progress")
  })

  it("continues when a scenario newly passes and nothing regressed", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "pass" }), // newly passing
        "BE-02": scenario({ baseline: "fail", current: "fail" }),
      },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("continue")
  })

  it("goes to final when all scenarios pass (zero remaining failures)", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "pass" }) },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("final")
  })

  it("all-deferred: every attempted issue is deferred → stop with all-deferred, NOT no-progress", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: {
        "QA-001": {
          severity: "HIGH", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "deferred", fixed_at: null,
          fix: { svarog_status: "ESCALATE", escalate_reason: "blocked", child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
      iterations: [iter({ n: 1, phase: "evaluated", attempted_so_far: ["QA-001"], stop_cause: null })],
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("all-deferred")
  })

  it("mixed iteration (one fix-attempted + one deferred, no newly passing) → no-progress, NOT all-deferred", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }),
        "FE-02": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-002"] }),
      },
      issues: {
        "QA-001": {
          severity: "HIGH", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "fix-attempted", fixed_at: null,
          fix: { svarog_status: "READY", escalate_reason: null, child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
        "QA-002": {
          severity: "HIGH", scenario: "FE-02", location: "f:2", title: "t",
          problem: "p", remediation: "r", status: "deferred", fixed_at: null,
          fix: { svarog_status: "ESCALATE", escalate_reason: "blocked", child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
      iterations: [iter({ n: 1, phase: "evaluated", attempted_so_far: ["QA-001", "QA-002"], stop_cause: null })],
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("no-progress")
  })

  it("regression + all-deferred both true → regression wins by precedence", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }),
        "BE-02": scenario({ baseline: "pass", current: "fail" }), // regression
      },
      issues: {
        "QA-001": {
          severity: "HIGH", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "deferred", fixed_at: null,
          fix: { svarog_status: "ESCALATE", escalate_reason: "blocked", child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
      iterations: [iter({ n: 1, phase: "evaluated", attempted_so_far: ["QA-001"], stop_cause: null })],
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("regression")
  })
})

describe("resultOf — the §4 Result mapping (order Pass > NotVerified > BudgetExhausted > Stopped > Fail)", () => {
  it("Pass: no fail >= floor AND >=1 feature-kind scenario passed", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ kind: "feature", baseline: "pass", current: "pass" }),
        "BE-02": scenario({ kind: "sanity", baseline: "pass", current: "pass" }),
      },
    })
    expect(resultOf(s)).toBe("Pass")
  })

  it("NotVerified: no scenario in a pass state", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "skip", current: "skip" }) },
    })
    expect(resultOf(s)).toBe("NotVerified")
  })

  it("NotVerified: every feature-kind scenario landed in not_verified even though sanity passes", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ kind: "feature", baseline: "skip", current: "skip" }),
        "BE-02": scenario({ kind: "sanity", baseline: "pass", current: "pass" }),
      },
    })
    expect(resultOf(s)).toBe("NotVerified")
  })

  it("Pass is checked before BudgetExhausted: a budget-stopped run whose final is green reports Pass", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "pass" }) },
      iterations: [iter({ n: 1, stop_cause: "max-dispatches" })],
    })
    expect(resultOf(s)).toBe("Pass")
  })

  it("BudgetExhausted: a budget stop whose final is NOT green", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      iterations: [iter({ n: 1, stop_cause: "time-budget" })],
    })
    expect(resultOf(s)).toBe("BudgetExhausted")
  })

  it("Stopped: a plan-tamper / checkpoint-integrity stop that is not green", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      iterations: [iter({ n: 1, stop_cause: "plan-tamper" })],
    })
    expect(resultOf(s)).toBe("Stopped")
  })

  it("Fail: a sub-floor fail with no >=floor fail still falls through to Fail", () => {
    const s = base({
      config: { ...base().config, severity_floor: "CRITICAL" },
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      issues: {
        "QA-001": {
          severity: "LOW", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "open", fixed_at: null,
          fix: { svarog_status: null, escalate_reason: null, child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
    })
    expect(resultOf(s)).toBe("Fail")
  })

  it("Fail: regression / no-progress / all-deferred terminal with nothing green", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      iterations: [iter({ n: 1, stop_cause: "regression" })],
    })
    expect(resultOf(s)).toBe("Fail")
  })
})
