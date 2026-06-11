import { describe, it, expect, afterEach } from "vitest"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import {
  getDispatchExtensions,
  clearDispatchExtensions,
} from "../../../src/modules/_shared/dispatch-extensions.js"
import { clearAgentMetadataRegistry } from "../../../src/modules/agent-registry/index.js"

// Minimal fake client: resolveParentID returns undefined (handlers fall back to
// ctx.sessionID); the gate itself never touches the client.
const fakeInput = {
  client: {
    session: {
      get: async () => ({ data: { parentID: undefined } }),
    },
  },
} as never

function ctx(sessionID: string) {
  return {
    sessionID,
    messageID: "",
    agent: "",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  } as never
}

afterEach(() => {
  clearDispatchExtensions()
  clearAgentMetadataRegistry()
})

describe("QA tool execute() gate wiring", () => {
  it("denies execute_recipe from a zmora-fe session with status forbidden", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("fe-child", "zmora-fe")
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("fe-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("denies execute_recipe from a zmora-be session", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("be-child", "zmora-be")
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("be-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("denies execute_recipe from an unregistered (Perun/unknown) session — minter is fail-closed", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("perun-session"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("allows execute_recipe from a zmora-setup session (reaches the handler)", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("setup-child", "zmora-setup")
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("setup-child"))
    // No plan parsed, so the handler returns unknown_binding — NOT forbidden.
    // That proves the gate let the call through to the handler.
    expect(JSON.parse(out).status).toBe("unknown_binding")
  })

  it("denies parse_plan from a registered specialist (zmora-fe)", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("fe-child", "zmora-fe")
    const out = await plugin.tool!.parse_plan.execute({ plan: "## Setup" }, ctx("fe-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("allows parse_plan from an unregistered (Perun, incl. turn-1) session", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    // Empty plan parses to ok with no bindings — proves the gate allowed it.
    const out = await plugin.tool!.parse_plan.execute({ plan: "no setup section here" }, ctx("perun-session"))
    expect(JSON.parse(out).status).toBe("ok")
  })

  it("denies record_input from a registered specialist (zmora-be)", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("be-child", "zmora-be")
    const out = await plugin.tool!.record_input.execute(
      { name: "TEST_USER_EMAIL", value: "a@b.com" },
      ctx("be-child"),
    )
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("denies preflight from a registered specialist (zmora-fe)", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("fe-child", "zmora-fe")
    const out = await plugin.tool!.preflight.execute({ env: [] }, ctx("fe-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("allows record_input from an unregistered (Perun) session (reaches the handler)", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    const out = await plugin.tool!.record_input.execute(
      { name: "TEST_USER_EMAIL", value: "a@b.com" },
      ctx("perun-session"),
    )
    // Handler runs; valid name/value → ok. Proves the gate let the call through.
    expect(JSON.parse(out).status).toBe("ok")
  })

  it("allows preflight from an unregistered (Perun) session (reaches the handler)", async () => {
    const plugin = await AppVerkQAPlugin(fakeInput)
    const out = await plugin.tool!.preflight.execute({ env: [] }, ctx("perun-session"))
    // Empty env list → nothing missing → ok. Proves the gate let the call through.
    expect(JSON.parse(out).status).toBe("ok")
  })
})
