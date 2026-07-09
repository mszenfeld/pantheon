import { ScenarioKind, Coverage, Sidecar } from './types.js';

declare const COVERAGE_BUCKET: Record<ScenarioKind, keyof Coverage["exercised"]>;
/**
 * The exact reason string qa_loop_start records for a malformed-heading SKIP (a parse
 * artifact, not a real scenario). SINGLE-SOURCED here so every place that must recognise it —
 * the producer (`tools.ts` splitScenarios/qa_loop_start), the coverage-rollup exclusion
 * (`deriveCoverage` below), and the verdict exclusion (`resultOf` in state-machine.ts) — keys
 * on the identical bytes. A reword can never silently desync producer from consumers.
 */
declare const MALFORMED_HEADING_REASON = "malformed heading \u2014 no recognised prefix (expected FE-/BE-/SETUP-NN)";
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

export { COVERAGE_BUCKET, MALFORMED_HEADING_REASON, deriveCoverage, routeSkip };
