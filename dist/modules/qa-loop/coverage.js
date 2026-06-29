const COVERAGE_BUCKET = {
  feature: "feature",
  sanity: "sanity",
  negative: "enforcement"
};
function routeSkip(reason) {
  const r = (reason ?? "").toLowerCase();
  if (/auth|login|token|credential|unauthor/.test(r)) return { bucket: "auth-unverified", warn: false };
  if (/mutation-guard|mutating/.test(r)) return { bucket: "mutation-guard", warn: false };
  if (/tool|playwright|psql|mysql|mongosh|redis|missing|unavailable|not installed/.test(r)) return { bucket: "tool-unavailable", warn: false };
  return { bucket: "tool-unavailable", warn: true };
}
function deriveCoverage(s) {
  const exercised = { feature: 0, sanity: 0, enforcement: 0 };
  const not_verified = { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 };
  for (const sc of Object.values(s.scenarios)) {
    if (sc.current === "skip") {
      not_verified[routeSkip(sc.reason ?? void 0).bucket]++;
    } else {
      exercised[COVERAGE_BUCKET[sc.kind]]++;
    }
  }
  return { exercised, not_verified, routing_warnings: s.coverage.routing_warnings };
}
export {
  COVERAGE_BUCKET,
  deriveCoverage,
  routeSkip
};
