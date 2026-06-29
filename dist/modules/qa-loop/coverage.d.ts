import { ScenarioKind, Coverage, Sidecar } from './types.js';

declare const COVERAGE_BUCKET: Record<ScenarioKind, keyof Coverage["exercised"]>;
/** Route a SKIP/NEED_INFO reason to a not_verified bucket (§5). `warn` flags an unrecognized reason. */
declare function routeSkip(reason: string | undefined): {
    bucket: keyof Coverage["not_verified"];
    warn: boolean;
};
/**
 * §5 coverage as a PURE PROJECTION of the current scenario states, recomputed at render time.
 * Because it derives from `s.scenarios[].current` (not an accumulator), re-ingesting the same
 * scenarios across baseline/retest/final can never inflate the counts. A mutation-guard-stripped
 * scenario lands in `current:"skip"` with a `mutation-guard` reason, so it is counted here too.
 * `routing_warnings` is the one genuinely append-only field (an event log) and is carried through
 * from the sidecar unchanged.
 */
declare function deriveCoverage(s: Sidecar): Coverage;

export { COVERAGE_BUCKET, deriveCoverage, routeSkip };
