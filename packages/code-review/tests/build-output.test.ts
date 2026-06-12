import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, "../dist")

describe("build output", () => {
  it("dist/index.js exists", () => {
    expect(existsSync(path.resolve(distDir, "index.js"))).toBe(true)
  })

  it("dist/index.d.ts exists", () => {
    expect(existsSync(path.resolve(distDir, "index.d.ts"))).toBe(true)
  })

  const EXPECTED_FILES = [
    "commands/review.md",
    "agents/security-auditor.md",
    "agents/code-quality-auditor.md",
    "agents/documentation-auditor.md",
    "agents/cross-verifier.md",
    "agents/challenger.md",
    "commands/fix.md",
    "commands/fix-report.md",
    "agents/fix-auto.md",
    "commands/analyze-feedback.md",
    "agents/feedback-analyzer.md",
    "agents/skill-secret-scanner.md",
    "agents/skill-sast-analyzer.md",
    "agents/skill-dependency-scanner.md",
    "agents/skill-architecture-analyzer.md",
    "agents/skill-linter-integrator.md",
    "skills/standards-discovery/SKILL.md",
  ]

  it.each(EXPECTED_FILES)(
    "dist/$path exists and has structural content",
    (p) => {
      const fullPath = path.resolve(distDir, p)
      expect(existsSync(fullPath)).toBe(true)
      const content = readFileSync(fullPath, "utf8")
      expect(content).toMatch(/^---/m)
      expect(content).toMatch(/^#/m)
    },
  )
})

describe("fix-report.md multiple selection", () => {
  const fixReportPath = path.resolve(distDir, "commands/fix-report.md")
  let content: string

  beforeAll(() => {
    content = readFileSync(fixReportPath, "utf8")
  })

  it("includes multiple: true for question tool", () => {
    expect(content).toMatch(/multiple:\s*true/)
  })

  it("places multiple: true inside question parameters (indented under question)", () => {
    // Match "- question:" line followed by indented "multiple: true"
    const match = content.match(/- question:.*?\n\s+multiple:\s*true/s)
    expect(match).toBeDefined()
  })
})

describe("review.md verification tracking", () => {
  const reviewPath = path.resolve(distDir, "commands/review.md")
  let content: string

  beforeAll(() => {
    content = readFileSync(reviewPath, "utf8")
  })

  it("includes verification tasks in progress tracking", () => {
    const step3Match = content.match(
      /## Step 3: Track Progress.*?(?=## Step \d+:|$)/is,
    )
    expect(step3Match).toBeDefined()
    expect(step3Match![0]).toMatch(/verification|cross-verifier|challenger/is)
  })

  it("includes cross-verifier in final verification checklist", () => {
    const idx = content.indexOf("## Final Verification Checklist")
    expect(idx).toBeGreaterThan(-1)
    const after = content.slice(idx)
    expect(after).toMatch(/cross-verifier/is)
  })

  it("includes challenger in final verification checklist", () => {
    const idx = content.indexOf("## Final Verification Checklist")
    expect(idx).toBeGreaterThan(-1)
    const after = content.slice(idx)
    expect(after).toMatch(/challenger/is)
  })
})
