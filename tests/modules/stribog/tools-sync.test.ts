import { describe, expect, it } from "vitest"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"
import { STRIBOG_ALLOWED_TOOL_IDS } from "../../../src/modules/stribog/stribog.metadata.js"

// MAINT-002: STRIBOG_TOOLS (display-cased prompt frontmatter, allowed-tools.ts) and
// STRIBOG_ALLOWED_TOOL_IDS (lowercase runtime gate, stribog.metadata.ts) are two
// hand-maintained lists describing ONE boundary. The "kept in sync" comment is prose;
// this test is the cross-check. It fails if a verb is added/removed on one side only —
// which would desync what the model is TOLD it can do from what the hook actually allows
// (the minter != actuator property depends on execute_recipe/task staying out of the gate).

/** Split STRIBOG_TOOLS into its `Bash(...)`-scoped verbs and its structured tools, then
 *  lowercase the structured names — that is the casing the runtime gate uses. Bash membership
 *  is derived from the mere PRESENCE of any `Bash(` entry, NOT a hard-coded verb list, so this
 *  stays robust to changes in the exact bash sub-command scoping. */
function deriveRuntimeIds(tools: readonly string[]) {
  const isBash = (t: string) => t.startsWith("Bash(")
  const hasBash = tools.some(isBash)
  const structured = new Set(tools.filter((t) => !isBash(t)).map((t) => t.toLowerCase()))
  return { hasBash, structured }
}

describe("Stribog tool-id gate <-> prompt list sync", () => {
  it("derives the gate's non-bash ids exactly from STRIBOG_TOOLS' structured entries", () => {
    const { structured } = deriveRuntimeIds(STRIBOG_TOOLS)
    const gateWithoutBash = new Set(STRIBOG_ALLOWED_TOOL_IDS)
    gateWithoutBash.delete("bash")

    // Both directions: lowercasing the structured prompt entries must reproduce the gate
    // (minus bash). A structured tool added to one list but not the other breaks this.
    expect([...structured].sort()).toEqual([...gateWithoutBash].sort())
  })

  it("has a Bash(...) entry iff the gate allows the lowercase `bash` id", () => {
    const { hasBash } = deriveRuntimeIds(STRIBOG_TOOLS)
    // Removing all Bash(...) verbs from the prompt OR dropping `bash` from the gate
    // (on one side only) flips exactly one of these and fails the equality.
    expect(hasBash).toBe(STRIBOG_ALLOWED_TOOL_IDS.has("bash"))
  })
})
