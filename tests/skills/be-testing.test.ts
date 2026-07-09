import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/be-testing/SKILL.md",
)

describe("be-testing skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("executes a plan-declared Seed FIRST via the one declared connection reference", () => {
    // The seed half of the QA data path — a failed seed reports as seed-missing, not a code defect.
    expect(md).toContain("Execute the Seed FIRST")
    expect(md).toContain("A failed seed reports as *seed-missing*, not as a code defect.")
  })

  it("§8 executes a Teardown block like a Seed, and a failed teardown never flips a scenario verdict (teardown-exec)", () => {
    // The ONLY place telling the BE executor how to run a teardown-only task (the finalize
    // teardown wave). Load-bearing for "modify then revert"; pinned so it can't silently regress.
    expect(md).toContain("**Teardown blocks.**")
    expect(md).toContain("A `**Teardown (psql/sqlite3):**` block executes exactly like a Seed")
    expect(md).toContain("the finalize teardown wave, run after all scenarios")
    // A failed teardown is surfaced but NEVER changes a scenario's pass/fail — it is cleanup.
    expect(md).toContain("NEVER changes a scenario's pass/fail")
  })

  it("carries the FAIL refutation battery with mutation safety", () => {
    expect(md).toContain("## FAIL refutation battery")
    // The load-bearing rule: a mutating request is NEVER re-fired (double-apply
    // lands outside the teardown accounting); re-verification re-READS state.
    expect(md).toContain("never re-fire the request")
    expect(md).toContain("not retry-until-pass")
  })

  it("liveness distinction routes environment gaps to NEED_INFO", () => {
    expect(md).toContain("NEED_INFO kind=service")
    expect(md).toContain("answered earlier in the scenario and then died")
  })

  it("gates sub-verdicts (edge-case lines + DB check) and widens the templates", () => {
    expect(md).toContain("the `**DB check:**` field")
    expect(md).toContain("- **Status:** PASS / FAIL / SKIP / NEED_INFO")
    expect(md).toContain("<edge case 1>: PASS / FAIL / SKIP — <details>")
  })

  it("aligns tool detection to the core SKIP-vs-NEED_INFO rule", () => {
    expect(md).toContain('kind: "tool"')
  })
})
