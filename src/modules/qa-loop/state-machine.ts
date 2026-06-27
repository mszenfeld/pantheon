import type { ScenarioRecord, Sidecar, StopCause, RunResult, SeverityFloor, IterationRecord } from "./types.js"

const SEVERITY_RANK: Record<SeverityFloor, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

// §4 stop-cause precedence, top first. The tool resolves to the single highest-precedence
// cause that ACTUALLY FIRED via a deterministic max over this order — NOT control-flow order.
const STOP_PRECEDENCE: StopCause[] = [
  "checkpoint-integrity",
  "plan-tamper",
  "regression",
  "all-deferred",
  "no-progress",
  "max-iterations",
  "max-dispatches",
  "time-budget",
  "zero-failure",
  "user-abort",
]

/** Deterministic max over fired causes by the §4 precedence (lower index = higher precedence). */
export function resolveStopCause(fired: StopCause[]): StopCause | undefined {
  let best: StopCause | undefined
  let bestRank = Infinity
  for (const c of fired) {
    const rank = STOP_PRECEDENCE.indexOf(c)
    if (rank !== -1 && rank < bestRank) {
      best = c
      bestRank = rank
    }
  }
  return best
}

function stillFailing(s: Sidecar): string[] {
  return Object.entries(s.scenarios)
    .filter(([, sc]) => sc.current === "fail")
    .map(([id]) => id)
}

/**
 * §4 step 2.0 (enter). Idempotent on re-entry: if the current iteration row exists with
 * stop_cause=null and phase not yet `evaluated`, resume it WITHOUT a second increment
 * (so MAXI is never miscounted). Otherwise increment `iteration` first, then admit the body
 * IFF `iteration <= MAXI` (post-increment) AND a budget hasn't fired. Returns the fix-set,
 * a stop (with the precedence-resolved cause), or `final` when nothing is still failing.
 */
export function stepEnter(s: Sidecar): {
  action: "fix" | "stop" | "final"
  issues?: string[]
  stop_cause?: StopCause
} {
  const failing = stillFailing(s)
  if (failing.length === 0) return { action: "final" }

  // Idempotent re-entry: an unfinished row for the CURRENT iteration resumes in place.
  const current = s.iterations.find(
    (it) => it.n === s.budgets.iteration && it.stop_cause === null && it.phase !== "evaluated",
  )
  if (current) {
    return { action: "fix", issues: issuesFor(s, failing) }
  }

  // Fresh entry: budgets are TRUE ceilings checked at the boundary (dispatch_count_total
  // is the authoritative MAXD gate). Collect every fired cause, resolve by precedence.
  const fired: StopCause[] = []
  if (s.budgets.dispatch_count_total >= s.config.max_dispatches) fired.push("max-dispatches")
  if (s.budgets.elapsed_s >= s.config.time_budget_s) fired.push("time-budget")

  s.budgets.iteration += 1
  if (s.budgets.iteration > s.config.max_iterations) fired.push("max-iterations")

  const stop_cause = resolveStopCause(fired)
  if (stop_cause) return { action: "stop", stop_cause }

  return { action: "fix", issues: issuesFor(s, failing) }
}

/**
 * §4 step 2a selection: QA-IDs attached to the still-failing scenarios, filtered to keep only
 * issues that (a) have a non-null, non-empty location (Svarog can't anchor a fix without one)
 * and (b) meet or exceed the configured severity_floor.
 */
function issuesFor(s: Sidecar, failing: string[]): string[] {
  const floor = SEVERITY_RANK[s.config.severity_floor]
  const ids: string[] = []
  for (const id of failing) {
    for (const qa of s.scenarios[id]?.qa_ids ?? []) {
      const iss = s.issues[qa]
      if (!iss) continue
      if (!iss.location) continue
      if (SEVERITY_RANK[iss.severity] < floor) continue
      ids.push(qa)
    }
  }
  return ids
}

/**
 * §4 step 2f (evaluate). No increment. Regression is checked FIRST (a scenario that passed
 * baseline now fails ⇒ stop), THEN all-deferred (every issue attempted this iteration returned
 * ESCALATE/deferred — more informative than no-progress per §4 AC6+AC15), THEN no-progress
 * (no scenario newly passes ⇒ stop). All are collected and resolved by precedence so regression
 * wins when both regression and all-deferred fire, and all-deferred wins over no-progress when
 * the entire attempted set is deferred. `final` when zero scenarios still fail; otherwise `continue`.
 */
export function stepEvaluate(s: Sidecar): {
  action: "continue" | "stop" | "final"
  stop_cause?: StopCause
} {
  const records = Object.values(s.scenarios)
  const regressed = records.some((sc) => sc.baseline === "pass" && sc.current === "fail")
  const newlyPassing = records.some((sc) => sc.baseline === "fail" && sc.current === "pass")

  // Derive the current iteration row: last row with stop_cause === null, else highest n.
  let currentIter: IterationRecord | undefined
  for (let i = s.iterations.length - 1; i >= 0; i--) {
    const it = s.iterations[i]
    if (it !== undefined && it.stop_cause === null) { currentIter = it; break }
  }
  if (currentIter === undefined) {
    for (const it of s.iterations) {
      if (currentIter === undefined || it.n > currentIter.n) currentIter = it
    }
  }
  const attempted = currentIter?.attempted_so_far ?? []
  const allDeferred =
    attempted.length > 0 && attempted.every((qa) => s.issues[qa]?.status === "deferred")

  const fired: StopCause[] = []
  if (regressed) fired.push("regression")
  if (allDeferred) fired.push("all-deferred")
  if (!newlyPassing) fired.push("no-progress")

  const stop_cause = resolveStopCause(fired)
  if (stop_cause) return { action: "stop", stop_cause }

  if (stillFailing(s).length === 0) return { action: "final" }
  return { action: "continue" }
}

function hasFailAtOrAboveFloor(s: Sidecar): boolean {
  const floor = SEVERITY_RANK[s.config.severity_floor]
  return Object.values(s.issues).some((iss) => {
    const sc = s.scenarios[iss.scenario]
    return sc?.current === "fail" && SEVERITY_RANK[iss.severity] >= floor
  })
}

function lastStopCause(s: Sidecar): StopCause | null {
  for (let i = s.iterations.length - 1; i >= 0; i--) {
    const it = s.iterations[i]
    if (it !== undefined && it.stop_cause !== null) return it.stop_cause
  }
  return null
}

const BUDGET_CAUSES: StopCause[] = ["max-iterations", "max-dispatches", "time-budget"]
const STOPPED_CAUSES: StopCause[] = ["user-abort", "plan-tamper", "checkpoint-integrity"]

/**
 * §4 Result mapping, computed once (identical at the Phase-1 zero-failure exit and the Phase-3
 * final). Order is load-bearing: Pass > NotVerified > BudgetExhausted > Stopped > Fail.
 * - Pass: no fail >= floor AND >=1 feature-kind scenario PASSED (the final run is authoritative,
 *   so this is checked BEFORE BudgetExhausted — a budget-stopped run with a green final is Pass).
 * - NotVerified: no scenario is in a pass state AND none are in a fail state (all skipped/
 *   unexercised), OR every feature-kind scenario is in the "skip" (not_verified) state even
 *   though non-feature scenarios may have passed.
 * - BudgetExhausted: stopped on a budget cause and the final is not green.
 * - Stopped: user-abort / plan-tamper / checkpoint-integrity, not green.
 * - Fail: everything else (regression / no-progress / all-deferred / sub-floor failures /
 *   nothing left to fix).
 */
export function resultOf(s: Sidecar): RunResult {
  const records = Object.values(s.scenarios)
  const anyPass = records.some((sc) => sc.current === "pass")
  const anyFail = records.some((sc) => sc.current === "fail")
  const featureScenarios = records.filter((sc) => sc.kind === "feature")
  const anyFeaturePass = featureScenarios.some((sc) => sc.current === "pass")
  const allFeaturesSkipped =
    featureScenarios.length > 0 && featureScenarios.every((sc) => sc.current === "skip")

  if (!hasFailAtOrAboveFloor(s) && anyFeaturePass) return "Pass"

  // No-pass-state AND no-fail-state (all scenarios skipped/unexercised) → NotVerified (AC13).
  if (!anyPass && !anyFail) return "NotVerified"
  // Every feature-kind scenario unexercised (not_verified) even if sanity passed → NotVerified (AC16).
  if (allFeaturesSkipped) return "NotVerified"

  const stop = lastStopCause(s)
  if (stop && BUDGET_CAUSES.includes(stop)) return "BudgetExhausted"
  if (stop && STOPPED_CAUSES.includes(stop)) return "Stopped"
  return "Fail"
}
