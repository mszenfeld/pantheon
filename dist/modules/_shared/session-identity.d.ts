import { PluginInput } from '@opencode-ai/plugin';

type Client = PluginInput["client"];
/** The agent identifier the coordinator (Perun) session runs under. */
declare const COORDINATOR_AGENT_NAME = "Perun - Coordinator";
/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
declare function getSessionAgent(sessionID: string, client: Client): Promise<string | undefined>;
/**
 * Memoized variant of {@link getSessionAgent}. Resolved identities are cached
 * forever; unresolved identities are only suppressed briefly after repeated
 * misses so a late-resolving first turn remains retryable.
 */
declare function getSessionAgentCached(sessionID: string, client: Client): Promise<string | undefined>;
/** Evict all session identity bookkeeping on session teardown. */
declare function forgetSessionAgent(sessionID: string): void;
/** True only when the session is positively identified as the coordinator. */
declare function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean>;

export { COORDINATOR_AGENT_NAME, forgetSessionAgent, getSessionAgent, getSessionAgentCached, isCoordinatorSession };
