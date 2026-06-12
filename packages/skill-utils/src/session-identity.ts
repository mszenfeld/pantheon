import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

/**
 * The agent identifier the coordinator (Perun) session runs under.
 * Pinned in Task 1b to the observed `UserMessage.info.agent` value and kept in
 * sync with the `config.agent[...]` key in src/modules/coordinator/index.ts via
 * the sync test in Task 7.
 */
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

/**
 * Module-level cache of resolved session→agent identities, keyed by sessionID.
 *
 * The agent identity for a session is immutable once resolvable, so it is safe to
 * cache and serve forever. This avoids re-fetching the entire transcript via
 * `client.session.messages` on every bash invocation (the gate) and once per turn
 * (the skill-registry transform).
 */
const sessionAgentCache = new Map<string, string>()

/**
 * In-flight promise-dedup, mirroring `loadAgentRegistry`'s pattern: concurrent resolves
 * of the SAME session share one underlying transcript fetch instead of each firing their
 * own. The hook (per tool-call) and the transform (per turn) can race within a single
 * unresolved turn; without dedup each would issue its own full-transcript fetch. The entry
 * is removed as soon as the fetch settles — it is a coalescing window, not a result cache
 * (resolved values go to `sessionAgentCache`; misses are governed by the negative cache).
 */
const inFlight = new Map<string, Promise<string | undefined>>()

/**
 * Number of consecutive unresolved attempts for a session before its misses are
 * negatively cached. The first few misses are the legitimate turn-1 unresolvable window
 * (messages not yet queryable); after that, a session that still will not resolve is
 * almost certainly one that never carries an agent on its first user message, so we stop
 * paying for a full-transcript fetch on every call.
 */
const NEGATIVE_CACHE_AFTER_MISSES = 3

/**
 * Short TTL for the negative cache. Kept brief so a session whose identity becomes
 * resolvable slightly later (slow first turn) is re-attempted within seconds rather than
 * being frozen as unresolved for the session's lifetime — the same "never freeze a miss"
 * concern that keeps resolved-only caching, just bounded in time instead of forever.
 */
const NEGATIVE_CACHE_TTL_MS = 5_000

/** Per-session miss bookkeeping backing the negative cache. */
const missCounts = new Map<string, number>()
const negativeCacheUntil = new Map<string, number>()

/**
 * Memoized variant of {@link getSessionAgent}, shared by all consumers (the bash gate
 * and the skill-registry transform) so the underlying transcript fetch happens at most
 * once per session.
 *
 * IMPORTANT: only RESOLVED (non-undefined) identities are cached forever. On the
 * coordinator's very first turn `getSessionAgent` may be unresolvable (messages not yet
 * queryable); caching that miss permanently would freeze the turn-1 unresolved window and
 * the identity could never resolve later. So a miss is never cached forever — instead:
 *
 *  - concurrent resolves of the same session coalesce into ONE transcript fetch
 *    (promise-dedup, the `loadAgentRegistry` pattern); and
 *  - after {@link NEGATIVE_CACHE_AFTER_MISSES} consecutive misses a session is
 *    negatively cached for {@link NEGATIVE_CACHE_TTL_MS}, so an unresolved identity no
 *    longer triggers a full-transcript fetch on EVERY call (previously quadratic over the
 *    life of a never-resolving session). The short TTL lets a late-resolving session
 *    re-attempt within seconds.
 */
export async function getSessionAgentCached(
  sessionID: string,
  client: Client,
): Promise<string | undefined> {
  const cached = sessionAgentCache.get(sessionID)
  if (cached !== undefined) return cached

  // Negative cache: skip the transcript fetch entirely while the short TTL holds.
  const suppressUntil = negativeCacheUntil.get(sessionID)
  if (suppressUntil !== undefined) {
    if (suppressUntil > Date.now()) return undefined
    negativeCacheUntil.delete(sessionID) // window elapsed — allow a fresh attempt
  }

  // Promise-dedup: a concurrent caller for the same session awaits the in-flight fetch.
  const pending = inFlight.get(sessionID)
  if (pending !== undefined) return pending

  const promise = (async () => {
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
    // Drop the coalescing entry once settled, but only if it is still ours — a later
    // call (after this one resolved) may have installed a new in-flight promise.
    if (inFlight.get(sessionID) === promise) inFlight.delete(sessionID)
  }
}

/**
 * Evict ALL per-session identity bookkeeping for `sessionID`. Call this from a
 * consumer's `session.deleted` handler so the module-level maps do not grow
 * unbounded over a long-lived process (one entry per session, plus one per
 * dispatch-child, retained forever otherwise — mirrors the per-session eviction
 * every other store in the repo already does: qa's `BindingsStore.purgeParent`,
 * stribog's edit-budget `clearSession`, the coordinator's `BackgroundTaskStore`).
 *
 * Clears every map that {@link getSessionAgentCached} populates for a session —
 * the resolved-identity cache AND the negative-cache bookkeeping (the in-flight
 * coalescing promise, the consecutive-miss counter, and the negative-cache TTL).
 * A deleted session id is never reused, so dropping a still-in-flight coalescing
 * entry is safe: any awaiter already holds the promise; only the map slot is freed.
 *
 * Idempotent and safe to call for an id that was never cached (every `delete` is
 * a no-op on an absent key).
 */
export function forgetSessionAgent(sessionID: string): void {
  sessionAgentCache.delete(sessionID)
  inFlight.delete(sessionID)
  missCounts.delete(sessionID)
  negativeCacheUntil.delete(sessionID)
}

/**
 * True only when the session is positively identified as the coordinator.
 *
 * Resolves identity through the memoized {@link getSessionAgentCached}, so the shared
 * production call sites (the per-bash-call gate and the per-turn skill-registry
 * transform) can route through this predicate without reintroducing a full-transcript
 * fetch on every invocation.
 */
export async function isCoordinatorSession(
  sessionID: string,
  client: Client,
): Promise<boolean> {
  return (
    (await getSessionAgentCached(sessionID, client)) === COORDINATOR_AGENT_NAME
  )
}
