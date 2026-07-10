import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const qaSkillsDir = join(__dirname, "../../src/skills/qa")

/**
 * Return the raw frontmatter block (text between the opening and closing `---`
 * fences) of a SKILL.md, WITHOUT parsing it. We assert on this raw text on
 * purpose: `parseSkillFrontmatter` at packages/skill-registry/src/skill-catalog.ts
 * defaults a missing `activation` to "Load when relevant to the task", so any
 * assertion made against parser OUTPUT is structurally blind to a deleted
 * `activation:` field. Only the raw frontmatter can catch its absence.
 */
function readFrontmatter(path: string): string {
  const md = readFileSync(path, "utf8")
  const block = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (block === undefined) throw new Error(`${path} has no frontmatter fence`)
  return block
}

const skillDirs = readdirSync(qaSkillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => existsSync(join(qaSkillsDir, name, "SKILL.md")))

describe("qa skill frontmatter uniformity", () => {
  it("finds the qa skills on disk (guards against an empty, vacuously-passing scan)", () => {
    // Without this, a broken path would make the loop below iterate zero times
    // and pass while pinning nothing.
    expect(skillDirs.length).toBeGreaterThanOrEqual(6)
    expect(skillDirs).toContain("state-combination-planning")
  })

  for (const name of skillDirs) {
    it(`${name}/SKILL.md declares name, description, and activation`, () => {
      const fm = readFrontmatter(join(qaSkillsDir, name, "SKILL.md"))

      // Each field must be present as a frontmatter line with a NON-EMPTY
      // value (`\s*\S` rejects a bare "activation:" with nothing after it). The
      // `activation:` line in particular cannot fail loudly at load time — the
      // loader silently substitutes a default — so this raw-text guard is the
      // only thing standing between a dropped `activation:` and a green suite.
      expect(fm).toMatch(/^name:\s*\S/m)
      expect(fm).toMatch(/^description:\s*\S/m)
      expect(fm).toMatch(/^activation:\s*\S/m)
    })
  }

  it("state-combination-planning pins its activation on RAW frontmatter (parser-default trap)", () => {
    // Called out explicitly because this skill is the one flagged in the
    // review. A test written against parseSkillFrontmatter(...).activation
    // would pass even after the line is deleted (it returns the default
    // "Load when relevant to the task"). Asserting the literal `activation:`
    // line here is what actually bites.
    const fm = readFrontmatter(
      join(qaSkillsDir, "state-combination-planning/SKILL.md"),
    )
    expect(fm).toMatch(/^activation:\s*\S/m)
  })
})
