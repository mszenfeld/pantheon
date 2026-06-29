import type { Coverage, ScenarioKind, Sidecar } from "./types.js"

export const COVERAGE_BUCKET: Record<ScenarioKind, keyof Coverage["exercised"]> = {
  feature: "feature",
  sanity: "sanity",
  negative: "enforcement",
}

/** Route a SKIP/NEED_INFO reason to a not_verified bucket (§5). `warn` flags an unrecognized reason. */
export function routeSkip(reason: string | undefined): { bucket: keyof Coverage["not_verified"]; warn: boolean } {
  const r = (reason ?? "").toLowerCase()
  if (/auth|login|token|credential|unauthor/.test(r)) return { bucket: "auth-unverified", warn: false }
  if (/mutation-guard|mutating/.test(r)) return { bucket: "mutation-guard", warn: false }
  if (/tool|playwright|psql|mysql|mongosh|redis|missing|unavailable|not installed/.test(r)) return { bucket: "tool-unavailable", warn: false }
  return { bucket: "tool-unavailable", warn: true }
}

/**
 * §5 coverage as a PURE PROJECTION of the current scenario states, recomputed at render time.
 * Because it derives from `s.scenarios[].current` (not an accumulator), re-ingesting the same
 * scenarios across baseline/retest/final can never inflate the counts. A mutation-guard-stripped
 * scenario lands in `current:"skip"` with a `mutation-guard` reason, so it is counted here too.
 * `routing_warnings` is the one genuinely append-only field (an event log) and is carried through
 * from the sidecar unchanged.
 */
export function deriveCoverage(s: Sidecar): Coverage {
  const exercised = { feature: 0, sanity: 0, enforcement: 0 }
  const not_verified = { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }
  for (const sc of Object.values(s.scenarios)) {
    if (sc.current === "skip") {
      not_verified[routeSkip(sc.reason ?? undefined).bucket]++
    } else {
      exercised[COVERAGE_BUCKET[sc.kind]]++
    }
  }
  return { exercised, not_verified, routing_warnings: s.coverage.routing_warnings }
}
