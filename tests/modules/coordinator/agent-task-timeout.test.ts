import { afterEach, describe, expect, it, vi } from "vitest"
import {
  dispatchParallel,
  resolveAgentTimeout,
  AGENT_TIMEOUT_OVERRIDES,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  type DispatchSpecialist,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"
import { VELES_AGENT_KEY } from "../../../src/modules/plan/veles.metadata.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

/**
 * Minimal never-finishing, never-progressing specialist: `fetchMessages` always
 * returns `[]` and `isSessionActive` always reports idle, so the poller sees no
 * sign of life and trips the planner's INACTIVITY timeout (or, for a leaf agent
 * with no idle window, the flat wall-clock). `startTask` fires `onSessionCreated`
 * so `runTask` records the child session id for the post-timeout `abortTask`
 * cleanup (mirrors the production contract and the recorder fake in
 * `dispatch.test.ts`).
 */
function makeNeverFinishingSpecialist(sessionId: string): {
  specialist: DispatchSpecialist
  aborted: string[]
} {
  const aborted: string[] = []
  const specialist: DispatchSpecialist = {
    async startTask(_agent, _prompt, onSessionCreated): Promise<string> {
      onSessionCreated?.(sessionId)
      return sessionId
    },
    async fetchMessages(): Promise<PollerMessage[]> {
      return []
    },
    async abortTask(id: string): Promise<void> {
      aborted.push(id)
    },
    async startBackground(agentName: string): Promise<string> {
      return agentName
    },
    async isSessionActive(): Promise<boolean> {
      return false
    },
  }
  return { specialist, aborted }
}

/**
 * Healthy-but-slow specialist: streams growing partial content and reports
 * `busy` until `doneAfterMs` elapses, then returns a terminal message and goes
 * idle. Models the real planner observed in production — continuous output well
 * past the old flat 15-min ceiling — so the heartbeat must keep it alive and let
 * it complete rather than killing it mid-stream.
 */
function makeHealthySpecialist(
  sessionId: string,
  doneAfterMs: number,
): { specialist: DispatchSpecialist; aborted: string[] } {
  const aborted: string[] = []
  let startedAt = 0
  let growth = 0
  const specialist: DispatchSpecialist = {
    async startTask(_agent, _prompt, onSessionCreated): Promise<string> {
      startedAt = Date.now()
      onSessionCreated?.(sessionId)
      return sessionId
    },
    async fetchMessages(): Promise<PollerMessage[]> {
      if (Date.now() - startedAt >= doneAfterMs) {
        return [
          { role: "assistant", content: "PLAN COMPLETE", finish_reason: "stop" },
        ]
      }
      // Growing partial content each poll → heartbeat progress, no finish yet.
      growth++
      return [{ role: "assistant", content: "x".repeat(growth), finish_reason: null }]
    },
    async abortTask(id: string): Promise<void> {
      aborted.push(id)
    },
    async startBackground(agentName: string): Promise<string> {
      return agentName
    },
    async isSessionActive(): Promise<boolean> {
      return Date.now() - startedAt < doneAfterMs
    },
  }
  return { specialist, aborted }
}

describe("resolveAgentTimeout", () => {
  it("returns the planner's heartbeat budget (idle window + generous backstop)", () => {
    expect(resolveAgentTimeout("Veles - Planner")).toEqual({
      wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
      idleMs: VELES_IDLE_TIMEOUT_MS,
    })
    // The backstop must exceed the flat default (heavy planner runs legitimately
    // exceed it); the idle window stays a fast hang-catch (≤ the flat default).
    expect(VELES_WALLCLOCK_BACKSTOP_MS).toBeGreaterThan(DEFAULT_TASK_TIMEOUT_MS)
    expect(VELES_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(DEFAULT_TASK_TIMEOUT_MS)
  })

  it("falls back to a pure wall-clock default for an agent without an override", () => {
    expect(resolveAgentTimeout("qa-be-tester")).toEqual({
      wallClockMs: DEFAULT_TASK_TIMEOUT_MS,
    })
  })

  it("honors a caller-supplied default for un-overridden agents (still pure wall-clock)", () => {
    expect(resolveAgentTimeout("triglav", 1234)).toEqual({ wallClockMs: 1234 })
    // An overridden agent still wins over the caller default.
    expect(resolveAgentTimeout("Veles - Planner", 1234)).toEqual({
      wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
      idleMs: VELES_IDLE_TIMEOUT_MS,
    })
  })

  it("keys the override on VELES_AGENT_KEY (drift pin)", () => {
    // Mirror of validate-dispatchable.test.ts: pin the literal key against the
    // planner's real registered name so a rename of one cannot silently orphan
    // the other (the map is a literal to avoid a coordinator→plan import).
    expect(VELES_AGENT_KEY).toBe("Veles - Planner")
    expect(AGENT_TIMEOUT_OVERRIDES.get(VELES_AGENT_KEY)).toEqual({
      wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
      idleMs: VELES_IDLE_TIMEOUT_MS,
    })
  })
})

describe("dispatchParallel — per-agent heartbeat timeout", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("lets the planner run past the old 15-min ceiling while it keeps making progress, then completes", async () => {
    vi.useFakeTimers()
    const DONE_AFTER = 20 * 60 * 1000
    const { specialist, aborted } = makeHealthySpecialist("s-veles", DONE_AFTER)

    let settled = false
    const promise = dispatchParallel({
      tasks: [{ name: "Veles - Planner", prompt: "author a QA plan" }],
      agentRegistry: { "Veles - Planner": { mode: "all" } },
      // Perun (primary) is the only caller allowed to dispatch the planner.
      callerMode: "primary",
      specialist,
      // 1-min polls keep the fake-time loop cheap; the heartbeat resets on every
      // poll because content grows / the session is busy.
      pollIntervalMs: 60_000,
    }).then((r) => {
      settled = true
      return r
    })

    // Past the OLD flat 15-min cap (and the 5-min leaf default) — still running,
    // because every poll shows progress. Under the old wall-clock code Veles
    // would already have been killed here mid-stream.
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000)
    expect(settled).toBe(false)

    // Reaches a natural finish at 20 min — collected as success, NOT timed out,
    // and the child is never cancelled server-side.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe("PLAN COMPLETE")
    expect(aborted).toEqual([])
  })

  it("catches a no-progress planner via the inactivity window, well before the backstop", async () => {
    vi.useFakeTimers()
    const { specialist, aborted } = makeNeverFinishingSpecialist("s-veles")

    let settled = false
    const promise = dispatchParallel({
      tasks: [{ name: "Veles - Planner", prompt: "author a QA plan" }],
      agentRegistry: { "Veles - Planner": { mode: "all" } },
      callerMode: "primary",
      specialist,
      pollIntervalMs: 60_000,
    }).then((r) => {
      settled = true
      return r
    })

    // Under the idle window — still running.
    await vi.advanceTimersByTimeAsync(VELES_IDLE_TIMEOUT_MS - 60_000)
    expect(settled).toBe(false)

    // Past the idle window: a planner with no sign of life is caught HERE, not at
    // the 45-min backstop, and the child is cancelled server-side.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("timeout")
    expect(results[0]?.error).toContain("idle")
    expect(aborted).toEqual(["s-veles"])
  })

  it("keeps the flat 5-min pure-wall-clock default for non-planner agents", async () => {
    vi.useFakeTimers()
    const { specialist } = makeNeverFinishingSpecialist("s-leaf")
    const registry: Record<string, AgentInfo> = {
      "qa-be-tester": { mode: "subagent" },
    }

    let settled = false
    const promise = dispatchParallel({
      tasks: [{ name: "qa-be-tester", prompt: "test the API" }],
      agentRegistry: registry,
      specialist,
      pollIntervalMs: 60_000,
    }).then((r) => {
      settled = true
      return r
    })

    // Just under the default: still running.
    await vi.advanceTimersByTimeAsync(DEFAULT_TASK_TIMEOUT_MS - 60_000)
    expect(settled).toBe(false)

    // Past the default: timed out — leaf agents keep fast hang-detection.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("timeout")
  })
})
