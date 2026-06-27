import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function makeSidecar(reportDir: string): Sidecar {
  return {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md",
    plan_sha256: "abc123",
    report_path: join(reportDir, "2026-06-26-demo-report.md"),
    config: {
      mode: "approve",
      severity_floor: "LOW",
      max_iterations: 3,
      max_dispatches: 50,
      time_budget_s: 1800,
      allow_mutations: false,
    },
    started_at: 1000,
    updated_at: 1000,
    finalized_at: null,
    budgets: {
      iteration: 0,
      dispatch_count_total: 0,
      elapsed_s: 0,
      final_pass_elapsed_s: null,
    },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {},
    issues: {},
    iterations: [],
    coverage: {
      exercised: { feature: 0, sanity: 0, enforcement: 0 },
      not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 },
      routing_warnings: [],
    },
    result: null,
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qa-loop-sidecar-"))
})

describe("QaLoopState", () => {
  it("returns undefined when nothing is stored", () => {
    const st = new QaLoopState()
    expect(st.load("ses_parent")).toBeUndefined()
  })

  it("round-trips a sidecar via the in-process map", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)
    expect(st.load("ses_parent")).toEqual(s)
  })

  it("writes the sidecar to its report_path-derived disk path atomically", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)

    // disk path = report_path with the -report.md stem swapped for -loop-state.json
    const expectedPath = join(dir, "2026-06-26-demo-loop-state.json")
    expect(existsSync(expectedPath)).toBe(true)
    const onDisk = JSON.parse(readFileSync(expectedPath, "utf8")) as Sidecar
    expect(onDisk).toEqual(s)
    // atomic write leaves no .tmp turd behind
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false)
  })

  it("loads from disk when the in-process map is cold (cross-session resume)", () => {
    const writer = new QaLoopState()
    const s = makeSidecar(dir)
    writer.save("ses_parent", s)

    // a fresh process: empty map, but the same parent id can be primed from disk
    const reader = new QaLoopState()
    expect(reader.loadFromDisk(s.report_path)).toEqual(s)
  })

  it("overwrites a prior save (single-writer durability)", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)
    const s2 = { ...s, updated_at: 2000, budgets: { ...s.budgets, dispatch_count_total: 4 } }
    st.save("ses_parent", s2)
    expect(st.load("ses_parent")?.budgets.dispatch_count_total).toBe(4)
    const expectedPath = join(dir, "2026-06-26-demo-loop-state.json")
    expect((JSON.parse(readFileSync(expectedPath, "utf8")) as Sidecar).updated_at).toBe(2000)
  })

  it("clearRun removes the in-process map entry but leaves the disk sidecar intact", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)

    st.clearRun("ses_parent")

    // in-process map is gone
    expect(st.load("ses_parent")).toBeUndefined()
    // disk sidecar survives for cross-session resume
    expect(st.loadFromDisk(s.report_path)).toEqual(s)
  })
})
