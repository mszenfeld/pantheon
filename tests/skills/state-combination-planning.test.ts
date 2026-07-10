import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseSkillFrontmatter } from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/state-combination-planning/SKILL.md",
)

describe("state-combination-planning skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")
  // Whitespace-normalized copy for reflow-invariant prose pins: the doctrine
  // prose is hard-wrapped, so a benign re-wrap must not break a multi-word pin.
  const flat = md.replace(/\s+/g, " ")

  it("parses with the collision-safe native name", () => {
    // NOT "state-combination-modeling": buildSkillCatalog throws on duplicate names
    // across scanned dirs, and a future frontend-developer port sync brings that name in.
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("state-combination-planning")
  })

  it("has a trigger-only description", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.description.startsWith("Use when")).toBe(true)
  })

  it("states the 2^N bar with proof-or-real classification", () => {
    expect(md).toContain("2^N")
    expect(md).toContain("impossible")
    expect(md).toContain("invariant")
    expect(flat).toContain("Unconfirmed → treat as real")
  })

  it("carries the 4-row worked example and the checklist", () => {
    expect(md).toContain("| isConnected | canEdit | Classification | Scenario |")
    expect(md).toContain("## Review checklist")
  })
})
