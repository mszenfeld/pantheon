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

  it("Coverage Matrix and checklist require a row per changed external surface (R-A)", () => {
    expect(md).toContain("per changed external surface named in the Changes Summary")
    expect(md).toContain("one row per status and per changed external surface")
  })

  it("grounding tags carry the function-derived-value rule (R-B)", () => {
    expect(md).toContain("Function-derived values")
    expect(md).toContain("not a hand-computed literal")
    expect(md).toContain("generating rule + producer")
  })

  it("Coverage Matrix desc locks reachable surfaces out of out-of-scope (L2)", () => {
    expect(md).toContain("A changed surface with a harness-observable interface (route / DB-effect / Playwright)")
  })

  it("Plan Quality Checklist forbids out-of-scoping a reachable changed surface (L2)", () => {
    expect(md).toContain("No changed surface with a curl/psql/Playwright interface or effect is dispositioned")
  })

  it("Blocker template carries the optional hermetic-observation pointer (L4)", () => {
    expect(md).toContain("**Hermetic observation (optional):**")
  })

  it("Coverage Matrix Pointer cell allows a hermetic pointer on blocked rows (L4)", () => {
    expect(md).toContain("whose contract is unobservable live may add a")
  })
})
