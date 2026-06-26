# QA Engineering Loop — Design

**Date:** 2026-06-25
**Status:** Design (approved section-by-section; pending spec review → implementation plan)
**Topic:** Migrate av-marketplace's closed test→fix→retest "engineering loop for QA" onto the Pantheon harness, with **Svarog** as the in-loop fixer.

---

## 1. Problem & goal

Today the Pantheon harness runs QA **once**: Perun's Workflow 1 dispatches Veles to plan and Zmora to execute scenarios, then writes a report (`docs/testing/reports/<date>-<topic>-report.md`). Workflow 2 can dispatch a fixer **sequentially, one issue at a time**, but it **never re-tests** — once fixes land, the human must manually re-run QA. There is no iteration, no budget, no regression guard, and no persisted run state.

`av-marketplace` solved this with `/qa:loop` (introduced 2026-06-17, now v2.4.0): a closed **test→fix→retest** loop that runs a baseline, then repeatedly picks failing issues, dispatches a fixer, re-runs the affected scenarios, and stops on green / regression / no-progress / budget — with an authoritative final run that is the sole writer of `✅ Fixed`. Its deterministic doctrine was extracted into a reusable `loop-engineering` skill.

**Goal:** bring that loop to Pantheon as a **full-fidelity** port, adapted to our coordinator-orchestrated architecture, with **Svarog** (our heavy executor) as the fixer instead of av-marketplace's `fix-auto`. Running QA becomes the loop — there is one QA entry point.

### Reference sources (av-marketplace)
- `/plugins/qa/commands/loop.md` — the 1,095-line loop algorithm
- `/plugins/qa/skills/loop-engineering/SKILL.md` — doctrine, oracle taxonomy, anti-patterns
- `/docs/superpowers/specs/2026-06-17-qa-loop-design.md` — original design spec

---

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| **D1** | Scope of the port | **Full-fidelity** — port all of av-marketplace's machinery (sidecar idempotency, budgets, coverage honesty, anti-hardcoding, modes), adapted to our coordinator. |
| **D2** | In-loop fixer | **Svarog** (ours; test-first + full-suite-green gate; checkpoint recovery). The loop is built fixer-agnostic, but only Svarog is wired in v1. |
| **D3** | Relationship to existing QA | **The loop replaces one-pass QA entirely.** Workflows 1 + 2 collapse into one unified loop workflow; there is a single QA entry point. The read-only "report, don't fix" outcome stays reachable via **gate-Abort**, not as a separate mode. |
| **D4** | Control architecture | **Coordinator-orchestrated with deterministic plugin tools** (Approach A). The loop's math + state live in a new `qa-loop` module's tools; Perun dispatches and calls them. The tools run `git`, read wall-clock, and hash in-process (Node `crypto`) — never Perun. |
| **D5** | Gating | **approve** (default) / **auto** (headless) / **step**; the gate is Perun's `question` tool; an unanswerable gate fails safe to **Abort**. |
| **D6** | fix-auto de-registration | **In scope** for this work — once the loop uses Svarog, fix-auto has no Pantheon caller. |
| **D7** | Checkpoint-ref GC | **Deferred for v1** — the loop does **not** prune the `refs/svarog/ckpt/*` it creates. By-id resolution (§6) is immune to ref accumulation, so stale refs are harmless; pruning is a later-version nicety, not a v1 requirement. |

These are consistent with last session's (now-superseded) intent: Svarog owns QA fixes, per-issue sequential dispatch, confirm-first gating, and re-verification by an **independent** tester before stamping `Fixed`.

### Why not the alternatives (D4)
- **Prompt-driven loop** (Perun reasons the loop; state in turn-text + report) — fails full-fidelity: Perun can't hash the plan or read wall-clock (no shell), cross-turn LLM regression/progress detection is unreliable, budgets become advisory. This is the state-fragility that bit the prior session.
- **Privileged `/qa:loop` command that shells freely** (literal av-marketplace port) — in OpenCode a command runs *inside* Perun, so it is either still restricted or it punches a hole in the coordinator-policy gate that deliberately denies the coordinator `git`/`docker`/`date`. Breaks the security model.

---

## 3. Architecture & components

```
                         ┌──────────────────────────────────────────┐
   user: "run QA"  ─────▶│  PERUN  (coordinator, mode:primary)       │
                         │  unified QA-loop workflow                 │
                         │  — dispatches specialists                 │
                         │  — calls qa-loop tools (no shell itself)  │
                         │  — surfaces gates + summary to the user   │
                         └───┬───────────────┬───────────────┬───────┘
            dispatch_parallel│               │ tool calls    │ dispatch_parallel
                 ┌───────────▼──┐   ┌─────────▼─────────┐  ┌──▼────────────────┐
                 │ Veles (plan) │   │  qa-loop MODULE   │  │ Svarog (fix, 1×ea) │
                 │ Zmora fe/be  │   │  (NEW)            │  │ — checkpoint ref   │
                 │  baseline /  │   │  owns budgets,    │  │ — returns changed[]│
                 │  re-test /   │   │  idempotency,     │  └────────────────────┘
                 │  final       │   │  baseline⇄current,│
                 │ Stribog/     │   │  regression/      │  ┌────────────────────┐
                 │ zmora-setup  │   │  progress, coverage│ │ PERSISTENCE        │
                 │  bring-up,   │   │                   │──▶│ (tool-owned,       │
                 │  bindings    │   │  6 tool actions   │  │  single writer):   │
                 └──────────────┘   └───────────────────┘  │ • sidecar JSON     │
                  (all REUSED)                              │ • report markdown  │
                                                           └────────────────────┘
```

### New: the `qa-loop` module (`src/modules/qa-loop/`)
| Piece | Role |
|---|---|
| 6 tool actions | `qa_loop_start` · `qa_loop_ingest` · `qa_loop_step` · `qa_loop_record_fix` · `qa_loop_finalize` · `qa_loop_undo`, defined + registered in the **new module's own plugin tool map** (the pattern `qa/index.ts` uses for `preflight`/`parse_plan` — *not* the coordinator map) and added to Perun's `allowed-tools` frontmatter + `PERUN_TOOLS` + `perun-tools-sync.test.ts` (no programmatic link, `coordinator/index.ts:507-510`) |
| sidecar persistence | in-process `Map` (same shape as `src/modules/qa/qa-run-state.ts`) **plus** a new disk-JSON layer for cross-session resume that qa-run-state lacks (it is in-process only) |
| privileged git ops | plan-hash (Node `crypto`, in-process — no `shasum`), `refs/qa-loop/pre` capture, checkpoint resolution **by child session-id**, FAIL auto-restore (reuses `restoreCheckpoint`), anti-hardcoding diff, total undo |
| report renderer | writes the report markdown — single writer of Status / Loop History / Coverage |
| classifier + coverage | scenario-kind (`feature`/`sanity`/`negative`) + coverage buckets per the §5 taxonomy; budget timer via `Date.now()` |

### Reused as-is (the migration adds a control layer; it does not re-implement QA execution)
Veles (`src/modules/plan/veles.md`), `preflight` and `parse_plan`, Stribog bring-up (`src/modules/stribog/`), zmora-setup recipes (`src/modules/qa/`), Zmora fe/be execution + dependency-aware waves, and Svarog's contract + checkpoint (`src/modules/svarog/`).

### Persistence model (a robustness win)
The `qa-loop` tool is the **single writer** of both the sidecar JSON and the report markdown. Perun stops hand-editing `✅ Fixed` lines. Zmora/Perun supply issue *content* (severity, problem, remediation); the tool formats + persists it deterministically. One deterministic actor owns every write — the marker-erasure / status-race class of bugs is designed out.

---

## 4. Control flow + state machine

Actor legend: `P` = Perun dispatch · `T` = qa-loop tool · `V/Z/S` = Veles/Zmora/Svarog.

```
Phase 0  RESOLVE & GUARD                              P→ qa_loop_start (T)
  • plan path (V authors if none) · base-URL · loopback-only env guard
  • working-tree dirty check · hash plan → REUSE / ADOPT / FRESH · init sidecar
  • capture pre-loop undo ref  refs/qa-loop/pre/<run>
        │
Phase 1  BASELINE  (authoritative, once)             P→ Z waves → qa_loop_ingest(baseline) (T)
  • preflight · parse_plan · Stribog bring-up · zmora-setup        [all REUSED]
  • Zmora fe/be run every scenario in ≤4 waves
  • ingest → baseline status map + scenario-kind + coverage
  • PHASE-1 EXIT: if ANY scenario fails ≥ severity → enter the loop (Phase 2).
  •   Otherwise finalize NOW via the **same Result mapping** (§ below) applied to the baseline —
  •   Pass / NotVerified / **Fail** (a sub-floor fail with no ≥severity fail falls to the else→Fail) — skip Phases 2–3.
  •   (One shared, total predicate; not a separate three-way.)
        │  (failures exist)
Phase 2  LOOP   admit body iff: failing ∧ iteration ≤ MAXI ∧ disp < MAXD ∧ elapsed < TB     ── zoom below
        │
Phase 3  FINAL  (authoritative, once)                P→ Z full plan → qa_loop_ingest(final) (T)
  • re-run the ENTIRE plan · only THIS run writes ✅ Fixed · new regressions → new QA-IDs
        │
Phase 4  SUMMARY                                     T→ qa_loop_finalize
  • result (Pass / Fail / BudgetExhausted / Stopped / NotVerified — per the Result mapping) · coverage (exercised vs not-verified)
  • Loop History table · recovery hint (qa_loop_undo restores refs/qa-loop/pre/<run>)
```

### Iteration zoom (the body of Phase 2)
```
2.0  qa_loop_step(enter) (T)  iteration++ (this phase ONLY) · pre-checks: re-hash plan (tamper?) · time + dispatch budget
        └─▶ returns  {fix:[issues]}  |  {stop: reason}  |  {final}
2a   (inside step)   select still-failing ∩ ≥severity · drop location-less issues (count surfaced at the gate)
2b   GATE (per mode):
        approve  → P question: Approve all / Skip to final / Abort   ← pauses, spans a turn
        auto     → no gate (headless / eval / cron)
        step     → gate here AND again before re-test
2c   FIX — per issue, SEQUENTIAL:
        before each issue:  if dispatch_count_total ≥ MAXD → stop the fix-set here → final   (MAXD is a TRUE ceiling)
        P→ Svarog (1 issue) → qa_loop_record_fix (T)  [record_fix does dispatch_count_total++ post-dispatch; both budget gates read this one authoritative counter]
           READY    → changes kept · issue = fix-attempted · bind checkpoint ref (set-diff)
           FAIL     → tool auto-restores THAT issue's checkpoint (restoreCheckpoint) · fix-failed · next
           ESCALATE → edit aborted/none · issue = deferred · next   (all-deferred ⇒ stop)
2d   ANTI-HARDCODING — T: once after the fix-set, diff each issue's changed[] vs its own checkpoint; flag literals matching a BE scenario payload → warnings (non-blocking)
2e   RE-TEST — P→ Zmora for sections holding still-failing scenarios → qa_loop_ingest(retest) (T)
2f   qa_loop_step(evaluate) (T)  no increment · regression FIRST (passed baseline, now fails ⇒ stop) · THEN progress (none newly passes ⇒ stop)
2g   sidecar += iteration entry · report += Loop History row    ← NO Status lines yet
```

### Termination conditions (faithfully ported + two adaptations marked ⁺)
| Stop cause | Trigger | After-effect |
|---|---|---|
| Zero-failure exit | baseline: no fail ≥ severity AND ≥1 **feature-kind** PASS (else NotVerified) | report; skip loop **and** final |
| Regression guard | scenario passed baseline, fails a re-run | stop loop → final |
| No-progress | no scenario newly passes in an iteration | stop loop → final |
| Max-iterations | a `step(enter)` increment makes `iteration > MAXI` | stop loop; **final still runs** |
| Max-dispatches | `disp ≥ MAXD` | skip remaining fixes → final |
| Time-budget | `elapsed ≥ TB` | stop → final |
| All-deferred ⁺ | every issue in **this iteration's** fix-set (selected at 2a) returned ESCALATE — a single READY/FAIL instead routes to no-progress via 2f | stop; surface escalations |
| User abort | decline at gate / Esc | stop; partial report |
| Plan tamper | plan hash changed mid-run | abort; flush partial report |
| Checkpoint-integrity ⁺ | a `READY` reported `changed[]` but its ckpt ref is **missing**, OR the ref **pre-existed** at dispatch (stale same-id, §6) | abort; do **not** auto-restore the untrusted ref; surface |

**Stop-cause precedence** (when several could fire, resolved deterministically): checkpoint-integrity ≈ plan-tamper (abort-class, top) › regression › all-deferred › no-progress › budgets (max-iterations / max-dispatches / time). **Resolution model:** the tool collects *every* cause that **actually fired** (i.e. whose detecting check ran) into a set and resolves to the single highest-precedence one (a deterministic `max` over this list — **not** control-flow order). The set only contains causes whose check ran: **regression and no-progress are evaluated solely against THIS iteration's fixes via the 2e re-test**, so an all-ESCALATE iteration (no fix applied → no re-test) cannot have fired regression — `all-deferred` legitimately wins, and any *latent* regression from a prior kept-`READY` is caught at the **Phase-3 final** (logged as a new QA-ID), not mid-loop. This is why the 2c short-circuit agrees with the `max`: the skipped checks contribute no causes. Likewise, if a **budget** stop truncates the fix-set before every selected issue is dispatched, the all-deferred check has not fully run and does not fire — the budget cause wins. The Loop-History row records the winning `stop_cause` — e.g. an all-ESCALATE iteration records `all-deferred`, never `no-progress`.

**Result mapping (`qa_loop_finalize`, computed once).** After the authoritative final run — or immediately, for the abort-class causes that skip it — the result is: **Pass** if no fail ≥ severity AND ≥1 **feature-kind** scenario PASSED · else **NotVerified** if no scenario is in a pass state, OR every feature-kind scenario landed in `not_verified` (a write-heavy plan whose entire feature surface is mutation-guarded does **not** report green) · else **BudgetExhausted** if the loop stopped on a budget · else **Stopped** on user-abort / plan-tamper / checkpoint-integrity · else **Fail** (regression / no-progress / all-deferred / nothing left to fix). This exact predicate is evaluated identically at the Phase-1 exit and the Phase-3 final. Note the order: **Pass is checked before BudgetExhausted**, so a budget-stopped run whose authoritative final pass is green reports **Pass** (the final run is authoritative); BudgetExhausted is reported only when the final is *not* green.

Defaults ported from av-marketplace: **MAXI = 3 · MAXD = 50 · TB = 1800 s**, all overridable. **Counting (single source of truth):** `iteration` starts at 0; `qa_loop_step(enter)` increments it first, then admits the body **iff `iteration ≤ MAXI`** (post-increment). So MAXI=3 ⇒ exactly **3 fix-iterations**; the loop stops when an increment makes `iteration > MAXI`. This one predicate is used at both the pipeline header and the termination table — there is no second reading.

### Cross-turn / resume
The `approve`/`step` gate pauses for the user, so the loop spans turns. All state lives in the tool-owned sidecar, so on the user's `approve`/`resume` Perun calls `qa_loop_step` and the tool resumes — the same cross-turn pattern the harness already uses for NEED_INFO and plan-proposal resume.

A fix-set is dispatched sequentially *within* Perun's turn, and the gate pauses (`2b`/`2f`) fall **between** dispatches — so a normal cross-turn resume has no Svarog in flight. The sidecar's **in-iteration cursor** — `pending` (queued), `in_flight` (the one issue marked *just before* dispatch, awaiting its `record_fix`), `attempted_so_far` (`record_fix` done) — drives re-entry. `record_fix` (post-dispatch) is the single writer of `childSessionId` + result + `dispatch_count_total++` (exactly once per dispatch, **READY/FAIL/ESCALATE alike**), so on a normal resume the persisted `budgets.dispatch_count_total` is authoritative and an already-attempted issue is never re-dispatched.

The only orphan is an **abnormal** death *during* a `2c` dispatch (Esc/crash mid-Svarog): the cursor shows `in_flight` but `record_fix` never ran, so `childSessionId` was never captured (it is a post-turn quantity, §6) and the tool **cannot** address the orphan ref by id. It does **not** guess or re-dispatch — it surfaces a **manual-reconcile** warning (recommend `qa_loop_undo` → restore `refs/qa-loop/pre/<run>`, the whole-loop undo). `dispatch_count_total` is not incremented for the never-recorded issue; the resulting under-count by one is moot because the run is now in manual-reconcile, not auto-continue.

**`step(enter)` is idempotent; a `phase` marker disambiguates the pause points.** Each iteration row carries `phase` ∈ {`selecting`, `awaiting_fix_gate`, `fixing`, `awaiting_retest_gate`, `retested`, `evaluated`}, advanced by the gates, `record_fix`, and `qa_loop_ingest(retest)`. On any gate-resume, `qa_loop_step(enter)` first inspects the current `iterations[n]`: if the row exists with `stop_cause=null` and `phase` not yet `evaluated`, it **resumes that iteration from its `phase` without a second `iteration++`** (so MAXI is never miscounted), returning the in-progress fix-set. This also resolves step-mode's two gates: after the second (pre-re-test) gate the cursor reads `phase=awaiting_retest_gate`, distinct from the post-re-test `phase=retested` — so Perun never re-runs an already-done 2e re-test (which under `--allow-mutations` would be a wasted second mutating pass) nor evaluates a stale `current`.

**Sidecar-present is the resume boundary.** Because the sidecar is gitignored transient state (§5), all of the above holds only when it is present (the same working tree). If it is **absent** — a fresh clone or clean checkout — `qa_loop_start` falls back to **ADOPT** (re-import QA-IDs from the report, fresh budget), the in-iteration cursor is gone, and any leftover `refs/svarog/ckpt/*` / `refs/qa-loop/pre/*` become the user's **manual-undo** responsibility. Cross-process resume is therefore scoped to same-working-tree; this is stated, not assumed.

---

## 5. State: sidecar schema + report format

The sidecar lives next to the report: `docs/testing/reports/<date>-<topic>-loop-state.json` (gitignored — transient machine state; the `<date>-<topic>` stem matches the report so REUSE/ADOPT can pair them). The tool keeps it in two layers: an in-process map (same shape as today's in-process `QaRunState`, `src/modules/qa/qa-run-state.ts`) for speed, **plus** a disk-JSON layer for durability + cross-session resume that `QaRunState` does **not** provide — it is in-process only, no disk. Atomic write-on-update and load-on-`qa_loop_start` are new code this module must add (no existing module persists run state to disk).

```jsonc
{
  "version": 1,
  "run_id": "qa-loop-<topic>-<n>",               // the "<run>" in refs/qa-loop/pre/<run> is this value
  "plan_path":  "docs/testing/plans/<date>-<topic>-test-plan.md",
  "plan_sha256":"e8094f…",                       // idempotency + mid-run tamper guard
  "report_path":"docs/testing/reports/<date>-<topic>-report.md",
  "config":  { "mode":"approve", "severity_floor":"LOW",
               "max_iterations":3, "max_dispatches":50, "time_budget_s":1800 },
  "started_at": <epoch>, "updated_at": <epoch>, "finalized_at": null,  // Date.now(); finalized_at = realized end (incl. uninterruptible final pass)
  "budgets": { "iteration":0, "dispatch_count_total":0, "elapsed_s":0, "final_pass_elapsed_s":null },  // dispatch_count_total = AUTHORITATIVE MAXD gate; final_pass_elapsed_s = final-pass component of TB overage (in-loop straddle unrecorded, §9)
  "pre_loop":{ "undo_ref":"refs/qa-loop/pre/<run>", "dirty":false, "dirty_files":[] },

  "scenarios": {                                  // baseline = immutable, current = mutable
    "FE-01": { "qa_ids":["QA-001"], "kind":"feature", "section":"FE",
               "baseline":"fail", "current":"fail", "reason":null },
    "BE-02": { "qa_ids":[], "kind":"sanity", "section":"BE",
               "baseline":"pass", "current":"pass", "reason":null }
  },
  "issues": {                                     // canonical issue records — report is a render of these
    "QA-001": { "severity":"HIGH", "scenario":"FE-01", "location":"file:line",
                "title":"…", "problem":"…", "remediation":"…",
                "status":"open|fix-attempted|fix-failed|deferred|fixed", "fixed_at":null,
                "fix": { "svarog_status":"READY|FAIL|ESCALATE", "escalate_reason":null,
                         "child_session_id":"ses_…",                 // from DispatchResult.sessionId, written post-turn by record_fix
                         "checkpoint_ref":"refs/svarog/ckpt/ses_…",
                         "changed":["…"], "hardcode_warnings":[] } }
  },
  "iterations": [
    { "n":1, "phase":"fixing",   // selecting|awaiting_fix_gate|fixing|awaiting_retest_gate|retested|evaluated — disambiguates resume
      "pending":[], "in_flight":null, "attempted_so_far":["QA-001"],  // in-iteration cursor: in_flight set pre-dispatch, cleared by record_fix
      "now_passing":[], "still_failing":["FE-01"], "stop_cause":null,
      "regressions":[], "warnings":[], "dispatches_this_iter":4, "elapsed_s":120 }  // per-row snapshot, NOT the MAXD gate
  ],
  "coverage": { "exercised":{"feature":3,"sanity":2,"enforcement":1},
                "not_verified":{"auth-unverified":1,"mutation-guard":0,"tool-unavailable":0},
                "routing_warnings":[] },   // unrecognized SKIP reasons that fell back to tool-unavailable
  "result": null                                  // Pass | Fail | BudgetExhausted | Stopped | NotVerified
}
```

### Scenario-kind & coverage taxonomy
`qa_loop_start` classifies each scenario into exactly one **kind** (at plan-parse, so the mutation guard can strip mutating scenarios pre-dispatch, §7); `qa_loop_ingest` then rolls results into fixed **coverage buckets**. These terms are sourced from av-marketplace's `loop-engineering` doctrine — so porting that doctrine as a Pantheon reference is a **hard dependency**, not optional (see §8). Exact values:

- **`scenario.kind`** ∈ { `feature`, `sanity`, `negative` } — *feature* exercises new behavior; *sanity* is baseline/smoke; *negative* asserts something should be rejected/blocked.
- **`coverage.exercised`** buckets (scenario actually ran): `feature` · `sanity` · `enforcement`. Kind→bucket map: `feature`→`feature`, `sanity`→`sanity`, **`negative`→`enforcement`** (a passing negative means the rejection was *enforced*).
- **`coverage.not_verified`** buckets (scenario did not truly run): `auth-unverified` (a feature gated behind auth that was not satisfied) · `mutation-guard` (a mutating scenario skipped under the mutation guard, §7) · `tool-unavailable` (e.g. Playwright/`psql` absent). **Routing:** `qa_loop_ingest` assigns the bucket from Zmora's SKIP / `NEED_INFO` reason — auth-gated feature → `auth-unverified`, mutation-guard skip → `mutation-guard`, missing tool → `tool-unavailable`; an unrecognized reason falls back to `tool-unavailable` and is appended to `coverage.routing_warnings[]` (schema below) for audit. An *unrun* `negative` scenario has no dedicated bucket — it routes by its skip reason into the three above, exactly like any other kind (only a *passing* negative becomes `enforcement`).

### Idempotency — `qa_loop_start` decides REUSE / ADOPT / FRESH
| Disposition | Condition | Action |
|---|---|---|
| **REUSE** | sidecar exists ∧ `plan_sha256` matches ∧ report exists | carry the prior scenario→QA-ID map; **resume** mid-loop (cross-turn always; cross-session only while the gitignored sidecar persists — §4 "Sidecar-present is the resume boundary") |
| **ADOPT** | report exists, but no sidecar *or* hash differs between runs | import QA-IDs from report headings (new = `max+1`); fresh sidecar; warn the plan changed |
| **FRESH** | neither exists | `qa_count = 0`; new sidecar |
| **TAMPER** | hash changes *mid-run* (Phase 2 pre-check, step 2.0 re-hash) | stop; flush partial report |

**QA-ID minting reuses the existing tool.** `qa_loop_ingest` mints IDs via the existing `assign_issue_ids({ findings, prefix: "QA" })` coordinator tool (`src/agents/perun.md:287`; tool defined at `src/modules/coordinator/index.ts:243`, registered into Perun's tool map at :513) — the loop adds **no** second minter. The returned `QA-NNN` findings land in the sidecar `issues` map; ADOPT passes `startAt: max(existing report IDs) + 1` (`assign_issue_ids` exposes `startAt`, `coordinator/index.ts:265-268`) so re-runs stay deterministic. (This is the one place the loop still leans on Perun's existing issue-ID path rather than re-implementing it.)

### Report format
Extends today's `docs/testing/reports/<date>-<topic>-report.md`, all written by the tool:
- existing: header `**Status:**` · Summary table · Issues Found (per QA-ID) · All Scenarios table
- **+ `## Loop History`** — one row/iteration: `Iteration │ Failing in │ Now passing │ Still failing │ Warnings │ Regressions │ Dispatches`
- **+ `## Coverage`** — exercised vs not-verified · confidence (high/low + reason) · unlock-hints (e.g. `auth-unverified → exercise via integration`)
- **+ recovery line** — how to invoke `qa_loop_undo` (restores `refs/qa-loop/pre/<run>`)

### Status write-back discipline (oracle-separation invariant, enforced in code)
Only `qa_loop_finalize` — the **final authoritative run (Phase 3)** — ever writes `✅ Fixed (date)`. Iterations append Loop-History rows but **never** a Status marker. A fix is not "Fixed" until an independent fresh re-run confirms it. The marker set is small because one deterministic writer owns it. **`issues[].status` → report marker:** `fixed`→`✅ Fixed (date)` · `deferred`→`⏸ Deferred — <reason>` · {`open`, `fix-attempted`, `fix-failed`}→*unmarked* (still-failing). **`qa_loop_finalize` is the sole writer that transitions `fix-attempted`→`fixed`**, and only when the **final** ingest shows that issue's scenario PASS — the oracle-separation invariant, enforced in code.

---

## 6. Svarog integration + recovery model

### Dispatch shape (per issue, sequential)
```jsonc
dispatch_parallel({
  agent: "svarog",
  summary: "fix QA-001 <short title ≤40 chars>",
  tasks: [{ name: "svarog", prompt:
    "Fix this QA finding. Anchor on its Location.\n<issue block: ID, severity, location, problem, remediation, scenario>\n\n" +
    "Constraints:\n" +
    "• Source-only: fix the code under test. Do NOT touch the QA plan or QA scenario files — they are the oracle.\n" +
    "• You MAY add/adjust unit/integration tests as part of your test-first fix (hardens the fix; NOT the QA oracle).\n" +
    "• Never commit. Your checkpoint + the loop handle recovery." }]
})
```

**The test-first inversion (Svarog ≠ fix-auto).** av-marketplace tells fix-auto *"don't modify tests"* because fix-auto isn't test-first. Svarog **is** test-first, so we *invert* that: Svarog may write a regression test, but the **QA plan/scenarios stay sacred**. Oracle separation holds because the verdict comes from Zmora's independent re-run, never from Svarog's unit suite — Svarog's test is bonus hardening, Zmora's pass is the truth.

### Result → loop behavior
| Svarog returns | Loop does | Marker |
|---|---|---|
| `READY` | changes kept; `status = fix-attempted` (**not** Fixed — Zmora decides) | — |
| `FAIL` | tool **auto-restores this issue's checkpoint**; `status = fix-failed`; next issue | unmarked |
| `ESCALATE` | edit aborted/none; `status = deferred`; next issue (all-deferred ⇒ stop) | `⏸ Deferred` |

### Deterministic checkpoint resolution (closes last session's blocker)
`createCheckpoint` writes exactly one ref per Svarog *session* at `refs/svarog/ckpt/<session>` (`src/modules/svarog/checkpoint.ts:48-49`), **lazily** — on the child's *first mutating tool*, once per session (`src/modules/svarog/tool-budget-hook.ts:103-119`). Last session's blocker was that `DispatchResult` (`src/modules/coordinator/dispatch.ts:24`) carries **no** session id, so the ref couldn't be addressed — which earlier drafts tried to work around with "newest ref" / set-difference. Both are unsound: refs are cumulative and never deleted (stale prior-run refs + concurrent Workflow-3 `svarog` builds, `src/agents/perun.md:575`), and the lazy creation means a foreign Svarog that hasn't edited *yet* is invisible to a pre-snapshot and then surfaces mid-window.

The correct fix is to **address the ref by id**, not discover it. `startTask` exposes an `onSessionCreated(sessionId)` callback that fires with the child id *before* the turn runs (signature `src/modules/coordinator/dispatch.ts:44-48`; captured in `runTask` at `:602-617`). v1 threads that id out of the Svarog dispatch into `DispatchResult.sessionId` (a small additive coordinator change, §8); the tool then resolves the checkpoint **directly**:

```
per issue (sequential):
   mark iterations[n].in_flight = { qa_id }               # pre-dispatch: QA-ID only, NO session id yet
   dispatch Svarog (1 issue) → DispatchResult (sessionId populated post-turn)
   record_fix (post-turn — the SOLE writer of the id):
       childSessionId ← DispatchResult.sessionId          # the only point the tool can observe it
       ref ← refs/svarog/ckpt/<childSessionId>
       if ref exists:  issue.fix.child_session_id ← childSessionId ; issue.checkpoint_ref ← ref
       else:           no mutating tool fired → no checkpoint (ESCALATE / FAIL-before-edit / no-op READY)
       dispatch_count_total++ ; clear in_flight
```

(`record_fix` receives `child_session_id`, `svarog_status`, `changed[]`, and `reason` as **explicit input arguments** that Perun threads from the `dispatch_parallel` result JSON — the qa-loop tool runs in-process and does not read `DispatchResult` itself.)

This reads **only this child's** ref, so it is immune to *foreign* refs — no "newest", no set-difference, no `|new|` hard-stop, no timestamp dependence. Lazy creation is handled by an existence check on that one ref. `childSessionId` is captured by `record_fix` **post-turn** (from `DispatchResult.sessionId`) and stored on the issue, binding the checkpoint for any later FAIL-restore. The cross-turn resume model — a clean gate-resume vs the mid-dispatch **manual-reconcile** case (the only point where an id was never captured) — is specified in §4.

**Two integrity guards** (by-id immunity covers foreign refs, *not* a stale **same-id** ref), placed at the only points that can actually observe each case:
- **Existence (tool-side, post-turn)** — a `READY` reported `changed[]` but its ref does **not** exist ⇒ `checkpoint-integrity` stop (§4): abort without auto-restore, surface. This is *all* the tool can check, because it learns `childSessionId` only **post-turn** via `DispatchResult.sessionId` — `onSessionCreated` is private to `runTask` (`dispatch.ts:602-617`) and the dispatch returns only after `pollUntilIdle`. A **no-op `READY`** (empty `changed[]`, no ref) is *not* an integrity failure — only a `READY` that *reports* `changed[]` but whose ref is missing aborts.
- **Freshness (in `createCheckpoint` itself)** — the stale-same-id overwrite (a host-restart-resumed session re-firing `createCheckpoint` *after* its partial edits — the in-process `checkpointed` Set cleared and `update-ref` is *unconditional*, `checkpoint.ts:48-49`) must be closed at the only code point that runs **before** the edit. Fix: make `createCheckpoint`'s `update-ref` **create-only** — refuse to overwrite an existing `refs/svarog/ckpt/<session>` — so a resumed session cannot clobber its original pre-edit checkpoint. When the resumed session re-fires the hook, the create-only `update-ref` throws and the throw is swallowed (`tool-budget-hook.ts:116-118`), leaving the **original pre-edit ref** intact — so a later FAIL-restore reverts the *whole* resumed session (both edit batches) to true pre-edit, the cumulative-safe outcome. A small change to Svarog's checkpoint path (§8), correct for all Svarog users, not just the loop. The tool's post-turn Existence check is the residual backstop. (For the loop's *auto* path this is belt-and-suspenders — a host-restart mid-Svarog is the abnormal-death / manual-reconcile case of §4, not an auto FAIL-restore — so the create-only guard is genuinely load-bearing mainly for Svarog's *standalone* manual-restore path.)

### FAIL auto-restore is cumulative-safe
On `FAIL` the tool calls the **existing** `restoreCheckpoint(cwd, ckptRef)` (`src/modules/svarog/checkpoint.ts:63-79`) — no new restore logic. That function is already cumulative-safe: the checkpoint is `git add -A` + `write-tree` taken *before* issue-N's edit, so it contains every prior `READY` fix; `restoreCheckpoint` resets the tree to it (`read-tree` + `checkout-index -a -f`) and deletes issue-N's *created* files by **tree-diff** — `orphans = (ls-files ∪ ls-files --others) − ls-tree <ckpt>` (lines 73-77). This reverts **only** issue-N's edits and preserves issues 1…N-1 (a file a prior `READY` created and issue-N then *modified* is in issue-N's checkpoint tree, so restore reverts it to the prior-fix content; one a prior `READY` created and issue-N *deleted* is recreated by `checkout-index -a -f` from the checkpoint tree — a file issue-N itself *created* is the only deletion case), and it does **not** trust Svarog's self-reported `changed[]` (a forgotten entry would otherwise leak a file into the next iteration). `changed[]` is kept only for the sidecar post-mortem record and the anti-hardcoding diff. **Honest limit** (`checkpoint.ts:58-62,71`): `restoreCheckpoint` lists untracked files with `ls-files --others --exclude-standard`, so *any* gitignored path is outside checkpoint scope — a FAIL-restore neither removes a gitignored file issue-N **created** nor reverts a gitignored file issue-N **modified**; gitignored side effects of a failed fix persist (the same limit `qa_loop_undo` inherits).

### Recovery: two granularities
| Ref | Captured | Use |
|---|---|---|
| `refs/svarog/ckpt/<childSessionId>` (per issue) | before the first edit of each Svarog (per-issue) session | **automatic** FAIL-restore inside the loop |
| `refs/qa-loop/pre/<run>` (once) | tool-captured before the first fix | **total undo** — `qa_loop_undo` reverts everything the loop did |

The pre-loop ref captures the tree *including* any pre-existing dirty work, so restoring it returns the user to exactly where they started. Because `git reset`/restore is denied to the coordinator, the undo is a **tool action** (`qa_loop_undo`) Perun invokes on request. `refs/qa-loop/pre/<run>` is also a plain git ref the user can restore from their own shell as a fallback. The Phase-0 dirty-tree check is a heads-up that uncommitted work is in the mix.

### Anti-hardcoding
After each `READY` fix, the tool runs `git diff` on `changed[]` (against that issue's checkpoint) and flags added literals that exactly match a BE scenario's request-payload value — the av-marketplace heuristic for "fix hardcoded the test's expected value." Non-blocking; recorded as `hardcode_warnings`, surfaced in Loop History / summary for human review. The scan is **best-effort over self-reported `changed[]`** — unlike the restore, which deliberately ignores `changed[]`; for completeness it could diff the whole checkpoint→current tree instead (a forgotten `changed[]` entry yields an incomplete scan, never an incorrect restore). One more best-effort caveat: 2d runs once after the fix-set and diffs each issue against *its own* pre-edit checkpoint, so if issue K+1 touched the same file as issue K, K's warning set may conflate their edits — a mis-attributed warning, never a restore error.

**Namespace hygiene.** Nothing GCs `refs/svarog/ckpt/*` — the in-process marker clears on `session.deleted` but the git ref persists — and the loop is now the dominant producer. Per **D7**, v1 does **not** prune them: by-id resolution is immune to accumulation, so stale refs are harmless. (Pruning the run's own refs at `qa_loop_finalize` is a documented later-version option, not v1.)

---

## 7. Gating/modes + read-only audit path

| Mode | Gates | For |
|---|---|---|
| **approve** *(default)* | once per iteration, **before** that iteration's fixes — the whole fix-set in one prompt (not per-issue) | normal interactive use |
| **auto** | never — prints a one-time scope banner, runs to completion | headless: eval / cron / non-interactive |
| **step** | before each fix-set **and** again before each re-test | maximum oversight |

The gate is Perun's `question` tool (already in its allowlist), so it is a first-class cross-turn pause:

```jsonc
question({
  header:   "QA loop — iteration 1/3",
  question: "3 scenarios failing · 3 Svarog fixes queued · 1 skipped (no location) · 4/50 dispatches used. Proceed?",
  options: [
    "Approve all — dispatch the fixes, then re-test",
    "Skip to final — no fixes; run the authoritative final pass + report",
    "Abort — stop now, write the partial report"
  ]
})
```

**`step` mode's second gate** (before each re-test) uses options **Re-test now / Skip re-test → final / Abort**. The fix-set gate above is shared by `approve` and `step`.

**auto / headless.** Mode is an explicit input (command flag, or natural language — "run QA autonomously" → auto), defaulting to `approve`; eval/cron pass `auto` explicitly, so no TTY-sniffing is needed. **Fail-safe:** if a gate is reached where `question` can't be answered (a non-interactive context that didn't set auto), the loop treats it as **Abort** and writes the partial report rather than hanging. In auto mode Perun emits a one-time scope banner first (`will run ≤3 iterations / ≤50 dispatches, edits source under test, leaves changes uncommitted`).

**Zero-failure → no gate.** If the baseline is all-green there are no fixes to approve — Phase 1 goes straight to the report.

**Read-only audit path.** Per D3, "report, don't fix" is not a first-class mode, but it stays reachable: **Abort at the first gate** yields exactly a baseline-only report (Phase 1 + finalize, zero fixes). A first-class `--no-fix` flag is a one-line add if ever wanted, but is a non-goal for v1.

**Mutation guard.** Zmora is **not** an allowlist-enforced read-only agent — its allowlist includes `Write` and mutating DB clients (`psql`/`mysql`/`mongosh`/`redis-cli`, `src/modules/qa/allowed-tools.ts`). That matters more here than in one-pass QA because the loop **re-runs** scenarios (baseline + per-iteration re-test + final), so a mutating scenario's side effects compound across runs. So the loop ports av-marketplace's **mutation guard**, applied **pre-dispatch** (not at ingest — ingest runs on results, too late to prevent the mutation): `qa_loop_start` classifies every scenario and, by default, **strips** the mutating ones (HTTP `POST`/`PUT`/`PATCH`/`DELETE`, or a write / DB-write step) from the dispatch set Perun hands to Zmora — so the mutating call never executes — recording each as a `mutation-guard` SKIP in the sidecar/coverage. **Expected-outcome rule:** the strip keys on *expected outcome*, not the verb alone — a `negative`-kind scenario whose assertion is that the mutation is **blocked** (expected non-2xx, no state change) is **not** stripped (the write never lands, and stripping it would gut the enforcement-coverage surface §5 defines); only a mutating scenario expected to **succeed** is stripped. **`--allow-mutations`** keeps them in the dispatch set (and the choice is surfaced in the auto-mode scope banner). This is **tool-side**, so Zmora needs no prompt change (it stays reused verbatim, §3/§8); it is a scenario-level heuristic, not an allowlist boundary — tightening Zmora's allowlist itself is a separate change (§9 non-goals). *(This also moves scenario-kind classification to `qa_loop_start` at plan-parse time; `qa_loop_ingest` records results + coverage against that classification.)*

---

## 8. Blast radius / repo footprint

### New — the `qa-loop` module (`src/modules/qa-loop/`)
The 6 tool actions, sidecar persistence, privileged git ops, report renderer, classifier + coverage (see §3). **Registration:** the tools live in the module's **own plugin tool map** (the `qa/index.ts` pattern, not the coordinator map); their names are then added to `src/agents/perun.md` `allowed-tools` frontmatter, the `PERUN_TOOLS` constant, and `tests/modules/coordinator/perun-tools-sync.test.ts` — the link is manual (`coordinator/index.ts:507-510`). **Perun-only enforcement:** each tool's `execute()` must guard on `isCoordinatorCaller(sessionID)` (`src/modules/qa/caller-gate.ts`, mirroring `preflight`/`parse_plan`) — the per-agent tool map is *declarative-only* on opencode 1.15.10, so this execute-level gate is the real boundary for these privileged git tools.

### Changed — Perun (`src/agents/perun.md`)
- **Workflows 1 + 2 collapse into one "QA Loop" workflow.** Reused verbatim inside it: Veles plan (Step 1), sanitize (Step 3), preflight (3.5), Stribog bring-up (3.55), parse bindings (3.6), fixture mutation (3.8), wave dispatch (Step 5), NEED_INFO backstop (Step 6), resume semantics. New around them: `qa_loop_*` calls + the gate + the iterate/final phases.
- **Workflow 0 routing** (the "test it" classification and worked example) re-points to the loop.
- **Fixer swap:** the Workflow-2 `fix-auto` dispatch → Svarog; the fix proposal text and Composability/Safety rules re-worded for Svarog + the loop.
- **Perun stops authoring the report** — the tool owns every write, so the hand-`Edit` of `✅ Fixed` lines and the "Edit only for Status lines" rule go away. Perun's QA job shrinks to dispatch + tool calls + `question` + surfacing.
- **Workflow 3** (feature build via Svarog) unchanged. `dist/agents/perun.md` regenerates from build.

### Changed — command surface
- `src/commands/run-qa.md` — `/qa:run` *becomes* the loop (one entry point), gaining `--mode` / `--max-iterations` / `--max-dispatches` / `--time-budget` / `--severity-floor` / `--allow-mutations` (severity default `LOW`; flags also settable in natural language). No separate `/qa:loop`.

### Changed — coordinator + Svarog checkpoint
- `src/modules/coordinator/dispatch.ts` — add `sessionId` to `DispatchResult` (line 24), populated from the `onSessionCreated` capture in `runTask` (currently kept in a private `let sessionId`, lines 595 / 602-617); thread it through the result serialization in `src/modules/coordinator/index.ts` (the `dispatch_parallel` return at :239), and update the model-facing dispatch-result-shape description (`coordinator/index.ts:148`) plus the dispatch result-shape test to include `sessionId`. Lets `qa_loop_record_fix` address `refs/svarog/ckpt/<childSessionId>` directly (§6). Existing callers ignore the new field.
- `src/modules/svarog/checkpoint.ts` — make `createCheckpoint`'s `update-ref` **create-only** (refuse to overwrite an existing same-session ref), so a host-restart-resumed session cannot clobber its pre-edit checkpoint (§6 freshness). This is the part the tool *cannot* enforce post-turn — so the coordinator/Svarog change is larger than a bare `DispatchResult.sessionId` field.
- `.gitignore` — add `docs/testing/reports/*-loop-state.json` (the transient sidecar must not be committed; no entry exists today).

### De-register fix-auto (Pantheon-side only; excludes `packages/code-review/*`)
*(The exact set — `grep -rl fix-auto src/ tests/ docs/ | grep -v 2026-06-25-qa-engineering-loop` → **18 real paths** incl. the src mirror `src/modules/agent-registry/fix-auto.metadata.ts` (the raw grep returns 19, self-including this spec file, which is not a de-reg target) — is enumerated as a checklist in the implementation plan; the groupings below are that grep's inventory, not a hand-counted list.)*
- **Delete:** `src/modules/agent-registry/fix-auto.metadata.ts` (the src-side mirror) + `tests/modules/agent-registry/fix-auto-cross-boundary-sync.test.ts`.
- **Update:** `src/modules/coordinator/index.ts` (registration), `src/modules/plan/veles.metadata.ts`, the agent-registry tests (`metadata-coverage`, `registry-freeze-e2e`, `perun-prompt-integration`, `perun-prompt-builder`, `agent-registry`), the `dispatch*` coordinator tests, the `perun-prompt-before.md` fixture, and docs (`pantheon.md`, `coordinator.md`, the triglav eval scenario).
- **Keep:** `docs/plugins/code-review.md` and `packages/code-review/*` — fix-auto stays a real, dispatchable **code-review** agent; we only stop Pantheon from advertising/dispatching it.

### New — tests, docs, eval
- **Module tests:** one per tool + a full-loop integration test (fake Zmora/Svarog) + idempotency (REUSE/ADOPT/FRESH/tamper) + recovery (FAIL auto-restore cumulative-safety, pre-loop undo).
- **Docs:** loop workflow in `coordinator.md`/`pantheon.md`; **port** av-marketplace's `loop-engineering` doctrine as a Pantheon reference — a hard dependency, since §5's scenario-kind/coverage taxonomy is sourced from it.
- **Eval:** new Perun scenarios (converges · regression-guard stops · budget-exhaustion still finalizes · FAIL auto-restore · checkpoint-integrity abort · stop-cause precedence · all-feature-mutation-guarded → NotVerified) under `docs/eval/scenarios/perun/`.

---

## 9. Risks, non-goals, acceptance

### Risks & mitigations
| Risk | Mitigation |
|---|---|
| **Cost/runtime** — Svarog is heavy (full-suite gate, pinned gpt-5.5); N issues × ≤3 iterations × (fix + re-test) can run long | hard budgets MAXD=50 ∧ TB=1800s cap it; lower MAXI; sequential is slow but bounded |
| **Sequential-dispatch is load-bearing** — FAIL auto-restore's cumulative-safety (issue-N's checkpoint contains issues 1…N-1) requires fixes to apply one at a time | encode it as an invariant + test; "parallel fixes" is an explicit non-goal |
| **Checkpoint resolution depends on coordinator + Svarog changes** — surfacing `DispatchResult.sessionId` **and** a create-only `createCheckpoint` (§8) | both small, covered by dispatch + checkpoint tests; the tool-side Existence stop (§4) backstops a missing ref, the create-only `update-ref` closes the stale-same-id overwrite; foreign refs are irrelevant (we address only our child's ref by id) |
| **Zmora is not allowlist-read-only** — its allowlist includes `Write` + DB clients, and the loop re-runs scenarios so a mutating scenario compounds | the default-on mutation guard (§7) skips mutating scenarios; `--allow-mutations` is opt-in; tightening the allowlist itself is a separate change |
| **Time-budget bounds loop *entry* only** — TB is checked at iteration boundaries; the in-flight Svarog fix and the always-runs final pass are uninterruptible, so wall-clock can exceed TB | realized overage = `final_pass_elapsed_s` (the final-pass component, **recorded**) **plus** an **unrecorded** in-loop straddling-fix component of ≤ one Svarog wall-clock timeout (≤5 min default — Svarog has no `AGENT_TIMEOUT_OVERRIDES` entry, `dispatch.ts` overrides only Veles); the straddle bound is documented so operators size TB accordingly; the final run always runs regardless |
| **FAIL auto-restore discards a partial attempt** | accepted (FAIL = broken build); the attempt's `changed[]`+`reason` stay in the sidecar |
| **Flaky scenario → false regression/no-progress stop** | guard is conservative-by-design (stop > oscillate); flakiness is a plan-quality issue; retry-on-flaky is a non-goal |
| **Undo is tool-only** (coordinator can't `git reset`) | `refs/qa-loop/pre/<run>` is a plain git ref the user can also restore from their own shell |
| **Large perun.md rewrite** (collapsing Workflows 1+2) could regress preflight/bindings/NEED_INFO/waves | reuse the existing step text *verbatim* inside the loop; existing QA tests + new eval scenarios guard it |

### Non-goals (v1)
Parallel fixes · fix-auto as a selectable fixer (seam exists, unwired) · flakiness detection/retry · a first-class `--no-fix` mode (use gate-Abort) · multi-plan runs · auto-commit (Perun never commits) · hardening Zmora's tool-allowlist to be truly read-only (the mutation *guard* is in-scope; tightening the *allowlist* is a separate change) · pruning created `refs/svarog/ckpt/*` (D7 — deferred) · generalizing the loop to non-QA domains.

### Acceptance criteria
1. `/qa:run` triggers the loop; baseline all-green → report, no loop, no gate.
2. Failures → approve-gate → sequential Svarog fixes → Zmora re-test; `✅ Fixed` written **only** after the final run confirms.
3. Regression guard: passed-baseline-then-fails stops the loop → final run → regression logged as a new QA-ID.
4. Budgets enforced; max-iterations reached → loop stops **but final run still executes**.
5. Svarog `FAIL` → that issue's checkpoint auto-restored (only `READY` fixes carried forward); loop continues.
6. Svarog `ESCALATE` → issue `⏸ Deferred`, batch continues; all-deferred → stop.
7. Idempotency: same plan → REUSE/resume; changed plan → ADOPT; mid-run hash change → tamper-stop.
8. `qa_loop_undo` restores `refs/qa-loop/pre/<run>` → tree returns to pre-loop state.
9. Anti-hardcoding warning surfaces (non-blocking) on a BE-payload-literal fix.
10. `auto` runs headless to completion (banner, no gate); `approve`/`step` gate via `question`.
11. fix-auto no longer dispatchable/advertised by Perun; code-review's fix-auto unaffected; de-reg suite green.
12. A normal gate-resume re-dispatches no already-attempted issue and double-counts no budget; a mid-dispatch death (cursor `in_flight`, no `record_fix`) is surfaced for manual-reconcile (recommend `qa_loop_undo`), never silently re-dispatched or dropped.
13. The NotVerified predicate — *no scenario in a pass state after the authoritative run, regardless of sub-floor fails* — is evaluated identically at the baseline zero-failure exit and the final; a run where nothing truly passes finalizes **NotVerified**, never Pass. (This is the no-pass-state branch; the all-feature-`not_verified` branch is AC16.)
14. Checkpoint-integrity: a `READY` whose `refs/svarog/ckpt/<childSessionId>` is **missing** triggers a tool-side checkpoint-integrity stop (abort, no auto-restore, surfaced); and `createCheckpoint`'s **create-only** `update-ref` makes a stale-same-id overwrite impossible, so a FAIL-restore can never revert to a non-pre-edit tree.
15. Stop-cause precedence: when several causes fire (e.g. regression + a budget), Loop-History `stop_cause` records the higher-precedence one (regression); an all-ESCALATE iteration records `all-deferred`, never `no-progress`.
16. Oracle honesty: a plan whose entire feature surface is mutation-guarded (every feature scenario lands in `not_verified`) finalizes **NotVerified**, not Pass.
17. Budget ceiling: `budgets.dispatch_count_total` (the authoritative MAXD gate, distinct from the per-row `dispatches_this_iter`) is incremented only in `record_fix` (once per READY/FAIL/ESCALATE); a normal resume reads the persisted total so MAXD is honored across turns; a mid-dispatch death routes to manual-reconcile rather than resuming the budget.
18. Time-budget exhausted at an iteration boundary stops the loop but the authoritative final pass still runs; `final_pass_elapsed_s` records the **final-pass component** of the overage (the in-loop straddling-fix component, ≤ one Svarog timeout, is documented in §9 but not separately recorded).
19. A `negative`-kind scenario asserting a mutation is blocked is exercised (not mutation-guard-stripped); only mutating scenarios expected to succeed are stripped.
20. A mutating scenario expected to **succeed** is stripped pre-dispatch (never sent to Zmora; the mutating call never executes) and recorded as `mutation-guard` in `coverage.not_verified`; `--allow-mutations` keeps it in the dispatch set.
21. Full suite + build green; new module tests + eval scenarios pass.

Two invariants the whole design protects: **oracle separation** (only an independent Zmora re-run writes `Fixed`) and the **coordinator security model** (Perun never shells — the tools do).

---

## Appendix A — av-marketplace → Pantheon mapping

| av-marketplace | Pantheon (this design) |
|---|---|
| `/qa:loop` command (self-orchestrating, shells freely) | Perun unified QA-loop **workflow** + deterministic `qa-loop` **tools** |
| `qa:fe-tester` / `qa:be-tester` (verifiers) | **Zmora** (`zmora-fe` / `zmora-be`) |
| `code-review:fix-auto` (fixer, advisory, dirty-tree) | **Svarog** (test-first, full-suite gate, checkpoint recovery) |
| `--auto-plan` | **Veles** dispatched to author the plan |
| sidecar JSON (`<topic>-loop-state.json`) | same dir, `<date>-<topic>` stem, **tool-owned** (in-process + disk) |
| `fix_touched_files` + `git restore` recovery | per-issue Svarog checkpoints + one `refs/qa-loop/pre/<run>` undo ref |
| anti-hardcoding via command bash | anti-hardcoding via the qa-loop tool's `git diff` on `changed[]` |
| approve / auto / step modes (TTY check) | same modes; gate via Perun `question`; fail-safe Abort (no TTY-sniffing) |
| Status write-back from final run only | identical invariant, enforced in the tool (single writer) |
| `loop-engineering` skill (doctrine) | optionally ported as a Pantheon reference doc |
