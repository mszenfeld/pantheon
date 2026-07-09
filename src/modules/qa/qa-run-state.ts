import type { ParsedBinding } from "./binding-parser.js"

/**
 * Maximum number of mid-run dialog rounds per QA run. After the 3rd round
 * `record_input` refuses further pastes and Perun must abort. Mirrors the
 * "max 3 rounds per QA run" rule in `src/agents/perun.md`. Enforced
 * deterministically in code so the cap holds even if the LLM miscounts.
 */
export const MAX_DIALOG_ROUNDS = 3

interface RunRecord {
  plan: ParsedBinding[]
  dialogRound: number
  /**
   * True while a dialog round is "in progress" — i.e. the user has pasted
   * at least one NAME=value pair and Perun has not yet re-dispatched
   * (signalled by the next `execute_recipe` call). Used by
   * `incrementDialogRoundOnFirstInput` to count one round per user reply
   * even when the reply carries multiple NAME=value pairs.
   */
  dialogRoundInProgress: boolean
  recipeAttempts: Map<string, number>
  /**
   * Env-var NAMES the plan declares as `**Required environment variables:**`,
   * captured from each `preflight({ env })` call for this run. A name in this
   * set is "declared in the consented plan" — the SAME authorisation basis as
   * a minted binding's `Inputs:` — so `record_input` exempts it from the
   * credential-prefix denylist. Without this a plain prerequisite like
   * `SUPABASE_URL` (declared as a Required env var, NOT a recipe input) is
   * unpasteable, contradicting the documented "paste in chat, no restart" flow.
   * See `record-input.ts` and `preflight.ts`.
   */
  declaredEnv: Set<string>
  /**
   * Operator consent to run PROVISIONING recipes for this run (bindings whose
   * `- Provisions:` field marks them as creating a principal). Default false:
   * without it, `execute_recipe` refuses a provisioning binding (an account is
   * never created without explicit consent). Set by `parse_plan({ allow_provisioning })`
   * once the user has confirmed the provisioning-consent gate. Token-minting
   * recipes (the common case) are unaffected — they carry no `provisions` marker.
   * Mirrors the qa-loop seed-consent flag (`allow_mutations`) for the recipe path.
   */
  allowProvisioning: boolean
}

/** Shared empty result for `getDeclaredEnv` on an uninitialised parent — avoids
 * allocating a throwaway Set per call. Never mutated (returned as ReadonlySet). */
const EMPTY_DECLARED_ENV: ReadonlySet<string> = new Set<string>()

function makeEmptyRecord(plan: ParsedBinding[] = []): RunRecord {
  return {
    plan,
    dialogRound: 0,
    dialogRoundInProgress: false,
    recipeAttempts: new Map(),
    declaredEnv: new Set(),
    allowProvisioning: false,
  }
}

export class QaRunState {
  readonly #map = new Map<string, RunRecord>()

  storePlan(parentID: string, bindings: ParsedBinding[]): void {
    const existing = this.#map.get(parentID)
    if (existing !== undefined) {
      existing.plan = bindings
      return
    }
    this.#map.set(parentID, makeEmptyRecord(bindings))
  }

  getBindings(parentID: string): ParsedBinding[] | undefined {
    return this.#map.get(parentID)?.plan
  }

  /**
   * Record env-var NAMES the plan declares as required (the `env` argument of a
   * `preflight` call). Merged into the run's declared-env set, which
   * `record_input` consults to exempt plan-declared prerequisites from the
   * credential-prefix denylist. Idempotent, and materialises the run record if
   * absent so a `preflight` that runs before any other state write still
   * persists (the documented flow runs preflight BEFORE the paste dialog).
   */
  addDeclaredEnv(parentID: string, names: readonly string[]): void {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    for (const name of names) r.declaredEnv.add(name)
  }

  /**
   * Names recorded via `addDeclaredEnv` for this run (an empty set when the
   * parent has no record). Read by `record_input`'s denylist exemption.
   */
  getDeclaredEnv(parentID: string): ReadonlySet<string> {
    return this.#map.get(parentID)?.declaredEnv ?? EMPTY_DECLARED_ENV
  }

  /**
   * Record operator consent to run provisioning recipes for this run. Set from
   * `parse_plan({ allow_provisioning })` after the user confirms the gate.
   * Materialises the run record if absent so consent survives an early call.
   */
  setAllowProvisioning(parentID: string, allow: boolean): void {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    r.allowProvisioning = allow
  }

  /**
   * Whether provisioning recipes are consented for this run (false when the
   * parent has no record). Read by `execute_recipe` to gate a `provisions` binding.
   */
  getAllowProvisioning(parentID: string): boolean {
    return this.#map.get(parentID)?.allowProvisioning ?? false
  }

  getDialogRound(parentID: string): number {
    return this.#map.get(parentID)?.dialogRound ?? 0
  }

  incrementDialogRound(parentID: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    r.dialogRound++
    return r.dialogRound
  }

  /**
   * Increment the dialog round counter exactly once per logical round —
   * the first `record_input` call after either run start or the previous
   * round being ended by `endDialogRound`. Subsequent calls within the
   * same round return the current counter without incrementing it.
   *
   * Returns the dialog round number the caller is now part of. Callers
   * compare against `MAX_DIALOG_ROUNDS` to decide whether to refuse the
   * write.
   */
  incrementDialogRoundOnFirstInput(parentID: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    if (!r.dialogRoundInProgress) {
      r.dialogRound++
      r.dialogRoundInProgress = true
    }
    return r.dialogRound
  }

  /**
   * Mark the current dialog round as ended. The next `record_input` call
   * will start a new round (and increment the counter). Called by
   * `execute_recipe` because re-dispatching to zmora-setup is the natural
   * signal that the round has concluded.
   *
   * No-op when no round is in progress or the parent has no state. Safe
   * to call repeatedly.
   */
  endDialogRound(parentID: string): void {
    const r = this.#map.get(parentID)
    if (r === undefined) return
    r.dialogRoundInProgress = false
  }

  getRecipeAttempts(parentID: string, bindingName: string): number {
    return this.#map.get(parentID)?.recipeAttempts.get(bindingName) ?? 0
  }

  incrementRecipeAttempt(parentID: string, bindingName: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    const next = (r.recipeAttempts.get(bindingName) ?? 0) + 1
    r.recipeAttempts.set(bindingName, next)
    return next
  }

  clearRun(parentID: string): void {
    this.#map.delete(parentID)
  }
}
