import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkSwiftDeveloperPlugin } from "../src/index.js"

describe("AppVerkSwiftDeveloperPlugin", () => {
  it("exports a plugin factory", () => {
    expect(typeof AppVerkSwiftDeveloperPlugin).toBe("function")
  })

  it("registers agent swift-developer in config", async () => {
    const plugin = await AppVerkSwiftDeveloperPlugin({} as never)
    const config = { agent: {} } as Config

    await plugin.config?.(config)

    expect(config.agent?.["swift-developer"]).toBeDefined()
    expect(config.agent!["swift-developer"]!.description).toContain("Swift")
    expect(config.agent!["swift-developer"]!.prompt).toContain(
      "Swift Developer Agent",
    )
    expect(config.agent!["swift-developer"]!.mode).toBe("primary")
  })

  it("registers command /swift in config", async () => {
    const plugin = await AppVerkSwiftDeveloperPlugin({} as never)
    const config = { command: {} } as Config

    await plugin.config?.(config)

    expect(config.command?.swift).toBeDefined()
    expect(config.command!.swift!.description).toContain("Swift")
    expect(config.command!.swift!.template).toContain("/swift")
    expect(config.command!.swift!.agent).toBe("swift-developer")
  })

  it("does not register load_swift_skill tool (now global)", async () => {
    const plugin = await AppVerkSwiftDeveloperPlugin({} as never)
    expect(plugin.tool?.load_swift_skill).toBeUndefined()
  })
})
