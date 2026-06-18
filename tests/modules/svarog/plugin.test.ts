import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { AppVerkSvarogPlugin } from "../../../src/modules/svarog/index.js"
import { SVAROG_AGENT_KEY } from "../../../src/modules/svarog/svarog.metadata.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"
import { __resetKnownSlugsForTests } from "../../../src/modules/_shared/apply-model-override.js"

const fakeInput = () => ({ client: {} }) as never

describe("AppVerkSvarogPlugin", () => {
  let tmpData: string
  let origXdg: string | undefined
  beforeEach(() => {
    clearAgentMetadataRegistry()
    __resetCacheForTests()
    __resetKnownSlugsForTests()
    tmpData = mkdtempSync(path.join(tmpdir(), "pantheon-svarog-"))
    origXdg = process.env["XDG_DATA_HOME"]
    process.env["XDG_DATA_HOME"] = tmpData
  })
  afterEach(() => {
    if (origXdg === undefined) delete process.env["XDG_DATA_HOME"]
    else process.env["XDG_DATA_HOME"] = origXdg
    rmSync(tmpData, { recursive: true, force: true })
  })

  it("registers svarog metadata in the factory body", async () => {
    await AppVerkSvarogPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain(
      SVAROG_AGENT_KEY,
    )
  })

  it("registers svarog as a subagent with its prompt", async () => {
    const hooks = await AppVerkSvarogPlugin(fakeInput())
    const config: {
      agent?: Record<string, { mode?: string; prompt?: string }>
    } = {}
    await hooks.config?.(config as never)
    const entry = config.agent?.[SVAROG_AGENT_KEY]
    expect(entry?.mode).toBe("subagent")
    expect(entry?.prompt).toContain("name: svarog")
  })

  it("wires a tool.execute.before hook and a session.deleted cleanup", async () => {
    const hooks = await AppVerkSvarogPlugin(fakeInput())
    expect(typeof hooks["tool.execute.before"]).toBe("function")
    expect(typeof hooks.event).toBe("function")
  })
})
