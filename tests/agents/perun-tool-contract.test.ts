import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * Contract-pinning test: the Perun coordinator prompt (`src/agents/perun.md`) documents
 * how it calls the six `qa_loop_*` tools. Those tools' real Zod input schemas + return
 * shapes live in `src/modules/qa-loop/tools.ts`. The prompt and the tools were authored
 * separately and once drifted apart (the prompt called the tools with invented arg names
 * and consumed return fields the tools never emit — an LLM following it would Zod-throw on
 * the first `qa_loop_step`). This test pins the documented call contract so that drift can
 * NEVER recur silently: it asserts the WRONG tokens are absent and the RIGHT tokens present.
 *
 * Each of the 6 historical mismatches has both a "must NOT contain" and a "must contain"
 * guard below — re-introducing any one of them fails this test.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const perun = readFileSync(join(__dirname, "../../src/agents/perun.md"), "utf8")

/**
 * The ARGUMENT-OBJECT text of every `qa_loop_*({ ... })` call in the prompt — i.e. just the
 * `{ ... }` actually passed INTO the tool, NOT any `→ { ...return... }` annotation that may
 * share the same line (the tools legitimately RETURN `run_id`, so we must not flag that).
 * Brace-balanced extraction from the first `{` after `(`.
 */
function qaLoopCallArgs(): string[] {
  const out: string[] = []
  const re = /qa_loop_\w+\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(perun)) !== null) {
    const openIdx = perun.indexOf("{", m.index)
    let depth = 0
    let end = openIdx
    for (let i = openIdx; i < perun.length; i++) {
      const ch = perun[i]
      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    out.push(perun.slice(openIdx, end + 1))
  }
  return out
}

/** The tool name for each call captured by qaLoopCallArgs(), in the same order. */
function qaLoopCallArgsToolNames(): string[] {
  const out: string[] = []
  const re = /(qa_loop_\w+)\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(perun)) !== null) out.push(m[1]!)
  return out
}

describe("Perun ↔ qa_loop_* tool-call contract", () => {
  // ── Mismatch 6 (the cross-cutting one): run_id is on NONE of the six schemas. ──
  it("never passes run_id INTO a qa_loop_* tool call", () => {
    const args = qaLoopCallArgs()
    expect(args.length).toBeGreaterThan(0)
    for (const a of args) {
      // `run_id` may appear in prose or as a RETURNED field, but never inside the args object.
      expect(a).not.toContain("run_id")
    }
  })

  // ── Mismatch 1: qa_loop_step arg is `phase`, not `op`; values "enter"/"evaluate". ──
  it("qa_loop_step uses phase: (not op:)", () => {
    expect(perun).not.toMatch(/\bop:\s*["']?(enter|evaluate)/)
    expect(perun).not.toContain("op: \"enter\"")
    expect(perun).not.toContain("op: \"evaluate\"")
    expect(perun).toMatch(/qa_loop_step\(\{\s*phase:\s*"enter"/)
    expect(perun).toMatch(/qa_loop_step\(\{\s*phase:\s*"evaluate"/)
  })

  // ── Phase-1 exit routes via qa_loop_step({phase:"enter"})'s action, not an ingest field. ──
  it("routes the Phase-1 exit through qa_loop_step, consuming its action", () => {
    // The §4 enter actions the prompt must consume.
    expect(perun).toMatch(/action:\s*"fix"/)
    expect(perun).toMatch(/action:\s*"final"/)
    expect(perun).toMatch(/action:\s*"stop"/)
  })

  // ── Mismatch 3: qa_loop_ingest returns { status, new_qa_ids }, not { failing, result_if_terminal }. ──
  it("qa_loop_ingest consumes new_qa_ids and never result_if_terminal/failing", () => {
    expect(perun).not.toContain("result_if_terminal")
    expect(perun).not.toMatch(/\{\s*failing:/)
    expect(perun).toContain("new_qa_ids")
  })

  // ── Mismatch 4: qa_loop_record_fix emits stop_cause:"checkpoint-integrity", not integrity_abort. ──
  it("qa_loop_record_fix reads stop_cause checkpoint-integrity (not integrity_abort)", () => {
    expect(perun).not.toContain("integrity_abort")
    expect(perun).toContain("checkpoint-integrity")
    // stop_cause is the field the tool actually emits after record_fix.
    expect(perun).toContain("stop_cause")
  })

  // ── Mismatch 5: qa_loop_start returns no base_url and no TAMPER disposition. ──
  it("does not treat base_url or a TAMPER disposition as qa_loop_start return fields", () => {
    // base_url as a snake_case return field must not appear at all.
    expect(perun).not.toContain("base_url")
    // qa_loop_start's documented return must list the REAL dispositions and fields.
    const startReturn = perun.slice(
      perun.indexOf("It returns `{ status: \"ok\", disposition:"),
      perun.indexOf("It returns `{ status: \"ok\", disposition:") + 400,
    )
    expect(startReturn).toContain("REUSE")
    expect(startReturn).toContain("ADOPT")
    expect(startReturn).toContain("FRESH")
    expect(startReturn).not.toContain("TAMPER")
    expect(startReturn).toContain("dispatch_set")
    expect(startReturn).toContain("pre_loop_ref")
    expect(startReturn).toContain("qa_id_start_at")
  })

  // ── qa_loop_start is CALLED with the required args topic + report_path (Zod-required). ──
  it("every qa_loop_start call passes the required topic and report_path args", () => {
    const startArgs = qaLoopCallArgs().filter(
      (a, i) => qaLoopCallArgsToolNames()[i] === "qa_loop_start",
    )
    expect(startArgs.length).toBeGreaterThanOrEqual(2) // Phase-0 template + end-to-end example
    for (const a of startArgs) {
      expect(a).toContain("topic:")
      expect(a).toContain("report_path:")
    }
  })

  // ── Mismatch 2: qa_loop_finalize takes no required wall-clock; called with {} (or no arg). ──
  it("qa_loop_finalize is called without supplying final_pass_elapsed_s", () => {
    // The prompt must call finalize with an empty object — Perun has no wall-clock to pass.
    expect(perun).toMatch(/qa_loop_finalize\(\{\s*\}\)/)
    // It must never pass final_pass_elapsed_s into the call.
    expect(perun).not.toMatch(/qa_loop_finalize\(\{[^}]*final_pass_elapsed_s/)
  })

  // ── Every qa_loop_* call site uses only real arg names (defensive umbrella). ──
  it("no qa_loop_* call site carries a phantom argument", () => {
    const args = qaLoopCallArgs()
    expect(args.length).toBeGreaterThan(0)
    for (const a of args) {
      expect(a).not.toContain("run_id")
      expect(a).not.toMatch(/\bop:/)
    }
  })
})
