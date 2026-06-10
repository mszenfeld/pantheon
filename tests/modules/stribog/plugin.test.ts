import { beforeEach, describe, expect, it } from "vitest"
import { AppVerkStribogPlugin } from "../../../src/modules/stribog/index.js"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"
import { STRIBOG_AGENT_KEY, STRIBOG_DENIED_TOOLS } from "../../../src/modules/stribog/stribog.metadata.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

function fakeInput() {
  return { client: {} } as never
}

describe("AppVerkStribogPlugin", () => {
  beforeEach(() => {
    clearAgentMetadataRegistry()
    __resetCacheForTests()
  })

  it("registers stribog metadata in the factory body", async () => {
    await AppVerkStribogPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain(STRIBOG_AGENT_KEY)
  })

  it("registers stribog as a subagent with its allow-list in the prompt", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    const config: { agent?: Record<string, { mode?: string; prompt?: string; description?: string }> } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.[STRIBOG_AGENT_KEY]
    expect(agent?.mode).toBe("subagent")
    expect(agent?.description).toContain("Light execution specialist")
    expect(agent?.prompt).toContain(`allowed-tools: ${STRIBOG_TOOLS.join(", ")}`)
  })

  it("declares a native tools deny-map for execute_recipe and task (inert in 1.15.10; hook enforces)", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    const config: { agent?: Record<string, { tools?: Record<string, boolean> }> } = {}
    await hooks.config?.(config as never)
    expect(config.agent?.[STRIBOG_AGENT_KEY]?.tools).toMatchObject(STRIBOG_DENIED_TOOLS)
  })

  it("registers a tool.execute.before hook", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    expect(typeof hooks["tool.execute.before"]).toBe("function")
  })

  it("registers a session.deleted event handler that does not throw", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    expect(typeof hooks.event).toBe("function")
    await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "x" } } } } as never)
  })
})
