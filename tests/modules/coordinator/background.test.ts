import { describe, expect, it, vi } from "vitest"
import { BackgroundTaskStore } from "../../../src/modules/coordinator/background-store.js"
import {
  BACKGROUND_MAX_CONCURRENT,
  collectBackground,
  startBackgroundTask,
} from "../../../src/modules/coordinator/background.js"
import type {
  DispatchSpecialist,
  AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

const registry: Record<string, AgentInfo> = {
  triglav: { mode: "subagent" },
  perun: { mode: "primary" },
}

function fakeSpecialist(
  over: Partial<DispatchSpecialist> = {},
): DispatchSpecialist {
  return {
    startTask: vi.fn(async () => "unused"),
    startBackground: vi.fn(
      async () => `child-${Math.random().toString(36).slice(2, 8)}`,
    ),
    fetchMessages: vi.fn(async (): Promise<PollerMessage[]> => []),
    abortTask: vi.fn(async () => {}),
    // Default inactive so tests that only model messages keep the
    // pre-status-gate behaviour; status-gate tests override this.
    isSessionActive: vi.fn(async () => false),
    ...over,
  }
}

const idleMsg = (text: string): PollerMessage[] => [
  { role: "assistant", content: text, finish_reason: "stop" },
]
const runningMsg = (): PollerMessage[] => [
  { role: "assistant", content: "thinking", finish_reason: null },
]

/**
 * Collect WITHOUT modelling a caller session. The ownership gate now fails
 * closed on an absent `parentSessionId`, so unit tests that exercise
 * non-ownership behaviour (poll/wait/timeout/abort/scrubbing) opt into the
 * test-only `allowUnscopedCollect` escape hatch. The ownership-gate suite below
 * deliberately calls `collectBackground` directly to exercise the real gate.
 */
const collect = (
  input: Omit<Parameters<typeof collectBackground>[0], "allowUnscopedCollect">,
) => collectBackground({ ...input, allowUnscopedCollect: true })

describe("startBackgroundTask", () => {
  it("validates the agent and rejects a non-subagent", async () => {
    const store = new BackgroundTaskStore()
    await expect(
      startBackgroundTask({
        store,
        specialist: fakeSpecialist(),
        agentRegistry: registry,
        parentSessionId: "p1",
        agent: "perun",
        prompt: "x",
      }),
    ).rejects.toThrow(/Cannot dispatch primary/)
    expect(store.countActiveByParent("p1")).toBe(0)
  })

  it("registers a running task and returns an id", async () => {
    const store = new BackgroundTaskStore()
    const r = await startBackgroundTask({
      store,
      specialist: fakeSpecialist(),
      agentRegistry: registry,
      parentSessionId: "p1",
      agent: "triglav",
      prompt: "explore",
    })
    expect(r.status).toBe("running")
    expect(r.id).toMatch(/^bg_/)
    expect(store.countActiveByParent("p1")).toBe(1)
  })

  it("throws at the per-parent cap and registers nothing extra", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist()
    for (let i = 0; i < BACKGROUND_MAX_CONCURRENT; i++) {
      await startBackgroundTask({
        store,
        specialist: spec,
        agentRegistry: registry,
        parentSessionId: "p1",
        agent: "triglav",
        prompt: "x",
      })
    }
    await expect(
      startBackgroundTask({
        store,
        specialist: spec,
        agentRegistry: registry,
        parentSessionId: "p1",
        agent: "triglav",
        prompt: "x",
      }),
    ).rejects.toThrow(/max 4 background tasks/)
    expect(store.countActiveByParent("p1")).toBe(BACKGROUND_MAX_CONCURRENT)
  })

  it("does not register when startBackground rejects", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      startBackground: vi.fn(async () => {
        throw new Error("create failed")
      }),
    })
    await expect(
      startBackgroundTask({
        store,
        specialist: spec,
        agentRegistry: registry,
        parentSessionId: "p1",
        agent: "triglav",
        prompt: "x",
      }),
    ).rejects.toThrow(/create failed/)
    expect(store.countActiveByParent("p1")).toBe(0)
  })
})

describe("startBackgroundTask callerMode gating", () => {
  it("starts an allowlisted all-agent in background only when callerMode is primary", async () => {
    const store = new BackgroundTaskStore()
    const specialist = fakeSpecialist()
    const agentRegistry = { "Veles - Planner": { mode: "all" as const } }
    await expect(
      startBackgroundTask({
        store,
        specialist,
        agentRegistry,
        parentSessionId: "s1",
        agent: "Veles - Planner",
        prompt: "plan",
        callerMode: "primary",
      }),
    ).resolves.toMatchObject({ agent: "Veles - Planner", status: "running" })
    await expect(
      startBackgroundTask({
        store,
        specialist,
        agentRegistry,
        parentSessionId: "s1",
        agent: "Veles - Planner",
        prompt: "plan",
        callerMode: "all",
      }),
    ).rejects.toThrow(/Cannot dispatch all agent: Veles - Planner/)
  })
})

describe("collectBackground", () => {
  async function seed(store: BackgroundTaskStore, spec: DispatchSpecialist) {
    return startBackgroundTask({
      store,
      specialist: spec,
      agentRegistry: registry,
      parentSessionId: "p1",
      agent: "triglav",
      prompt: "x",
    })
  }

  it("poll (non-block) returns running when the child isn't idle", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => runningMsg()),
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r?.status).toBe("running")
    expect(store.get(id)).toBeDefined() // poll does not remove
  })

  it("poll returns success + result when the child is idle, and is terminal (removes the task)", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("done!")),
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r?.status).toBe("success")
    expect(r?.result).toContain("done!")
    // M7: a successful poll is one-time retrieval — the task is removed and the
    // slot freed, exactly like wait_background.
    expect(store.get(id)).toBeUndefined()
    expect(store.countActiveByParent("p1")).toBe(0)
  })

  it("poll returns running (and keeps the task) when the message looks terminal but the session is still active", async () => {
    // Inter-step race: the server persists `finish` after every step, so a
    // mid-turn transcript can end in a terminal-looking message while the turn
    // loop is still running. The status gate must keep the task uncollected.
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("not actually done")),
      isSessionActive: vi.fn(async () => true),
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r?.status).toBe("running")
    expect(store.get(id)).toBeDefined()
    expect(spec.isSessionActive).toHaveBeenCalled()
  })

  it("poll collects normally when the status check itself fails (degrades to message-only)", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("done!")),
      isSessionActive: vi.fn(async () => {
        throw new Error("status endpoint 500")
      }),
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r?.status).toBe("success")
    expect(r?.result).toContain("done!")
    expect(store.get(id)).toBeUndefined()
  })

  it("wait (block) does not collect until the session goes inactive", async () => {
    const store = new BackgroundTaskStore()
    let statusPolls = 0
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("final")),
      isSessionActive: vi.fn(async () => {
        statusPolls++
        return statusPolls <= 2
      }),
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: true,
      pollIntervalMs: 10,
    })
    expect(r?.status).toBe("success")
    expect(r?.result).toContain("final")
    expect(statusPolls).toBeGreaterThanOrEqual(3)
    expect(store.get(id)).toBeUndefined()
  })

  it("poll-success frees the slot so a new task can be dispatched at the cap (M7)", async () => {
    const store = new BackgroundTaskStore()
    // Fill the cap with finished children.
    const doneSpec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("ok")),
    })
    const ids: string[] = []
    for (let i = 0; i < BACKGROUND_MAX_CONCURRENT; i++) {
      const { id } = await startBackgroundTask({
        store,
        specialist: doneSpec,
        agentRegistry: registry,
        parentSessionId: "p1",
        agent: "triglav",
        prompt: "x",
      })
      ids.push(id)
    }
    expect(store.countActiveByParent("p1")).toBe(BACKGROUND_MAX_CONCURRENT)
    // Before the fix, dispatching a 5th here would throw even though all four
    // are finished. After the fix, a successful poll collects one and frees a slot.
    const [r] = await collect({
      store,
      specialist: doneSpec,
      ids: [ids[0]!],
      block: false,
    })
    expect(r?.status).toBe("success")
    expect(store.countActiveByParent("p1")).toBe(BACKGROUND_MAX_CONCURRENT - 1)
    await expect(
      startBackgroundTask({
        store,
        specialist: doneSpec,
        agentRegistry: registry,
        parentSessionId: "p1",
        agent: "triglav",
        prompt: "x",
      }),
    ).resolves.toMatchObject({ status: "running" })
  })

  it("re-polling a collected id returns not_found and does NOT re-fetch the transcript (M7)", async () => {
    const store = new BackgroundTaskStore()
    const fetchMessages = vi.fn(async () => idleMsg("done!"))
    const spec = fakeSpecialist({ fetchMessages })
    const { id } = await seed(store, spec)
    const [first] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(first?.status).toBe("success")
    expect(fetchMessages).toHaveBeenCalledTimes(1)
    // Second poll of the now-collected id must be a cheap not_found — no second
    // HTTP transcript fetch (and therefore no re-scrub/re-truncate).
    const [second] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(second?.status).toBe("not_found")
    expect(fetchMessages).toHaveBeenCalledTimes(1)
  })

  it("poll (running) is non-terminal: keeps the task and keeps fetching until done", async () => {
    const store = new BackgroundTaskStore()
    // First poll: still running. Second poll: idle.
    const fetchMessages = vi
      .fn<() => Promise<PollerMessage[]>>()
      .mockResolvedValueOnce(runningMsg())
      .mockResolvedValueOnce(idleMsg("done!"))
    const spec = fakeSpecialist({ fetchMessages })
    const { id } = await seed(store, spec)
    const [r1] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r1?.status).toBe("running")
    expect(store.get(id)).toBeDefined() // running poll does not remove
    const [r2] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r2?.status).toBe("success")
    expect(store.get(id)).toBeUndefined() // success poll removes
  })

  it("poll returns not_found for an unknown id", async () => {
    const store = new BackgroundTaskStore()
    const [r] = await collect({
      store,
      specialist: fakeSpecialist(),
      ids: ["bg_ghost"],
      block: false,
    })
    expect(r?.status).toBe("not_found")
  })

  it("wait (block) returns success and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("ok")),
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: true,
      pollIntervalMs: 1,
    })
    expect(r?.status).toBe("success")
    expect(store.get(id)).toBeUndefined() // collected = removed
  })

  it("wait times out, kills the child server-side, and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const abortTask = vi.fn(async () => {})
    // Deterministic child session id so we can assert abortTask is called with it.
    const spec = fakeSpecialist({
      startBackground: vi.fn(async () => "child-timeout"),
      fetchMessages: vi.fn(async () => runningMsg()),
      abortTask,
    })
    const { id } = await seed(store, spec)
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: true,
      timeoutMs: 5,
      pollIntervalMs: 1,
    })
    expect(r?.status).toBe("timeout")
    // A timed-out background child's turn is still running server-side (fired
    // fire-and-forget via promptAsync); collectBackground must cancel it with
    // the child session id BEFORE store.remove, so the still-running child is
    // not orphaned compute. abortTask must run before the task leaves the store
    // (otherwise the session.deleted listByParent→abortTask recovery can no
    // longer reach it).
    expect(abortTask).toHaveBeenCalledTimes(1)
    expect(abortTask).toHaveBeenCalledWith("child-timeout")
    expect(store.get(id)).toBeUndefined()
  })

  it("wait abort kills the child (with the child-session-id) and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const abortTask = vi.fn(async () => {})
    const spec = fakeSpecialist({
      startBackground: vi.fn(async () => "child-abort"),
      fetchMessages: vi.fn(async () => runningMsg()),
      abortTask,
    })
    const { id } = await seed(store, spec)
    const ac = new AbortController()
    ac.abort()
    const [r] = await collect({
      store,
      specialist: spec,
      ids: [id],
      block: true,
      signal: ac.signal,
      pollIntervalMs: 1,
    })
    expect(r?.status).toBe("aborted")
    expect(abortTask).toHaveBeenCalledTimes(1)
    expect(abortTask).toHaveBeenCalledWith("child-abort")
    expect(store.get(id)).toBeUndefined()
  })
})

describe("collectBackground parent-session ownership gate", () => {
  async function seedFor(
    store: BackgroundTaskStore,
    spec: DispatchSpecialist,
    parentSessionId: string,
  ) {
    return startBackgroundTask({
      store,
      specialist: spec,
      agentRegistry: registry,
      parentSessionId,
      agent: "triglav",
      prompt: "x",
    })
  }

  it("poll from a FOREIGN session returns not_found and does NOT read the transcript", async () => {
    const store = new BackgroundTaskStore()
    const fetchMessages = vi.fn(async () => idleMsg("owner-only result"))
    const spec = fakeSpecialist({ fetchMessages })
    // Task owned by session p1.
    const { id } = await seedFor(store, spec, "p1")
    // A different session (attacker) tries to poll p1's task.
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      parentSessionId: "attacker",
    })
    expect(r?.status).toBe("not_found")
    // Not disclosed: no agent name leaked, transcript never fetched, task intact.
    expect(r?.agent).toBe("")
    expect(fetchMessages).not.toHaveBeenCalled()
    expect(store.get(id)).toBeDefined()
  })

  it("wait from a FOREIGN session returns not_found and does NOT remove the owner's task", async () => {
    const store = new BackgroundTaskStore()
    const fetchMessages = vi.fn(async () => idleMsg("owner-only result"))
    const spec = fakeSpecialist({ fetchMessages })
    const { id } = await seedFor(store, spec, "p1")
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: true,
      pollIntervalMs: 1,
      parentSessionId: "attacker",
    })
    expect(r?.status).toBe("not_found")
    // The blocking path must NOT remove a foreign task (otherwise the attacker
    // denies the owner its one-time-retrieval result).
    expect(fetchMessages).not.toHaveBeenCalled()
    expect(store.get(id)).toBeDefined()
    expect(store.countActiveByParent("p1")).toBe(1)
  })

  it("the OWNER can still poll/collect its own task after a foreign attempt", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("done!")),
    })
    const { id } = await seedFor(store, spec, "p1")
    // Foreign attempt does not consume or disturb the task.
    const [foreign] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      parentSessionId: "attacker",
    })
    expect(foreign?.status).toBe("not_found")
    // Owner collects successfully.
    const [owner] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      parentSessionId: "p1",
    })
    expect(owner?.status).toBe("success")
    expect(owner?.result).toContain("done!")
    expect(store.get(id)).toBeUndefined()
  })

  it("fails CLOSED when no caller session id is supplied", async () => {
    const store = new BackgroundTaskStore()
    const fetchMessages = vi.fn(async () => idleMsg("ok"))
    const spec = fakeSpecialist({ fetchMessages })
    const { id } = await seedFor(store, spec, "p1")
    // An absent caller id is a programming error, not a license to collect.
    // It matches no owner → not_found, the transcript is never read, and (on
    // the path that would remove) the owner's task stays intact.
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
    })
    expect(r?.status).toBe("not_found")
    expect(r?.agent).toBe("")
    expect(fetchMessages).not.toHaveBeenCalled()
    expect(store.get(id)).toBeDefined()
  })

  it("the test-only allowUnscopedCollect opt-in re-enables unscoped collection", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg("ok")),
    })
    const { id } = await seedFor(store, spec, "p1")
    // Unit tests that don't model a caller use the explicit escape hatch; this
    // path is NEVER taken by the production poll_background/wait_background
    // handlers, which always thread context.sessionID.
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      allowUnscopedCollect: true,
    })
    expect(r?.status).toBe("success")
  })
})

describe("collectBackground secret scrubbing", () => {
  const SECRET = "sk-live-9f3aQ7xZ2pK8mN4rT6vW1bY5cD0eH" // high-entropy, > 16 chars
  // A snapshot-pinned factory that redacts any occurrence of SECRET — the same
  // shape the QA plugin registers as `scrubberFactory` (the only scrubber the
  // plugin ever registers; the legacy `scrubber` field is always undefined).
  function makeRedactingFactory() {
    const release = vi.fn(() => {})
    const factory = vi.fn((_parentSessionID: string) => ({
      scrub: (text: string) =>
        text.split(SECRET).join("[REDACTED:QA_BIND_TOKEN]"),
      release,
    }))
    return { factory, release }
  }

  async function seed(store: BackgroundTaskStore, spec: DispatchSpecialist) {
    return startBackgroundTask({
      store,
      specialist: spec,
      agentRegistry: registry,
      parentSessionId: "p1",
      agent: "triglav",
      prompt: "x",
    })
  }

  it("poll redacts a known secret in a background result via scrubberFactory", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg(`leaked: ${SECRET} end`)),
    })
    const { id } = await seed(store, spec)
    const { factory, release } = makeRedactingFactory()
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      scrubberFactory: factory,
      parentSessionId: "p1",
    })
    expect(r?.status).toBe("success")
    expect(r?.result).not.toContain(SECRET)
    expect(r?.result).toContain("[REDACTED:QA_BIND_TOKEN]")
    expect(factory).toHaveBeenCalledWith("p1")
    // Release the pinned snapshot exactly once, even on the non-blocking path.
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("wait redacts a known secret in a background result via scrubberFactory", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg(`token=${SECRET}`)),
    })
    const { id } = await seed(store, spec)
    const { factory, release } = makeRedactingFactory()
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: true,
      pollIntervalMs: 1,
      scrubberFactory: factory,
      parentSessionId: "p1",
    })
    expect(r?.status).toBe("success")
    expect(r?.result).not.toContain(SECRET)
    expect(r?.result).toContain("[REDACTED:QA_BIND_TOKEN]")
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("pins the snapshot once per collect for all ids and releases once", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg(`x ${SECRET}`)),
    })
    const a = await seed(store, spec)
    const b = await seed(store, spec)
    const { factory, release } = makeRedactingFactory()
    const results = await collectBackground({
      store,
      specialist: spec,
      ids: [a.id, b.id],
      block: false,
      scrubberFactory: factory,
      parentSessionId: "p1",
    })
    expect(results.every((r) => !r.result?.includes(SECRET))).toBe(true)
    // ONE snapshot covers the whole call (every id), released exactly once.
    expect(factory).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("scrubberFactory takes precedence over the legacy scrubber field", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg(`v=${SECRET}`)),
    })
    const { id } = await seed(store, spec)
    const { factory } = makeRedactingFactory()
    const legacyScrubber = vi.fn((text: string) => text) // would NOT redact
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      scrubber: legacyScrubber,
      scrubberFactory: factory,
      parentSessionId: "p1",
    })
    expect(r?.result).not.toContain(SECRET)
    expect(legacyScrubber).not.toHaveBeenCalled()
  })

  it("falls back to no scrubbing when the factory returns undefined", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({
      fetchMessages: vi.fn(async () => idleMsg(`v=${SECRET}`)),
    })
    const { id } = await seed(store, spec)
    // A buggy / pin-failed factory returns undefined — must not throw, and the
    // result is simply unscrubbed (the pre-existing legacy behaviour).
    const factory = vi.fn(() => undefined)
    const [r] = await collectBackground({
      store,
      specialist: spec,
      ids: [id],
      block: false,
      scrubberFactory: factory,
      parentSessionId: "p1",
    })
    expect(r?.status).toBe("success")
    expect(r?.result).toContain(SECRET)
  })
})
