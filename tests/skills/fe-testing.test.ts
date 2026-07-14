import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseSkillFrontmatter } from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/fe-testing/SKILL.md",
)

/**
 * Return the whitespace-normalized text from `anchor` up to the next Markdown
 * heading or `---` rule. Assertions about ONE section must be scoped to it:
 * `kind: "tool"` recurs in the priority order, the battery's check 2, and Error
 * Handling, so a document-wide `toContain` cannot tell which one still holds.
 */
function blockAt(md: string, anchor: string): string {
  const i = md.indexOf(anchor)
  if (i === -1) return ""
  const rest = md.slice(i)
  const end = rest.search(/\n(?:#{1,6} |---)/)
  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ")
}

describe("fe-testing skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")
  // Whitespace-normalized copy for reflow-invariant prose pins: the doctrine
  // prose is hard-wrapped, so a benign re-wrap must not break a multi-word pin.
  const flat = md.replace(/\s+/g, " ")

  it("parses with name fe-testing", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("fe-testing")
  })

  it("carries the FAIL refutation battery, observation-only", () => {
    expect(md).toContain("## FAIL refutation battery")
    // Re-verification never re-performs the action (no re-submit) — retry-laundering guard.
    expect(flat).toContain("no re-submit")
    expect(flat).toContain("not retry-until-pass")
  })

  it("stale-read disposition + timing-sensitive carve-out", () => {
    expect(md).toContain("(re-verified: first read stale)")
    expect(md).toContain("timing/immediacy-sensitive")
  })

  it("routes environment gaps to NEED_INFO, not FAIL", () => {
    expect(md).toContain("NEED_INFO kind=service")
  })

  it("aligns the tool-priority fallback to the core SKIP-vs-NEED_INFO rule", () => {
    // Scoped to the "3. **None**" fallback. A document-wide `kind: "tool"` pin
    // stays GREEN after this line reverts to the pre-branch "mark all FE
    // scenarios as SKIP", because check 2 and Error Handling also carry the
    // token — it never guarded the alignment it was named for.
    const noneFallback = blockAt(md, "3. **None**")
    expect(noneFallback).not.toBe("")
    expect(noneFallback).toContain('`NEED_INFO` with `kind: "tool"`')
    expect(noneFallback).not.toMatch(/mark all FE scenarios as SKIP/i)
  })

  it("aligns the Error Handling Playwright-unavailable bullet to the same rule", () => {
    // Trailing newline in the anchor keeps this pinned to the section heading
    // itself, not to a longer heading that merely starts with the same words.
    const errorHandling = blockAt(md, "## Error Handling\n")
    expect(errorHandling).not.toBe("")
    expect(errorHandling).toContain('return `NEED_INFO` with `kind: "tool"`')
    expect(errorHandling).not.toMatch(/mark ALL FE scenarios as SKIP/i)
  })

  it("gates sub-verdicts (edge-case lines) and widens the templates", () => {
    expect(md).toContain("- **Status:** PASS / FAIL / SKIP / NEED_INFO")
    expect(md).toContain("<edge case 1>: PASS / FAIL / SKIP — <details>")
  })
})
