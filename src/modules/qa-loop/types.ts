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
  | "zero-failure" | "regression" | "no-progress" | "all-deferred"
  | "max-iterations" | "max-dispatches" | "time-budget"
  | "user-abort" | "plan-tamper" | "checkpoint-integrity"
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
  budgets: {
    iteration: number
    dispatch_count_total: number
    elapsed_s: number
    final_pass_elapsed_s: number | null
  }
  pre_loop: { undo_ref: string; dirty: boolean; dirty_files: string[] }
  scenarios: Record<string, ScenarioRecord>
  issues: Record<string, IssueRecord>
  iterations: IterationRecord[]
  coverage: Coverage
  result: RunResult | null
}
