import { tool } from "@opencode-ai/plugin";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { hashPlan } from "./plan-hash.js";
import { classifyScenario } from "./classify.js";
import { routeSkip, MALFORMED_HEADING_REASON } from "./coverage.js";
import { capturePreLoopRef, refExists, restoreFailRef, antiHardcodeDiff, undoToPreLoop } from "./git-ops.js";
import { stepEnter, stepEvaluate, resultOf } from "./state-machine.js";
import { renderReport } from "./report.js";
const FORBIDDEN = (name) => JSON.stringify({
  status: "forbidden",
  reason: `${name} is restricted to the coordinator (Perun)`
});
function sectionOf(id) {
  if (id.startsWith("FE")) return "FE";
  if (id.startsWith("SETUP")) return "SETUP";
  return "BE";
}
function splitScenarios(planText) {
  const lines = planText.split("\n");
  const blocks = [];
  let current = null;
  const MALFORMED_HEADING = /^#{2,4}\s+(?:FE|BE|SETUP)-\d+[^\s:]/i;
  for (const line of lines) {
    const m = /^#{2,4}\s+((?:FE|BE|SETUP)-\d+)\b/i.exec(line);
    if (m) {
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") });
      current = { id: (m[1] ?? "").toUpperCase(), lines: [line] };
    } else if (MALFORMED_HEADING.test(line)) {
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") });
      const id = (/^#{2,4}\s+((?:FE|BE|SETUP)-\d+[^\s:]*)/i.exec(line)?.[1] ?? "").toUpperCase();
      blocks.push({ id, block: line, malformed: true });
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ id: current.id, block: current.lines.join("\n") });
  return blocks;
}
function detectDirty(cwd) {
  let output = "";
  try {
    output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8"
    });
  } catch {
    return { dirty: false, dirty_files: [] };
  }
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { dirty: false, dirty_files: [] };
  const dirty_files = lines.map((l) => l.slice(3).trim());
  return { dirty: true, dirty_files };
}
const SEED_MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Seed\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im;
const TEARDOWN_MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Teardown\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im;
const LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1"]);
function baseUrlIsLocal(planText) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(planText);
  if (!fm) return false;
  const m = /^base-url:\s*(.+)$/im.exec(fm[1]);
  if (!m) return false;
  const raw = m[1].trim().replace(/^["']|["']$/g, "");
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
    return LOCAL_HOSTS.has(host);
  } catch {
    return false;
  }
}
function extractTeardown(block) {
  const lines = block.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TEARDOWN_MARKER.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let k = start + 1;
  while (k < lines.length && !/^\s*```/.test(lines[k])) k++;
  if (k >= lines.length) return null;
  let end = k + 1;
  while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
  if (end >= lines.length) return null;
  return lines.slice(start, end + 1).join("\n").trim();
}
const QA_LOOP_DEFAULTS = { maxIterations: 3, maxDispatches: 50, timeBudgetS: 1800 };
function containedPath(cwd, p) {
  const root = resolve(cwd);
  const abs = resolve(root, p);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}
function newIterationRow(n, opts) {
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
    elapsed_s: 0
  };
}
function makeQaLoopTools(deps) {
  const { gate, state, cwd, resolveParentID, assignIssueIds } = deps;
  const qa_loop_start = tool({
    description: [
      "Phase 0 of the QA loop (RESOLVE & GUARD). Perun-only. Hashes the plan for idempotency, decides REUSE/ADOPT/FRESH, classifies every scenario, applies the mutation guard, captures the pre-loop undo ref, and runs the working-tree dirty check.",
      "",
      "Mutation policy (\xA78): a Seed / mutating-expected-success scenario that declares a paired `**Teardown (psql/sqlite3):**` AND targets a LOCAL base URL is AUTO-REVERTING, so it RUNS BY DEFAULT and its id is listed in `auto_reverting` (the loop hands the teardown SQL back at finalize/undo for a zmora-be un-seed wave). An irreversible (no Teardown) or non-local mutation stays stripped unless `allow_mutations` is set.",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", disposition: "REUSE"|"ADOPT"|"FRESH", run_id, pre_loop_ref, dispatch_set: string[], stripped: { id, reason }[], auto_reverting: string[], dirty: boolean, dirty_files: string[], qa_id_start_at?: number }`.',
      '- `{ status: "forbidden", reason }` \u2014 caller is not the coordinator.'
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
      allow_mutations: tool.schema.boolean().optional()
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_start");
      const parentId = await resolveParentID(ctx.sessionID);
      const absReportPath = containedPath(cwd, args.report_path);
      const absPlanPath = containedPath(cwd, args.plan_path);
      if (!absReportPath || !absPlanPath) {
        return JSON.stringify({ status: "error", reason: "report_path and plan_path must resolve within the repository" });
      }
      const planText = readFileSync(absPlanPath, "utf8");
      const sha = hashPlan(planText);
      const allowMutations = args.allow_mutations ?? false;
      const config = {
        mode: args.mode ?? "approve",
        severity_floor: args.severity_floor ?? "LOW",
        max_iterations: args.max_iterations ?? QA_LOOP_DEFAULTS.maxIterations,
        max_dispatches: args.max_dispatches ?? QA_LOOP_DEFAULTS.maxDispatches,
        time_budget_s: args.time_budget_s ?? QA_LOOP_DEFAULTS.timeBudgetS,
        allow_mutations: allowMutations
      };
      const onDisk = state.loadFromDisk(absReportPath);
      if (onDisk && onDisk.plan_sha256 === sha && onDisk.baseline_recorded === true) {
        onDisk.updated_at = Date.now();
        state.save(parentId, onDisk);
        return JSON.stringify({
          status: "ok",
          disposition: "REUSE",
          run_id: onDisk.run_id,
          pre_loop_ref: onDisk.pre_loop.undo_ref,
          dispatch_set: Object.entries(onDisk.scenarios).filter(([, sc]) => sc.current !== "skip").map(([id]) => id),
          stripped: Object.entries(onDisk.scenarios).filter(([, sc]) => sc.reason?.startsWith("mutation-guard")).map(([id, sc]) => ({ id, reason: sc.reason })),
          auto_reverting: (onDisk.teardowns ?? []).map((t) => t.scenario),
          dirty: onDisk.pre_loop.dirty,
          dirty_files: onDisk.pre_loop.dirty_files
        });
      }
      let reportExists = false;
      let qaIdStartAt;
      try {
        const reportText = readFileSync(absReportPath, "utf8");
        reportExists = true;
        const ids = [...reportText.matchAll(/\bQA-(\d+)\b/g)].map((m) => Number(m[1]));
        qaIdStartAt = (ids.length ? Math.max(...ids) : 0) + 1;
      } catch {
        reportExists = false;
      }
      const disposition = reportExists ? "ADOPT" : "FRESH";
      const targetIsLocal = baseUrlIsLocal(planText);
      const scenarios = {};
      const dispatchSet = [];
      const teardowns = [];
      for (const { id, block, malformed } of splitScenarios(planText)) {
        if (malformed) {
          scenarios[id] = {
            qa_ids: [],
            kind: "feature",
            section: sectionOf(id),
            mutating: false,
            baseline: "skip",
            current: "skip",
            reason: MALFORMED_HEADING_REASON
          };
          continue;
        }
        if (scenarios[id]) {
          return JSON.stringify({
            status: "error",
            reason: `duplicate scenario id ${id} \u2014 scenario ids must be unique (test-plan-format \xA7Plan Structure). A repeated id silently overwrites the first block and can mask a consent-stripped Seed write; give each scenario a distinct FE-/BE-/SETUP-NN id.`
          });
        }
        const { kind, mutating, expectsSuccess } = classifyScenario(block);
        const isSeedWrite = SEED_MARKER.test(block);
        const gatedMutation = isSeedWrite || mutating && expectsSuccess;
        const teardownBlock = extractTeardown(block);
        const autoReverting = gatedMutation && teardownBlock !== null && targetIsLocal;
        const stripped = gatedMutation && !autoReverting && !allowMutations;
        scenarios[id] = {
          qa_ids: [],
          kind,
          section: sectionOf(id),
          mutating,
          baseline: stripped ? "skip" : "fail",
          current: stripped ? "skip" : "fail",
          reason: stripped ? isSeedWrite ? "mutation-guard: plan-declared Seed write needs a paired **Teardown (psql/sqlite3):** on a local base URL (auto-revert), or allow_mutations" : "mutation-guard: mutating scenario expected to succeed \u2014 pair a **Teardown (psql/sqlite3):** on a local base URL (auto-revert), or re-run with allow_mutations" : null
        };
        if (!stripped) {
          dispatchSet.push(id);
          if (teardownBlock !== null) teardowns.push({ scenario: id, block: teardownBlock });
        }
      }
      if (Object.keys(scenarios).length === 0) {
        return JSON.stringify({
          status: "error",
          reason: "0 scenarios parsed from the plan \u2014 expected scenario headings like '### FE-01:' or '### BE-01:' (test-plan-format \xA7Plan Structure). Check the plan's scenario heading format."
        });
      }
      const mutationStripCount = Object.values(scenarios).filter(
        (sc) => sc.reason?.startsWith("mutation-guard")
      ).length;
      if (dispatchSet.length === 0 && mutationStripCount === 0) {
        return JSON.stringify({
          status: "error",
          reason: `all ${Object.keys(scenarios).length} scenario heading(s) are malformed \u2014 no recognised prefix (expected '### FE-01:' / '### BE-01:' / '### SETUP-01:', per test-plan-format \xA7Plan Structure). Fix the scenario headings.`
        });
      }
      if (dispatchSet.length === 0) {
        return JSON.stringify({
          status: "error",
          reason: `all ${mutationStripCount} scenario(s) were stripped by the mutation guard (mutating-expected-success, or a plan-declared Seed write without consent). Re-run with allow_mutations to exercise them, or the plan needs negative/non-mutating coverage.`
        });
      }
      const runId = `qa-loop-${args.topic}-${reportExists ? 2 : 1}`;
      const undoRef = capturePreLoopRef(cwd, runId);
      const { dirty, dirty_files } = detectDirty(cwd);
      const preLoop = { undo_ref: undoRef, dirty, dirty_files };
      const now = Date.now();
      const sidecar = {
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
          final_pass_elapsed_s: null
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
            "tool-unavailable": 0
          },
          routing_warnings: []
        },
        result: null
      };
      state.save(parentId, sidecar);
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
        stripped: Object.entries(scenarios).filter(([, sc]) => sc.reason?.startsWith("mutation-guard")).map(([id, sc]) => ({ id, reason: sc.reason })),
        // Scenarios that mutate but run by DEFAULT because they declared a reversal on a local
        // target (§8). Perun tells the operator these seed-then-revert, and MUST run the teardown
        // wave (qa_loop_finalize hands back the SQL) so the loop leaves the DB clean.
        auto_reverting: teardowns.map((t) => t.scenario),
        dirty,
        dirty_files,
        ...qaIdStartAt !== void 0 ? { qa_id_start_at: qaIdStartAt } : {}
      });
    }
  });
  const qa_loop_ingest = tool({
    description: [
      "Record a Zmora wave's results into the loop sidecar. Perun-only. Updates each scenario's `current` state, rolls coverage buckets, and mints QA-IDs (via assign_issue_ids) for new failing scenarios that have no id yet. Call after every Zmora wave (baseline / retest / final).",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", new_qa_ids: string[] }`.',
      '- `{ status: "forbidden", reason }`.'
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
          location: tool.schema.string().optional()
        })
      )
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_ingest");
      const parentId = await resolveParentID(ctx.sessionID);
      const s = state.load(parentId);
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" });
      const newFindings = [];
      for (const r of args.results) {
        const sc = s.scenarios[r.scenario];
        if (!sc) continue;
        sc.current = r.state;
        sc.reason = r.state === "skip" ? r.reason ?? null : null;
        if (r.state === "skip") {
          const { warn } = routeSkip(r.reason);
          if (warn) s.coverage.routing_warnings.push(`${r.scenario}: unrecognized SKIP reason -> tool-unavailable (${r.reason ?? ""})`);
        } else {
          if (r.state === "fail" && sc.qa_ids.length === 0) {
            newFindings.push({
              scenario: r.scenario,
              severity: r.severity ?? "LOW",
              title: r.title ?? r.scenario,
              problem: r.problem ?? "",
              remediation: r.remediation ?? "",
              location: r.location ?? null
            });
          }
        }
      }
      let minted = [];
      if (newFindings.length > 0) {
        minted = await assignIssueIds({ findings: newFindings, startAt: args.start_at_qa_id });
        for (const f of minted) {
          s.scenarios[f.scenario]?.qa_ids.push(f.id);
          const issue = {
            severity: f.severity,
            scenario: f.scenario,
            location: f.location,
            title: f.title,
            problem: f.problem,
            remediation: f.remediation,
            status: "open",
            fixed_at: null,
            fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] }
          };
          s.issues[f.id] = issue;
        }
      }
      if (args.phase === "baseline") s.baseline_recorded = true;
      s.updated_at = Date.now();
      state.save(parentId, s);
      return JSON.stringify({ status: "ok", new_qa_ids: minted.map((m) => m.id) });
    }
  });
  const qa_loop_step = tool({
    description: [
      "Advance the loop state machine. Perun-only.",
      '- `phase:"enter"` (2.0): increments the iteration ONLY when starting a new one; on re-entry into a not-yet-`evaluated` iteration it resumes from the stored `phase` WITHOUT a second increment (MAXI stays exact). Returns `{ action:"fix", issues }` | `{ action:"stop", stop_cause }` | `{ action:"final" }`. Requires a baseline wave first \u2014 returns `{ status:"error" }` if called before `qa_loop_ingest(phase:"baseline")` (guards against entering the fix loop on scaffold placeholders).',
      '- `phase:"evaluate"` (2f): no increment; regression-first then no-progress against THIS iteration\'s retest. Advances the row to `evaluated`. Returns `{ action:"continue" }` | `{ action:"stop", stop_cause }` | `{ action:"final" }`.',
      "",
      'Result shape: `{ status:"ok", ...decision }` or `{ status:"forbidden", reason }`.'
    ].join("\n"),
    args: {
      phase: tool.schema.enum(["enter", "evaluate"])
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_step");
      const parentId = await resolveParentID(ctx.sessionID);
      const s = state.load(parentId);
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" });
      if (args.phase === "enter") {
        if (!s.baseline_recorded) {
          return JSON.stringify({
            status: "error",
            reason: 'baseline not yet ingested \u2014 dispatch the dispatch_set to Zmora and call qa_loop_ingest(phase:"baseline") before entering the fix loop (qa_loop_step phase:"enter").'
          });
        }
        let tampered = false;
        try {
          tampered = hashPlan(readFileSync(s.plan_path, "utf8")) !== s.plan_sha256;
        } catch {
          tampered = true;
        }
        if (tampered) {
          const open = s.iterations.find((it) => it.n === s.budgets.iteration && it.stop_cause === null && it.phase !== "evaluated");
          if (open) {
            open.stop_cause = "plan-tamper";
            open.phase = "evaluated";
          } else {
            s.budgets.iteration += 1;
            s.iterations.push(newIterationRow(s.budgets.iteration, { phase: "evaluated", stop_cause: "plan-tamper" }));
          }
          s.updated_at = Date.now();
          state.save(parentId, s);
          return JSON.stringify({ status: "ok", action: "stop", stop_cause: "plan-tamper" });
        }
        const iterBefore = s.budgets.iteration;
        const decision2 = stepEnter(s);
        if (decision2.action === "fix") {
          if (s.budgets.iteration > iterBefore) {
            s.iterations.push(newIterationRow(s.budgets.iteration, { phase: "selecting", pending: decision2.issues ?? [] }));
          }
        } else if (decision2.action === "stop") {
          s.iterations.push(newIterationRow(s.budgets.iteration, { phase: "evaluated", stop_cause: decision2.stop_cause ?? null }));
        }
        s.updated_at = Date.now();
        state.save(parentId, s);
        return JSON.stringify({ status: "ok", ...decision2 });
      }
      const decision = stepEvaluate(s);
      const row = s.iterations[s.iterations.length - 1];
      if (row) {
        row.phase = "evaluated";
        const recs = Object.entries(s.scenarios);
        row.now_passing = recs.filter(([, sc]) => sc.baseline === "fail" && sc.current === "pass").map(([id]) => id);
        row.still_failing = recs.filter(([, sc]) => sc.current === "fail").map(([id]) => id);
        row.regressions = recs.filter(([, sc]) => sc.baseline === "pass" && sc.current === "fail").map(([id]) => id);
        if (decision.action === "stop" && decision.stop_cause) row.stop_cause = decision.stop_cause;
      }
      s.updated_at = Date.now();
      state.save(parentId, s);
      return JSON.stringify({ status: "ok", ...decision });
    }
  });
  const qa_loop_record_fix = tool({
    description: [
      "Record one sequential Svarog dispatch result (\xA76). Perun-only. The SOLE writer of `child_session_id` + `dispatch_count_total++`. Perun threads `child_session_id`/`svarog_status`/`changed`/`reason` FROM the dispatch_parallel result JSON \u2014 this tool does NOT read DispatchResult.",
      "- READY: bind `refs/svarog/ckpt/<child_session_id>` (if it exists), run anti-hardcoding on `changed[]`, mark `fix-attempted`. If `changed[]` is non-empty but the ref is MISSING \u2192 `checkpoint-integrity` stop (no restore, surfaced).",
      "- FAIL: auto-restore that issue's checkpoint (restoreFailRef), mark `fix-failed`.",
      "- ESCALATE: mark `deferred` with `reason`.",
      "Increments `dispatch_count_total` exactly once for READY/FAIL/ESCALATE alike, and clears the in-iteration `in_flight` cursor.",
      "",
      'Result shape: `{ status:"ok", issue_status, stop_cause?, hardcode_warnings? }` or `{ status:"forbidden", reason }`.'
    ].join("\n"),
    args: {
      qa_id: tool.schema.string(),
      child_session_id: tool.schema.string().describe("DispatchResult.sessionId for this Svarog dispatch, threaded by Perun."),
      svarog_status: tool.schema.enum(["READY", "FAIL", "ESCALATE"]),
      changed: tool.schema.array(tool.schema.string()).describe("Svarog's self-reported changed[] paths."),
      reason: tool.schema.string().describe("ESCALATE/FAIL reason; empty for READY."),
      be_payloads: tool.schema.array(tool.schema.string()).optional().describe("BE scenario request-payload literals for the anti-hardcoding scan.")
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_record_fix");
      const parentId = await resolveParentID(ctx.sessionID);
      const s = state.load(parentId);
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" });
      const issue = s.issues[args.qa_id];
      if (!issue) return JSON.stringify({ status: "error", reason: `unknown issue ${args.qa_id}` });
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(args.child_session_id)) {
        return JSON.stringify({ status: "error", reason: "invalid child_session_id" });
      }
      const row = s.iterations[s.iterations.length - 1];
      issue.fix.svarog_status = args.svarog_status;
      issue.fix.child_session_id = args.child_session_id;
      issue.fix.changed = args.changed;
      const ref = `refs/svarog/ckpt/${args.child_session_id}`;
      const hasRef = refExists(cwd, ref);
      let stopCause;
      if (args.svarog_status === "READY") {
        if (args.changed.length > 0 && !hasRef) {
          stopCause = "checkpoint-integrity";
          if (row) row.stop_cause = "checkpoint-integrity";
        } else {
          if (hasRef) {
            issue.fix.checkpoint_ref = ref;
            const warnings = antiHardcodeDiff(cwd, ref, args.changed, args.be_payloads ?? []);
            issue.fix.hardcode_warnings = warnings;
            if (row) row.warnings.push(...warnings);
          }
          issue.status = "fix-attempted";
        }
      } else if (args.svarog_status === "FAIL") {
        if (hasRef) {
          issue.fix.checkpoint_ref = ref;
          restoreFailRef(cwd, ref);
        }
        issue.status = "fix-failed";
      } else {
        issue.status = "deferred";
        issue.fix.escalate_reason = args.reason;
      }
      s.budgets.dispatch_count_total++;
      if (row) {
        row.dispatches_this_iter++;
        row.in_flight = null;
        if (!row.attempted_so_far.includes(args.qa_id)) row.attempted_so_far.push(args.qa_id);
      }
      s.updated_at = Date.now();
      state.save(parentId, s);
      return JSON.stringify({
        status: "ok",
        issue_status: issue.status,
        ...stopCause !== void 0 ? { stop_cause: stopCause } : {},
        hardcode_warnings: issue.fix.hardcode_warnings
      });
    }
  });
  const qa_loop_finalize = tool({
    description: [
      "Phase 4 (SUMMARY). Perun-only. Computes the run result via the Result mapping (Pass>NotVerified>BudgetExhausted>Stopped>Fail), then \u2014 and ONLY here, the oracle-separation invariant \u2014 transitions each `fix-attempted` issue to `fixed` when its scenario's `current` is `pass` after the FINAL ingest. Renders + writes the report markdown (the sole writer of `\u2705 Fixed`) and records `final_pass_elapsed_s`.",
      'The tool records `final_pass_elapsed_s` itself: it measures wall-clock from the FINAL ingest (`s.updated_at`, last set by `qa_loop_ingest({phase:"final"})`) to this finalize call \u2014 Perun cannot measure wall-clock, so it does NOT supply it. `final_pass_elapsed_s` is an OPTIONAL override only (e.g. for deterministic tests).',
      "",
      "Also returns `teardowns_pending` (\xA78): the recorded reversals for the auto-reverting seeds/mutations that ran, LIFO. When non-empty, Perun MUST dispatch a zmora-be teardown wave to run each block (un-seeding the DB rows the run created) before reporting done \u2014 the pre-loop ref reverts FILES only, not DB rows.",
      "",
      'Result shape: `{ status:"ok", result, report_path, teardowns_pending: { scenario, block }[] }` or `{ status:"forbidden", reason }`.'
    ].join("\n"),
    args: {
      final_pass_elapsed_s: tool.schema.number().optional().describe("Optional override for the final-pass wall-clock seconds; omit to let the tool compute it from the FINAL-ingest timestamp.")
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_finalize");
      const parentId = await resolveParentID(ctx.sessionID);
      const s = state.load(parentId);
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" });
      const now = Date.now();
      const computedFinalElapsed = Math.max(0, Math.round((now - s.updated_at) / 1e3));
      const finalizedAt = new Date(now).toISOString();
      for (const [, issue] of Object.entries(s.issues)) {
        if (issue.status === "fix-attempted" && s.scenarios[issue.scenario]?.current === "pass") {
          issue.status = "fixed";
          issue.fixed_at = finalizedAt;
        }
      }
      s.result = resultOf(s);
      s.budgets.final_pass_elapsed_s = args.final_pass_elapsed_s ?? computedFinalElapsed;
      s.finalized_at = now;
      s.updated_at = s.finalized_at;
      state.save(parentId, s);
      writeFileSync(s.report_path, renderReport(s));
      const teardowns_pending = [...s.teardowns ?? []].reverse();
      return JSON.stringify({
        status: "ok",
        result: s.result,
        report_path: s.report_path,
        teardowns_pending
      });
    }
  });
  const qa_loop_undo = tool({
    description: [
      "Total undo (\xA76): revert the whole working tree to `refs/qa-loop/pre/<run>`, returning the user to exactly the pre-loop state (including any pre-existing dirty work). Perun-only \u2014 the coordinator cannot `git reset` itself, so it invokes this tool on request.",
      "The ref restores FILES only. `teardowns_pending` (\xA78, LIFO) carries the DB reversals for any auto-reverting seeds/mutations that ran; when non-empty, Perun runs a zmora-be teardown wave to un-seed the rows too, so undo reverts BOTH files and data.",
      "",
      'Result shape: `{ status:"ok", restored_ref, teardowns_pending: { scenario, block }[] }` | `{ status:"error", reason }` | `{ status:"forbidden", reason }`.'
    ].join("\n"),
    args: {},
    async execute(_args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_undo");
      const parentId = await resolveParentID(ctx.sessionID);
      const s = state.load(parentId);
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" });
      const ref = s.pre_loop.undo_ref;
      if (!refExists(cwd, ref)) {
        return JSON.stringify({ status: "error", reason: `pre-loop ref ${ref} is missing` });
      }
      undoToPreLoop(cwd, ref);
      const teardowns_pending = [...s.teardowns ?? []].reverse();
      return JSON.stringify({ status: "ok", restored_ref: ref, teardowns_pending });
    }
  });
  return {
    qa_loop_start,
    qa_loop_ingest,
    qa_loop_step,
    qa_loop_record_fix,
    qa_loop_finalize,
    qa_loop_undo
  };
}
export {
  QA_LOOP_DEFAULTS,
  SEED_MARKER,
  TEARDOWN_MARKER,
  baseUrlIsLocal,
  extractTeardown,
  makeQaLoopTools
};
