import { createHash } from "node:crypto"

/**
 * sha256 hex of the raw plan text. In-process (node:crypto) — never `shasum`,
 * because the qa-loop tools hash but the coordinator (Perun) never shells (§3 D4).
 * Used for §5 idempotency (REUSE/ADOPT/FRESH) and the §4 step-2.0 mid-run tamper guard.
 */
export function hashPlan(planText: string): string {
  return createHash("sha256").update(planText, "utf8").digest("hex")
}
