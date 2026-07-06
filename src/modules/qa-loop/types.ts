export type SeverityFloor = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type Mode = "approve" | "auto" | "step"
export type ScenarioKind = "feature" | "sanity" | "negative"
export type ScenarioState = "pass" | "fail" | "skip"
export type IssueStatus = "open" | "fix-attempted" | "fix-failed" | "deferred" | "fixed"
export type SvarogStatus = "READY" | "FAIL" | "ESCALATE"
export type IterationPhase =
  | "selecting" | "awaiting_fix_gate" | "fixing"
  | "awaiting_retest_gate" | "retested" | "evaluated"
export type StopCause =
  | "regression" | "no-progress" | "all-deferred"
  | "max-iterations" | "max-dispatches" | "time-budget"
  | "plan-tamper" | "checkpoint-integrity"
export type RunResult = "Pass" | "Fail" | "BudgetExhausted" | "Stopped" | "NotVerified"

export interface ScenarioRecord {
  qa_ids: string[]
  kind: ScenarioKind
  section: "FE" | "BE" | "SETUP"
  mutating: boolean
  baseline: ScenarioState
  current: ScenarioState
  reason: string | null
}

export interface FixRecord {
  svarog_status: SvarogStatus | null
  escalate_reason: string | null
  child_session_id: string | null
  checkpoint_ref: string | null
  changed: string[]
  hardcode_warnings: string[]
}

export interface IssueRecord {
  severity: SeverityFloor
  scenario: string
  location: string | null
  title: string
  problem: string
  remediation: string
  status: IssueStatus
  fixed_at: string | null
  fix: FixRecord
}

export interface IterationRecord {
  n: number
  phase: IterationPhase
  pending: string[]
  in_flight: string | null
  attempted_so_far: string[]
  now_passing: string[]
  still_failing: string[]
  stop_cause: StopCause | null
  regressions: string[]
  warnings: string[]
  dispatches_this_iter: number
  elapsed_s: number
}

export interface Coverage {
  exercised: { feature: number; sanity: number; enforcement: number }
  not_verified: { "auth-unverified": number; "mutation-guard": number; "tool-unavailable": number }
  routing_warnings: string[]
}

export interface Sidecar {
  version: 1
  run_id: string
  plan_path: string
  plan_sha256: string
  report_path: string
  config: {
    mode: Mode
    severity_floor: SeverityFloor
    max_iterations: number
    max_dispatches: number
    time_budget_s: number
    allow_mutations: boolean
  }
  started_at: number
  updated_at: number
  finalized_at: number | null
  // True once a baseline Zmora wave has been ingested (qa_loop_ingest phase:"baseline").
  // Distinguishes a real "ran and failed" scenario state from the scaffold placeholder
  // (every non-stripped scenario initializes baseline/current:"fail" BEFORE any wave runs):
  // gates REUSE (never resume a never-baselined run into a phantom fix-phase) and `enter`
  // (never enter the fix loop before the baseline wave). Absent on pre-field on-disk
  // sidecars → read as falsy → treated as not-recorded (safe: forces a fresh baseline).
  baseline_recorded: boolean
  budgets: {
    iteration: number
    dispatch_count_total: number
    elapsed_s: number
    final_pass_elapsed_s: number | null
  }
  pre_loop: { undo_ref: string; dirty: boolean; dirty_files: string[] }
  // Recorded un-seed steps for the auto-reverting mutations that ran this loop (§8). Each
  // entry is the `**Teardown (psql/sqlite3):**` block of a scenario that mutated on a LOCAL
  // base URL and so ran by DEFAULT (no allow_mutations) BECAUSE it declared a reversal. The
  // git pre_loop ref restores FILES only — DB rows are reverted by running these blocks, which
  // qa_loop_finalize/qa_loop_undo hand back to Perun (LIFO) for a zmora-be teardown wave.
  // Absent on pre-field on-disk sidecars → read as `?? []` (safe: nothing to revert).
  teardowns: { scenario: string; block: string }[]
  scenarios: Record<string, ScenarioRecord>
  issues: Record<string, IssueRecord>
  iterations: IterationRecord[]
  coverage: Coverage
  result: RunResult | null
}
