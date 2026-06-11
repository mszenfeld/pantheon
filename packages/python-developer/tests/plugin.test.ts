import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkPythonDeveloperPlugin } from "../src/index.js"

describe("AppVerkPythonDeveloperPlugin", () => {
  it("exports a plugin factory", () => {
    expect(typeof AppVerkPythonDeveloperPlugin).toBe("function")
  })

  it("registers agent python-developer in config", async () => {
    const plugin = await AppVerkPythonDeveloperPlugin({} as never)
    const config = { agent: {} } as Config

    await plugin.config?.(config)

    expect(config.agent?.["python-developer"]).toBeDefined()
    expect(config.agent!["python-developer"]!.description).toContain("Python")
    expect(config.agent!["python-developer"]!.prompt).toContain("Python Developer Agent")
    expect(config.agent!["python-developer"]!.mode).toBe("primary")
  })

  it("registers command /python in config", async () => {
    const plugin = await AppVerkPythonDeveloperPlugin({} as never)
    const config = { command: {} } as Config

    await plugin.config?.(config)

    expect(config.command?.python).toBeDefined()
    expect(config.command!.python!.description).toContain("Python")
    expect(config.command!.python!.template).toContain("Python Development Workflow")
    expect(config.command!.python!.agent).toBe("python-developer")
  })

  it("does not register load_python_skill tool (now global)", async () => {
    const plugin = await AppVerkPythonDeveloperPlugin({} as never)
    expect(plugin.tool?.load_python_skill).toBeUndefined()
  })
})
