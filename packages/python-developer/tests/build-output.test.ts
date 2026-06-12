import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("build output assets", () => {
  it("includes all 10 skill files in dist/skills", async () => {
    const skills = [
      "python-coding-standards",
      "python-tdd-workflow",
      "fastapi-patterns",
      "sqlalchemy-patterns",
      "pydantic-patterns",
      "async-python-patterns",
      "uv-package-manager",
      "django-web-patterns",
      "django-orm-patterns",
      "celery-patterns",
    ]

    for (const name of skills) {
      const skillPath = resolve(process.cwd(), "dist/skills", name, "SKILL.md")
      expect(existsSync(skillPath)).toBe(true)
      const content = readFileSync(skillPath, "utf8")
      expect(content.length).toBeGreaterThan(100)
    }
  })

  it("registers the python command with agent frontmatter from dist/commands/python.md", async () => {
    const { AppVerkPythonDeveloperPlugin } = await import("../dist/index.js")
    const plugin = await AppVerkPythonDeveloperPlugin({} as never)
    const config = { command: {} } as {
      command?: Record<
        string,
        { description?: string; template: string; agent?: string }
      >
    }

    await plugin.config?.(config as never)

    expect(config.command?.python?.template).toContain(
      "agent: python-developer",
    )
    expect(config.command?.python?.template).toContain(
      "Python Development Workflow",
    )
  })

  it("does not register load_python_skill tool in dist build", async () => {
    const { AppVerkPythonDeveloperPlugin } = await import("../dist/index.js")
    const plugin = await AppVerkPythonDeveloperPlugin({} as never)
    expect(plugin.tool?.load_python_skill).toBeUndefined()
  })
})
