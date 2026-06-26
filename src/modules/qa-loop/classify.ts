import type { ScenarioKind } from "./types.js"

const MUTATING_VERB = /\b(POST|PUT|PATCH|DELETE)\b/
const DB_WRITE =
  /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+\w|CREATE\s+TABLE|UPSERT|TRUNCATE)\b/i
const WRITE_STEP = /\b(create|delete|update|insert|write|mutate|persist|save)s?\b/i

// "the mutation must be blocked / rejected / denied / forbidden / 401 / 403 / 4xx, no state change"
const BLOCKED =
  /\b(reject(ed|s)?|block(ed|s)?|den(y|ied|ies)|forbidden|unauthor(ized|ised)|must\s+not|should\s+not|no\s+(state\s+change|row|change)|401|403|4\d\d\b)/i
const NEGATIVE_HINT =
  /\b(reject|block|deny|denied|forbidden|unauthor|invalid|must\s+not|should\s+not|negative)\b/i
const SANITY_HINT = /\b(smoke|sanity|baseline|health\s*check|healthcheck|ping)\b/i

/**
 * §5 kind taxonomy + §7 mutation/expected-outcome rules over a scenario's raw text block.
 *
 * - kind: `negative` (asserts a rejection/block) › `sanity` (smoke/baseline) › `feature` (default).
 * - mutating: an HTTP POST/PUT/PATCH/DELETE, an SQL write, or a write-ish step verb.
 * - expectsSuccess: false ONLY when the scenario asserts the mutation is BLOCKED (negative-blocked);
 *   the §7 mutation guard strips a scenario iff `mutating && expectsSuccess` — a negative-blocked
 *   mutating scenario stays in the dispatch set (the write never lands, AC19), while a mutating
 *   scenario expected to succeed is stripped (AC20).
 */
export function classifyScenario(block: string): {
  kind: ScenarioKind
  mutating: boolean
  expectsSuccess: boolean
} {
  const mutating =
    MUTATING_VERB.test(block) || DB_WRITE.test(block) || WRITE_STEP.test(block)

  const blocked = BLOCKED.test(block)
  let kind: ScenarioKind = "feature"
  if (NEGATIVE_HINT.test(block) || blocked) kind = "negative"
  else if (SANITY_HINT.test(block)) kind = "sanity"

  // A negative scenario asserting the mutation is blocked expects a non-2xx / no-state-change,
  // so it does NOT expect success — and is therefore exempt from the mutation-guard strip.
  const expectsSuccess = !(kind === "negative" && blocked)

  return { kind, mutating, expectsSuccess }
}
