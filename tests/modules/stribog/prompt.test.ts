import { describe, expect, it } from "vitest"
import { buildStribogPrompt } from "../../../src/modules/stribog/prompt.js"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"

describe("buildStribogPrompt", () => {
  const prompt = buildStribogPrompt()

  it("emits frontmatter with the exact allow-list and subagent mode", () => {
    expect(prompt).toContain(`allowed-tools: ${STRIBOG_TOOLS.join(", ")}`)
    expect(prompt).toContain("mode: subagent")
    expect(prompt).toContain("name: stribog")
    expect(prompt).toContain("description: ")
  })

  it("documents the JSON result contract (status enum + baseUrl)", () => {
    expect(prompt).toContain('"status"')
    expect(prompt).toContain("READY")
    expect(prompt).toContain("FAIL")
    expect(prompt).toContain("ESCALATE")
    expect(prompt).toContain("baseUrl")
  })

  it("instructs detached bring-up + liveness verification", () => {
    expect(prompt).toContain("docker compose up -d")
    expect(prompt.toLowerCase()).toContain("curl")
  })

  it("is cached (stable across calls)", () => {
    expect(buildStribogPrompt()).toBe(prompt)
  })

  it("states the mechanical scope contract (2-file budget + tool allow-list)", () => {
    const prompt = buildStribogPrompt()
    expect(prompt).toMatch(/at most \*\*2 distinct files\*\*/)
    expect(prompt).toContain("STRIBOG_SCOPE_VIOLATION")
    expect(prompt).toContain("STRIBOG_TOOL_DENIED")
  })

  it("preserves the no-questions (4f71cce) rule", () => {
    const prompt = buildStribogPrompt()
    expect(prompt).toContain("do **not** ask a clarifying question")
    expect(prompt).toContain("you have no `question` tool")
  })

  it("preserves the secret rule (minter != actuator)", () => {
    const prompt = buildStribogPrompt()
    expect(prompt).toContain(
      "Producing or refreshing a SECRET / credential value is NOT your job",
    )
  })
})
