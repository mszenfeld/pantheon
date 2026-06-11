import type { SessionAgentRegistry } from "../_shared/session-agent-registry.js"

/** The only agent permitted to call execute_recipe (the secret minter). */
export const SETUP_AGENT_KEY = "zmora-setup"

export interface CallerGateDeps {
  registry: SessionAgentRegistry
  /** The agent key permitted to call execute_recipe. Constructed as "zmora-setup" by the plugin. */
  setupAgentKey: string
}

export interface CallerGate {
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
  isSetupCaller: (sessionID: string) => boolean
  /**
   * True iff the session is NOT a dispatched specialist — the registry-negative
   * proxy for "is the coordinator (Perun)". Perun is never placed in the registry
   * (the only writer is the coordinator dispatch path, which registers children),
   * so a miss means Perun — including on Perun's turn-1, with no transcript fetch.
   *
   * Both dispatch paths register their children, so a miss is Perun ONLY:
   * the foreground `dispatch_parallel` path registers via `onSessionCreated`,
   * and the background `dispatch_background` path registers right after the
   * child session is created (see `coordinator/background.ts`). A background
   * subagent (e.g. triglav) therefore reads as its own agent and is denied
   * these three coordinator-only tools. The minter (isSetupCaller) was already
   * unaffected — it needs a positive "zmora-setup".
   */
  isCoordinatorCaller: (sessionID: string) => boolean
}

export function makeCallerGate(deps: CallerGateDeps): CallerGate {
  return {
    isSetupCaller: (sessionID) => deps.registry.lookup(sessionID) === deps.setupAgentKey,
    isCoordinatorCaller: (sessionID) => deps.registry.lookup(sessionID) === undefined,
  }
}
