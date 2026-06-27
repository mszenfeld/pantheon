import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, "../../docs/eval/scenarios/perun")

const scenarios = [
  "qa-loop-converges",
  "qa-loop-regression-guard",
  "qa-loop-budget-exhaustion",
  "qa-loop-fail-restore",
  "qa-loop-checkpoint-integrity",
  "qa-loop-mutation-guard-notverified",
]

describe("Perun QA-loop eval scenarios", () => {
  for (const name of scenarios) {
    it(`${name} exists and follows the scenario format`, () => {
      const p = join(dir, `${name}.md`)
      expect(existsSync(p)).toBe(true)
      const doc = readFileSync(p, "utf8")
      expect(doc).toContain("**Agent:** Perun - Coordinator")
      expect(doc).toContain("## Query")
      expect(doc).toContain("## Expected coverage")
      expect(doc).toMatch(/\*\*MUST:\*\*/)
    })
  }

  it("mutation-guard scenario asserts the NotVerified result", () => {
    const doc = readFileSync(join(dir, "qa-loop-mutation-guard-notverified.md"), "utf8")
    expect(doc).toContain("NotVerified")
  })
})
