import { describe, it, expect, beforeAll } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkCodeReviewPlugin } from "../src/index.js"

describe("AppVerkCodeReviewPlugin", () => {
  let pluginResult: Awaited<ReturnType<typeof AppVerkCodeReviewPlugin>>

  beforeAll(async () => {
    pluginResult = await AppVerkCodeReviewPlugin({
      directory: "/tmp",
      worktree: "/tmp",
    } as any)
  })

  it("exports a plugin factory function", () => {
    expect(typeof AppVerkCodeReviewPlugin).toBe("function")
  })

  it("returns an object with a config function", () => {
    expect(pluginResult.config).toBeDefined()
    expect(typeof pluginResult.config).toBe("function")
  })

  const EXPECTED_AGENTS = [
    "security-auditor",
    "code-quality-auditor",
    "documentation-auditor",
    "cross-verifier",
    "challenger",
    "feedback-analyzer",
    "fix-auto",
    "skill-secret-scanner",
    "skill-sast-analyzer",
    "skill-dependency-scanner",
    "skill-architecture-analyzer",
    "skill-linter-integrator",
  ]

  const EXPECTED_COMMANDS = ["review", "fix", "fix-report", "analyze-feedback"]

  it.each(EXPECTED_AGENTS)("config registers %s agent", async (name) => {
    const config: Config = { agent: {} }
    await pluginResult.config?.(config)
    expect(config.agent![name]).toBeDefined()
    expect(config.agent![name]!.description).toBeDefined()
    expect(typeof config.agent![name]!.prompt).toBe("string")
    expect(config.agent![name]!.prompt!.length).toBeGreaterThan(0)
    expect(config.agent![name]!.mode).toBe("subagent")
  })

  it.each(EXPECTED_COMMANDS)("config registers %s command", async (name) => {
    const config: Config = { command: {} }
    await pluginResult.config?.(config)
    expect(config.command![name]).toBeDefined()
    expect(config.command![name]!.description).toBeDefined()
    expect(typeof config.command![name]!.template).toBe("string")
    expect(config.command![name]!.template.length).toBeGreaterThan(0)
  })

  it("does not register any custom tools", async () => {
    const config: Config = { command: {}, agent: {} }
    await pluginResult.config?.(config)
    expect(pluginResult.tool).toBeUndefined()
  })

  describe("pre-analysis injection", () => {
    it("injects pre-analysis block into all agent prompts", async () => {
      const config: Config = { agent: {} }
      await pluginResult.config?.(config)

      for (const name of EXPECTED_AGENTS) {
        const prompt = config.agent![name]!.prompt!
        expect(prompt).toContain(
          "## Pre-Analysis Step: Discover Project Standards",
        )
        expect(prompt).toContain("load the `standards-discovery` skill")
      }
    })

    it("injects pre-analysis block into all command templates", async () => {
      const config: Config = { command: {} }
      await pluginResult.config?.(config)

      for (const name of EXPECTED_COMMANDS) {
        const template = config.command![name]!.template!
        expect(template).toContain(
          "## Pre-Analysis Step: Discover Project Standards",
        )
        expect(template).toContain("load the `standards-discovery` skill")
      }
    })

    it("places pre-analysis block after frontmatter", async () => {
      const config: Config = { agent: {} }
      await pluginResult.config?.(config)

      // Check a file known to have frontmatter
      const prompt = config.agent!["security-auditor"]!.prompt!
      const frontmatterEnd = prompt.indexOf("---\n", 4) // Find end of frontmatter
      expect(frontmatterEnd).toBeGreaterThan(-1)

      const preAnalysisIndex = prompt.indexOf(
        "## Pre-Analysis Step: Discover Project Standards",
      )
      expect(preAnalysisIndex).toBeGreaterThan(frontmatterEnd)
    })

    it("does not duplicate pre-analysis block", async () => {
      const config: Config = { agent: {} }
      await pluginResult.config?.(config)

      for (const name of EXPECTED_AGENTS) {
        const prompt = config.agent![name]!.prompt!
        const matches = prompt.match(
          /## Pre-Analysis Step: Discover Project Standards/g,
        )
        expect(matches?.length ?? 0).toBe(1)
      }
    })
  })
})
