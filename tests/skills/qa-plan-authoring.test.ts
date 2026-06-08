import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  parseSkillFrontmatter,
  isToolSubset,
} from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/qa-plan-authoring/SKILL.md",
)
const COMMAND_PATH = path.resolve(__dirname, "../../src/commands/create-qa-plan.md")

function frontmatterToolList(md: string): string[] {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = (m?.[1] ?? "").split(/\r?\n/).find((l) => l.startsWith("allowed-tools:"))
  return (line ?? "").replace("allowed-tools:", "").split(",").map((t) => t.trim()).filter(Boolean)
}

describe("qa-plan-authoring skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("parses with a name and a single-line allowed-tools", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("qa-plan-authoring")
    expect(entry?.allowedTools?.length).toBeGreaterThan(0)
  })

  it("loads test-plan-format and saves to the plans dir", () => {
    expect(md).toContain("test-plan-format")
    expect(md).toContain("docs/testing/plans/")
  })

  it("its allowed-tools are an exact subset of the /create-qa-plan command's", () => {
    const skillTools = parseSkillFrontmatter(md, SKILL_PATH)!.allowedTools!
    const commandTools = frontmatterToolList(readFileSync(COMMAND_PATH, "utf8"))
    expect(isToolSubset(skillTools, commandTools)).toBe(true)
  })

  it("Step 0 binds the converse — (unverified) is a defect on on-disk source", () => {
    expect(md).toContain("The converse is equally binding")
  })

  it("teaches the framework-default trap (verify against the installed version)", () => {
    expect(md).toContain("Framework defaults are the most common confident-wrong trap")
    expect(md).toContain("HTTPBearer")
  })

  it("Step 6.6 carries the reachability litmus + in-scope-by-default classes", () => {
    expect(md).toContain("Reachability litmus")
    expect(md).toContain("IDOR / cross-tenant")
  })

  it("Step 6.8 adds a targeted refute pass with the momus seam", () => {
    expect(md).toContain("Targeted refute pass")
    expect(md).toContain("intent to *refute*")
    expect(md).toContain("Momus seam")
  })

  it("Step 1.5 pins the contract before observing runtime", () => {
    expect(md).toContain("Pin the intended contract")
  })

  it("Step 3.5 forces an emitted Blockers section incl. markerless guards", () => {
    expect(md).toContain("None found.")
    expect(md).toContain("commented-out")
  })

  it("Step 6.6 closes the transitive-punt hole", () => {
    expect(md).toContain("property of the HARNESS, not of the code")
  })

  it("Step 6.7 requires the completed coverage matrix", () => {
    expect(md).toContain("complete the coverage matrix")
  })

  it("Step 6.8 carries the contract-vs-runtime refute check", () => {
    expect(md).toContain("contract-vs-runtime")
  })

  it("Step 4.5 states the runner dispatches scenarios in parallel", () => {
    expect(md).toContain("dispatches scenarios in parallel")
  })

  it("Step 6.9 sequences shared-quota scenarios via Depends-on", () => {
    expect(md).toContain("Step 6.9")
    expect(md).toContain("terminal wave")
  })

  it("Step 6.6 carries no-oracle IDOR equality and reflected-input injection", () => {
    expect(md).toContain("indistinguishable from not-found")
    expect(md).toContain("reflected into a response header")
  })

  it("Step 6.6 carries lock-release-on-error and a no-mutation invariant", () => {
    expect(md).toContain("lock releases on the error path")
    expect(md).toContain("mutates no persistent state")
  })

  it("Step 3.5 orders multi-step blocker remediation as Setup prerequisites", () => {
    expect(md).toContain("ordered list of human Setup prerequisites")
  })

  it("Step 0 tiers tests as corroboration, not oracle, with a confidence floor", () => {
    expect(md).toContain("they are not the oracle")
    expect(md).toContain("keeps an assertion at full confidence")
    expect(md).toContain("suspected defective test")
  })

  it("Step 6.8 requires a claim-specific, branch-governing citation", () => {
    expect(md).toContain("branch-governing citation")
  })

  it("Step 6.7 carries the surface-coverage anchor (R-A, self-referential)", () => {
    expect(md).toContain("every external surface named in your own")
    expect(md).toContain("row set == the surfaces you declared")
  })

  it("Step 6.8 treats an out-of-scope surface reason as a refute class (R-A)", () => {
    expect(md).toContain("out-of-scope surface dispositions")
    expect(md).toContain("Only a true harness limit survives")
  })

  it("Step 6.8 forbids hand-computed derived literals (R-B)", () => {
    expect(md).toContain("never assert a hand-computed encoding/hash/slug literal")
    expect(md).toContain("assert the producing rule")
  })

  it("Step 6.7 carries the findings re-scan loop-back (R-C)", () => {
    expect(md).toContain("re-scan the changed files for the Step 3.5 hazard classes")
    expect(md).toContain("not folded into another blocker")
  })

  it("Step 6.8 requires the raise-site+catcher pair for envelope claims (L1)", () => {
    expect(md).toContain("cite the *pair* — the raise-site AND the handler that catches that exception type")
  })

  it("Step 6.8 carries the order-gated resolution-order rule (L1)", () => {
    expect(md).toContain("name the resolution order you rely on and ground it")
  })

  it("Step 6.6 rejects pre-auth-rejected requests as a 429 recipe (L1)", () => {
    expect(md).toContain("never increments the bucket and is a coverage defect")
  })

  it("Step 6.7 locks reachable changed surfaces out of out-of-scope (L2)", () => {
    expect(md).toContain("A changed surface with a harness-observable interface")
  })

  it("Step 6.8 out-of-scope-surface bullet carries the reachable-interface test (L2)", () => {
    expect(md).toContain("if the changed surface has a curl/psql/Playwright interface or effect")
  })

  it("Step 6.6 carries the 422 schema-validation class (L3)", () => {
    expect(md).toContain("**Schema validation → 422** (any surface with a typed request body or typed params)")
  })
})
