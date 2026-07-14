import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sectionsDir = join(__dirname, "../../../src/modules/qa/prompt-sections")

/**
 * Only `overlay-fe.md` carries a battery pointer, and the asymmetry is deliberate.
 *
 * `overlay-fe.md` step 5 has a prompt-level "If not met → … return FAIL"
 * instruction. That text sits in the SAME assembled context as the fe-testing
 * skill and short-circuits the skill-level battery, so the overlay must route
 * that FAIL through the battery itself. Per the design spec (§7.2) this gate is
 * "the only prompt-section edit belonging to Leg 3".
 *
 * `overlay-be.md` gets no pointer: it has no "return FAIL" instruction to
 * short-circuit, and the be-testing battery is self-triggering (bound to the ACT
 * of returning a FAIL) and mandatorily loaded. A pointer there would transcribe
 * a rule be-testing owns — a second drift site, which `docs/agent-contracts.md`
 * ("cite by pointer — never transcribes") names as a defect. If you are reading
 * this because BE/FE look asymmetric: the asymmetry IS the design.
 */
const FE = { file: "overlay-fe.md", skill: "fe-testing" }

describe("qa prompt-section overlays wire the FAIL refutation battery", () => {
  it(`${FE.file} routes FAIL through the ${FE.skill} refutation battery`, () => {
    const path = join(sectionsDir, FE.file)
    expect(existsSync(path)).toBe(true)

    // Whitespace-normalized so a benign reflow (the pointer wrapping onto a
    // new line) cannot fake a regression.
    const flat = readFileSync(path, "utf8").replace(/\s+/g, " ")

    // Bind the SPECIFIC skill to the battery pointer: "<skill> … FAIL
    // refutation battery first". Two deliberate choices make this bite where
    // a weaker check would not:
    //   - matching "FAIL refutation battery first" (not the bare word "FAIL")
    //     — "FAIL" is the ambient verdict token that litters the overlay, so a
    //     bare match survives deletion of the refutation seam entirely;
    //   - anchoring on <skill> just before it — so the battery cannot be
    //     silently re-homed to the wrong/nonexistent skill.
    // Removing the "run the fe-testing skill's FAIL refutation battery first"
    // instruction from the overlay drops this match and fails the test.
    expect(flat).toMatch(
      new RegExp(`${FE.skill}.{0,25}FAIL refutation battery first`, "i"),
    )
  })

  it("overlay-be.md does not transcribe be-testing's battery or mutation rule", () => {
    // Pin the ABSENCE. be-testing's battery check 1 owns "never re-fire a
    // mutating request"; a copy in the overlay lets the two texts diverge and
    // leaves the assembled BE context carrying two mutation-safety statements.
    // This guard is what stops the copy creeping back in as a well-meant
    // "fix the FE/BE asymmetry" edit.
    const flat = readFileSync(join(sectionsDir, "overlay-be.md"), "utf8")
      .replace(/\s+/g, " ")
      .toLowerCase()

    expect(flat).not.toMatch(/re-fire a mutating request/)
    expect(flat).not.toMatch(/fail refutation battery/)
  })
})
