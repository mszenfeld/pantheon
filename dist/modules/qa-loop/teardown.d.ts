import { ScenarioKind } from './types.js';

/**
 * The §8 seed/teardown parsing + dispatch-classification concern, lifted out of the stateful
 * tool factory (tools.ts) into its own pure module. Everything here is a total function of its
 * input text — no I/O, no state — which is what makes it directly unit-testable (the SEC
 * literal-DSN predicate and the classify-for-dispatch truth table both get their own tests here).
 */
/**
 * The plan-declared seed marker (`**Seed (psql/sqlite3):**`). Kept intentionally
 * PERMISSIVE — a SUPERSET of what be-testing's LLM executor recognizes: a leading
 * list-marker — unordered (`- ` / `* ` / `+ `) OR ordered (`1. ` / `2) `, the plan format's
 * numbered-step form, test-plan-format §Plan Structure) — or blockquote (`> `), and
 * incidental whitespace around the marker, all still match. The consent gate must never be
 * weaker than the executor: if be-testing would run the fenced SQL (it recognizes the marker
 * semantically), this MUST catch it so the write stays consent-gated. Still rejects prose
 * that only mentions "seed" (`**Seeded rows are visible**`, `**Seed the database manually**`)
 * because the `(psql/sqlite3)` clause is required. Authors must write the byte-exact
 * canonical marker; the leniency here is defense-in-depth, not license to vary it.
 */
declare const SEED_MARKER: RegExp;
/**
 * The plan-declared un-seed marker (`**Teardown (psql/sqlite3):**`), the reversal paired with a
 * Seed/mutating scenario (§8). Same leading-marker leniency as SEED_MARKER. Its PRESENCE (with a
 * well-formed fenced block, see extractTeardown) is what makes a mutation auto-reverting — and so
 * runnable by DEFAULT on a local base URL, without allow_mutations. A bare marker with no fence
 * does not count (extractTeardown returns null → treated as no teardown → the mutation stays
 * consent-gated): a malformed reversal must never silently unlock the default.
 */
declare const TEARDOWN_MARKER: RegExp;
/**
 * True iff the plan's frontmatter `base-url:` resolves to a loopback host (§8 non-local floor).
 * Scoped to the leading YAML frontmatter block (between the first two `---` fences) so a stray
 * `base-url:` in a scenario body cannot spoof locality. No base URL, an unparseable URL, or a
 * non-loopback host all return false → the auto-revert default does NOT apply (safe: consent-gated).
 */
declare function baseUrlIsLocal(planText: string): boolean;
/**
 * Split a scenario block around its Teardown region ONCE (the span is computed a single time and
 * reused for both projections, instead of each of extractTeardown/classifyBodyExcludingTeardown
 * re-splitting and re-scanning the block). `teardown` is the marker→closing-fence text handed to
 * the zmora-be wave (or null when there is no usable teardown, see teardownSpan); `body` is the
 * block with that region excised — what classifyScenario should read.
 */
declare function splitTeardown(block: string): {
    teardown: string | null;
    body: string;
};
/**
 * The `**Teardown (psql/sqlite3):**` region (marker line through its closing fence) — exactly what
 * Perun hands to a zmora-be teardown wave — or null when there is no usable teardown (see
 * teardownSpan). The null makes the scenario "has no teardown" for classification (stays gated).
 */
declare function extractTeardown(block: string): string | null;
/**
 * The scenario block with its Teardown region excised — the body `classifyScenario` should read.
 * A teardown's blocked-phrasing comment (e.g. `-- cleanup: must not leave rows (was a 403 case)`)
 * or its DELETE verb must NOT flip a seed FEATURE to `negative` and corrupt the coverage bucket;
 * the seed now RUNS by default, so its (mis)classified kind reaches the report. No-op when there
 * is no usable teardown span.
 */
declare function classifyBodyExcludingTeardown(block: string): string;
/**
 * True iff a `**Teardown (psql/sqlite3):**` block connects via a LITERAL (non-`$VAR`) DSN — a
 * `scheme://…` target written inline instead of a plan-declared env var (§8 defense-in-depth,
 * CWE-863/306). The auto-revert local-floor is enforced on the HTTP base-url ONLY; a teardown's
 * real write egress is its DSN, which `qa_loop_start` cannot resolve when it is a `$VAR`. Rejecting
 * a LITERAL DSN host closes the gap where `base-url: http://localhost` pairs with a teardown of
 * `psql "postgres://…@prod-db/…"`. The legitimate `psql "$DATABASE_URL"` form has no inline `://`
 * so it is unaffected; `postgres://$VAR` (the rare interpolated form) is also allowed via the `$`
 * lookahead. The scan is per-line (`[^\n]*?`), so the `(psql/sqlite3)` in the marker line — which
 * has no `://` — never trips it.
 */
declare function teardownHasLiteralDsn(block: string): boolean;
/** The §8 dispatch classification of one scenario block (a pure function of the block + targets). */
interface DispatchClassification {
    kind: ScenarioKind;
    mutating: boolean;
    /** A plan-declared `**Seed (psql/sqlite3):**` fixture write is present. */
    isSeedWrite: boolean;
    /** The paired reversal region (marker→fence), or null when absent/malformed. */
    teardownBlock: string | null;
    /** The write actually LANDS: a Seed (any verb) or a non-seed mutating scenario expecting success. */
    gatedMutation: boolean;
    /** Runs by DEFAULT (no allow_mutations) because it self-reverts on a LOCAL target. */
    autoReverting: boolean;
    /** Excluded pre-dispatch by the mutation guard (gated, not auto-reverting, no consent). */
    stripped: boolean;
}
/**
 * Classify one scenario block for dispatch (§7 mutation guard + §8 auto-revert), as a pure
 * function of the block text and the run's `{ allowMutations, targetIsLocal }`. The span is
 * computed once (splitTeardown) and the Teardown region is excised before classifyScenario so a
 * teardown's DELETE verb or a "must not / 403" comment cannot flip a seed FEATURE to `negative`.
 *
 * Truth table:
 * - `gatedMutation` = isSeedWrite ∨ (mutating ∧ expectsSuccess). A negative-blocked mutation
 *   (mutating ∧ ¬expectsSuccess) is NOT gated — the write never lands (§7 AC19/AC20).
 * - `autoReverting` = gatedMutation ∧ teardown present ∧ targetIsLocal → runs by default.
 * - `stripped` = gatedMutation ∧ ¬autoReverting ∧ ¬allowMutations → excluded pre-dispatch.
 */
declare function classifyForDispatch(block: string, opts: {
    allowMutations: boolean;
    targetIsLocal: boolean;
}): DispatchClassification;

export { type DispatchClassification, SEED_MARKER, TEARDOWN_MARKER, baseUrlIsLocal, classifyBodyExcludingTeardown, classifyForDispatch, extractTeardown, splitTeardown, teardownHasLiteralDsn };
