import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';

/** The only agent permitted to call execute_recipe (the secret minter). */
declare const SETUP_AGENT_KEY = "zmora-setup";
interface CallerGateDeps {
    registry: SessionAgentRegistry;
    /** The agent key permitted to call execute_recipe. Constructed as "zmora-setup" by the plugin. */
    setupAgentKey: string;
}
interface CallerGate {
    /**
     * True iff the session is the dispatched zmora-setup child — the only secret
     * minter. Registry-positive, fail-closed: a miss (e.g. server restart lost the
     * in-memory registry) denies, which loses nothing since the run's BindingsStore
     * is equally gone on restart.
     *
     * NOTE: this is STRICTER than the shell.env hook, which allows any `zmora-*`
     * (shell-env-hook.ts). execute_recipe is zmora-setup ONLY — keep the two
     * policies from silently converging as new zmora variants are added.
     */
    isSetupCaller: (sessionID: string) => boolean;
    /**
     * True iff the session is NOT a dispatched specialist — the registry-negative
     * proxy for "is the coordinator (Perun)". Perun is never placed in the registry
     * (the only writer is the coordinator dispatch path, which registers children),
     * so a miss means Perun — including on Perun's turn-1, with no transcript fetch.
     *
     * Residual (accepted, see spec §1): background-dispatched subagents (triglav)
     * are not registered either, so they also read as coordinator for these three
     * lower-risk tools. The minter (isSetupCaller) is unaffected — it needs a
     * positive "zmora-setup".
     */
    isCoordinatorCaller: (sessionID: string) => boolean;
}
declare function makeCallerGate(deps: CallerGateDeps): CallerGate;

export { type CallerGate, type CallerGateDeps, SETUP_AGENT_KEY, makeCallerGate };
