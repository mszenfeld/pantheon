import { describe, expect, it } from "vitest"
import { createSkillLoader } from "../src/load-skill.js"
import { buildSkillCatalog } from "../src/skill-catalog.js"

describe("createSkillLoader", () => {
  const catalog = buildSkillCatalog([
    "../python-developer/dist/skills",
    "../frontend-developer/dist/skills",
  ])

  const loadSkill = createSkillLoader(catalog)

  it("loads a skill by name", () => {
    const content = loadSkill("python-coding-standards")
    expect(content).toContain("HARD-RULES")
    expect(content).toContain("Python Coding Rules")
  })

  it("returns cached content on second call", () => {
    const first = loadSkill("frontend-coding-standards")
    const second = loadSkill("frontend-coding-standards")
    expect(first).toBe(second)
  })

  it("throws for unknown skill name", () => {
    expect(() => loadSkill("nonexistent-skill")).toThrow(/not found/)
    expect(() => loadSkill("nonexistent-skill")).toThrow(
      /python-coding-standards/,
    )
  })

  it("lists available skills in error", () => {
    expect(() => loadSkill("unknown")).toThrow("python-coding-standards")
    expect(() => loadSkill("unknown")).toThrow("frontend-coding-standards")
    expect(() => loadSkill("unknown")).toThrow("fastapi-patterns")
  })
})
