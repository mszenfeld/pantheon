import { describe, expect, it } from "vitest"
import { buildSvarogPrompt } from "../../../src/modules/svarog/prompt.js"

describe("buildSvarogPrompt", () => {
  const prompt = buildSvarogPrompt()

  it("renders frontmatter: name, subagent mode, allow-list", () => {
    expect(prompt).toContain("name: svarog")
    expect(prompt).toContain("mode: subagent")
    expect(prompt).toContain("allowed-tools:")
    expect(prompt).toContain("Bash(bun:*)")
  })

  it("states the structured READY/FAIL/ESCALATE result contract", () => {
    expect(prompt).toContain("```json")
    expect(prompt).toMatch(/READY/)
    expect(prompt).toMatch(/FAIL/)
    expect(prompt).toMatch(/ESCALATE/)
    expect(prompt).toContain("checkpoint")
  })

  it("encodes the leaf + headless + secret rules", () => {
    expect(prompt.toLowerCase()).toMatch(/leaf|never dispatch/)
    expect(prompt.toLowerCase()).toMatch(/headless|no .*question/)
    expect(prompt.toLowerCase()).toContain("zmora-setup")
  })

  it("scopes the QA gate to a leaf surface (no tmux/Playwright over-promise)", () => {
    expect(prompt).not.toMatch(/tmux/i)
    expect(prompt).not.toMatch(/playwright/i)
    expect(prompt.toLowerCase()).toContain("curl")
  })

  it("encodes test-first + greenfield rule and the green-suite READY gate", () => {
    expect(prompt.toLowerCase()).toMatch(/test-first|tests before/)
    expect(prompt.toLowerCase()).toContain("greenfield")
    expect(prompt.toLowerCase()).toMatch(/suite|build/)
  })

  it("memoizes (same string instance on repeat calls)", () => {
    expect(buildSvarogPrompt()).toBe(prompt)
  })
})
