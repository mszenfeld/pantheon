import { afterEach, describe, expect, it, vi } from "vitest"
import {
  dispatchParallel,
  resolveTaskTimeoutMs,
  AGENT_TASK_TIMEOUT_MS_OVERRIDES,
  VELES_TASK_TIMEOUT_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  type DispatchSpecialist,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"
import { VELES_AGENT_KEY } from "../../../src/modules/plan/veles.metadata.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

/**
 * Minimal never-finishing specialist: `fetchMessages` always returns `[]`, so
 * the poller never sees a terminal message and runs until the per-agent timeout
 * elapses. `startTask` fires `onSessionCreated` so `runTask` records the child
 * session id for the post-timeout `abortTask` cleanup (mirrors the production
 * contract and the recorder fake in `dispatch.test.ts`).
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

const FIVE_MIN = 5 * 60 * 1000

describe("resolveTaskTimeoutMs", () => {
  it("returns the planner's longer budget for Veles", () => {
    expect(resolveTaskTimeoutMs("Veles - Planner")).toBe(VELES_TASK_TIMEOUT_MS)
    expect(VELES_TASK_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TASK_TIMEOUT_MS)
  })

  it("falls back to the default for an agent without an override", () => {
    expect(resolveTaskTimeoutMs("qa-be-tester")).toBe(DEFAULT_TASK_TIMEOUT_MS)
  })

  it("honors a caller-supplied default for un-overridden agents", () => {
    expect(resolveTaskTimeoutMs("triglav", 1234)).toBe(1234)
    // An overridden agent still wins over the caller default.
    expect(resolveTaskTimeoutMs("Veles - Planner", 1234)).toBe(
      VELES_TASK_TIMEOUT_MS,
    )
  })

  it("keys the override on VELES_AGENT_KEY (drift pin)", () => {
    // Mirror of validate-dispatchable.test.ts: pin the literal key against the
    // planner's real registered name so a rename of one cannot silently orphan
    // the other (the map is a literal to avoid a coordinator→plan import).
    expect(VELES_AGENT_KEY).toBe("Veles - Planner")
    expect(AGENT_TASK_TIMEOUT_MS_OVERRIDES.get(VELES_AGENT_KEY)).toBe(
      VELES_TASK_TIMEOUT_MS,
    )
  })
})

describe("dispatchParallel — per-agent foreground timeout", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("gives the planner (Veles) a longer budget than the flat 5-min default", async () => {
    vi.useFakeTimers()
    const { specialist, aborted } = makeNeverFinishingSpecialist("s-veles")

    let settled = false
    const promise = dispatchParallel({
      tasks: [{ name: "Veles - Planner", prompt: "author a QA plan" }],
      agentRegistry: { "Veles - Planner": { mode: "all" } },
      specialist,
      // Perun (primary) is the only caller allowed to dispatch the planner.
      callerMode: "primary",
      // Coarse interval keeps the fake-time loop cheap; timeout resolution is
      // independent of the poll cadence.
      pollIntervalMs: 60_000,
    }).then((r) => {
      settled = true
      return r
    })

    // Past the flat 5-min default — under the old code Veles would have already
    // timed out here. With a per-agent budget the planner is still running.
    await vi.advanceTimersByTimeAsync(FIVE_MIN + 60_000)
    expect(settled).toBe(false)

    // …it still has a hard ceiling: once the planner's longer budget elapses it
    // times out and the child is cancelled server-side.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("timeout")
    expect(aborted).toEqual(["s-veles"])
  })

  it("keeps the flat 5-min default for non-planner agents", async () => {
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
    await vi.advanceTimersByTimeAsync(FIVE_MIN - 60_000)
    expect(settled).toBe(false)

    // Past the default: timed out — leaf agents keep fast hang-detection.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("timeout")
  })
})
