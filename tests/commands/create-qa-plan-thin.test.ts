import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const md = readFileSync(
  path.resolve(__dirname, "../../src/commands/create-qa-plan.md"),
  "utf8",
)

describe("/qa:create-plan thin command", () => {
  it("delegates to the qa-plan-authoring skill", () => {
    expect(md).toContain('skill(name: "qa-plan-authoring")')
  })
  it("keeps the todowrite progress tasks command-side", () => {
    expect(md).toContain("todowrite")
  })
  it("keeps the closing /qa:run proposal", () => {
    expect(md).toContain("/qa:run")
  })
  it("no longer inlines the full diff-classification workflow", () => {
    expect(md).not.toContain("Frontend indicators:")
  })
})
