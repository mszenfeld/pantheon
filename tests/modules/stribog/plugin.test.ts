import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { AppVerkStribogPlugin } from "../../../src/modules/stribog/index.js"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"
import {
  STRIBOG_AGENT_KEY,
  STRIBOG_DENIED_TOOLS,
} from "../../../src/modules/stribog/stribog.metadata.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

function fakeInput() {
  return { client: {} } as never
}

/** Plugin input with a stub `tui.showToast`, for the provider-missing toast tests. */
function toastInput(showToast = vi.fn(async () => {})) {
  return { client: { tui: { showToast } } } as never
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

const beforeInput = (tool: string, sessionID: string) => ({
  tool,
  sessionID,
  callID: "c",
})
const beforeOutput = (filePath: string) => ({ args: { filePath } })

describe("AppVerkStribogPlugin", () => {
  let tmpData: string
  let origXdgData: string | undefined

  beforeEach(() => {
    clearAgentMetadataRegistry()
    __resetCacheForTests()
    // The provider probe also reads ${XDG_DATA_HOME:-~/.local/share}/opencode/
    // auth.json; point it at an empty temp dir so the developer's live
    // `opencode auth login` state can't flip the provider-absent toast tests.
    tmpData = mkdtempSync(path.join(tmpdir(), "pantheon-stribog-data-"))
    origXdgData = process.env["XDG_DATA_HOME"]
    process.env["XDG_DATA_HOME"] = tmpData
    // Edit-budget state is now factory-scoped: each AppVerkStribogPlugin(...) call
    // builds a fresh closure-bound map, so the session.deleted wiring test below
    // gets a clean budget without any module-global reset. The test still proves
    // clearing happens via the real event handler (it drives the budget to full on
    // one plugin instance, then dispatches session.deleted on that same instance).
  })

  afterEach(() => {
    if (origXdgData === undefined) delete process.env["XDG_DATA_HOME"]
    else process.env["XDG_DATA_HOME"] = origXdgData
    rmSync(tmpData, { recursive: true, force: true })
  })

  it("registers stribog metadata in the factory body", async () => {
    await AppVerkStribogPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain(
      STRIBOG_AGENT_KEY,
    )
  })

  it("registers stribog as a subagent with its allow-list in the prompt", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    const config: {
      agent?: Record<
        string,
        { mode?: string; prompt?: string; description?: string }
      >
    } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.[STRIBOG_AGENT_KEY]
    expect(agent?.mode).toBe("subagent")
    expect(agent?.description).toContain("Light execution specialist")
    expect(agent?.prompt).toContain(
      `allowed-tools: ${STRIBOG_TOOLS.join(", ")}`,
    )
  })

  it("declares a native tools deny-map for execute_recipe and task (default-allow in 1.17.3; hook enforces)", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    const config: {
      agent?: Record<string, { tools?: Record<string, boolean> }>
    } = {}
    await hooks.config?.(config as never)
    expect(config.agent?.[STRIBOG_AGENT_KEY]?.tools).toMatchObject(
      STRIBOG_DENIED_TOOLS,
    )
  })

  it("registers a tool.execute.before hook", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    expect(typeof hooks["tool.execute.before"]).toBe("function")
  })

  it("registers a session.deleted event handler that does not throw", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    expect(typeof hooks.event).toBe("function")
    await hooks.event?.({
      event: { type: "session.deleted", properties: { info: { id: "x" } } },
    } as never)
  })

  // L3: when the opencode-go provider the pinned default needs is absent, the default
  // is skipped (stribog inherits the session default) AND a one-time warning toast
  // documents the dependency — the serena-gate pattern from plan/explore.
  it("warns exactly once on session.created when the opencode-go provider is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkStribogPlugin(toastInput(showToast))
    await hooks.config?.({ agent: {}, provider: {} } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("does not warn when the opencode-go provider is configured", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkStribogPlugin(toastInput(showToast))
    await hooks.config?.({ agent: {}, provider: { "opencode-go": {} } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("session.deleted clears that session's edit budget through the real event wiring", async () => {
    const hooks = await AppVerkStribogPlugin(stribogAttributedInput())
    const before = hooks["tool.execute.before"]!
    const sessionID = "s-del-wiring"

    // Drive the budget to full (STRIBOG_EDIT_BUDGET = 2 distinct files) via the real hook.
    await before(beforeInput("write", sessionID), beforeOutput("/repo/a.ts"))
    await before(beforeInput("edit", sessionID), beforeOutput("/repo/b.ts"))
    // Sanity: budget is now exhausted — a third distinct file is denied.
    await expect(
      before(beforeInput("write", sessionID), beforeOutput("/repo/c.ts")),
    ).rejects.toThrow(/STRIBOG_SCOPE_VIOLATION/)

    // Dispatch the real session.deleted event for that same id (event → clearSession).
    await hooks.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    } as never)

    // State must have been cleared via the wiring: a fresh distinct-file edit is allowed again.
    await expect(
      before(beforeInput("write", sessionID), beforeOutput("/repo/d.ts")),
    ).resolves.toBeUndefined()
  })
})

describe("AppVerkStribogPlugin – extraTools wiring", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origXdgData: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    clearAgentMetadataRegistry()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-stribog-et-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origXdgData = process.env["XDG_DATA_HOME"]
    process.env["XDG_DATA_HOME"] = path.join(tmpHome, ".local", "share")
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    if (origXdgData === undefined) delete process.env["XDG_DATA_HOME"]
    else process.env["XDG_DATA_HOME"] = origXdgData
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
    clearAgentMetadataRegistry()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  /**
   * Build a plugin instance whose hook attributes EVERY session to `stribog`,
   * so the tool enforcement path is exercised end-to-end.
   */
  async function makePlugin() {
    const plugin = await AppVerkStribogPlugin({
      client: {
        session: {
          messages: async () => ({
            data: [{ info: { role: "user", agent: STRIBOG_AGENT_KEY } }],
          }),
        },
      },
    } as never)
    return plugin
  }

  it("allows a pattern from extraTools when configured via pantheon.json", async () => {
    writeUserGlobal(
      `{ "agents": { "stribog": { "extraTools": ["supabase_*"] } } }`,
    )
    const plugin = await makePlugin()
    const before = plugin["tool.execute.before"]!
    // supabase_execute_sql matches the "supabase_*" glob — must pass.
    await expect(
      before({ tool: "supabase_execute_sql", sessionID: "s1", callID: "c" }, { args: {} }),
    ).resolves.toBeUndefined()
  })

  it("denies the same pattern when extraTools is absent (strict default)", async () => {
    // No pantheon.json at all → extraPatterns defaults to [] → deny.
    const plugin = await makePlugin()
    const before = plugin["tool.execute.before"]!
    await expect(
      before({ tool: "supabase_execute_sql", sessionID: "s1", callID: "c" }, { args: {} }),
    ).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
  })
})
