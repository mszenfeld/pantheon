import { tool } from "@opencode-ai/plugin"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { CallerGate } from "../qa/caller-gate.js"
import type { Sidecar, ScenarioRecord, ScenarioKind, Mode, SeverityFloor, IssueRecord, ScenarioState, IterationRecord, IterationPhase, StopCause } from "./types.js"
import { QaLoopState } from "./sidecar.js"
import { hashPlan } from "./plan-hash.js"
import { classifyScenario } from "./classify.js"
import { routeSkip } from "./coverage.js"
import { capturePreLoopRef, refExists, restoreFailRef, antiHardcodeDiff, undoToPreLoop } from "./git-ops.js"
import { stepEnter, stepEvaluate, resultOf } from "./state-machine.js"
import { renderReport } from "./report.js"

export interface QaLoopToolDeps {
  gate: Pick<CallerGate, "isCoordinatorCaller">
  state: QaLoopState
  cwd: string
  resolveParentID: (sessionID: string) => Promise<string>
  // The existing coordinator minter (src/modules/coordinator/index.ts assign_issue_ids).
  // Perun wires the real one in; tests pass a deterministic fake.
  assignIssueIds: (input: {
    findings: { scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[]
    startAt?: number
  }) => Promise<{ id: string; scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[]>
}

const FORBIDDEN = (name: string) =>
  JSON.stringify({
    status: "forbidden",
    reason: `${name} is restricted to the coordinator (Perun)`,
  })

function sectionOf(id: string): "FE" | "BE" | "SETUP" {
  if (id.startsWith("FE")) return "FE"
  if (id.startsWith("SETUP")) return "SETUP"
  return "BE"
}

/** Split the plan into per-scenario blocks keyed by scenario id. */
function splitScenarios(planText: string): { id: string; block: string; malformed?: boolean }[] {
  const lines = planText.split("\n")
  const blocks: { id: string; block: string; malformed?: boolean }[] = []
  let current: { id: string; lines: string[] } | null = null
  // A heading that starts like a scenario prefix but has a trailing alphanumeric
  // suffix after the number (e.g. `### FE-01a`) must NOT be silently folded into the
  // previous scenario's body — a merge can smuggle a foreign body (e.g. a "blocked"
  // assertion) into a seed-bearing block. Detect that malformed heading and surface it
  // as its own zero-body block, tagged `malformed`, so qa_loop_start records it as a
  // visible SKIP (never dispatched, never a phantom `fail`) rather than attaching it to
  // the preceding scenario.
  const MALFORMED_HEADING = /^#{2,4}\s+(?:FE|BE|SETUP)-\d+[A-Za-z0-9]/i
  for (const line of lines) {
    // Match the documented scenario heading (`### FE-01:` / `### BE-01:`,
    // test-plan-format §Plan Structure). Lenient on heading depth (##..####)
    // so an authoring wobble never silently yields zero scenarios.
    const m = /^#{2,4}\s+((?:FE|BE|SETUP)-\d+)\b/i.exec(line)
    if (m) {
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
      current = { id: (m[1] ?? "").toUpperCase(), lines: [line] }
    } else if (MALFORMED_HEADING.test(line)) {
      // Close the current scenario (do not absorb this heading's body) and emit the
      // malformed heading as a standalone, id-carrying, zero-body block flagged malformed.
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
      const id = (/^#{2,4}\s+((?:FE|BE|SETUP)-\d+[A-Za-z0-9]*)/i.exec(line)?.[1] ?? "").toUpperCase()
      blocks.push({ id, block: line, malformed: true })
      current = null
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
  return blocks
}

/** Detect working-tree dirty state (tracked modifications + untracked files). */
function detectDirty(cwd: string): { dirty: boolean; dirty_files: string[] } {
  let output = ""
  try {
    output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
    })
  } catch {
    return { dirty: false, dirty_files: [] }
  }
  const lines = output.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { dirty: false, dirty_files: [] }
  const dirty_files = lines.map((l) => l.slice(3).trim())
  return { dirty: true, dirty_files }
}

/** Loop budget defaults — the single source the tool reads (docs quote these). */
export const QA_LOOP_DEFAULTS = { maxIterations: 3, maxDispatches: 50, timeBudgetS: 1800 } as const

/**
 * Resolve a repo-relative (or absolute-inside-repo) path and assert it stays within `cwd`.
 * Returns null when the path escapes the repo — CWE-22/73 containment for the privileged
 * report/sidecar write sink. The caller turns null into a tool-level error.
 */
function containedPath(cwd: string, p: string): string | null {
  const root = resolve(cwd)
  const abs = resolve(root, p)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  return abs
}

/** Build a fresh IterationRecord (one place, so every push stays field-complete). */
function newIterationRow(
  n: number,
  opts?: { phase?: IterationPhase; pending?: string[]; stop_cause?: StopCause | null },
): IterationRecord {
  return {
    n,
    phase: opts?.phase ?? "selecting",
    pending: opts?.pending ?? [],
    in_flight: null,
    attempted_so_far: [],
    now_passing: [],
    still_failing: [],
    stop_cause: opts?.stop_cause ?? null,
    regressions: [],
    warnings: [],
    dispatches_this_iter: 0,
    elapsed_s: 0,
  }
}

export function makeQaLoopTools(deps: QaLoopToolDeps) {
  const { gate, state, cwd, resolveParentID, assignIssueIds } = deps

  const qa_loop_start = tool({
    description: [
      "Phase 0 of the QA loop (RESOLVE & GUARD). Perun-only. Hashes the plan for idempotency, decides REUSE/ADOPT/FRESH, classifies every scenario, strips mutating-expected-success scenarios from the dispatch set (mutation guard), captures the pre-loop undo ref, and runs the working-tree dirty check.",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", disposition: "REUSE"|"ADOPT"|"FRESH", run_id, pre_loop_ref, dispatch_set: string[], dirty: boolean, dirty_files: string[], qa_id_start_at?: number }`.',
      '- `{ status: "forbidden", reason }` — caller is not the coordinator.',
    ].join("\n"),
    args: {
      plan_path: tool.schema.string().describe("Repo-relative path to the QA plan markdown."),
      topic: tool.schema.string().describe("Short topic slug for run_id + sidecar/report stem."),
      report_path: tool.schema.string().describe("Repo-relative path to the report markdown."),
      mode: tool.schema.enum(["approve", "auto", "step"]).optional(),
      severity_floor: tool.schema.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      max_iterations: tool.schema.number().optional(),
      max_dispatches: tool.schema.number().optional(),
      time_budget_s: tool.schema.number().optional(),
      allow_mutations: tool.schema.boolean().optional(),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_start")
      const parentId = await resolveParentID(ctx.sessionID)

      // Absolute paths for sidecar (which uses the path as-is for disk writes).
      // Containment: both must resolve INSIDE the repo — they feed privileged writeFileSync
      // sinks (the report + the sidecar), so a traversal path is rejected here in code.
      const absReportPath = containedPath(cwd, args.report_path)
      const absPlanPath = containedPath(cwd, args.plan_path)
      if (!absReportPath || !absPlanPath) {
        return JSON.stringify({ status: "error", reason: "report_path and plan_path must resolve within the repository" })
      }

      const planText = readFileSync(absPlanPath, "utf8")
      const sha = hashPlan(planText)
      const allowMutations = args.allow_mutations ?? false

      const config: Sidecar["config"] = {
        mode: (args.mode as Mode) ?? "approve",
        severity_floor: (args.severity_floor as SeverityFloor) ?? "LOW",
        max_iterations: args.max_iterations ?? QA_LOOP_DEFAULTS.maxIterations,
        max_dispatches: args.max_dispatches ?? QA_LOOP_DEFAULTS.maxDispatches,
        time_budget_s: args.time_budget_s ?? QA_LOOP_DEFAULTS.timeBudgetS,
        allow_mutations: allowMutations,
      }

      // Idempotency disposition (§5 table). Cross-session REUSE requires reading
      // the on-disk sidecar — the in-process Map is cold on a fresh server start.
      const onDisk = state.loadFromDisk(absReportPath)
      if (onDisk && onDisk.plan_sha256 === sha) {
        // REUSE: same plan hash, same report stem — resume the prior run.
        onDisk.updated_at = Date.now()
        state.save(parentId, onDisk)
        return JSON.stringify({
          status: "ok",
          disposition: "REUSE",
          run_id: onDisk.run_id,
          pre_loop_ref: onDisk.pre_loop.undo_ref,
          dispatch_set: Object.entries(onDisk.scenarios)
            .filter(([, sc]) => sc.current !== "skip")
            .map(([id]) => id),
          dirty: onDisk.pre_loop.dirty,
          dirty_files: onDisk.pre_loop.dirty_files,
        })
      }

      // ADOPT vs FRESH: does a report file already exist?
      let reportExists = false
      let qaIdStartAt: number | undefined
      try {
        const reportText = readFileSync(absReportPath, "utf8")
        reportExists = true
        // ADOPT: mint new IDs starting after the highest existing QA-n in the report.
        const ids = [...reportText.matchAll(/\bQA-(\d+)\b/g)].map((m) => Number(m[1]))
        qaIdStartAt = (ids.length ? Math.max(...ids) : 0) + 1
      } catch {
        reportExists = false
      }
      const disposition: "ADOPT" | "FRESH" = reportExists ? "ADOPT" : "FRESH"

      // Classify every scenario; apply the mutation guard pre-dispatch.
      const scenarios: Record<string, ScenarioRecord> = {}
      const dispatchSet: string[] = []
      for (const { id, block, malformed } of splitScenarios(planText)) {
        if (malformed) {
          // A suffixed/typo'd heading (e.g. `### BE-02a`) has no recognised scenario
          // prefix. Record it as a visible SKIP — never dispatched — so the report shows
          // it AND the state machine can still reach `final`. Recording it as `fail`
          // (its heading text classifies non-mutating) would keep stillFailing() non-empty
          // forever: no Zmora wave ever ingests it, so the loop would burn every iteration
          // and corrupt the verdict/coverage. Mirrors Perun's sanitizer promise (perun.md
          // Step 3: SKIP, reason "no recognised prefix", never dispatched).
          scenarios[id] = {
            qa_ids: [],
            kind: "feature",
            section: sectionOf(id),
            mutating: false,
            baseline: "skip",
            current: "skip",
            reason: "malformed heading — no recognised prefix (expected FE-/BE-/SETUP-NN)",
          }
          continue
        }
        const { kind, mutating, expectsSuccess } = classifyScenario(block)
        // A plan-declared Seed block (`**Seed (psql/sqlite3):**`) is a fixture WRITE by
        // definition — be-testing executes its fenced SQL before the request, for ANY
        // write verb (INSERT / UPDATE / DELETE / TRUNCATE / UPSERT / …). Gate it on
        // operator consent ALONE: never key on the specific verb, and never let a
        // "blocked/reject/403/no-row" phrase elsewhere in the same block flip its
        // expected-outcome and exempt the write. Marker-keyed, not disposition-keyed and
        // not verb-keyed (qa-plan-authoring §"Write-safety is marker-keyed"). Every
        // non-seed scenario keeps the §7 rule: strip only mutating-expected-success (a
        // negative-blocked mutation is kept, the write never lands — AC19/AC20).
        const isSeedWrite = /^\s*\*\*Seed \(psql\/sqlite3\):\*\*/im.test(block)
        const stripped = isSeedWrite
          ? !allowMutations
          : mutating && expectsSuccess && !allowMutations
        scenarios[id] = {
          qa_ids: [],
          kind: kind as ScenarioKind,
          section: sectionOf(id),
          mutating,
          baseline: stripped ? "skip" : "fail",
          current: stripped ? "skip" : "fail",
          reason: stripped
            ? isSeedWrite
              ? "mutation-guard: plan-declared Seed write requires allow_mutations (seed-consent gate)"
              : "mutation-guard: mutating scenario expected to succeed"
            : null,
        }
        if (!stripped) dispatchSet.push(id)
      }

      // Loud-failure guards — a QA loop with nothing to run must ERROR, never
      // silently return ok + an empty dispatch_set (the caller would sail past it).
      if (Object.keys(scenarios).length === 0) {
        return JSON.stringify({
          status: "error",
          reason:
            "0 scenarios parsed from the plan — expected scenario headings like '### FE-01:' or '### BE-01:' (test-plan-format §Plan Structure). Check the plan's scenario heading format.",
        })
      }
      if (dispatchSet.length === 0) {
        return JSON.stringify({
          status: "error",
          reason: `all ${Object.keys(scenarios).length} scenario(s) were stripped by the mutation guard (mutating-expected-success, or a plan-declared Seed write without consent). Re-run with allow_mutations to exercise them, or the plan needs negative/non-mutating coverage.`,
        })
      }

      const runId = `qa-loop-${args.topic}-${reportExists ? 2 : 1}`
      const undoRef = capturePreLoopRef(cwd, runId)
      const { dirty, dirty_files } = detectDirty(cwd)

      const preLoop = { undo_ref: undoRef, dirty, dirty_files }

      const now = Date.now()
      const sidecar: Sidecar = {
        version: 1,
        run_id: runId,
        plan_path: absPlanPath,
        plan_sha256: sha,
        report_path: absReportPath,
        config,
        started_at: now,
        updated_at: now,
        finalized_at: null,
        budgets: {
          iteration: 0,
          dispatch_count_total: 0,
          elapsed_s: 0,
          final_pass_elapsed_s: null,
        },
        pre_loop: preLoop,
        scenarios,
        issues: {},
        iterations: [],
        // exercised/not_verified are a render-time projection (deriveCoverage); only
        // routing_warnings accumulates on the sidecar, so the buckets initialize to zero.
        coverage: {
          exercised: { feature: 0, sanity: 0, enforcement: 0 },
          not_verified: {
            "auth-unverified": 0,
            "mutation-guard": 0,
            "tool-unavailable": 0,
          },
          routing_warnings: [],
        },
        result: null,
      }
      state.save(parentId, sidecar)

      return JSON.stringify({
        status: "ok",
        disposition,
        run_id: runId,
        pre_loop_ref: undoRef,
        dispatch_set: dispatchSet,
        dirty,
        dirty_files,
        ...(qaIdStartAt !== undefined ? { qa_id_start_at: qaIdStartAt } : {}),
      })
    },
  })

  const qa_loop_ingest = tool({
    description: [
      "Record a Zmora wave's results into the loop sidecar. Perun-only. Updates each scenario's `current` state, rolls coverage buckets, and mints QA-IDs (via assign_issue_ids) for new failing scenarios that have no id yet. Call after every Zmora wave (baseline / retest / final).",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", new_qa_ids: string[] }`.',
      '- `{ status: "forbidden", reason }`.',
    ].join("\n"),
    args: {
      phase: tool.schema.enum(["baseline", "retest", "final"]),
      start_at_qa_id: tool.schema.number().optional().describe("ADOPT only: first QA-ID number (max report id + 1)."),
      results: tool.schema.array(
        tool.schema.object({
          scenario: tool.schema.string(),
          state: tool.schema.enum(["pass", "fail", "skip"]),
          reason: tool.schema.string().optional(),
          severity: tool.schema.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
          title: tool.schema.string().optional(),
          problem: tool.schema.string().optional(),
          remediation: tool.schema.string().optional(),
          location: tool.schema.string().optional(),
        }),
      ),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_ingest")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      const newFindings: { scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[] = []

      for (const r of args.results) {
        const sc = s.scenarios[r.scenario]
        if (!sc) continue
        sc.current = r.state as ScenarioState
        sc.reason = r.state === "skip" ? (r.reason ?? null) : null

        if (r.state === "skip") {
          // Coverage buckets are a render-time projection (deriveCoverage); ingest only
          // records the unrecognized-reason routing warning (a genuine append-only log).
          const { warn } = routeSkip(r.reason)
          if (warn) s.coverage.routing_warnings.push(`${r.scenario}: unrecognized SKIP reason -> tool-unavailable (${r.reason ?? ""})`)
        } else {
          // New failure with no id yet → mint one.
          if (r.state === "fail" && sc.qa_ids.length === 0) {
            newFindings.push({
              scenario: r.scenario,
              severity: r.severity ?? "LOW",
              title: r.title ?? r.scenario,
              problem: r.problem ?? "",
              remediation: r.remediation ?? "",
              location: r.location ?? null,
            })
          }
        }
      }

      let minted: { id: string; scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[] = []
      if (newFindings.length > 0) {
        minted = await assignIssueIds({ findings: newFindings, startAt: args.start_at_qa_id })
        for (const f of minted) {
          s.scenarios[f.scenario]?.qa_ids.push(f.id)
          const issue: IssueRecord = {
            severity: f.severity as IssueRecord["severity"],
            scenario: f.scenario,
            location: f.location,
            title: f.title,
            problem: f.problem,
            remediation: f.remediation,
            status: "open",
            fixed_at: null,
            fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] },
          }
          s.issues[f.id] = issue
        }
      }

      s.updated_at = Date.now()
      state.save(parentId, s)
      return JSON.stringify({ status: "ok", new_qa_ids: minted.map((m) => m.id) })
    },
  })

  const qa_loop_step = tool({
    description: [
      "Advance the loop state machine. Perun-only.",
      "- `phase:\"enter\"` (2.0): increments the iteration ONLY when starting a new one; on re-entry into a not-yet-`evaluated` iteration it resumes from the stored `phase` WITHOUT a second increment (MAXI stays exact). Returns `{ action:\"fix\", issues }` | `{ action:\"stop\", stop_cause }` | `{ action:\"final\" }`.",
      "- `phase:\"evaluate\"` (2f): no increment; regression-first then no-progress against THIS iteration's retest. Advances the row to `evaluated`. Returns `{ action:\"continue\" }` | `{ action:\"stop\", stop_cause }` | `{ action:\"final\" }`.",
      "",
      'Result shape: `{ status:"ok", ...decision }` or `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {
      phase: tool.schema.enum(["enter", "evaluate"]),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_step")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      if (args.phase === "enter") {
        // §4 tamper guard: re-hash the plan on every enter. A plan edited mid-run can no
        // longer be trusted against the baseline, so the loop stops here with plan-tamper
        // (perun.md Workflow-1 §2.0). An unreadable plan mid-run is also treated as tamper.
        let tampered = false
        try {
          tampered = hashPlan(readFileSync(s.plan_path, "utf8")) !== s.plan_sha256
        } catch {
          tampered = true
        }
        if (tampered) {
          // Record the stop on the open iteration row if one exists, else open one
          // (mirroring stepEnter's fresh-vs-resume accounting) so the cause is visible.
          const open = s.iterations.find((it) => it.n === s.budgets.iteration && it.stop_cause === null && it.phase !== "evaluated")
          if (open) {
            open.stop_cause = "plan-tamper"
            open.phase = "evaluated"
          } else {
            s.budgets.iteration += 1
            s.iterations.push(newIterationRow(s.budgets.iteration, { phase: "evaluated", stop_cause: "plan-tamper" }))
          }
          s.updated_at = Date.now()
          state.save(parentId, s)
          return JSON.stringify({ status: "ok", action: "stop", stop_cause: "plan-tamper" })
        }

        // stepEnter handles idempotency and increments budgets.iteration on fresh entry.
        // Capture the iteration index before calling so we can detect a fresh entry.
        const iterBefore = s.budgets.iteration
        const decision = stepEnter(s)

        if (decision.action === "fix") {
          // Fresh entry advanced the counter → open a new row. Idempotent re-entry leaves
          // the existing (not-yet-evaluated) row untouched.
          if (s.budgets.iteration > iterBefore) {
            s.iterations.push(newIterationRow(s.budgets.iteration, { phase: "selecting", pending: decision.issues ?? [] }))
          }
        } else if (decision.action === "stop") {
          // Budget/MAXI fired — push the row so the stop_cause is visible.
          s.iterations.push(newIterationRow(s.budgets.iteration, { phase: "evaluated", stop_cause: decision.stop_cause ?? null }))
        }

        s.updated_at = Date.now()
        state.save(parentId, s)
        return JSON.stringify({ status: "ok", ...decision })
      }

      // phase === "evaluate"
      const decision = stepEvaluate(s)
      const row = s.iterations[s.iterations.length - 1]
      if (row) {
        row.phase = "evaluated"
        // Persist the per-iteration deltas the Loop-History report renders, from the same
        // baseline-vs-current scan stepEvaluate uses (so the columns are never blank).
        const recs = Object.entries(s.scenarios)
        row.now_passing = recs.filter(([, sc]) => sc.baseline === "fail" && sc.current === "pass").map(([id]) => id)
        row.still_failing = recs.filter(([, sc]) => sc.current === "fail").map(([id]) => id)
        row.regressions = recs.filter(([, sc]) => sc.baseline === "pass" && sc.current === "fail").map(([id]) => id)
        if (decision.action === "stop" && decision.stop_cause) row.stop_cause = decision.stop_cause
      }
      s.updated_at = Date.now()
      state.save(parentId, s)
      return JSON.stringify({ status: "ok", ...decision })
    },
  })

  const qa_loop_record_fix = tool({
    description: [
      "Record one sequential Svarog dispatch result (§6). Perun-only. The SOLE writer of `child_session_id` + `dispatch_count_total++`. Perun threads `child_session_id`/`svarog_status`/`changed`/`reason` FROM the dispatch_parallel result JSON — this tool does NOT read DispatchResult.",
      "- READY: bind `refs/svarog/ckpt/<child_session_id>` (if it exists), run anti-hardcoding on `changed[]`, mark `fix-attempted`. If `changed[]` is non-empty but the ref is MISSING → `checkpoint-integrity` stop (no restore, surfaced).",
      "- FAIL: auto-restore that issue's checkpoint (restoreFailRef), mark `fix-failed`.",
      "- ESCALATE: mark `deferred` with `reason`.",
      "Increments `dispatch_count_total` exactly once for READY/FAIL/ESCALATE alike, and clears the in-iteration `in_flight` cursor.",
      "",
      'Result shape: `{ status:"ok", issue_status, stop_cause?, hardcode_warnings? }` or `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {
      qa_id: tool.schema.string(),
      child_session_id: tool.schema.string().describe("DispatchResult.sessionId for this Svarog dispatch, threaded by Perun."),
      svarog_status: tool.schema.enum(["READY", "FAIL", "ESCALATE"]),
      changed: tool.schema.array(tool.schema.string()).describe("Svarog's self-reported changed[] paths."),
      reason: tool.schema.string().describe("ESCALATE/FAIL reason; empty for READY."),
      be_payloads: tool.schema.array(tool.schema.string()).optional().describe("BE scenario request-payload literals for the anti-hardcoding scan."),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_record_fix")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      const issue = s.issues[args.qa_id]
      if (!issue) return JSON.stringify({ status: "error", reason: `unknown issue ${args.qa_id}` })
      // Defense-in-depth: child_session_id is spliced into a git ref name, so pin its shape
      // at the boundary — the trust is then code-enforced, not incidental on the minted id.
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(args.child_session_id)) {
        return JSON.stringify({ status: "error", reason: "invalid child_session_id" })
      }
      const row = s.iterations[s.iterations.length - 1]

      // record_fix is the SOLE writer of child_session_id + the MAXD counter.
      issue.fix.svarog_status = args.svarog_status
      issue.fix.child_session_id = args.child_session_id
      issue.fix.changed = args.changed
      const ref = `refs/svarog/ckpt/${args.child_session_id}`
      const hasRef = refExists(cwd, ref)

      let stopCause: string | undefined
      if (args.svarog_status === "READY") {
        if (args.changed.length > 0 && !hasRef) {
          // Existence integrity (§6): a READY that REPORTS changed[] but whose
          // ref is missing — do NOT auto-restore the untrusted tree; abort.
          stopCause = "checkpoint-integrity"
          if (row) row.stop_cause = "checkpoint-integrity"
        } else {
          if (hasRef) {
            issue.fix.checkpoint_ref = ref
            const warnings = antiHardcodeDiff(cwd, ref, args.changed, args.be_payloads ?? [])
            issue.fix.hardcode_warnings = warnings
            if (row) row.warnings.push(...warnings)
          }
          issue.status = "fix-attempted"
        }
      } else if (args.svarog_status === "FAIL") {
        if (hasRef) {
          issue.fix.checkpoint_ref = ref
          restoreFailRef(cwd, ref) // cumulative-safe (§6); reverts only this issue's edits
        }
        issue.status = "fix-failed"
      } else {
        // ESCALATE — edit aborted/none
        issue.status = "deferred"
        issue.fix.escalate_reason = args.reason
      }

      // dispatch_count_total++ exactly once, READY/FAIL/ESCALATE alike (§4).
      s.budgets.dispatch_count_total++
      if (row) {
        row.dispatches_this_iter++
        row.in_flight = null
        if (!row.attempted_so_far.includes(args.qa_id)) row.attempted_so_far.push(args.qa_id)
      }
      s.updated_at = Date.now()
      state.save(parentId, s)

      return JSON.stringify({
        status: "ok",
        issue_status: issue.status,
        ...(stopCause !== undefined ? { stop_cause: stopCause } : {}),
        hardcode_warnings: issue.fix.hardcode_warnings,
      })
    },
  })

  const qa_loop_finalize = tool({
    description: [
      "Phase 4 (SUMMARY). Perun-only. Computes the run result via the Result mapping (Pass>NotVerified>BudgetExhausted>Stopped>Fail), then — and ONLY here, the oracle-separation invariant — transitions each `fix-attempted` issue to `fixed` when its scenario's `current` is `pass` after the FINAL ingest. Renders + writes the report markdown (the sole writer of `✅ Fixed`) and records `final_pass_elapsed_s`.",
      "The tool records `final_pass_elapsed_s` itself: it measures wall-clock from the FINAL ingest (`s.updated_at`, last set by `qa_loop_ingest({phase:\"final\"})`) to this finalize call — Perun cannot measure wall-clock, so it does NOT supply it. `final_pass_elapsed_s` is an OPTIONAL override only (e.g. for deterministic tests).",
      "",
      'Result shape: `{ status:"ok", result, report_path }` or `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {
      final_pass_elapsed_s: tool.schema.number().optional().describe("Optional override for the final-pass wall-clock seconds; omit to let the tool compute it from the FINAL-ingest timestamp."),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_finalize")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      // Compute the final-pass elapsed from the recorded FINAL-ingest timestamp
      // BEFORE we overwrite updated_at below. The final ingest set s.updated_at, so
      // (now - updated_at) is the final-pass→finalize wall-clock the tool measures itself.
      const now = Date.now()
      const computedFinalElapsed = Math.max(0, Math.round((now - s.updated_at) / 1000))

      // SOLE fix-attempted→fixed transition: only when the FINAL ingest shows
      // that issue's scenario PASS (§5 status write-back discipline).
      const finalizedAt = new Date(now).toISOString()
      for (const [, issue] of Object.entries(s.issues)) {
        if (issue.status === "fix-attempted" && s.scenarios[issue.scenario]?.current === "pass") {
          issue.status = "fixed"
          issue.fixed_at = finalizedAt
        }
      }

      s.result = resultOf(s)
      s.budgets.final_pass_elapsed_s = args.final_pass_elapsed_s ?? computedFinalElapsed
      s.finalized_at = now
      s.updated_at = s.finalized_at
      state.save(parentId, s)

      // Tool is the single writer of the report markdown.
      // s.report_path is always absolute (qa_loop_start stores join(cwd, report_path)).
      writeFileSync(s.report_path, renderReport(s))

      return JSON.stringify({ status: "ok", result: s.result, report_path: s.report_path })
    },
  })

  const qa_loop_undo = tool({
    description: [
      "Total undo (§6): revert the whole working tree to `refs/qa-loop/pre/<run>`, returning the user to exactly the pre-loop state (including any pre-existing dirty work). Perun-only — the coordinator cannot `git reset` itself, so it invokes this tool on request.",
      "",
      'Result shape: `{ status:"ok", restored_ref }` | `{ status:"error", reason }` | `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {},
    async execute(_args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_undo")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      const ref = s.pre_loop.undo_ref
      if (!refExists(cwd, ref)) {
        return JSON.stringify({ status: "error", reason: `pre-loop ref ${ref} is missing` })
      }
      undoToPreLoop(cwd, ref)
      return JSON.stringify({ status: "ok", restored_ref: ref })
    },
  })

  return {
    qa_loop_start,
    qa_loop_ingest,
    qa_loop_step,
    qa_loop_record_fix,
    qa_loop_finalize,
    qa_loop_undo,
  }
}

