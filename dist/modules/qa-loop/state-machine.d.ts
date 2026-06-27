import { StopCause, Sidecar, RunResult } from './types.js';

/** Deterministic max over fired causes by the §4 precedence (lower index = higher precedence). */
declare function resolveStopCause(fired: StopCause[]): StopCause | undefined;
/**
 * §4 step 2.0 (enter). Idempotent on re-entry: if the current iteration row exists with
 * stop_cause=null and phase not yet `evaluated`, resume it WITHOUT a second increment
 * (so MAXI is never miscounted). Otherwise increment `iteration` first, then admit the body
 * IFF `iteration <= MAXI` (post-increment) AND a budget hasn't fired. Returns the fix-set,
 * a stop (with the precedence-resolved cause), or `final` when nothing is still failing.
 */
declare function stepEnter(s: Sidecar): {
    action: "fix" | "stop" | "final";
    issues?: string[];
    stop_cause?: StopCause;
};
/**
 * §4 step 2f (evaluate). No increment. Regression is checked FIRST (a scenario that passed
 * baseline now fails ⇒ stop), THEN all-deferred (every issue attempted this iteration returned
 * ESCALATE/deferred — more informative than no-progress per §4 AC6+AC15), THEN no-progress
 * (no scenario newly passes ⇒ stop). All are collected and resolved by precedence so regression
 * wins when both regression and all-deferred fire, and all-deferred wins over no-progress when
 * the entire attempted set is deferred. `final` when zero scenarios still fail; otherwise `continue`.
 */
declare function stepEvaluate(s: Sidecar): {
    action: "continue" | "stop" | "final";
    stop_cause?: StopCause;
};
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
declare function resultOf(s: Sidecar): RunResult;

export { resolveStopCause, resultOf, stepEnter, stepEvaluate };
