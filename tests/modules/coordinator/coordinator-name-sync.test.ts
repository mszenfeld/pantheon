import { COORDINATOR_AGENT_NAME } from "../../../src/modules/_shared/session-identity.js"
import { describe, expect, it } from "vitest"
import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"

describe("coordinator name stays in sync with the registered agent key", () => {
  it("COORDINATOR_AGENT equals the resolver's COORDINATOR_AGENT_NAME", () => {
    // Guards the resolver constant against drift: the bash gate and injection
    // suppression key off COORDINATOR_AGENT_NAME, but the runtime stamps the
    // session's `info.agent` with the `config.agent[COORDINATOR_AGENT]` key the
    // coordinator module registers under. The roster re-exports the canonical
    // shared constant so both policy gates use the same source of truth.
    expect(COORDINATOR_AGENT).toBe(COORDINATOR_AGENT_NAME)
  })
})
