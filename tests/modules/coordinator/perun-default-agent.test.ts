import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkCoordinatorPlugin default_agent", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-coord-"))
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
  })

  it("sets default_agent to 'Perun - Coordinator' when unset", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect((config as { default_agent?: string }).default_agent).toBe(
      "Perun - Coordinator",
    )
  })

  it("respects a user-provided default_agent (does not overwrite)", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config = { agent: {}, default_agent: "my-agent" } as Config
    await plugin.config?.(config)
    expect((config as { default_agent?: string }).default_agent).toBe(
      "my-agent",
    )
  })
})
