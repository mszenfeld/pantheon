import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Plugin } from "@opencode-ai/plugin"
import { AppVerkAgentRosterPlugin } from "../../../src/modules/agent-roster/index.js"

type RuntimeAgent = {
  name?: string
  mode?: string
  native?: boolean
  builtIn?: boolean
  hidden?: boolean
}

type Hooks = Awaited<ReturnType<Plugin>>

/**
 * Minimal fake of the slice of the OpenCode client the self-check touches:
 * `app.agents()` (the runtime map) and `tui.showToast` (the warn channel).
 * `agents()` can be made to throw to exercise the best-effort guard.
 */
function makeClient(opts: {
  agents?: RuntimeAgent[]
  agentsThrows?: boolean
}) {
  const showToast = vi.fn(async () => ({}))
  const agents = vi.fn(async () => {
    if (opts.agentsThrows) throw new Error("agents endpoint unavailable")
    return { data: opts.agents ?? [] }
  })
  return {
    client: {
      app: { agents },
      tui: { showToast },
    },
    showToast,
    agents,
  }
}

async function init(client: unknown): Promise<Hooks> {
  // Only `client` is read by the factory; the rest of the plugin input is unused.
  return AppVerkAgentRosterPlugin({ client } as Parameters<Plugin>[0])
}

function sessionCreated() {
  return { event: { type: "session.created" } } as unknown as Parameters<
    NonNullable<Hooks["event"]>
  >[0]
}

describe("agent-roster: AppVerkAgentRosterPlugin (startup self-check)", () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
  })
  afterEach(() => {
    errSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it("warns (toast + stderr) when a new native visible-primary leaks", async () => {
    const { client, showToast } = makeClient({
      agents: [
        { name: "build", mode: "primary", native: true },
        { name: "plan", mode: "primary", native: true },
        { name: "chat", mode: "primary", native: true },
      ],
    })
    const hooks = await init(client)
    await hooks.event?.(sessionCreated())

    expect(showToast).toHaveBeenCalledTimes(1)
    const arg = (showToast.mock.calls[0] as unknown[])[0] as {
      body: { variant: string; message: string }
    }
    expect(arg.body.variant).toBe("warning")
    expect(arg.body.message).toContain("chat")
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("chat"))
  })

  it("stays silent when every native is covered by NATIVE_BUILTINS", async () => {
    const { client, showToast } = makeClient({
      agents: [
        { name: "build", mode: "primary", native: true },
        { name: "plan", mode: "primary", native: true },
        { name: "general", mode: "subagent", native: true },
      ],
    })
    const hooks = await init(client)
    await hooks.event?.(sessionCreated())

    expect(showToast).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it("fires at most once across multiple session.created events (one-shot)", async () => {
    const { client, showToast, agents } = makeClient({
      agents: [{ name: "chat", mode: "primary", native: true }],
    })
    const hooks = await init(client)
    await hooks.event?.(sessionCreated())
    await hooks.event?.(sessionCreated())
    await hooks.event?.(sessionCreated())

    expect(agents).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("ignores non-session.created events", async () => {
    const { client, agents } = makeClient({
      agents: [{ name: "chat", mode: "primary", native: true }],
    })
    const hooks = await init(client)
    await hooks.event?.({ event: { type: "session.deleted" } } as unknown as Parameters<
      NonNullable<Hooks["event"]>
    >[0])

    expect(agents).not.toHaveBeenCalled()
  })

  it("never throws when the agents endpoint fails (conservative — warn, don't break)", async () => {
    const { client, showToast } = makeClient({ agentsThrows: true })
    const hooks = await init(client)
    await expect(hooks.event?.(sessionCreated())).resolves.toBeUndefined()
    expect(showToast).not.toHaveBeenCalled()
  })

  it("never throws when showToast fails (headless / non-TUI)", async () => {
    const { client, showToast } = makeClient({
      agents: [{ name: "chat", mode: "primary", native: true }],
    })
    showToast.mockRejectedValueOnce(new Error("no TUI"))
    const hooks = await init(client)
    await expect(hooks.event?.(sessionCreated())).resolves.toBeUndefined()
    // stderr still got the warning even though the toast failed.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("chat"))
  })
})
