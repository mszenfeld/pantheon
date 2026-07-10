import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/be-testing/SKILL.md",
)

/**
 * Return the whitespace-normalized text from `anchor` up to the next Markdown
 * heading or `---` rule. Assertions about ONE section must be scoped to it:
 * tokens like `kind: "tool"` recur in several sections, so a document-wide
 * `toContain` cannot tell "this section still says NEED_INFO" from "some other
 * section happens to mention it".
 */
function blockAt(md: string, anchor: string): string {
  const i = md.indexOf(anchor)
  if (i === -1) return ""
  const rest = md.slice(i)
  const end = rest.search(/\n(?:#{1,6} |---)/)
  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ")
}

describe("be-testing skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")
  // Whitespace-normalized copy for reflow-invariant prose pins: the doctrine
  // prose is hard-wrapped, so a benign re-wrap must not break a multi-word pin.
  const flat = md.replace(/\s+/g, " ")

  it("executes a plan-declared Seed FIRST via the one declared connection reference", () => {
    // The seed half of the QA data path — a failed seed reports as seed-missing, not a code defect.
    expect(flat).toContain("Execute the Seed FIRST")
    expect(flat).toContain("A failed seed reports as *seed-missing*, not as a code defect.")
  })

  it("§8 executes a Teardown block like a Seed, and a failed teardown never flips a scenario verdict (teardown-exec)", () => {
    // The ONLY place telling the BE executor how to run a teardown-only task (the finalize
    // teardown wave). Load-bearing for "modify then revert"; pinned so it can't silently regress.
    expect(md).toContain("**Teardown blocks.**")
    expect(flat).toContain("A `**Teardown (psql/sqlite3):**` block executes exactly like a Seed")
    expect(flat).toContain("the finalize teardown wave, run after all scenarios")
    // A failed teardown is surfaced but NEVER changes a scenario's pass/fail — it is cleanup.
    expect(flat).toContain("NEVER changes a scenario's pass/fail")
  })

  it("carries the FAIL refutation battery with mutation safety", () => {
    expect(md).toContain("## FAIL refutation battery")
    // The load-bearing rule: a mutating request is NEVER re-fired (double-apply
    // lands outside the teardown accounting); re-verification re-READS state.
    expect(flat).toContain("never re-fire the request")
    expect(flat).toContain("not retry-until-pass")
  })

  it("liveness distinction routes environment gaps to NEED_INFO", () => {
    expect(md).toContain("NEED_INFO kind=service")
    expect(flat).toContain("answered earlier in the scenario and then died")
  })

  it("gates sub-verdicts (edge-case lines + DB check) and widens the templates", () => {
    expect(flat).toContain("the `**DB check:**` field")
    expect(md).toContain("- **Status:** PASS / FAIL / SKIP / NEED_INFO")
    expect(md).toContain("<edge case 1>: PASS / FAIL / SKIP — <details>")
  })

  it("aligns tool detection to the core SKIP-vs-NEED_INFO rule", () => {
    // Scoped to the Tool Detection block on purpose. `kind: "tool"` also occurs in
    // the battery's check 2 and in Error Handling, so a document-wide toContain
    // stays GREEN after this block reverts to the pre-branch "no HTTP client →
    // mark all API scenarios as SKIP" — i.e. it never guarded the alignment it
    // is named for. Reverting the block now drops the NEED_INFO pin and fails.
    const toolDetection = blockAt(md, "Use the first available tool from each category")
    expect(toolDetection).not.toBe("")
    expect(toolDetection).toContain('`NEED_INFO` with `kind: "tool"`')
    expect(toolDetection).toMatch(/SKIP only for scenarios inapplicable/i)
    expect(toolDetection).not.toMatch(/mark all API scenarios as SKIP/i)
  })

  it("aligns the Error Handling no-HTTP-client bullet to the same rule", () => {
    // The other half of the §7.2 alignment, equally revertible on its own.
    // Anchor includes the trailing newline: the skill ALSO has an earlier
    // "## Error Handling Test Patterns" heading that a bare prefix would hit.
    const errorHandling = blockAt(md, "## Error Handling\n")
    expect(errorHandling).not.toBe("")
    expect(errorHandling).toContain('return `NEED_INFO` with `kind: "tool"`')
    expect(errorHandling).not.toMatch(/mark ALL API scenarios as SKIP/i)
  })
})
