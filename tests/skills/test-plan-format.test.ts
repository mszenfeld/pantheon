import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/test-plan-format/SKILL.md",
)

describe("test-plan-format skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("shows Depends-on serializing a rate-limit scenario", () => {
    expect(md).toContain("serialize a rate-limit")
  })

  it("Edge Case Rules carry adversarial teeth (pointers to Step 6.6)", () => {
    expect(md).toContain("indistinguishable from not-found")
    expect(md).toContain("mutates no persistent state")
    expect(md).toContain("reflected into a response header")
  })

  it("requires runnable DSN credentials and the sanctioned-tool note", () => {
    expect(md).toContain("carry the credentials the local service requires")
    expect(md).toContain("cite any repo-sanctioned seeding script")
  })

  it("requires DB-checks to assert the active predicate, not bare existence", () => {
    expect(md).toContain("asserts the active predicate")
  })
})
