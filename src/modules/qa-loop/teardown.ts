import type { ScenarioKind } from "./types.js"
import { classifyScenario } from "./classify.js"

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
export const SEED_MARKER =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Seed\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im

/**
 * The plan-declared un-seed marker (`**Teardown (psql/sqlite3):**`), the reversal paired with a
 * Seed/mutating scenario (§8). Same leading-marker leniency as SEED_MARKER. Its PRESENCE (with a
 * well-formed fenced block, see extractTeardown) is what makes a mutation auto-reverting — and so
 * runnable by DEFAULT on a local base URL, without allow_mutations. A bare marker with no fence
 * does not count (extractTeardown returns null → treated as no teardown → the mutation stays
 * consent-gated): a malformed reversal must never silently unlock the default.
 */
export const TEARDOWN_MARKER =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Teardown\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im

// Loopback hosts we treat as the operator's own machine. The auto-reverting-mutation DEFAULT (§8)
// applies ONLY here: a shared/staging/prod target (any other host) never auto-mutates — it keeps
// the explicit allow_mutations gate so a seed+teardown can't silently churn rows in a DB other
// people share. `::1`/bracketed IPv6 is normalized (brackets stripped) before the check. `0.0.0.0`
// is deliberately EXCLUDED — as a client destination it is the unspecified address, not loopback.
// NOTE (§8 residual): this gates the HTTP base-url only; a seed's WRITE egress is its declared DSN
// (a `$VAR` unknowable here), so the auto-revert heads-up must NAME that DSN — see perun.md. The
// teardownHasLiteralDsn predicate below closes the narrow case where a literal DSN is inline.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

/**
 * True iff the plan's frontmatter `base-url:` resolves to a loopback host (§8 non-local floor).
 * Scoped to the leading YAML frontmatter block (between the first two `---` fences) so a stray
 * `base-url:` in a scenario body cannot spoof locality. No base URL, an unparseable URL, or a
 * non-loopback host all return false → the auto-revert default does NOT apply (safe: consent-gated).
 */
export function baseUrlIsLocal(planText: string): boolean {
  // Read base-url ONLY from the leading YAML frontmatter. Fail closed: no frontmatter fence →
  // not provably local → false, so a `base-url:` line planted in a scenario body cannot spoof
  // locality and unlock the auto-revert default off-loopback.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(planText)
  if (!fm) return false
  const m = /^base-url:\s*(.+)$/im.exec(fm[1]!)
  if (!m) return false
  const raw = m[1]!.trim().replace(/^["']|["']$/g, "")
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "")
    return LOCAL_HOSTS.has(host)
  } catch {
    return false
  }
}

/**
 * Locate a scenario's `**Teardown (psql/sqlite3):**` region as a [start, end] line span (marker
 * line → its closing fence). The opening fence MUST be the first non-blank line after the marker:
 * a bare marker whose next non-blank line is prose or another field (`**DB Check:**`, a step) has
 * NO usable teardown. Without this bound the forward scan would adopt an UNRELATED later fence —
 * e.g. a `**DB Check:**` SELECT — which both (a) silently unlocks the auto-revert default for a
 * seed with no real reversal AND (b) records a read-only SELECT as the "teardown" the finalize
 * wave runs, so `qa_loop_finalize` reports "seeds reverted" while the row persists. Returns null
 * for absent marker / no immediate fence / unterminated fence.
 */
function teardownSpan(lines: string[]): { start: number; end: number } | null {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (TEARDOWN_MARKER.test(lines[i]!)) { start = i; break }
  }
  if (start === -1) return null
  let k = start + 1
  while (k < lines.length && lines[k]!.trim() === "") k++ // only blank lines may intervene
  if (k >= lines.length || !/^\s*```/.test(lines[k]!)) return null // no fence immediately after marker
  let end = k + 1
  while (end < lines.length && !/^\s*```\s*$/.test(lines[end]!)) end++
  if (end >= lines.length) return null // unterminated fence → reject
  return { start, end }
}

/**
 * Split a scenario block around its Teardown region ONCE (the span is computed a single time and
 * reused for both projections, instead of each of extractTeardown/classifyBodyExcludingTeardown
 * re-splitting and re-scanning the block). `teardown` is the marker→closing-fence text handed to
 * the zmora-be wave (or null when there is no usable teardown, see teardownSpan); `body` is the
 * block with that region excised — what classifyScenario should read.
 */
export function splitTeardown(block: string): { teardown: string | null; body: string } {
  const lines = block.split("\n")
  const span = teardownSpan(lines)
  if (!span) return { teardown: null, body: block }
  return {
    teardown: lines.slice(span.start, span.end + 1).join("\n").trim(),
    body: [...lines.slice(0, span.start), ...lines.slice(span.end + 1)].join("\n"),
  }
}

/**
 * The `**Teardown (psql/sqlite3):**` region (marker line through its closing fence) — exactly what
 * Perun hands to a zmora-be teardown wave — or null when there is no usable teardown (see
 * teardownSpan). The null makes the scenario "has no teardown" for classification (stays gated).
 */
export function extractTeardown(block: string): string | null {
  return splitTeardown(block).teardown
}

/**
 * The scenario block with its Teardown region excised — the body `classifyScenario` should read.
 * A teardown's blocked-phrasing comment (e.g. `-- cleanup: must not leave rows (was a 403 case)`)
 * or its DELETE verb must NOT flip a seed FEATURE to `negative` and corrupt the coverage bucket;
 * the seed now RUNS by default, so its (mis)classified kind reaches the report. No-op when there
 * is no usable teardown span.
 */
export function classifyBodyExcludingTeardown(block: string): string {
  return splitTeardown(block).body
}

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
export function teardownHasLiteralDsn(block: string): boolean {
  return /(?:psql|sqlite3)\b[^\n]*?\b[a-z][a-z0-9+.-]*:\/\/(?!\s*\$)/i.test(block)
}

/** The §8 dispatch classification of one scenario block (a pure function of the block + targets). */
export interface DispatchClassification {
  kind: ScenarioKind
  mutating: boolean
  /** A plan-declared `**Seed (psql/sqlite3):**` fixture write is present. */
  isSeedWrite: boolean
  /** The paired reversal region (marker→fence), or null when absent/malformed. */
  teardownBlock: string | null
  /** The write actually LANDS: a Seed (any verb) or a non-seed mutating scenario expecting success. */
  gatedMutation: boolean
  /** Runs by DEFAULT (no allow_mutations) because it self-reverts on a LOCAL target. */
  autoReverting: boolean
  /** Excluded pre-dispatch by the mutation guard (gated, not auto-reverting, no consent). */
  stripped: boolean
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
export function classifyForDispatch(
  block: string,
  opts: { allowMutations: boolean; targetIsLocal: boolean },
): DispatchClassification {
  const isSeedWrite = SEED_MARKER.test(block)
  const { teardown, body } = splitTeardown(block)
  const { kind, mutating, expectsSuccess } = classifyScenario(body)
  const gatedMutation = isSeedWrite || (mutating && expectsSuccess)
  const autoReverting = gatedMutation && teardown !== null && opts.targetIsLocal
  const stripped = gatedMutation && !autoReverting && !opts.allowMutations
  return {
    kind: kind as ScenarioKind,
    mutating,
    isSeedWrite,
    teardownBlock: teardown,
    gatedMutation,
    autoReverting,
    stripped,
  }
}
