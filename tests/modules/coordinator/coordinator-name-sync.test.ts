import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"
import { describe, expect, it } from "vitest"
import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"

describe("coordinator name stays in sync with the registered agent key", () => {
  it("COORDINATOR_AGENT equals the resolver's COORDINATOR_AGENT_NAME", () => {
    // Guards the resolver constant against drift: the bash gate and injection
    // suppression key off COORDINATOR_AGENT_NAME, but the runtime stamps the
    // session's `info.agent` with the `config.agent[COORDINATOR_AGENT]` key the
    // coordinator module registers under. These two constants live in separate
    // build units (packages/skill-utils vs src/) that can't share a symbol, so
    // assert they hold the same value — if they diverge, the coordinator silently
    // stops being recognised and the whole policy layer fails open.
    expect(COORDINATOR_AGENT).toBe(COORDINATOR_AGENT_NAME)
  })
})
