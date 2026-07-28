import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

/** The agent identifier the coordinator (Perun) session runs under. */
export const COORDINATOR_AGENT_NAME = "Perun - Coordinator"

/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
export async function getSessionAgent(
  sessionID: string,
  client: Client,
): Promise<string | undefined> {
  try {
    const res = await client.session.messages({ path: { id: sessionID } })
    const msgs = res.data ?? []
    const firstUser = msgs.find((m) => m.info?.role === "user")?.info as
      | { agent?: string }
      | undefined
    return firstUser?.agent
  } catch {
    return undefined
  }
}

/** Module-level cache of resolved session→agent identities, keyed by sessionID. */
const sessionAgentCache = new Map<string, string>()

/** Coalesces concurrent identity lookups for the same session. */
const inFlight = new Map<string, Promise<string | undefined>>()

/** Consecutive unresolved attempts before enabling the short negative cache. */
const NEGATIVE_CACHE_AFTER_MISSES = 3

/** Keep misses retryable in case a first-turn identity becomes available late. */
const NEGATIVE_CACHE_TTL_MS = 5_000

/** Per-session miss bookkeeping backing the negative cache. */
const missCounts = new Map<string, number>()
const negativeCacheUntil = new Map<string, number>()

/**
 * Memoized variant of {@link getSessionAgent}. Resolved identities are cached
 * forever; unresolved identities are only suppressed briefly after repeated
 * misses so a late-resolving first turn remains retryable.
 */
export async function getSessionAgentCached(
  sessionID: string,
  client: Client,
): Promise<string | undefined> {
  const cached = sessionAgentCache.get(sessionID)
  if (cached !== undefined) return cached

  const suppressUntil = negativeCacheUntil.get(sessionID)
  if (suppressUntil !== undefined) {
    if (suppressUntil > Date.now()) return undefined
    negativeCacheUntil.delete(sessionID)
  }

  const pending = inFlight.get(sessionID)
  if (pending !== undefined) return pending

  const promise = (async (): Promise<string | undefined> => {
    const agent = await getSessionAgent(sessionID, client)
    if (agent !== undefined) {
      sessionAgentCache.set(sessionID, agent)
      missCounts.delete(sessionID)
      negativeCacheUntil.delete(sessionID)
    } else {
      const misses = (missCounts.get(sessionID) ?? 0) + 1
      missCounts.set(sessionID, misses)
      if (misses >= NEGATIVE_CACHE_AFTER_MISSES) {
        negativeCacheUntil.set(sessionID, Date.now() + NEGATIVE_CACHE_TTL_MS)
        missCounts.delete(sessionID)
      }
    }
    return agent
  })()

  inFlight.set(sessionID, promise)
  try {
    return await promise
  } finally {
    if (inFlight.get(sessionID) === promise) inFlight.delete(sessionID)
  }
}

/** Evict all session identity bookkeeping on session teardown. */
export function forgetSessionAgent(sessionID: string): void {
  sessionAgentCache.delete(sessionID)
  inFlight.delete(sessionID)
  missCounts.delete(sessionID)
  negativeCacheUntil.delete(sessionID)
}

/** True only when the session is positively identified as the coordinator. */
export async function isCoordinatorSession(
  sessionID: string,
  client: Client,
): Promise<boolean> {
  return (
    (await getSessionAgentCached(sessionID, client)) === COORDINATOR_AGENT_NAME
  )
}
