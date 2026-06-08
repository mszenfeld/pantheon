import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const md = readFileSync(
  path.resolve(__dirname, "../../src/commands/run-qa.md"),
  "utf8",
)

describe("/qa:run no-plan handoff", () => {
  it("no longer tells the user to run /qa:create-plan first", () => {
    expect(md).not.toContain("Run `/qa:create-plan` first")
  })
  it("hands off the no-plan case to @perun", () => {
    expect(md).toContain("@perun")
    expect(md).toMatch(/no QA plan/i)
  })
})
