import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  PERUN_PLACEHOLDERS,
  buildPerunPrompt,
} from "../../../src/modules/agent-registry/index.js"
import { zmoraSpecialistInfo } from "../../../src/modules/qa/zmora.metadata.js"
import { fixAutoSpecialistInfo } from "../../../src/modules/agent-registry/fix-auto.metadata.js"
import { triglavSpecialistInfo } from "../../../src/modules/explore/triglav.metadata.js"
import { DISPATCHABLE_ALL_AGENTS } from "../../../src/modules/coordinator/dispatch.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")

const ALLOWLIST = [...DISPATCHABLE_ALL_AGENTS].sort((a, b) =>
  a.localeCompare(b),
)

function render(): string {
  const template = readFileSync(PERUN_MD, "utf8")
  // Every {USE_AVOID:<name>} placeholder in perun.md MUST have its agent here —
  // buildUseAvoidSection throws "Unknown agent in placeholder" otherwise. When you
  // add a new specialist with a use/avoid section, add its SpecialistInfo to this array.
  // Pass the dispatchable allowlist so {DISPATCHABLE_ALLOWLIST} renders from the live
  // constant (mirrors how coordinator/index.ts builds the real prompt).
  return buildPerunPrompt(
    template,
    [fixAutoSpecialistInfo, zmoraSpecialistInfo, triglavSpecialistInfo],
    { dispatchableAllowlist: ALLOWLIST },
  )
}

describe("perun prompt integration", () => {
  it("renders both specialist rows", () => {
    const out = render()
    expect(out).toContain("| `zmora` | subagent |")
    expect(out).toContain("| `fix-auto` | subagent |")
  })

  it("leaves no unsubstituted placeholder", () => {
    expect(render()).not.toMatch(/\{[A-Z_][A-Za-z0-9_:-]*\}/)
  })

  it("renders Triglav's table row, key-trigger, delegation row, and use/avoid section", () => {
    const out = render()
    expect(out).toContain("| `triglav` | subagent |")
    expect(out).toContain("fire `triglav` before planning")
    expect(out).toContain("| Code exploration | `triglav` |")
    expect(out).toContain("### Use `triglav` when:")
    expect(out).toContain("Multiple search angles needed")
  })

  it("declares every builder placeholder in perun.md", () => {
    const template = readFileSync(PERUN_MD, "utf8")
    for (const name of PERUN_PLACEHOLDERS) {
      expect(template).toContain(`{${name}}`)
    }
  })

  it("renders the dispatchable allowlist from the constant — each entry appears verbatim", () => {
    const out = render()
    // The {DISPATCHABLE_ALLOWLIST} placeholder must resolve from the live
    // DISPATCHABLE_ALL_AGENTS set, not be hand-written in prose. Assert every
    // constant entry appears literally (backticked) in the render, so adding or
    // renaming an allowlist entry can never drift from the prompt text.
    expect(ALLOWLIST.length).toBeGreaterThan(0)
    for (const name of ALLOWLIST) {
      expect(out).toContain(`\`${name}\``)
    }
  })

  it("does not repeat the legacy hand-written allowlist clause", () => {
    // Guards against re-introducing the duplicated prose the placeholder replaced.
    expect(render()).not.toContain(
      "the lone entry in the `DISPATCHABLE_ALL_AGENTS` allowlist",
    )
  })
})
