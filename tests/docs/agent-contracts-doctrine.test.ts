import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const docPath = join(__dirname, "../../docs/agent-contracts.md")
const triglavPath = join(__dirname, "../../src/modules/explore/triglav.md")

describe("agent-contracts doctrine doc", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true)
  })

  it("pins the roster verdict vocabularies (Section A)", () => {
    const doc = readFileSync(docPath, "utf8")
    for (const token of [
      "PASS",
      "FAIL",
      "SKIP",
      "NEED_INFO",
      "READY",
      "ESCALATE",
      "timeout",
      "RECIPE_FAILED",
      "BudgetExhausted",
      "NotVerified",
    ]) {
      expect(doc).toContain(token)
    }
  })

  it("states the bar terms verbatim", () => {
    const doc = readFileSync(docPath, "utf8").toLowerCase()
    for (const term of [
      "fail-closed",
      "truncation",
      "named fields",
      "computed, not chosen",
      "exhaustion",
    ]) {
      expect(doc).toContain(term)
    }
  })

  it("keeps triglav.md in sync with the reader contract (truncation field + fail-closed)", () => {
    // "never synthesize" (negated phrase), NOT a bare "synthesize" token —
    // a bare token is direction-blind and would pass on an instruction TO synthesize.
    const triglav = readFileSync(triglavPath, "utf8")
    expect(triglav).toContain("truncation:")
    expect(triglav).toMatch(/never synthesize/i)
  })
})
