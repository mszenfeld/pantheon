import { describe, expect, it } from "vitest"
import {
  AppVerkCoordinatorPlugin,
  DISPATCH_TOOL_NAMES,
  PERUN_TOOLS,
} from "../../../src/modules/coordinator/index.js"
import { AppVerkPlanPlugin } from "../../../src/modules/plan/index.js"

/**
 * Sync test for the Veles dispatch-tool opt-in map (review issue L8).
 *
 * Veles enables a set of plugin tools via its `AgentConfig.tools` boolean map.
 * Those tools are REGISTERED by the coordinator, named canonically in
 * `DISPATCH_TOOL_NAMES`, and gated into perun.md via `PERUN_TOOLS`. Nothing in
 * the type system forces those four lists to agree at the *value* level, so a
 * coordinator-side rename could otherwise leave plan's code + its own unit test
 * green while silently disabling Veles's dispatch. These assertions bind the
 * keys Veles enables to the coordinator's REAL, registered tool names.
 */

function fakeCoordinatorInput() {
  // The coordinator factory only touches `client` lazily (at tool-execute /
  // event time); registering the tool map does not call into the client, so a
  // bare stub is enough to read `hooks.tool`.
  return { client: {} } as never
}

function fakePlanInput() {
  return { client: { tui: { showToast: async () => {} } } } as never
}

async function getVelesEnabledToolNames(): Promise<string[]> {
  const hooks = await AppVerkPlanPlugin(fakePlanInput())
  const config: {
    agent?: Record<string, { tools?: Record<string, boolean> }>
  } = {}
  await hooks.config?.(config as never)
  const tools = config.agent?.["Veles - Planner"]?.tools ?? {}
  // Only the opted-IN (true) entries are "enabled" dispatch tools.
  return Object.entries(tools)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
}

describe("Veles dispatch-tool sync", () => {
  it("every canonical dispatch-tool name is registered by the coordinator", async () => {
    const hooks = await AppVerkCoordinatorPlugin(fakeCoordinatorInput())
    const registered = Object.keys(hooks.tool ?? {})
    for (const name of DISPATCH_TOOL_NAMES) {
      expect(registered).toContain(name)
    }
  })

  it("every canonical dispatch-tool name is a member of PERUN_TOOLS", () => {
    for (const name of DISPATCH_TOOL_NAMES) {
      expect(PERUN_TOOLS).toContain(name)
    }
  })

  it("every dispatch tool Veles enables is a registered coordinator tool", async () => {
    const hooks = await AppVerkCoordinatorPlugin(fakeCoordinatorInput())
    const registered = Object.keys(hooks.tool ?? {})
    const velesEnabled = await getVelesEnabledToolNames()
    expect(velesEnabled.length).toBeGreaterThan(0)
    for (const name of velesEnabled) {
      expect(registered).toContain(name)
    }
  })

  it("the keys Veles enables match the canonical dispatch set exactly", async () => {
    const velesEnabled = await getVelesEnabledToolNames()
    expect(velesEnabled.sort()).toEqual([...DISPATCH_TOOL_NAMES].sort())
  })
})
