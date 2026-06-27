import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const perun = readFileSync(
  join(__dirname, "../../src/agents/perun.md"),
  "utf8",
)

describe("Perun unified QA-loop workflow", () => {
  it("has a single QA Loop workflow, not separate Workflow 1 + Workflow 2", () => {
    expect(perun).toMatch(/###\s+Workflow 1:\s*QA Loop/)
    expect(perun).not.toMatch(/###\s+Workflow 2:\s*Issue Fix/)
  })

  it("drives the §4 phase pipeline by name", () => {
    expect(perun).toContain("Phase 0")
    expect(perun).toContain("Phase 1")
    expect(perun).toContain("Phase 2")
    expect(perun).toContain("Phase 3")
    expect(perun).toContain("Phase 4")
  })

  it("calls every qa_loop_* tool in the workflow body", () => {
    for (const t of [
      "qa_loop_start",
      "qa_loop_ingest",
      "qa_loop_step",
      "qa_loop_record_fix",
      "qa_loop_finalize",
      "qa_loop_undo",
    ]) {
      expect(perun).toContain(t)
    }
  })

  it("dispatches Svarog (not fix-auto) as the in-loop fixer", () => {
    // the loop body dispatches svarog one issue at a time
    expect(perun).toMatch(/agent:\s*"svarog"/)
    // no fix-auto dispatch survives anywhere in the workflow
    expect(perun).not.toContain("fix-auto")
  })

  it("preserves the reused-verbatim steps inside the loop", () => {
    expect(perun).toContain("Preflight prerequisites")
    expect(perun).toContain("Service bring-up (auto, via Stribog)")
    expect(perun).toContain("Parse bindings")
    expect(perun).toContain("Compute waves")
    expect(perun).toContain("NEED_INFO")
  })

  it("stops authoring the report itself — the tool is the single writer", () => {
    // the hand-Edit of Status: ✅ Fixed lines is gone
    expect(perun).not.toMatch(/Edit.*Status:.*✅ Fixed/)
  })
})
