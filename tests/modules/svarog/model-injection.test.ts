import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { AppVerkSvarogPlugin } from "../../../src/modules/svarog/index.js"
import {
  DEFAULT_SVAROG_MODEL,
  SVAROG_AGENT_KEY,
} from "../../../src/modules/svarog/svarog.metadata.js"
import { clearAgentMetadataRegistry } from "../../../src/modules/agent-registry/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"
import { __resetKnownSlugsForTests } from "../../../src/modules/_shared/apply-model-override.js"

const fakeInput = () => ({ client: {} }) as never

/** Plugin input with a stub `tui.showToast`, for the provider-missing toast tests. */
const toastInput = (showToast: ReturnType<typeof vi.fn>) =>
  ({ client: { tui: { showToast } } }) as never

describe("svarog model injection", () => {
  let tmpData: string
  let origXdg: string | undefined
  beforeEach(() => {
    clearAgentMetadataRegistry()
    __resetCacheForTests()
    __resetKnownSlugsForTests()
    tmpData = mkdtempSync(path.join(tmpdir(), "pantheon-svarog-mi-"))
    origXdg = process.env["XDG_DATA_HOME"]
    process.env["XDG_DATA_HOME"] = tmpData
  })
  afterEach(() => {
    if (origXdg === undefined) delete process.env["XDG_DATA_HOME"]
    else process.env["XDG_DATA_HOME"] = origXdg
    rmSync(tmpData, { recursive: true, force: true })
  })

  it("pins the default when the provider is configured", async () => {
    const hooks = await AppVerkSvarogPlugin(fakeInput())
    const config = { provider: { openai: {} } } as {
      provider: object
      agent?: Record<string, { model?: string }>
    }
    await hooks.config?.(config as never)
    expect(config.agent?.[SVAROG_AGENT_KEY]?.model).toBe(DEFAULT_SVAROG_MODEL)
  })

  it("falls back to the session default when the provider is absent", async () => {
    const hooks = await AppVerkSvarogPlugin(fakeInput())
    const config: { agent?: Record<string, { model?: string }> } = {}
    await hooks.config?.(config as never)
    expect(config.agent?.[SVAROG_AGENT_KEY]?.model).toBeUndefined()
  })

  it("lets a user opencode.json model win over the default", async () => {
    const hooks = await AppVerkSvarogPlugin(fakeInput())
    const config = {
      provider: { openai: {} },
      agent: { [SVAROG_AGENT_KEY]: { model: "anthropic/claude-opus-4-8" } },
    }
    await hooks.config?.(config as never)
    expect(config.agent[SVAROG_AGENT_KEY].model).toBe("anthropic/claude-opus-4-8")
  })

  it("warns once on session.created when the provider is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkSvarogPlugin(toastInput(showToast))
    const config: { agent?: Record<string, { model?: string }> } = {}
    await hooks.config?.(config as never) // no provider -> providerMissing
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("does not warn when the provider is configured", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkSvarogPlugin(toastInput(showToast))
    await hooks.config?.({ provider: { openai: {} } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })
})
