import { describe, expect, it, vi } from "vitest"
import {
  COORDINATOR_AGENT_NAME,
  forgetSessionAgent,
  getSessionAgent,
  getSessionAgentCached,
  isCoordinatorSession,
} from "../src/session-identity.js"

// Minimal fake of the bits of the OpenCode client the resolver touches.
// `parentID` is accepted (some callers pass it to model a dispatched child) but
// the agent resolvers read identity solely from the first user message.
function fakeClient(opts: {
  parentID?: string
  agent?: string
  throwOn?: "messages"
}) {
  return {
    session: {
      messages: async () => {
        if (opts.throwOn === "messages") throw new Error("boom")
        return {
          data: opts.agent
            ? [{ info: { role: "user", agent: opts.agent }, parts: [] }]
            : [],
        }
      },
    },
  } as never
}

describe("getSessionAgent", () => {
  it("returns the first user message's agent", async () => {
    expect(
      await getSessionAgent(
        "s1",
        fakeClient({ agent: COORDINATOR_AGENT_NAME }),
      ),
    ).toBe(COORDINATOR_AGENT_NAME)
  })
  it("returns undefined when no messages yet (turn 1)", async () => {
    expect(await getSessionAgent("s1", fakeClient({}))).toBeUndefined()
  })
  it("returns undefined (not throw) on client error", async () => {
    expect(
      await getSessionAgent("s1", fakeClient({ throwOn: "messages" })),
    ).toBeUndefined()
  })
})

describe("isCoordinatorSession", () => {
  // Distinct sessionIDs per case: isCoordinatorSession resolves through the memoized
  // getSessionAgentCached, whose cache is module-global and persists across tests.
  it("true when the resolved agent is the coordinator", async () => {
    const sessionID = `coord-${Math.random()}`
    expect(
      await isCoordinatorSession(
        sessionID,
        fakeClient({ agent: COORDINATOR_AGENT_NAME }),
      ),
    ).toBe(true)
  })
  it("false for a dispatched specialist", async () => {
    const sessionID = `spec-${Math.random()}`
    expect(
      await isCoordinatorSession(
        sessionID,
        fakeClient({ agent: "zmora-be", parentID: "p" }),
      ),
    ).toBe(false)
  })
  it("memoizes via getSessionAgentCached: fetches the transcript once across repeated calls", async () => {
    const { client, state } = countingClient(COORDINATOR_AGENT_NAME)
    const sessionID = `coord-memo-${Math.random()}`

    expect(await isCoordinatorSession(sessionID, client)).toBe(true)
    expect(await isCoordinatorSession(sessionID, client)).toBe(true)
    expect(await isCoordinatorSession(sessionID, client)).toBe(true)
    // Routing the per-bash-call gate through this predicate must NOT re-fetch the
    // full transcript on every call (memoization preserved).
    expect(state.messageCalls).toBe(1)
  })
})

/**
 * Counting fake whose first user message resolves only once `agent` is set.
 * Exposes `messageCalls` so tests can prove the transcript fetch is memoized,
 * and lets a test flip from unresolved → resolved to prove misses are NOT cached.
 */
function countingClient(initialAgent?: string) {
  const state = { agent: initialAgent, messageCalls: 0 }
  const client = {
    session: {
      get: async () => ({ data: { id: "s1", parentID: undefined } }),
      messages: async () => {
        state.messageCalls++
        return {
          data: state.agent
            ? [{ info: { role: "user", agent: state.agent }, parts: [] }]
            : [],
        }
      },
    },
  } as never
  return { client, state }
}

describe("getSessionAgentCached", () => {
  it("fetches a resolved identity once and serves it from cache afterwards", async () => {
    const { client, state } = countingClient(COORDINATOR_AGENT_NAME)
    const sessionID = `resolved-${Math.random()}` // unique key: module-level cache persists across tests

    const first = await getSessionAgentCached(sessionID, client)
    const second = await getSessionAgentCached(sessionID, client)
    const third = await getSessionAgentCached(sessionID, client)

    expect(first).toBe(COORDINATOR_AGENT_NAME)
    expect(second).toBe(COORDINATOR_AGENT_NAME)
    expect(third).toBe(COORDINATOR_AGENT_NAME)
    // The whole transcript is fetched exactly once across N calls.
    expect(state.messageCalls).toBe(1)
  })

  it("does NOT cache an unresolved (undefined) result so a later call can still resolve", async () => {
    const { client, state } = countingClient(undefined) // turn-1 unresolvable window
    const sessionID = `unresolved-${Math.random()}`

    // Turn 1: messages not yet queryable -> undefined, must re-attempt next time.
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(state.messageCalls).toBe(1)

    // Still undefined: each unresolved call re-fetches (miss not cached) until the
    // negative-cache threshold (3 misses) is reached.
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(state.messageCalls).toBe(2)

    // The identity becomes resolvable on a later turn — re-attempted (still under threshold).
    state.agent = COORDINATOR_AGENT_NAME
    expect(await getSessionAgentCached(sessionID, client)).toBe(
      COORDINATOR_AGENT_NAME,
    )
    expect(state.messageCalls).toBe(3)

    // Now resolved and cached: no further transcript fetches.
    expect(await getSessionAgentCached(sessionID, client)).toBe(
      COORDINATOR_AGENT_NAME,
    )
    expect(state.messageCalls).toBe(3)
  })

  it("coalesces concurrent resolves of the same session into ONE transcript fetch (promise-dedup)", async () => {
    const { client, state } = countingClient(COORDINATOR_AGENT_NAME)
    const sessionID = `dedup-${Math.random()}`

    // Three callers race within the same unresolved turn (the hook per tool-call and the
    // transform per turn) — they must share one in-flight fetch, not issue three.
    const [a, b, c] = await Promise.all([
      getSessionAgentCached(sessionID, client),
      getSessionAgentCached(sessionID, client),
      getSessionAgentCached(sessionID, client),
    ])

    expect(a).toBe(COORDINATOR_AGENT_NAME)
    expect(b).toBe(COORDINATOR_AGENT_NAME)
    expect(c).toBe(COORDINATOR_AGENT_NAME)
    expect(state.messageCalls).toBe(1)
  })

  it("negatively caches after N consecutive misses so an unresolved session stops re-fetching", async () => {
    const { client, state } = countingClient(undefined) // never resolves
    const sessionID = `negcache-${Math.random()}`

    // Misses 1..3 each re-fetch (miss not yet suppressed).
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(state.messageCalls).toBe(3)

    // The 3rd miss arms the short-TTL negative cache: subsequent calls are served from it
    // WITHOUT a full-transcript fetch (the quadratic-over-session-lifetime fix).
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(state.messageCalls).toBe(3)
  })

  it("re-attempts after the negative-cache TTL elapses (a late-resolving session is not frozen)", async () => {
    vi.useFakeTimers()
    try {
      const { client, state } = countingClient(undefined)
      const sessionID = `negcache-ttl-${Math.random()}`

      // Arm the negative cache with 3 misses.
      await getSessionAgentCached(sessionID, client)
      await getSessionAgentCached(sessionID, client)
      await getSessionAgentCached(sessionID, client)
      expect(state.messageCalls).toBe(3)

      // Suppressed while the TTL holds.
      await getSessionAgentCached(sessionID, client)
      expect(state.messageCalls).toBe(3)

      // After the TTL window, the identity (now resolvable) is re-attempted and resolves.
      state.agent = COORDINATOR_AGENT_NAME
      vi.advanceTimersByTime(6_000)
      expect(await getSessionAgentCached(sessionID, client)).toBe(
        COORDINATOR_AGENT_NAME,
      )
      expect(state.messageCalls).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("forgetSessionAgent", () => {
  it("removes a resolved session's cache entry so a later call re-fetches", async () => {
    const { client, state } = countingClient(COORDINATOR_AGENT_NAME)
    const sessionID = `forget-resolved-${Math.random()}`

    // Resolve once and confirm it is served from cache (no second fetch).
    expect(await getSessionAgentCached(sessionID, client)).toBe(
      COORDINATOR_AGENT_NAME,
    )
    expect(await getSessionAgentCached(sessionID, client)).toBe(
      COORDINATOR_AGENT_NAME,
    )
    expect(state.messageCalls).toBe(1)

    // Evicting (what a consumer's session.deleted handler does) drops the cached entry,
    // so the next resolve must hit the transcript again rather than serve a stale value.
    forgetSessionAgent(sessionID)
    expect(await getSessionAgentCached(sessionID, client)).toBe(
      COORDINATOR_AGENT_NAME,
    )
    expect(state.messageCalls).toBe(2)
  })

  it("clears negative-cache bookkeeping (miss counter + TTL) so an evicted session re-attempts immediately", async () => {
    const { client, state } = countingClient(undefined) // never resolves on its own
    const sessionID = `forget-negcache-${Math.random()}`

    // Arm the negative cache with 3 misses, then prove subsequent calls are suppressed.
    await getSessionAgentCached(sessionID, client)
    await getSessionAgentCached(sessionID, client)
    await getSessionAgentCached(sessionID, client)
    await getSessionAgentCached(sessionID, client)
    expect(state.messageCalls).toBe(3) // 4th call served from the negative cache, no fetch

    // Eviction must clear the negative-cache TTL (and the miss counter), not just the
    // resolved-identity map — otherwise a re-created id would stay suppressed.
    forgetSessionAgent(sessionID)
    await getSessionAgentCached(sessionID, client)
    expect(state.messageCalls).toBe(4) // re-attempted: the suppression window was cleared
  })

  it("is a no-op for an id that was never cached", () => {
    expect(() =>
      forgetSessionAgent(`never-seen-${Math.random()}`),
    ).not.toThrow()
  })
})
