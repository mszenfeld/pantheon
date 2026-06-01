import type { BindingsStore } from "./bindings-store.js"

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
 */
export interface PreflightHandlerDeps {
  store: BindingsStore
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
    const parentID = (await deps.resolveParentID(ctx.sessionID)) ?? ctx.sessionID

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

    return missing.length === 0 ? { status: "ok" } : { status: "missing", missing }
  }
}
