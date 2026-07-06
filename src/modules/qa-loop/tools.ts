import { tool } from "@opencode-ai/plugin"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { CallerGate } from "../qa/caller-gate.js"
import type { Sidecar, ScenarioRecord, ScenarioKind, Mode, SeverityFloor, IssueRecord, ScenarioState, IterationRecord, IterationPhase, StopCause } from "./types.js"
import { QaLoopState } from "./sidecar.js"
import { hashPlan } from "./plan-hash.js"
import { classifyScenario } from "./classify.js"
import { routeSkip, MALFORMED_HEADING_REASON } from "./coverage.js"
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
  // Detect ANY non-well-formed scenario-prefix heading (a prefix + digits followed by any
  // non-space, non-colon char), so a single-digit id with a non-alphanumeric suffix like
  // `### BE-2_seed:` is surfaced too — `[A-Za-z0-9]` used to miss it (single digit, `_` not
  // alphanumeric), letting the line fall through and silently absorb its body into the
  // preceding scenario. `[^\s:]` matches the extraction regex below so detection and id
  // capture stay in lockstep.
  const MALFORMED_HEADING = /^#{2,4}\s+(?:FE|BE|SETUP)-\d+[^\s:]/i
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
      // Capture the WHOLE suffix (`[^\s:]*`, not `[A-Za-z0-9]*`) so a non-alphanumeric
      // suffix (e.g. `### FE-01_extra`) does NOT truncate the id to a bare `FE-01` that
      // collides with a well-formed scenario. A malformed heading always has a word char
      // after the digits (that is why it failed the well-formed `\b`), so its id keeps a
      // non-empty suffix and stays disjoint from every well-formed id.
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
      const id = (/^#{2,4}\s+((?:FE|BE|SETUP)-\d+[^\s:]*)/i.exec(line)?.[1] ?? "").toUpperCase()
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

/**
 * The plan-declared seed marker (`**Seed (psql/sqlite3):**`). Kept intentionally
 * PERMISSIVE — a SUPERSET of what be-testing's LLM executor recognizes: a leading
 * list-marker — unordered (`- ` / `* ` / `+ `) OR ordered (`1. ` / `2) `, the plan format's
 * numbered-step form, test-plan-format §Plan Structure) — or blockquote (`> `), and
 * incidental whitespace around the marker, all still match. The consent gate must never be
 * weaker than the executor: if be-testing would run the fenced SQL (it recognizes the marker
 * semantically), this MUST catch it so the write stays consent-gated. Still rejects prose
 * that only mentions "seed" (`**Seeded rows are visible**`, `**Seed the database manually**`)
 * because the `(psql/sqlite3)` clause is required. Authors must write the byte-exact
 * canonical marker; the leniency here is defense-in-depth, not license to vary it.
 */
export const SEED_MARKER =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Seed\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im

/**
 * The plan-declared un-seed marker (`**Teardown (psql/sqlite3):**`), the reversal paired with a
 * Seed/mutating scenario (§8). Same leading-marker leniency as SEED_MARKER. Its PRESENCE (with a
 * well-formed fenced block, see extractTeardown) is what makes a mutation auto-reverting — and so
 * runnable by DEFAULT on a local base URL, without allow_mutations. A bare marker with no fence
 * does not count (extractTeardown returns null → treated as no teardown → the mutation stays
 * consent-gated): a malformed reversal must never silently unlock the default.
 */
export const TEARDOWN_MARKER =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Teardown\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im

// Loopback hosts we treat as the operator's own machine. The auto-reverting-mutation DEFAULT (§8)
// applies ONLY here: a shared/staging/prod target (any other host) never auto-mutates — it keeps
// the explicit allow_mutations gate so a seed+teardown can't silently churn rows in a DB other
// people share. `::1`/bracketed IPv6 is normalized (brackets stripped) before the check. `0.0.0.0`
// is deliberately EXCLUDED — as a client destination it is the unspecified address, not loopback.
// NOTE (§8 residual): this gates the HTTP base-url only; a seed's WRITE egress is its declared DSN
// (a `$VAR` unknowable here), so the auto-revert heads-up must NAME that DSN — see perun.md.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

/**
 * True iff the plan's frontmatter `base-url:` resolves to a loopback host (§8 non-local floor).
 * Scoped to the leading YAML frontmatter block (between the first two `---` fences) so a stray
 * `base-url:` in a scenario body cannot spoof locality. No base URL, an unparseable URL, or a
 * non-loopback host all return false → the auto-revert default does NOT apply (safe: consent-gated).
 */
export function baseUrlIsLocal(planText: string): boolean {
  // Read base-url ONLY from the leading YAML frontmatter. Fail closed: no frontmatter fence →
  // not provably local → false, so a `base-url:` line planted in a scenario body cannot spoof
  // locality and unlock the auto-revert default off-loopback.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(planText)
  if (!fm) return false
  const m = /^base-url:\s*(.+)$/im.exec(fm[1]!)
  if (!m) return false
  const raw = m[1]!.trim().replace(/^["']|["']$/g, "")
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "")
    return LOCAL_HOSTS.has(host)
  } catch {
    return false
  }
}

/**
 * Extract a scenario's `**Teardown (psql/sqlite3):**` region — the marker line through the end of
 * the fenced code block that follows it — so Perun can hand exactly that (and nothing else) to a
 * zmora-be teardown wave. Returns null when the marker is absent OR carries no fenced block (a bare
 * marker is not a usable reversal); the null makes the scenario "has no teardown" for classification.
 */
export function extractTeardown(block: string): string | null {
  const lines = block.split("\n")
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (TEARDOWN_MARKER.test(lines[i]!)) { start = i; break }
  }
  if (start === -1) return null
  let k = start + 1
  while (k < lines.length && !/^\s*```/.test(lines[k]!)) k++
  if (k >= lines.length) return null // marker with no opening fence → not a usable teardown
  let end = k + 1
  while (end < lines.length && !/^\s*```\s*$/.test(lines[end]!)) end++
  if (end >= lines.length) return null // unterminated fence → reject
  return lines.slice(start, end + 1).join("\n").trim()
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
      "Phase 0 of the QA loop (RESOLVE & GUARD). Perun-only. Hashes the plan for idempotency, decides REUSE/ADOPT/FRESH, classifies every scenario, applies the mutation guard, captures the pre-loop undo ref, and runs the working-tree dirty check.",
      "",
      "Mutation policy (§8): a Seed / mutating-expected-success scenario that declares a paired `**Teardown (psql/sqlite3):**` AND targets a LOCAL base URL is AUTO-REVERTING, so it RUNS BY DEFAULT and its id is listed in `auto_reverting` (the loop hands the teardown SQL back at finalize/undo for a zmora-be un-seed wave). An irreversible (no Teardown) or non-local mutation stays stripped unless `allow_mutations` is set.",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", disposition: "REUSE"|"ADOPT"|"FRESH", run_id, pre_loop_ref, dispatch_set: string[], stripped: { id, reason }[], auto_reverting: string[], dirty: boolean, dirty_files: string[], qa_id_start_at?: number }`.',
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
      // REUSE requires a run worth resuming: same plan hash AND a baseline wave already
      // ingested. A never-baselined sidecar carries only the scaffold placeholders (every
      // scenario baseline/current:"fail", zero qa_ids) — resuming it drops Perun straight
      // into a phantom fix-phase where `enter` returns { action:"fix", issues:[] } ("fix
      // nothing"), forcing a manual undo+restart. Without the marker it falls through to
      // ADOPT/FRESH, which re-scaffolds and runs the baseline wave normally. (`=== true`
      // so a pre-field on-disk sidecar, where the flag is undefined, also re-baselines.)
      if (onDisk && onDisk.plan_sha256 === sha && onDisk.baseline_recorded === true) {
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
          stripped: Object.entries(onDisk.scenarios)
            .filter(([, sc]) => sc.reason?.startsWith("mutation-guard"))
            .map(([id, sc]) => ({ id, reason: sc.reason })),
          auto_reverting: (onDisk.teardowns ?? []).map((t) => t.scenario),
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

      // §8: the auto-reverting-mutation default applies only against a loopback target.
      // Computed once; every scenario's strip decision reads it.
      const targetIsLocal = baseUrlIsLocal(planText)

      // Classify every scenario; apply the mutation guard pre-dispatch.
      const scenarios: Record<string, ScenarioRecord> = {}
      const dispatchSet: string[] = []
      // Recorded reversals for the auto-reverting mutations that will run (§8).
      const teardowns: { scenario: string; block: string }[] = []
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
            reason: MALFORMED_HEADING_REASON,
          }
          continue
        }
        // Duplicate (well-formed) scenario id → reject loudly. The keyed scenarios map is
        // last-write-wins and the strip decision is per-block, so a later same-id block
        // silently overwrites the first. If the first block was a consent-stripped Seed
        // write, a later clean duplicate-id block would resurrect the id into dispatch_set
        // and the seed would execute under allow_mutations:false — a consent-gate BYPASS.
        // (Malformed ids carry a suffix and collide only among themselves, all skipped, so
        // this check is scoped to the well-formed path.) Ids must be unique regardless —
        // ingest/report/coverage all key on the id.
        if (scenarios[id]) {
          return JSON.stringify({
            status: "error",
            reason: `duplicate scenario id ${id} — scenario ids must be unique (test-plan-format §Plan Structure). A repeated id silently overwrites the first block and can mask a consent-stripped Seed write; give each scenario a distinct FE-/BE-/SETUP-NN id.`,
          })
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
        const isSeedWrite = SEED_MARKER.test(block)
        // A "gated" mutation is one whose write actually LANDS: a Seed (any verb) or a non-seed
        // mutating scenario that expects success. A negative-blocked mutation (mutating &&
        // !expectsSuccess) is NOT gated — the write never lands (§7 AC19/AC20), so it runs
        // regardless and needs no reversal.
        const gatedMutation = isSeedWrite || (mutating && expectsSuccess)
        // §8 auto-reverting DEFAULT: a gated mutation that declares a paired, well-formed
        // `**Teardown (psql/sqlite3):**` AND targets a LOCAL base URL runs by DEFAULT (no
        // allow_mutations) — the loop reverts it via the teardown wave at finalize. Irreversible
        // (no usable Teardown) OR non-local mutations keep the explicit allow_mutations gate.
        const teardownBlock = extractTeardown(block)
        const autoReverting = gatedMutation && teardownBlock !== null && targetIsLocal
        const stripped = gatedMutation && !autoReverting && !allowMutations
        scenarios[id] = {
          qa_ids: [],
          kind: kind as ScenarioKind,
          section: sectionOf(id),
          mutating,
          baseline: stripped ? "skip" : "fail",
          current: stripped ? "skip" : "fail",
          reason: stripped
            ? isSeedWrite
              ? "mutation-guard: plan-declared Seed write needs a paired **Teardown (psql/sqlite3):** on a local base URL (auto-revert), or allow_mutations"
              : "mutation-guard: mutating scenario expected to succeed — pair a **Teardown (psql/sqlite3):** on a local base URL (auto-revert), or re-run with allow_mutations"
            : null,
        }
        if (!stripped) {
          dispatchSet.push(id)
          // Record the reversal for any RUNNING scenario that declares one — auto-reverting
          // seeds, plus any consent-run (allow_mutations) mutation that also paired a teardown.
          // Handed back LIFO by qa_loop_finalize / qa_loop_undo for the zmora-be teardown wave.
          if (teardownBlock !== null) teardowns.push({ scenario: id, block: teardownBlock })
        }
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
      // Diagnose an empty dispatch set by CAUSE, derived from the recorded scenario reasons
      // rather than a block counter — so duplicate/case-colliding malformed ids (which dedupe
      // in the keyed map) can't skew the classification. Every non-dispatched scenario carries
      // a reason: a "malformed heading …" skip or a "mutation-guard: …" strip.
      const mutationStripCount = Object.values(scenarios).filter((sc) =>
        sc.reason?.startsWith("mutation-guard"),
      ).length

      // No mutation strips AND nothing to dispatch ⇒ every scenario is a malformed-heading
      // skip. That is a heading-format problem, NOT a mutation-guard strip: allow_mutations
      // cannot help (malformed blocks never dispatch regardless of the flag), so give the
      // heading diagnosis rather than the misleading "re-run with allow_mutations" message.
      if (dispatchSet.length === 0 && mutationStripCount === 0) {
        return JSON.stringify({
          status: "error",
          reason: `all ${Object.keys(scenarios).length} scenario heading(s) are malformed — no recognised prefix (expected '### FE-01:' / '### BE-01:' / '### SETUP-01:', per test-plan-format §Plan Structure). Fix the scenario headings.`,
        })
      }
      if (dispatchSet.length === 0) {
        return JSON.stringify({
          status: "error",
          reason: `all ${mutationStripCount} scenario(s) were stripped by the mutation guard (mutating-expected-success, or a plan-declared Seed write without consent). Re-run with allow_mutations to exercise them, or the plan needs negative/non-mutating coverage.`,
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
        baseline_recorded: false,
        budgets: {
          iteration: 0,
          dispatch_count_total: 0,
          elapsed_s: 0,
          final_pass_elapsed_s: null,
        },
        pre_loop: preLoop,
        teardowns,
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
        // Surface the mutation-guard strips so the coordinator can tell the operator WHICH
        // scenarios were excluded (and why) up front, rather than the operator only learning
        // at the final report that the run under-covered the change. Excludes malformed-heading
        // skips (their reason does not start with "mutation-guard").
        stripped: Object.entries(scenarios)
          .filter(([, sc]) => sc.reason?.startsWith("mutation-guard"))
          .map(([id, sc]) => ({ id, reason: sc.reason })),
        // Scenarios that mutate but run by DEFAULT because they declared a reversal on a local
        // target (§8). Perun tells the operator these seed-then-revert, and MUST run the teardown
        // wave (qa_loop_finalize hands back the SQL) so the loop leaves the DB clean.
        auto_reverting: teardowns.map((t) => t.scenario),
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

      // A baseline wave has now been recorded — the scenario states reflect a real Zmora
      // run, not the scaffold placeholders. Unlocks REUSE-resume and the fix-loop `enter`
      // gate (see Sidecar.baseline_recorded). retest/final ingests leave it as-is (already true).
      if (args.phase === "baseline") s.baseline_recorded = true

      s.updated_at = Date.now()
      state.save(parentId, s)
      return JSON.stringify({ status: "ok", new_qa_ids: minted.map((m) => m.id) })
    },
  })

  const qa_loop_step = tool({
    description: [
      "Advance the loop state machine. Perun-only.",
      "- `phase:\"enter\"` (2.0): increments the iteration ONLY when starting a new one; on re-entry into a not-yet-`evaluated` iteration it resumes from the stored `phase` WITHOUT a second increment (MAXI stays exact). Returns `{ action:\"fix\", issues }` | `{ action:\"stop\", stop_cause }` | `{ action:\"final\" }`. Requires a baseline wave first — returns `{ status:\"error\" }` if called before `qa_loop_ingest(phase:\"baseline\")` (guards against entering the fix loop on scaffold placeholders).",
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
        // Precondition: the baseline wave must have been ingested. Entering the fix loop
        // with only scaffold placeholders (every scenario current:"fail", zero qa_ids) is
        // what produced the confusing { action:"fix", issues:[] } — surface an actionable
        // error instead so Perun runs the baseline wave rather than reverse-engineering a
        // phantom fix-phase. (Disposition already downgrades a never-baselined REUSE to
        // FRESH; this is the belt-and-suspenders guard for a direct premature enter.)
        if (!s.baseline_recorded) {
          return JSON.stringify({
            status: "error",
            reason:
              "baseline not yet ingested — dispatch the dispatch_set to Zmora and call qa_loop_ingest(phase:\"baseline\") before entering the fix loop (qa_loop_step phase:\"enter\").",
          })
        }

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
      "Also returns `teardowns_pending` (§8): the recorded reversals for the auto-reverting seeds/mutations that ran, LIFO. When non-empty, Perun MUST dispatch a zmora-be teardown wave to run each block (un-seeding the DB rows the run created) before reporting done — the pre-loop ref reverts FILES only, not DB rows.",
      "",
      'Result shape: `{ status:"ok", result, report_path, teardowns_pending: { scenario, block }[] }` or `{ status:"forbidden", reason }`.',
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

      // §8 DB-revert: hand the recorded reversals back LIFO (dependents un-seed before their
      // prerequisites) so Perun runs a zmora-be teardown wave — the DB counterpart to the
      // file-only pre-loop ref. Empty when the run seeded nothing auto-revertingly.
      const teardowns_pending = [...(s.teardowns ?? [])].reverse()
      return JSON.stringify({
        status: "ok",
        result: s.result,
        report_path: s.report_path,
        teardowns_pending,
      })
    },
  })

  const qa_loop_undo = tool({
    description: [
      "Total undo (§6): revert the whole working tree to `refs/qa-loop/pre/<run>`, returning the user to exactly the pre-loop state (including any pre-existing dirty work). Perun-only — the coordinator cannot `git reset` itself, so it invokes this tool on request.",
      "The ref restores FILES only. `teardowns_pending` (§8, LIFO) carries the DB reversals for any auto-reverting seeds/mutations that ran; when non-empty, Perun runs a zmora-be teardown wave to un-seed the rows too, so undo reverts BOTH files and data.",
      "",
      'Result shape: `{ status:"ok", restored_ref, teardowns_pending: { scenario, block }[] }` | `{ status:"error", reason }` | `{ status:"forbidden", reason }`.',
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
      // The ref restores FILES only (Svarog's edits + any pre-loop dirty work). Hand the DB
      // reversals back LIFO too so a manual undo also un-seeds via a zmora-be teardown wave (§8).
      const teardowns_pending = [...(s.teardowns ?? [])].reverse()
      return JSON.stringify({ status: "ok", restored_ref: ref, teardowns_pending })
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

