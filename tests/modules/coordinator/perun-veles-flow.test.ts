import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const md = readFileSync(
  path.resolve(__dirname, "../../../src/agents/perun.md"),
  "utf8",
)
const velesPlanningDoc = readFileSync(
  path.resolve(__dirname, "../../../docs/veles-planning.md"),
  "utf8",
)

describe("perun.md Veles no-plan flow", () => {
  it("dispatches veles when no plan is found", () => {
    expect(md).toMatch(/no plan/i)
    expect(md).toContain('agent: "Veles - Planner"')
  })
  it("defines the Planning-consent gate dialog state with a verbatim template", () => {
    expect(md).toContain("Planning-consent gate")
    expect(md).toContain("Veles authored one")
    expect(md).toContain("Run QA on this plan")
  })
  it("parses the Veles JSON result and branches on status", () => {
    expect(md).toContain("plan_path")
    expect(md).toContain("status")
  })

  // Pins Perun's documented parse-field list against the same 6-field
  // contract the Veles-side test (veles-prompt.test.ts) already pins, so
  // both ends of the Veles↔Perun JSON contract are covered by tests and
  // cannot drift independently.
  describe("Veles↔Perun 6-field JSON contract", () => {
    const CONTRACT_FIELDS = [
      "status",
      "plan_path",
      "fe_count",
      "be_count",
      "setup_prereqs",
      "topic",
    ] as const

    it("documents Perun's parse list with exactly the 6 contract fields", () => {
      // The parse list lives in the no-plan branch step (b):
      //   Parse Veles's result as JSON: `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`
      const parseLine = md
        .split("\n")
        .find((line) => /Parse Veles'?s result as JSON/i.test(line))
      expect(
        parseLine,
        "Perun must document the Veles JSON parse list",
      ).toBeDefined()

      const braced = parseLine?.match(/\{([^}]*)\}/)?.[1]
      expect(braced, "parse list must be a `{ ... }` field set").toBeDefined()

      const parsedFields = (braced ?? "")
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)

      expect(parsedFields.sort()).toEqual([...CONTRACT_FIELDS].sort())
    })

    it("references every contract field somewhere in perun.md", () => {
      for (const field of CONTRACT_FIELDS) {
        expect(md).toContain(field)
      }
    })

    it("branches on the documented status values (error/timeout/zero counts)", () => {
      expect(md).toMatch(/"error"/)
      expect(md).toMatch(/"timeout"/)
      expect(md).toContain("fe_count + be_count")
    })
  })

  describe("verified planning-artifact execution flow", () => {
    it("uses the approval tool's snake_case digest argument", () => {
      expect(md).toContain("pre_approval_digest: <pre_approval_digest>")
      expect(md).not.toContain("preApprovalDigest")
    })

    it("passes verified artifact content to Svarog", () => {
      expect(md).toContain("verified `content` returned by `read_verified_planning_artifact`")
      expect(md).not.toContain("content_snapshot")
    })

    it("places the headless execution context inside the Veles task", () => {
      expect(md).toMatch(
        /tasks:\s*\[\s*\{[\s\S]*?name:\s*"Veles - Planner"[\s\S]*?executionContext:\s*"perun-headless"[\s\S]*?\}\s*\]/,
      )
    })
  })

  it("documents natural-language Veles planning without unsupported slash commands", () => {
    expect(velesPlanningDoc).toContain("describe what you need in natural language")
    expect(velesPlanningDoc).not.toMatch(/\/veles:(spec|plan|qa-plan)/)
  })
})
