import { BindingsStore } from './bindings-store.js';
import './secret.js';

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
 * NOTE: the "resolvable = bound in the store OR non-empty in process env;
 * liveness is NOT probed" semantics above are restated for the LLM in the
 * `preflight` tool description in `index.ts`. The two are intentionally worded
 * for different audiences (dev rationale here vs. operational instruction
 * there) — if you change this contract, update the tool description to match.
 */
interface PreflightHandlerDeps {
    store: BindingsStore;
    resolveParentID: (sessionID: string) => Promise<string | undefined>;
    processEnv: Record<string, string | undefined>;
}
interface PreflightArgs {
    /** Env-var names from the plan's `**Required environment variables:**`. */
    env: string[];
}
type PreflightResult = {
    status: "ok";
} | {
    status: "missing";
    missing: string[];
};
interface PreflightContext {
    sessionID: string;
}
declare function makePreflightHandler(deps: PreflightHandlerDeps): (args: PreflightArgs, ctx: PreflightContext) => Promise<PreflightResult>;

export { type PreflightArgs, type PreflightContext, type PreflightHandlerDeps, type PreflightResult, makePreflightHandler };
