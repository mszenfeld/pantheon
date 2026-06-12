import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("build output assets", () => {
  it("includes all 7 skill files in dist/skills", async () => {
    const skills = [
      "swift-coding-standards",
      "swift-tdd-workflow",
      "swiftui-patterns",
      "swift-concurrency-patterns",
      "swift-data-persistence",
      "swift-networking-patterns",
      "swift-package-manager",
    ]

    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
    for (const name of skills) {
      const skillPath = resolve(packageRoot, "dist/skills", name, "SKILL.md")
      expect(existsSync(skillPath)).toBe(true)
      const content = readFileSync(skillPath, "utf8")
      expect(content.length).toBeGreaterThan(100)
    }
  })

  it("dist/commands/swift.md exists and contains agent frontmatter", async () => {
    const { AppVerkSwiftDeveloperPlugin } = await import("../dist/index.js")
    const plugin = await AppVerkSwiftDeveloperPlugin({} as never)
    const config = { command: {} } as {
      command?: Record<
        string,
        { description?: string; template: string; agent?: string }
      >
    }

    await plugin.config?.(config as never)

    expect(config.command?.swift?.template).toContain("agent: swift-developer")
    expect(config.command?.swift?.template).toContain(
      "Swift development workflow",
    )
  })

  it("does not register load_swift_skill tool in dist build", async () => {
    const { AppVerkSwiftDeveloperPlugin } = await import("../dist/index.js")
    const plugin = await AppVerkSwiftDeveloperPlugin({} as never)
    expect(plugin.tool?.load_swift_skill).toBeUndefined()
  })
})
