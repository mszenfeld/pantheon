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

/**
 * Plugin input whose `client.session.messages` attributes EVERY session to `stribog`,
 * so the real attribution path (`getSessionAgentCached` → first user message `info.agent`)
 * resolves to stribog and the `tool.execute.before` hook actually enforces the edit budget.
 */
function stribogAttributedInput() {
  return {
    client: {
      session: {
        messages: async () => ({
          data: [{ info: { role: "user", agent: STRIBOG_AGENT_KEY } }],
        }),
      },
    },
  } as never
}

const beforeInput = (tool: string, sessionID: string) => ({ tool, sessionID, callID: "c" })
const beforeOutput = (filePath: string) => ({ args: { filePath } })

describe("AppVerkStribogPlugin", () => {
  beforeEach(() => {
    clearAgentMetadataRegistry()
    __resetCacheForTests()
    // Edit-budget state is now factory-scoped: each AppVerkStribogPlugin(...) call
    // builds a fresh closure-bound map, so the session.deleted wiring test below
    // gets a clean budget without any module-global reset. The test still proves
    // clearing happens via the real event handler (it drives the budget to full on
    // one plugin instance, then dispatches session.deleted on that same instance).
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

  it("session.deleted clears that session's edit budget through the real event wiring", async () => {
    const hooks = await AppVerkStribogPlugin(stribogAttributedInput())
    const before = hooks["tool.execute.before"]!
    const sessionID = "s-del-wiring"

    // Drive the budget to full (STRIBOG_EDIT_BUDGET = 2 distinct files) via the real hook.
    await before(beforeInput("write", sessionID), beforeOutput("/repo/a.ts"))
    await before(beforeInput("edit", sessionID), beforeOutput("/repo/b.ts"))
    // Sanity: budget is now exhausted — a third distinct file is denied.
    await expect(before(beforeInput("write", sessionID), beforeOutput("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )

    // Dispatch the real session.deleted event for that same id (event → clearSession).
    await hooks.event?.({
      event: { type: "session.deleted", properties: { info: { id: sessionID } } },
    } as never)

    // State must have been cleared via the wiring: a fresh distinct-file edit is allowed again.
    await expect(
      before(beforeInput("write", sessionID), beforeOutput("/repo/d.ts")),
    ).resolves.toBeUndefined()
  })
})
