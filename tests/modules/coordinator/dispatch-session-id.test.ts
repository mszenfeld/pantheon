import { describe, it, expect } from "vitest"
import { dispatchParallel } from "../../../src/modules/coordinator/dispatch.js"
import type { DispatchSpecialist } from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

function fakeSpecialist(childId: string): DispatchSpecialist {
  return {
    async startTask(_agent, _prompt, onSessionCreated) {
      onSessionCreated?.(childId)
      return childId
    },
    async fetchMessages(): Promise<PollerMessage[]> {
      return [{ role: "assistant", content: "done", finish_reason: "stop" }]
    },
    isSessionActive: async () => false,
    abortTask: async () => {},
    startBackground: async () => childId,
  }
}

const AGENT_REGISTRY = {
  svarog: { mode: "subagent" as const },
}

describe("dispatchParallel surfaces the child session id", () => {
  it("returns sessionId from onSessionCreated on success", async () => {
    const results = await dispatchParallel({
      tasks: [{ name: "svarog", prompt: "x" }],
      agentRegistry: AGENT_REGISTRY,
      specialist: fakeSpecialist("ses_child123"),
      pollIntervalMs: 1,
      taskTimeoutMs: 5000,
      resultMaxBytes: 4096,
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe("success")
    expect(results[0]!.sessionId).toBe("ses_child123")
  })
})
