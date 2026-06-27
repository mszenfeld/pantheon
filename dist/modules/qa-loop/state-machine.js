const SEVERITY_RANK = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3
};
const STOP_PRECEDENCE = [
  "checkpoint-integrity",
  "plan-tamper",
  "regression",
  "all-deferred",
  "no-progress",
  "max-iterations",
  "max-dispatches",
  "time-budget",
  "zero-failure",
  "user-abort"
];
function resolveStopCause(fired) {
  let best;
  let bestRank = Infinity;
  for (const c of fired) {
    const rank = STOP_PRECEDENCE.indexOf(c);
    if (rank !== -1 && rank < bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}
function stillFailing(s) {
  return Object.entries(s.scenarios).filter(([, sc]) => sc.current === "fail").map(([id]) => id);
}
function stepEnter(s) {
  const failing = stillFailing(s);
  if (failing.length === 0) return { action: "final" };
  const current = s.iterations.find(
    (it) => it.n === s.budgets.iteration && it.stop_cause === null && it.phase !== "evaluated"
  );
  if (current) {
    return { action: "fix", issues: issuesFor(s, failing) };
  }
  const fired = [];
  if (s.budgets.dispatch_count_total >= s.config.max_dispatches) fired.push("max-dispatches");
  if (s.budgets.elapsed_s >= s.config.time_budget_s) fired.push("time-budget");
  s.budgets.iteration += 1;
  if (s.budgets.iteration > s.config.max_iterations) fired.push("max-iterations");
  const stop_cause = resolveStopCause(fired);
  if (stop_cause) return { action: "stop", stop_cause };
  return { action: "fix", issues: issuesFor(s, failing) };
}
function issuesFor(s, failing) {
  const floor = SEVERITY_RANK[s.config.severity_floor];
  const ids = [];
  for (const id of failing) {
    for (const qa of s.scenarios[id]?.qa_ids ?? []) {
      const iss = s.issues[qa];
      if (!iss) continue;
      if (!iss.location) continue;
      if (SEVERITY_RANK[iss.severity] < floor) continue;
      ids.push(qa);
    }
  }
  return ids;
}
function stepEvaluate(s) {
  const records = Object.values(s.scenarios);
  const regressed = records.some((sc) => sc.baseline === "pass" && sc.current === "fail");
  const newlyPassing = records.some((sc) => sc.baseline === "fail" && sc.current === "pass");
  let currentIter;
  for (let i = s.iterations.length - 1; i >= 0; i--) {
    const it = s.iterations[i];
    if (it !== void 0 && it.stop_cause === null) {
      currentIter = it;
      break;
    }
  }
  if (currentIter === void 0) {
    for (const it of s.iterations) {
      if (currentIter === void 0 || it.n > currentIter.n) currentIter = it;
    }
  }
  const attempted = currentIter?.attempted_so_far ?? [];
  const allDeferred = attempted.length > 0 && attempted.every((qa) => s.issues[qa]?.status === "deferred");
  const fired = [];
  if (regressed) fired.push("regression");
  if (allDeferred) fired.push("all-deferred");
  if (!newlyPassing) fired.push("no-progress");
  const stop_cause = resolveStopCause(fired);
  if (stop_cause) return { action: "stop", stop_cause };
  if (stillFailing(s).length === 0) return { action: "final" };
  return { action: "continue" };
}
function hasFailAtOrAboveFloor(s) {
  const floor = SEVERITY_RANK[s.config.severity_floor];
  return Object.values(s.issues).some((iss) => {
    const sc = s.scenarios[iss.scenario];
    return sc?.current === "fail" && SEVERITY_RANK[iss.severity] >= floor;
  });
}
function lastStopCause(s) {
  for (let i = s.iterations.length - 1; i >= 0; i--) {
    const it = s.iterations[i];
    if (it !== void 0 && it.stop_cause !== null) return it.stop_cause;
  }
  return null;
}
const BUDGET_CAUSES = ["max-iterations", "max-dispatches", "time-budget"];
const STOPPED_CAUSES = ["user-abort", "plan-tamper", "checkpoint-integrity"];
function resultOf(s) {
  const records = Object.values(s.scenarios);
  const anyPass = records.some((sc) => sc.current === "pass");
  const anyFail = records.some((sc) => sc.current === "fail");
  const featureScenarios = records.filter((sc) => sc.kind === "feature");
  const anyFeaturePass = featureScenarios.some((sc) => sc.current === "pass");
  const allFeaturesSkipped = featureScenarios.length > 0 && featureScenarios.every((sc) => sc.current === "skip");
  if (!hasFailAtOrAboveFloor(s) && anyFeaturePass) return "Pass";
  if (!anyPass && !anyFail) return "NotVerified";
  if (allFeaturesSkipped) return "NotVerified";
  const stop = lastStopCause(s);
  if (stop && BUDGET_CAUSES.includes(stop)) return "BudgetExhausted";
  if (stop && STOPPED_CAUSES.includes(stop)) return "Stopped";
  return "Fail";
}
export {
  resolveStopCause,
  resultOf,
  stepEnter,
  stepEvaluate
};
