# Code Review — QA Engineering Loop (`feat/qa-engineering-loop`)

**Date:** 2026-06-29
**Branch:** `feat/qa-engineering-loop` (40 commits, `origin/master..HEAD`)
**Scope:** `git diff origin/master...HEAD` — +10,429 / −515 across 93 files. Working tree clean.
**Meaningful surface (excl. generated `dist/` and design docs):** new module `src/modules/qa-loop/` (9 files, ~1,263 LOC), Svarog/coordinator primitives, the Perun prompt restructure, fix-auto de-registration.
**Method:** 3 parallel auditors (security · quality · documentation) → reviewer code-verification of every load-bearing claim → adversarial verification (Cross-Verifier + Challenger).

## Verdict

> **Mergeable after addressing the contract/report-fidelity cluster. No CRITICAL, no HIGH, no security vulnerabilities, no false positives.** Build is green (`tsc --noEmit` clean; **1208/1208 tests pass**, 128 files — re-run by the quality auditor this session). The architecture is genuinely well-executed (pure state core, single-writer oracle, frozen-boundary compliant). The findings are **honesty/contract** issues — a documented guard that doesn't run, a report that shows impossible numbers, and docs that disagree with the shipped driver — none of which corrupt the loop's actual pass/fail outcome, but several of which undermine trust in its deliverable.

**4 MEDIUM · 9 LOW.** The one item to treat as a merge gate regardless of its severity number is **ARCH-001** (a shipped broken promise in `perun.md`).

---

## Verification Summary

**Method:** every finding grep/read-verified against live code by the reviewer, then adversarially challenged.

| Metric | Count |
|--------|-------|
| Findings verified (real, confirmed) | 13 |
| False positives removed | **0** |
| Severity adjustments | 5 |
| Cross-analysis composites / coverage gaps | 4 / 3 |

**Severity adjustments (auditor → final):** ARCH-001 `CRITICAL→MEDIUM` · MAINT-001 `HIGH→MEDIUM` · DOC-003 `HIGH→LOW` · SEC-001 `MEDIUM→LOW` · MAINT-002 `MEDIUM→LOW`. The Challenger argued LOW across the board (no untrusted principal, no control-flow impact); the Cross-Verifier argued HIGH via composition. Split where a *shipped* contract is broken (kept MEDIUM) and deferred to the Challenger where impact is purely report-cosmetic or eval-only.

**Cross-analysis (Security ↔ Quality ↔ Docs):** the highest-leverage insight is that the new `perun-tool-contract.test.ts` gave a **false green** — it pins call *signatures* in `perun.md` only, so a behavioral promise (ARCH-001) and an eval-doc return-shape (DOC-003) both drifted under a passing suite. The durable fix is test-modality, not symptom (see **Coverage Gaps**).

**Challenged & downgraded:** SEC-001 (caller-gated + Perun-templated path ⇒ no positioned attacker), MAINT-002 & DOC-003 (cosmetic / eval-fixture only). **Challenged & upheld:** ARCH-001 and MAINT-001 — confirmed real; held at MEDIUM rather than the Challenger's LOW because both ship in a primary artifact (the prompt contract; the report).

---

## MEDIUM

### [MEDIUM] ARCH-001: Documented `plan-tamper` mid-run guard is not implemented

**Status:** ✅ Fixed (2026-06-29)

**ID:** ARCH-001
**Location:** `src/modules/qa-loop/tools.ts:347+` (the `enter` branch), `src/agents/perun.md:329` & `:98`
**Category:** Architecture (contract parity)
**Effort:** easy

**Problem.** `perun.md:329` promises that `qa_loop_step({ phase: "enter" })` *"re-hashes the plan (tamper guard — a changed plan stops here with `stop_cause: "plan-tamper"`)"*. It doesn't. `hashPlan` is called **only** in `qa_loop_start` (`tools.ts:120`); the `enter` branch delegates to the *pure* `stepEnter(s)` (`state-machine.ts:52-81`), which receives no plan text and touches no filesystem. `plan-tamper` exists as a union member (`types.ts:13`), a `STOP_PRECEDENCE` slot (`state-machine.ts:14`), and a `STOPPED_CAUSES` entry (`:163`) — but is **never assigned** to any `row.stop_cause` or pushed to `fired[]`.

**Impact.** The loop's headline integrity guarantee — the plan is the oracle, tampering is caught — silently does not hold *during* a run. A plan edited at a gate (common in `approve` mode) is accepted; the loop continues against the stale baseline and emits a report claiming an integrity it never enforced. `REUSE` re-hashes on the *next* `qa_loop_start`, so the gap is intra-run only — but that is exactly the window the guard names. Three tests pass around the hole (contract test = signatures; `state-machine.test.ts:409` hand-injects the cause; `types.test.ts:29` is type-level).

**Remediation.** Binary choice — do one, before merge:

```ts
// qa_loop_step, enter branch, BEFORE stepEnter(s) (keeps stepEnter pure — I/O in the tool):
if (args.phase === "enter") {
  try {
    if (hashPlan(readFileSync(s.plan_path, "utf8")) !== s.plan_sha256) {
      /* push a stop row with stop_cause: "plan-tamper", save, return action:"stop" */
    }
  } catch { /* plan unreadable mid-run → treat as tamper */ }
  // …existing stepEnter delegation…
}
```

…**or** delete the promise (`perun.md:329`, `:98`) and the dead `plan-tamper` plumbing (`types.ts`, `state-machine.ts:14/163`). Either way add the behavior test in **GAP-2**. Note: `coordinator.md:89` also documents a `deriveReportPath`/traversal guard that likewise isn't present — same "doc promises a control the code lacks" class (see SEC-001).

### [MEDIUM] MAINT-001: Coverage counters accumulate across phases — the report shows impossible totals

**Status:** ✅ Fixed (2026-06-29)

**ID:** MAINT-001
**Location:** `src/modules/qa-loop/tools.ts:281,288` (`qa_loop_ingest`)
**Category:** Maintainability (data fidelity)
**Effort:** easy

**Problem.** `qa_loop_ingest` declares a `phase: "baseline"|"retest"|"final"` arg but **never reads it** (`args.phase` is referenced only at `tools.ts:347`, a different tool). Coverage buckets increment unconditionally — `s.coverage.not_verified[bucket]++` (`:281`), `s.coverage.exercised[...]++` (`:288`) — with no per-phase reset. Ingest runs at baseline + every retest + final over the *same* scenario set, so counts compound.

**Impact.** A plan with 5 feature scenarios passing at baseline and final reports `exercised.feature = 10` (more with retests) — a physically impossible number in the report's **Coverage** section, the artifact a human uses to judge QA completeness. **No control-flow impact** (verified: `resultOf`/`stepEvaluate`/`hasFailAtOrAboveFloor` read `scenarios[]`/`issues[]`, never `coverage`) — which is why this is MEDIUM, not HIGH. Invisible to CI because `tools-ingest.test.ts` only ever ingests a single `baseline` phase (**GAP-1**).

**Remediation.** Make coverage a **pure projection** recomputed from `s.scenarios` at render time (single source of truth, accumulation impossible), or reset the buckets at the head of each ingest. The projection approach also lets you drop the seeded `mutationGuardCount` and the now-dead `coverage` writes.

### [MEDIUM] DOC-001: Report filename convention — docs say `-report.md`, the shipped driver writes `<topic>.md`

**Status:** ✅ Fixed (2026-06-29)

**ID:** DOC-001
**Location:** `src/commands/run-qa.md:97`, `docs/plugins/coordinator.md:36,89`, `docs/plugins/qa.md:57`, `…/report-format/SKILL.md:12` vs `src/agents/perun.md:82,88,634`
**Category:** Documentation
**Effort:** easy

**Problem.** Six docs advertise `docs/testing/reports/<date>-<topic>-report.md`; `perun.md` — the agent that actually computes and passes `report_path` to `qa_loop_start` — uses `<date>-<topic>.md` with no `-report` suffix (zero `-report` references in `perun.md`). The user-visible filename is whatever `perun.md` emits, so the guides are wrong.

**Impact.** Cosmetic-not-breaking *today* (real runs are self-consistent because `perun.md` is the sole driver), but `sidecarPathFor` (`sidecar.ts:10-17`) derives the REUSE/ADOPT pairing key by stripping `-report.md` — so a hand-invocation following the docs would key a *different* sidecar stem and silently miss cross-session REUSE. Pick one convention and converge all six docs onto it. (Design spec/plan also use `-report.md` — lower priority, historical.)

### [MEDIUM] DOC-002: `qa.md` still describes `/qa:run` as a one-pass pipeline

**Status:** ✅ Fixed (2026-06-29)

**ID:** DOC-002
**Location:** `docs/plugins/qa.md:49-57`
**Category:** Documentation
**Effort:** easy

**Problem.** The `/qa:run` section ends at "Generates `…-report.md`" with no test→fix→retest loop, no baseline/final phases, no Svarog as in-loop fixer, no `qa_loop_*` tools, no MAXI/MAXD/TB budgets, no mutation guard (grep of `qa.md` for `qa_loop|Svarog|loop-state` → 0 hits). This branch made `/qa:run` the loop entry point, and `run-qa.md:119/126` point at `qa.md` as the QA "single source of truth" — so the stale description is load-bearing.

**Remediation.** Rewrite the section to the closed loop (baseline → gated Svarog fixes → re-test → authoritative final → report), reference the six tools + budgets + mutation guard, and cross-link `docs/plugins/qa-loop-engineering.md`. Pair with DOC-001's filename fix (`qa.md:57`).

---

## LOW

### [LOW] SEC-001: `report_path` / `plan_path` reach a privileged write sink with no code-level containment

**Status:** ✅ Fixed (2026-06-29)

**ID:** SEC-001
**Location:** `src/modules/qa-loop/tools.ts:116-117` → finalize write `:531`, `src/modules/qa-loop/sidecar.ts:35-39`
**Category:** Security · **CWE-22 / CWE-73 · OWASP A01:2025**
**Effort:** easy

**Problem.** `qa_loop_start` does `join(cwd, args.report_path)` / `join(cwd, args.plan_path)` with no traversal check (`join` resolves `..`); the absolute path becomes a privileged `writeFileSync` at finalize and the sidecar temp-write+rename. Only guards: the fail-closed caller-gate (Perun-only) + `perun.md` prose (`topic ^[a-z0-9-]+$`, "never change directories"). `coordinator.md:89` even *documents* a `deriveReportPath` that "refuses anything that could traverse" — which isn't present in the qa-loop path.

**Impact (and why LOW, not MEDIUM).** No positioned attacker: all six tools are coordinator-only, and Perun templates the path from a fixed `docs/testing/reports/<date>-<topic>.md` slug — there is no untrusted free-form principal supplying `../`. This is a **defense-in-depth gap on a write primitive**, not an exploitable traversal. **Escalates to MEDIUM/HIGH if these tools are ever exposed beyond the coordinator.** Cheap, worth doing:

```ts
function assertInside(cwd: string, p: string, label: string): string {
  const abs = resolve(cwd, p)
  if (abs !== cwd && !abs.startsWith(cwd + sep)) throw new Error(`${label} escapes the repo: ${p}`)
  return abs
}
```

Add a `tools-start` test rejecting `..`/absolute paths, and either implement or strike the `coordinator.md:89` `deriveReportPath` claim.

### [LOW] SEC-002: `child_session_id` interpolated into a git ref name without a shape check

**Status:** ✅ Fixed (2026-06-29)

**ID:** SEC-002
**Location:** `src/modules/qa-loop/tools.ts:441` (`refs/svarog/ckpt/${args.child_session_id}`)
**Category:** Security · **CWE-20**
**Effort:** trivial

**Problem / Impact.** `qa_loop_record_fix` accepts `child_session_id` as a bare string and splices it into a ref. Bounded: all git calls are `execFileSync` argv (metacharacters inert), `cwd` is fixed, and a forged/garbage name only yields a non-existent ref → `refExists` false → READY-bind and FAIL-restore both no-op. Realistic value is server-minted (`ses_…`). **Remediation:** allowlist at the boundary — `if (!/^[A-Za-z0-9._-]{1,128}$/.test(args.child_session_id)) return error`.

### [LOW] SEC-003: untrusted `changed[]` used as a git pathspec

**Status:** ✅ Fixed (2026-06-29)

**ID:** SEC-003
**Location:** `src/modules/qa-loop/git-ops.ts:85` (`antiHardcodeDiff`)
**Category:** Security · **CWE-88**
**Effort:** trivial

**Problem / Impact.** Svarog's self-reported `changed[]` feeds a `git diff` pathspec. The `--` separator **is** present, so option-injection is blocked; worst case is a spurious/missing best-effort warning string (read-only diff, wrapped in try/catch). The *restore* path correctly ignores `changed[]` entirely (orphans derived from `git ls-files`). **Remediation (optional):** skip non-plain entries (`startsWith("-"|":")`, `includes("..")`).

### [LOW] ARCH-002: `zero-failure` and `user-abort` StopCause members are inert

**Status:** ✅ Fixed (2026-06-29)

**ID:** ARCH-002
**Location:** `src/modules/qa-loop/state-machine.ts:21-22`, `types.ts:11-13`
**Category:** Architecture (dead code / union honesty)
**Effort:** trivial

**Problem.** Both sit in `STOP_PRECEDENCE` (and `user-abort` in `STOPPED_CAUSES`) but are never fired — the zero-failure path returns `action:"final"`, and abort routes through Perun to Phase 3, never a tool stop. Dead reserved vocabulary that implies stop causes the loop can't produce. **Remediation:** drop `zero-failure`; either wire `user-abort` (a tool that stamps it) or remove it.

### [LOW] MAINT-002: Loop-History columns always render "—"

**Status:** ✅ Fixed (2026-06-29)

**ID:** MAINT-002
**Location:** `src/modules/qa-loop/tools.ts:362-365,381-384` → `report.ts:68-73`
**Category:** Maintainability
**Effort:** easy

**Problem.** `now_passing` / `still_failing` / `regressions` are written **only** as `[]` at row creation and never populated (the sole non-`[]` writes are test fixtures). `stepEvaluate` *computes* `regressed`/`newlyPassing` (`state-machine.ts:116-117`) but discards them. So those three report columns always show "—" — including an empty "Regressions" column on a regression-stopped run. **Remediation:** populate the arrays from the scenario scan in the `evaluate` branch, or delete the columns.

### [LOW] MAINT-003: Budget defaults (3 / 50 / 1800) quadruplicated as bare literals

**Status:** ✅ Fixed (2026-06-29)

**ID:** MAINT-003
**Location:** `src/modules/qa-loop/tools.ts:126-128` (+ `run-qa.md`, `perun.md:91`, spec)
**Category:** Maintainability (DRY)
**Effort:** trivial

**Problem / Remediation.** Four hand-maintained copies, nothing tying them together → doc-drift hazard. Hoist a `QA_LOOP_DEFAULTS` const the schema references; optionally a sync test (the repo already uses `perun-tools-sync.test.ts`).

### [LOW] PERF-001: `sidecar.save` rewrites the full JSON on every state mutation

**Status:** ☑️ Acknowledged — informational, no change (2026-06-29)

**ID:** PERF-001
**Location:** `src/modules/qa-loop/sidecar.ts:30-40`
**Category:** Performance
**Effort:** —

**Assessment (informational).** Each tool call re-serializes the entire sidecar (atomic temp+rename) — O(state) per mutation. Negligible at realistic plan sizes (tens of scenarios); the atomic-write correctness is worth more than the I/O. No action needed; noted for completeness. The loop re-running the entire plan each phase is **by design** (full-fidelity), not a defect.

### [LOW] DOC-003: Eval scenarios reference a non-existent return field `{ integrity_abort: true }`

**Status:** ✅ Fixed (2026-06-29)

**ID:** DOC-003
**Location:** `docs/eval/scenarios/perun/qa-loop-checkpoint-integrity.md:5,14`, `docs/eval/scenarios/perun/README.md:45`
**Category:** Documentation
**Effort:** trivial

**Problem.** The tool emits `stop_cause: "checkpoint-integrity"` (`tools.ts:449`); these eval docs instruct against a phantom `{ integrity_abort: true }` (and line 15 of the same file uses the correct term — internally contradictory). **Why LOW, not the auditor's HIGH:** eval-fixture docs only; the shipped `perun.md` is correct and fenced by `perun-tool-contract.test.ts`. But these evals are run manually — the checkpoint-integrity scenario would mis-grade — so fix it and widen the contract test's read-set to the eval docs (**GAP-3**).

### [LOW] DOC-004: `heavy-execution.md` omits the loop's automated checkpoint resolution + the create-only `update-ref` guard

**Status:** ✅ Fixed (2026-06-29)

**ID:** DOC-004
**Location:** `docs/heavy-execution.md:48,56,118`
**Category:** Documentation
**Effort:** easy

**Problem.** It still says Svarog restore is manual-only via out-of-band `git for-each-ref`. This branch added: in-loop resolution of `refs/svarog/ckpt/<child_session_id>` (auto-restore on FAIL) and a create-only `update-ref` freshness guard for all Svarog users. A maintainer onboarding via this doc builds a threat model missing exactly the surfaces SEC-001/002 live on. **Remediation:** add a short note on both.

---

## Test Coverage Gaps (highest-leverage fixes)

These are *why* the issues shipped green — fix the modality and the class can't recur:

- **GAP-1 — no multi-phase ingest test.** `tools-ingest.test.ts` only ever calls `qa_loop_ingest` once, `phase:"baseline"`. Add a baseline→retest→final sequence asserting buckets reflect the latest state, not the sum → catches **MAINT-001**.
- **GAP-2 — no `enter`-phase behavior test.** Only `plan-tamper` assertions hand-inject the cause or are type-level. Drive `qa_loop_step({phase:"enter"})` against a mutated plan and assert `stop_cause:"plan-tamper"` → catches **ARCH-001** (also exercises ARCH-002's never-fired members).
- **GAP-3 — contract test reads only `perun.md`.** `perun-tool-contract.test.ts` `readFileSync`s a single file, so its `not.toContain("integrity_abort")` can't see the live token in the eval docs. Widen the corpus, or add a doc-lint: no `qa_loop_*` doc may reference a return field absent from the tool's emitted shapes → catches **DOC-003** and future drift.

## What's well-built (verified, not boilerplate)

- **`state-machine.ts` is genuinely pure and correct.** `resolveStopCause` is a deterministic max-over-precedence (not control-flow order) — exactly the design that kills stop-ordering bugs. `resultOf` precedence (`Pass > NotVerified > BudgetExhausted > Stopped > Fail`) has no holes I or the auditors could find; `Pass` is correctly checked before `BudgetExhausted` (a budget-stopped run with a green authoritative final is `Pass` — matches the oracle doctrine).
- **Oracle separation enforced by construction** — `qa_loop_finalize` is the sole writer of both `fix-attempted→fixed` and the `✅ Fixed` marker. The marker-erasure/status-race class is designed out.
- **Caller-gate is fail-closed and drift-proof** — all 6 tools guard `isCoordinatorCaller` first; `caller-gate-coverage.test.ts` iterates `QA_LOOP_TOOL_NAMES`. Security auditor: 0 command-injection (all git via `execFileSync` argv), 0 secrets (trufflehog over 40 commits), deps unchanged.
- **`checkpoint.ts` create-only `update-ref` is a security *improvement*** — the all-zeros expected-OID makes the write TOCTOU-safe and preserves the original pre-edit snapshot across a host-restart resume; test-covered.
- **Frozen-boundary compliance PASS** — qa-loop imports only `src/`-internal siblings; no `@appverk/opencode-skill-utils`. **`types.ts` is a real single-source-of-truth** (no field-name drift across sidecar/state-machine/tools/report). **fix-auto de-registration is clean** (no dangling refs; `packages/code-review` correctly retains its own). **`tools.ts` (568 lines) is a cohesive DI factory, not a God file** — leave as one. Build green.

---

*Generated by `/code-review:review` — 3 auditors + Cross-Verifier + Challenger, all findings reviewer-verified against live code.*
