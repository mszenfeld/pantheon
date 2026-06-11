import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkFrontendDeveloperPlugin } from "../src/index.js"

describe("AppVerkFrontendDeveloperPlugin", () => {
  it("exports a plugin factory", () => {
    expect(typeof AppVerkFrontendDeveloperPlugin).toBe("function")
  })

  it("registers agent frontend-developer in config", async () => {
    const plugin = await AppVerkFrontendDeveloperPlugin({} as never)
    const config = { agent: {} } as Config

    await plugin.config?.(config)

    expect(config.agent?.["frontend-developer"]).toBeDefined()
    expect(config.agent!["frontend-developer"]!.description).toContain("TypeScript")
    expect(config.agent!["frontend-developer"]!.prompt).toContain("TypeScript + React Developer Agent")
    expect(config.agent!["frontend-developer"]!.mode).toBe("primary")
  })

  it("registers command /frontend in config", async () => {
    const plugin = await AppVerkFrontendDeveloperPlugin({} as never)
    const config = { command: {} } as Config

    await plugin.config?.(config)

    expect(config.command?.frontend).toBeDefined()
    expect(config.command!.frontend!.description).toContain("TypeScript")
    expect(config.command!.frontend!.template).toContain("TypeScript + React Development Workflow")
    expect(config.command!.frontend!.agent).toBe("frontend-developer")
  })

  it("does not register load_frontend_skill tool (now global)", async () => {
    const plugin = await AppVerkFrontendDeveloperPlugin({} as never)
    expect(plugin.tool?.load_frontend_skill).toBeUndefined()
  })
})
