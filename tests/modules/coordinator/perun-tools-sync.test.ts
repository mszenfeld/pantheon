import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PERUN_TOOLS } from "../../../src/modules/coordinator/index.js"
import { QA_LOOP_TOOL_NAMES } from "../../../src/modules/qa-loop/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")

describe("Perun tool sync", () => {
  it("lists every PERUN_TOOLS name in perun.md allowed-tools", () => {
    const md = readFileSync(PERUN_MD, "utf8")
    const allowed = md.match(/^allowed-tools:\s*(.+)$/m)?.[1] ?? ""
    for (const t of PERUN_TOOLS) {
      expect(allowed).toContain(t)
    }
  })

  it("includes the three background tools", () => {
    expect(PERUN_TOOLS).toEqual(
      expect.arrayContaining([
        "dispatch_background",
        "poll_background",
        "wait_background",
      ]),
    )
  })

  it("includes all six qa-loop tool names", () => {
    expect(PERUN_TOOLS).toEqual(
      expect.arrayContaining([...QA_LOOP_TOOL_NAMES]),
    )
  })
})
