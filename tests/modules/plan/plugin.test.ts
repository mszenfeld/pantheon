import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppVerkPlanPlugin } from "../../../src/modules/plan/index.js"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"
import { DISPATCH_TOOL_NAMES } from "../../../src/modules/coordinator/dispatch-tool-names.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"

function fakeInput(showToast = vi.fn(async () => {})) {
  return { client: { tui: { showToast } } } as never
}

describe("AppVerkPlanPlugin", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("registers veles metadata in the factory body", async () => {
    await AppVerkPlanPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain("Veles - Planner")
  })

  it("registers the veles agent as mode all with the allow-list in its prompt", async () => {
    const hooks = await AppVerkPlanPlugin(fakeInput())
    const config: {
      agent?: Record<string, { mode?: string; prompt?: string; tools?: Record<string, boolean> }>
    } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.["Veles - Planner"]
    expect(agent?.mode).toBe("all")
    expect(agent?.prompt).toContain(`allowed-tools: ${VELES_TOOLS.join(", ")}`)
  })

  it("enables exactly the coordinator's canonical dispatch tools via the AgentConfig.tools map", async () => {
    const hooks = await AppVerkPlanPlugin(fakeInput())
    const config: { agent?: Record<string, { tools?: Record<string, boolean> }> } = {}
    await hooks.config?.(config as never)
    const tools = config.agent?.["Veles - Planner"]?.tools
    // Assert against the imported canonical names rather than literals: if the
    // coordinator renames a dispatch tool, DISPATCH_TOOL_NAMES (and this
    // assertion) follow it — a stale literal can no longer leave the test green
    // while the real wiring is broken.
    for (const name of DISPATCH_TOOL_NAMES) {
      expect(tools?.[name]).toBe(true)
    }
    // And nothing extra is enabled beyond the canonical dispatch set.
    expect(Object.keys(tools ?? {}).sort()).toEqual([...DISPATCH_TOOL_NAMES].sort())
  })

  it("warns exactly once on session.created when serena is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkPlanPlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: {} } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
