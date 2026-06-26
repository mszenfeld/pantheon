import { tool } from "@opencode-ai/plugin"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CallerGate } from "../qa/caller-gate.js"
import type { Sidecar, ScenarioRecord, ScenarioKind, Mode, SeverityFloor } from "./types.js"
import { QaLoopState } from "./sidecar.js"
import { hashPlan } from "./plan-hash.js"
import { classifyScenario } from "./classify.js"
import { capturePreLoopRef } from "./git-ops.js"

export interface QaLoopToolDeps {
  gate: Pick<CallerGate, "isCoordinatorCaller">
  state: QaLoopState
  cwd: string
  resolveParentID: (sessionID: string) => Promise<string>
  /** Optional: inject QA-ID assigner for qa_loop_ingest (later tasks). */
  assignIssueIds?: (parentId: string, count: number, startAt?: number) => Promise<string[]>
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
function splitScenarios(planText: string): { id: string; block: string }[] {
  const lines = planText.split("\n")
  const blocks: { id: string; block: string }[] = []
  let current: { id: string; lines: string[] } | null = null
  for (const line of lines) {
    const m = /^##\s+((?:FE|BE|SETUP)-\d+)\b/i.exec(line)
    if (m) {
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
      current = { id: (m[1] ?? "").toUpperCase(), lines: [line] }
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

export function makeQaLoopTools(deps: QaLoopToolDeps) {
  const { gate, state, cwd, resolveParentID } = deps

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
      const absReportPath = join(cwd, args.report_path)
      const absPlanPath = join(cwd, args.plan_path)

      const planText = readFileSync(absPlanPath, "utf8")
      const sha = hashPlan(planText)
      const allowMutations = args.allow_mutations ?? false

      const config: Sidecar["config"] = {
        mode: (args.mode as Mode) ?? "approve",
        severity_floor: (args.severity_floor as SeverityFloor) ?? "LOW",
        max_iterations: args.max_iterations ?? 3,
        max_dispatches: args.max_dispatches ?? 50,
        time_budget_s: args.time_budget_s ?? 1800,
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
      let mutationGuardCount = 0
      for (const { id, block } of splitScenarios(planText)) {
        const { kind, mutating, expectsSuccess } = classifyScenario(block)
        // Strip ONLY mutating scenarios expected to succeed; a negative-blocked
        // mutation is kept (§7 expected-outcome rule, AC19/AC20).
        const stripped = mutating && expectsSuccess && !allowMutations
        scenarios[id] = {
          qa_ids: [],
          kind: kind as ScenarioKind,
          section: sectionOf(id),
          mutating,
          baseline: stripped ? "skip" : "fail",
          current: stripped ? "skip" : "fail",
          reason: stripped ? "mutation-guard: mutating scenario expected to succeed" : null,
        }
        if (stripped) mutationGuardCount++
        else dispatchSet.push(id)
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
        coverage: {
          exercised: { feature: 0, sanity: 0, enforcement: 0 },
          not_verified: {
            "auth-unverified": 0,
            "mutation-guard": mutationGuardCount,
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

  return { qa_loop_start }
}
