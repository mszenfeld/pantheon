import type { BindingsStore } from "./bindings-store.js"
import type { QaRunState } from "./qa-run-state.js"

/**
 * Preflight env-presence check. Verifies that the env-var names a QA plan's
 * `## Setup` declares as required are actually resolvable for the run BEFORE
 * Perun dispatches any scenario — the most common gap is a missing credential
 * / binding input (e.g. `SUPABASE_ANON_KEY`), and catching it up front avoids
 * dispatching a whole wave only to have every task return `NEED_INFO`.
 *
 * "Resolvable" mirrors `execute_recipe`'s own input resolution order: a name is
 * present if it is bound in the `BindingsStore` for this run (user-pasted via
 * `record_input`, or minted) OR set to a non-empty value in the OpenCode
 * process env (which dispatched zmora children inherit). Service / database
 * *liveness* is deliberately NOT probed here — that is left to the per-scenario
 * `NEED_INFO` backstop at dispatch time, which already distinguishes
 * `kind: "service"` (connection refused) from `kind: "credentials"`.
 *
 * This replaces the former `scripts/qa-preflight.sh` shell probe, which could
 * not run under the coordinator bash policy (the documented `printf … | …`
 * invocation is a compound command) and was never provisioned into target
 * repos — leaving Perun to write a script into the user's project.
 *
 * SIDE EFFECT — registers the requested `env` NAMES as plan-declared for this
 * run (`QaRunState.addDeclaredEnv`). These are the plan's
 * `**Required environment variables:**`; persisting them lets a subsequent
 * `record_input` accept a credential-prefixed prerequisite (e.g. `SUPABASE_URL`,
 * `DATABASE_URL`) that the user pastes in chat. Authorisation basis is the same
 * as a minted binding's `Inputs:` — "declared in the consented plan". The
 * ordering is load-bearing: the documented flow runs `preflight` (which finds
 * the names missing) BEFORE the user pastes, so the names are already
 * registered when `record_input` fires. See `record-input.ts`.
 *
 * NOTE: the "resolvable = bound in the store OR non-empty in process env;
 * liveness is NOT probed" semantics above are restated for the LLM in the
 * `preflight` tool description in `index.ts`. The two are intentionally worded
 * for different audiences (dev rationale here vs. operational instruction
 * there) — if you change this contract, update the tool description to match.
 */
export interface PreflightHandlerDeps {
  store: BindingsStore
  state: QaRunState
  resolveParentID: (sessionID: string) => Promise<string | undefined>
  processEnv: Record<string, string | undefined>
}

export interface PreflightArgs {
  /** Env-var names from the plan's `**Required environment variables:**`. */
  env: string[]
}

export type PreflightResult =
  | { status: "ok" }
  | { status: "missing"; missing: string[] }

export interface PreflightContext {
  sessionID: string
}

export function makePreflightHandler(
  deps: PreflightHandlerDeps,
): (args: PreflightArgs, ctx: PreflightContext) => Promise<PreflightResult> {
  return async (args, ctx) => {
    const parentID =
      (await deps.resolveParentID(ctx.sessionID)) ?? ctx.sessionID

    // Register the plan-declared required-env NAMES for this run so a later
    // `record_input` can exempt a credential-prefixed prerequisite the user
    // pastes (see the SIDE EFFECT note above). Done before the presence check
    // and unconditionally — the names are plan-declared whether or not they
    // happen to be resolvable right now.
    deps.state.addDeclaredEnv(parentID, args.env)

    const missing: string[] = []
    const seen = new Set<string>()
    for (const name of args.env) {
      if (seen.has(name)) continue
      seen.add(name)
      // Bound in the store for this run (user-paste or minted) → present.
      if (deps.store.getBinding(parentID, name) !== undefined) continue
      // Otherwise present only if set to a non-empty value in the process env
      // (empty string counts as missing — an exported-but-blank var is not a
      // usable credential).
      const fromEnv = deps.processEnv[name]
      if (typeof fromEnv === "string" && fromEnv.length > 0) continue
      missing.push(name)
    }

    return missing.length === 0
      ? { status: "ok" }
      : { status: "missing", missing }
  }
}
