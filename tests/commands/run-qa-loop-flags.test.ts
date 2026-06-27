import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = readFileSync(
  join(__dirname, "../../src/commands/run-qa.md"),
  "utf8",
)

describe("/qa:run loop flags", () => {
  it("documents every loop flag", () => {
    for (const flag of [
      "--mode",
      "--max-iterations",
      "--max-dispatches",
      "--time-budget",
      "--severity-floor",
      "--allow-mutations",
    ]) {
      expect(cmd).toContain(flag)
    }
  })

  it("states the severity-floor default is LOW", () => {
    expect(cmd).toMatch(/--severity-floor[^\n]*LOW/i)
  })

  it("describes /qa:run as the closed loop, not a one-pass run", () => {
    expect(cmd).toMatch(/test→fix→retest|closed loop|QA loop/i)
  })

  it("no longer offers a fix-auto follow-up", () => {
    expect(cmd).not.toContain("fix-auto")
  })
})
