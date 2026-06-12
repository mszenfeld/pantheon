import { describe, expect, it } from "vitest"
import {
  buildSkillCatalog,
  parseSkillFrontmatter,
} from "../src/skill-catalog.js"

describe("parseSkillFrontmatter", () => {
  it("parses frontmatter with name, description, and activation", () => {
    const content = `---\nname: test-skill\ndescription: A test skill\nactivation: MUST load when testing\n---\n\n# Test Skill\n`
    const parsed = parseSkillFrontmatter(content, "test.md")
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe("test-skill")
    expect(parsed!.description).toBe("A test skill")
    expect(parsed!.activation).toBe("MUST load when testing")
  })

  it("uses default activation when missing", () => {
    const content = `---\nname: minimal\ndescription: Minimal skill\n---\n\nContent\n`
    const parsed = parseSkillFrontmatter(content, "minimal.md")
    expect(parsed).not.toBeNull()
    expect(parsed!.activation).toBe("Load when relevant to the task")
  })

  it("returns null for files without frontmatter", () => {
    const content = `# No Frontmatter\n\nJust markdown.`
    const parsed = parseSkillFrontmatter(content, "nofront.md")
    expect(parsed).toBeNull()
  })

  it("throws for missing name in frontmatter", () => {
    const content = `---\ndescription: Missing name\n---\n`
    expect(() => parseSkillFrontmatter(content, "noname.md")).toThrow(/name/)
  })

  it("parses allowed-tools as a comma-separated list", () => {
    const content = `---\nname: test-skill\nallowed-tools: Read, Write, Bash(curl:*)\n---\n\n# Test Skill\n`
    const parsed = parseSkillFrontmatter(content, "test.md")
    expect(parsed).not.toBeNull()
    expect(parsed!.allowedTools).toEqual(["Read", "Write", "Bash(curl:*)"])
  })

  it("leaves allowed-tools undefined when missing", () => {
    const content = `---\nname: minimal\ndescription: Minimal skill\n---\n\nContent\n`
    const parsed = parseSkillFrontmatter(content, "minimal.md")
    expect(parsed).not.toBeNull()
    expect(parsed!.allowedTools).toBeUndefined()
  })
})

import { isToolSubset } from "../src/skill-catalog.js"

describe("isToolSubset", () => {
  it("returns true for an exact match", () => {
    expect(isToolSubset(["Read", "Write"], ["Read", "Write", "Bash"])).toBe(
      true,
    )
  })

  it("returns true when subset is empty", () => {
    expect(isToolSubset([], ["Read", "Write"])).toBe(true)
  })

  it("returns false when a tool is missing from superset", () => {
    expect(isToolSubset(["Read", "Delete"], ["Read", "Write"])).toBe(false)
  })

  it("returns false for broader Bash patterns in subset", () => {
    // Agent restricts to cat:./* but skill allows cat:* — skill is NOT a subset
    expect(isToolSubset(["Bash(cat:*)"], ["Bash(cat:./*)"])).toBe(false)
  })

  it("returns true for exact Bash pattern match", () => {
    expect(isToolSubset(["Bash(curl:*)"], ["Bash(curl:*)", "Read"])).toBe(true)
  })

  it("ignores whitespace around tools", () => {
    expect(isToolSubset([" Read ", " Write "], ["Read", "Write"])).toBe(true)
  })

  it("returns true when superset has extra tools", () => {
    expect(isToolSubset(["Read"], ["Read", "Write", "Bash"])).toBe(true)
  })
})

describe("buildSkillCatalog", () => {
  it("scans skill directories and returns catalog", () => {
    const catalog = buildSkillCatalog([
      "../python-developer/dist/skills",
      "../frontend-developer/dist/skills",
    ])

    expect(catalog.has("python-coding-standards")).toBe(true)
    expect(catalog.has("frontend-coding-standards")).toBe(true)
    expect(catalog.has("fastapi-patterns")).toBe(true)
    expect(catalog.has("tailwind-patterns")).toBe(true)
  })

  it("parses frontmatter fields", () => {
    const catalog = buildSkillCatalog(["../python-developer/dist/skills"])

    const skill = catalog.get("python-coding-standards")!
    expect(skill.name).toBe("python-coding-standards")
    expect(skill.description).toContain("Python")
    expect(skill.activation).toBeTruthy()
    expect(skill.filePath).toContain("python-coding-standards/SKILL.md")
  })

  it("throws on duplicate skill names across directories", () => {
    expect(() =>
      buildSkillCatalog([
        "../python-developer/dist/skills",
        "../python-developer/dist/skills",
      ]),
    ).toThrow(/duplicate.*skill.*name/i)
  })

  it("gracefully handles missing directories", () => {
    const catalog = buildSkillCatalog(["../nonexistent/dist/skills"])
    expect(catalog.size).toBe(0)
  })
})
