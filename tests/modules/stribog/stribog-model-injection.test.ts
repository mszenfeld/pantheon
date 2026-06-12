import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkStribogPlugin } from "../../../src/modules/stribog/index.js"
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
} from "../../../src/modules/stribog/stribog.metadata.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"
import { clearAgentMetadataRegistry } from "../../../src/modules/agent-registry/index.js"

describe("AppVerkStribogPlugin model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origXdgData: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    clearAgentMetadataRegistry()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-stribog-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    // Pin the auth.json lookup to the temp home too: the provider probe also
    // reads ${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json, and a real
    // XDG_DATA_HOME on the host would leak the developer's live auth state
    // into the provider-absent tests below.
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

  // The pinned default needs the `openai` provider; declare it so the default
  // leg actually fires (the provider-absent degraded path has its own tests
  // below). The plugin probes two config-time availability signals — custom
  // provider config AND opencode's auth.json — see _shared/provider-detect.ts;
  // this helper exercises the former, the auth.json test below the latter.
  async function runConfig(
    provider: Record<string, unknown> = { openai: {} },
  ): Promise<Config> {
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = { agent: {}, provider } as Config
    await plugin.config?.(config)
    return config
  }

  it("defaults to the eval-picked model (openai/gpt-5.4) when no pantheon.json exists and the openai provider is configured", async () => {
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("honours a valid agents.stribog.model override", async () => {
    writeUserGlobal(
      `{ "agents": { "stribog": { "model": "opencode/claude-haiku-4-5" } } }`,
    )
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(
      "opencode/claude-haiku-4-5",
    )
  })

  it("falls back to the default when the stribog key is absent", async () => {
    writeUserGlobal(
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("falls back to the default when the override is invalid (schema strips it)", async () => {
    writeUserGlobal(`{ "agents": { "stribog": { "model": "bad model[31m" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  // L3: a fresh install on a non-OpenAI path (opencode-subscription / Anthropic)
  // has no `openai` provider. Pinning the default would dispatch an unresolvable
  // model, so the default leg is skipped and stribog inherits the session default
  // (model left unset). User/pantheon overrides are unaffected — see below.
  it("does NOT pin the default when the openai provider is absent (no pantheon override)", async () => {
    const config = await runConfig({})
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBeUndefined()
  })

  // The common real-world path: `opencode auth login openai` writes an OAuth
  // entry to auth.json, but the provider never appears under config.provider.
  // The probe must count that as configured — before this leg existed the
  // plugin warned "provider not configured" and unpinned the default even
  // though dispatching openai/gpt-5.4 worked fine.
  it("pins the default when openai is configured via auth.json only", async () => {
    const authDir = path.join(tmpHome, ".local", "share", "opencode")
    mkdirSync(authDir, { recursive: true })
    writeFileSync(
      path.join(authDir, "auth.json"),
      JSON.stringify({ openai: { type: "oauth" } }),
    )
    const config = await runConfig({})
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("does NOT pin the default when openai is in disabled_providers", async () => {
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = {
      agent: {},
      provider: { openai: {} },
      disabled_providers: ["openai"],
    } as Config
    await plugin.config?.(config)
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBeUndefined()
  })

  it("does NOT pin the default when enabled_providers omits openai", async () => {
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = {
      agent: {},
      provider: { openai: {} },
      enabled_providers: ["anthropic"],
    } as Config
    await plugin.config?.(config)
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBeUndefined()
  })

  it("still honours a valid pantheon override even when the openai provider is absent", async () => {
    writeUserGlobal(
      `{ "agents": { "stribog": { "model": "opencode/claude-haiku-4-5" } } }`,
    )
    const config = await runConfig({})
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(
      "opencode/claude-haiku-4-5",
    )
  })

  // M11 precedence contract: a user's opencode.json `agent.stribog.model` is the
  // top of the chain — it must survive the wholesale replace and win over both
  // the pantheon.json override and the harness default. Stribog is the worst
  // case: before the fix the default unconditionally clobbered the user value.
  it("preserves the user's opencode.json agent.stribog.model over the harness default", async () => {
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = {
      agent: { [STRIBOG_AGENT_KEY]: { model: "anthropic/claude-opus-4-7" } },
    }
    await plugin.config?.(config)
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(
      "anthropic/claude-opus-4-7",
    )
  })

  it("user opencode.json agent.stribog.model wins over a pantheon.json override", async () => {
    writeUserGlobal(
      `{ "agents": { "stribog": { "model": "openai/gpt-5.4" } } }`,
    )
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = {
      agent: { [STRIBOG_AGENT_KEY]: { model: "anthropic/claude-opus-4-7" } },
    }
    await plugin.config?.(config)
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(
      "anthropic/claude-opus-4-7",
    )
  })
})
