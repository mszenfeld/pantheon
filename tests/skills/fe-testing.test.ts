import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseSkillFrontmatter } from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/fe-testing/SKILL.md",
)

describe("fe-testing skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("parses with name fe-testing", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("fe-testing")
  })

  it("carries the FAIL refutation battery, observation-only", () => {
    expect(md).toContain("## FAIL refutation battery")
    // Re-verification never re-performs the action (no re-submit) — retry-laundering guard.
    expect(md).toContain("no re-submit")
    expect(md).toContain("not retry-until-pass")
  })

  it("stale-read disposition + timing-sensitive carve-out", () => {
    expect(md).toContain("(re-verified: first read stale)")
    expect(md).toContain("timing/immediacy-sensitive")
  })

  it("routes environment gaps to NEED_INFO, not FAIL", () => {
    expect(md).toContain("NEED_INFO kind=service")
    expect(md).toContain('kind: "tool"')
  })

  it("gates sub-verdicts (edge-case lines) and widens the templates", () => {
    expect(md).toContain("- **Status:** PASS / FAIL / SKIP / NEED_INFO")
    expect(md).toContain("<edge case 1>: PASS / FAIL / SKIP — <details>")
  })
})
