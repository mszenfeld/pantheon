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
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    clearAgentMetadataRegistry()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-stribog-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
    clearAgentMetadataRegistry()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  async function runConfig(): Promise<Config> {
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    return config
  }

  it("defaults to the Sonnet-class model when no pantheon.json exists", async () => {
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("honours a valid agents.stribog.model override", async () => {
    writeUserGlobal(`{ "agents": { "stribog": { "model": "opencode/claude-haiku-4-5" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe("opencode/claude-haiku-4-5")
  })

  it("falls back to the default when the stribog key is absent", async () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("falls back to the default when the override is invalid (schema strips it)", async () => {
    writeUserGlobal(`{ "agents": { "stribog": { "model": "bad model[31m" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })
})
