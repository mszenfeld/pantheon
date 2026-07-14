import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseSkillFrontmatter } from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/report-format/SKILL.md",
)

describe("report-format skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("parses with name report-format", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("report-format")
  })

  it("allows a self-contained refutation-trace parenthetical on Pass lines", () => {
    // Self-contained: the report has no per-scenario Details field, so the
    // parenthetical must carry the trace inline (mirrors the Skip parenthetical).
    expect(md).toContain("(re-verified: first read stale)")
  })
})
