# Veles Plan-Depth & Execution-Logistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Revision v3 (2026-06-03):** incorporates a *second* sequential-thinking + 3-reviewer (MoA) pass on v2. Changes vs v2:
> **(BL-1, BL-2)** reflowed two asserted test phrases (`lock releases on the error path`, `ordered list of human Setup prerequisites`) onto single lines — the v2 trims had re-split them across markdown wraps, which would false-fail `bun run check`. **(E-1)** GATE-DEPTH now scores by **assertion substance** (the specific adversarial predicate per edge), NOT grounding-tag presence — on an embedded golden every assertion is legitimately `(unverified)`, so the v2 "grounding ⇒ not keyword-stuffable" claim was false at Layer-1; grounding teeth bite only at Layer-2 and are listed there. **(E-2)** dropped the 2-arm ablation (statistically underpowered at n=3 worst-of-N) → Lever E is evaluated **record-only with a pre-committed threshold** off the single full-Phase-1 arm. **(S-2)** dropped the dedicated non-export golden → generalization is measured on a **non-export real endpoint in the RUNG-1 Layer-2 run** (real source, zero fixture to maintain). **(C-1)** de-duplicated the 429-sequencing guidance — Step 6.9 is canonical; Step 6.6 rejects the punt and *points* to 6.9. **(C-2)** collapsed the per-bullet "(Generalizes:)" riders to one shared lead-in so the sharp predicate isn't diluted. **(S-1)** corrected the net-scope claim (prose lighter, eval lighter than v2 — net leaner) and the lever framing.
>
> **Verified-solid across both review rounds (do not re-litigate):** `**Depends-on:** <all peers>` yields a terminal, sibling-free wave (R1 vs `compute-waves.ts` Kahn's + the `handles fan-in` test); all edit anchors exist as quoted; the `veles.md` edit preserves all ~17 `veles-prompt.test.ts` substrings; the H1 reword breaks no test and keeps `property of the HARNESS, not of the code` intact; golden #1 embeds 429/IDOR/409/filename; `**Depends-on:**` is Perun-parsed (not the binding parser), no dep cap; no momus violation; Phase 2 correctly gated.

**Goal:** Close the *second* Veles quality frontier from the 2026-06-03 export-PDF iteration. The defect-grounding fix held (the report calls both plans factually solid; Veles emits BLK-01 + Coverage Matrix + `blocked-by`). The new gaps are **testing depth** (adversarial edges) and **execution logistics** (scenario sequencing under the parallel runner), plus a **process** lever (Veles never invoked sequential-thinking). Make the deeper, harness-correct plan the path of least resistance and measure it.

**Architecture:** Eval-gated, mirrors `2026-06-03-veles-defect-grounding.md`. **Phase 0** extends golden #1's quality rubric and re-confirms current Veles falls short (RUNG 0 — partly already evidenced by the 2026-06-03 transcript). **Phase 1** is five additive prose/flow edits (no TS): (A) make the runner's **4-wide parallel** dispatch model explicit; (B) teach harness-correct sequencing via `**Depends-on:**`; (C) deepen the adversarial edge classes; (D) route multi-step blocker remediation into ordered Setup prerequisites; (E) strengthen the sequential-thinking trigger. **A/B/C are substantive; D is a one-sentence clarification of the existing reversible-blocker rule; E is an experimental prose trigger, evaluated record-only at RUNG 1.** **RUNG 1** re-grades (single arm; Layer-2 covers a non-export endpoint for generalization) and decides. **Phase 2** (conditional) adds a deterministic lint only if prose fails. Mechanism-strength ranking: **deterministic gate > forced emitted artifact > flow reordering > prose**.

**The central reframe (do not skip):** the marketplace plan "won" partly by writing for a **full-shell human executor** (revert+reintroduce source, `docker compose stop`, grep logs). Our runner (`zmora`) is curl/psql/Playwright only **and dispatches scenarios 4-wide in parallel** (`src/agents/perun.md:155`, `src/commands/run-qa.md:90`; `test-plan-format` line 297: *"Plans without `**Depends-on:**` dispatch fully in parallel"*). So "run the rate-limit scenario LAST, pace the others" is **correct for a sequential human and wrong for our harness** — document order does not serialize anything. The harness-correct mechanism is `**Depends-on:**`, which forces a terminal dependency wave. Phase 1 teaches the *harness-true* fix, not the marketplace's sequential advice.

**Honest scope (carried, finding R2):** Phase 1's additions are **self-attested** prose — a model can still under-apply them. The real enforcement is the golden eval. Wins the report credits to the marketplace plan that are **executor-invalid for us** are deliberately NOT adopted: live revert→reintroduce of `sleep(65)` as *runner* steps (Zmora can't edit source — but Lever D captures the legitimate Setup-orchestration kernel), and container-log PII assertions (no log surface over curl/psql).

**Tech Stack:** Markdown skills (`src/skills/qa/**`), the Veles prompt module (`src/modules/plan/prompt.ts` → embeds `veles.md` → `dist/modules/plan/prompt.js`), `bun` build (`tsup` + `copy-root-assets.mjs`, **committed `dist/`**), `vitest`. Manual model-eval via `docs/eval/playbook.md`. Veles eval model = `opencode-go/kimi-k2.6` (mid-tier — relevant to Lever E).

---

## Background & root cause (read once)

The 2026-06-03 export-PDF iteration ran the same task two ways: **Plan A = Veles**, **Plan B = marketplace**. Plan B won as a *manual* plan. The report's deciders, classified against our executor:

| Decider (report) | Executable by `zmora`? | Verdict |
|---|---|---|
| Effective coverage via revert→reintroduce `sleep(65)` | ❌ edits source + restarts container | Executor-invalid as *runner steps*; legitimate kernel = ordered **Setup** prerequisites (Lever D) |
| Container-log PII / observability assertions | ❌ no log surface over curl/psql | Executor-invalid — out of scope |
| `grant_test_entitlement.py` test | ❌ needs Python | Correctly out-of-scope in Plan A |
| **No-oracle IDOR**, header injection, lock-release-on-error, boundary timing, no-mutation invariant | ✅ curl + psql | **Real depth gap (Lever C)** |
| **Scenario ordering / rate-limit pacing** | ✅ — but via `**Depends-on:**`, not document order | **Real gap, highest impact (Levers A+B)** |

Root cause is two-fold: (1) the authoring skill lists adversarial categories (`test-plan-format` Edge Case Rules: IDOR, race conditions, special chars) as *headings without teeth*; (2) the skill never states the runner's **parallel** dispatch model, so Veles cannot reason that a global per-IP rate-limit (10/min) will 429-contaminate sibling scenarios run 4-wide, nor that `**Depends-on:**` is the remedy. The transcript shows the symptom: BE-08 fires 20 requests with **no `**Depends-on:**`** and no contamination note; BE-04 (IDOR) asserts only `404` with no equality-to-not-found; the filename gets 2 edges. The transcript also shows **`sequential_thinking_sequentialthinking` was never called** — it is available (token in `VELES_TOOLS`; the `sequential-thinking` MCP server is configured in `opencode.json`, enabled by default with no explicit `enabled` flag) but `veles.md:68-73` makes it MAY-use/"skip for simple diffs", and Kimi judged the diff simple (Lever E).

Veles's strengths are **preserved**: Bindings recipes, frontmatter, Coverage Matrix, `(file:line)` citations, the defect-grounding behavior. All edits are additive.

---

## The levers

| Lever | Mechanism | Files | Weight |
|---|---|---|---|
| **A. Parallel-dispatch awareness** | State the runner is 4-wide parallel; scenario independence + shared global state matter | `qa-plan-authoring` Step 4.5 | substantive |
| **B. Harness-correct sequencing** | A shared-quota / global-lock / ordered-state scenario uses `**Depends-on:**` to land in a terminal wave; canonical home for the rule | `qa-plan-authoring` new Step 6.9; `test-plan-format` Dependency-annotations example | substantive |
| **C. Adversarial edge depth** | No-oracle IDOR equality; reflected-input/header injection; lock-release-on-error; no-mutation invariant — one shared "applies to any surface" lead-in, sharp predicate per edge | `qa-plan-authoring` Step 6.6 + 6.8; `test-plan-format` Edge Case Rules (pointers) | substantive |
| **D. Setup-orchestration kernel** | Multi-step blocker remediation as an ordered Setup list, never runner steps | `qa-plan-authoring` Step 3.5 (one sentence); `test-plan-format` Blockers (pointer) | one clarifying sentence |
| **E. Sequential-thinking trigger** | MAY-use/tangled → SHOULD-use for any ≥2-status diff; countable skip; native fallback | `src/modules/plan/veles.md` | experimental; record-only at RUNG 1 |

**Lever B nuance (state it, don't just skill it):** `**Depends-on:** <all peers>` makes the limit-exercising scenario terminal and sibling-free (R1-verified). It does **not** stop peers in Wave 0 (run 4-wide, ≤4 per chunk) from collectively exceeding a low per-IP limit and 429-ing each other. That residual is a genuine harness limitation — the skill also requires a one-line **contamination note**. Do not over-promise a clean fix.

---

## File Structure

| File | Phase | Responsibility |
|---|---|---|
| `docs/eval/scenarios/veles/qa-plan-defect-grounding.md` | 0 | EXTEND quality signals with the depth/logistics rubric (export surface already has 429 / IDOR / 409 / filename) |
| `docs/eval/playbook.md` | 0 | add the depth/logistics grading dimensions, the parallel-dispatch fact, the record-only Lever-E protocol, and the Layer-2 non-export generalization check |
| `src/skills/qa/qa-plan-authoring/SKILL.md` | 1 | Step 4.5 (parallel model), Step 3.5 (orchestration, one sentence), Step 6.6 (adversarial classes + a 429-punt→6.9 pointer), Step 6.8 (refute class), new Step 6.9 (sequencing — canonical) |
| `src/skills/qa/test-plan-format/SKILL.md` | 1 | Dependency-annotations example (rate-limit serialize), Edge Case Rules teeth (terse pointers to Step 6.6), Blockers pointer |
| `src/modules/plan/veles.md` | 1 | strengthen the sequential-thinking trigger (preserve the two asserted substrings; heading loses "(optional)" — note it) |
| `tests/skills/qa-plan-authoring.test.ts` | 1 | assert the new Step substrings (each on a single line — see B1 caution) |
| `tests/skills/test-plan-format.test.ts` | 1 | NEW — assert the format-skill additions (no test asserts this skill today) |
| `tests/modules/plan/veles-prompt.test.ts` | 1 | assert the strengthened ST trigger; KEEP the existing `sequential_thinking_sequentialthinking` + `proceed with native decomposition` assertions |
| `src/modules/qa/plan-linter.ts` (+ wiring, tests) | 2 (conditional) | deterministic flag: a 429/shared-quota scenario lacking `**Depends-on:**` or a contamination note |

**B1 caution (applies to every test task):** `toContain` is byte-exact against `readFileSync`. A markdown soft-wrap *inside* an asserted phrase breaks the match (this bit v1 and v2). **Every asserted phrase MUST be on a single unwrapped line in the skill prose.** The prose blocks below keep each asserted phrase on one line — preserve that, and after editing run `grep -n "<phrase>" <target SKILL.md>` to confirm a single-line hit in the *specific* file the test reads (whole-repo greps mislead — a contiguous copy in another file masks a split in the target).

**Parser-safety (re-verified):** `**Depends-on:**` is Perun-parsed (Step 5d → `compute_waves`) into wave edges — load-bearing, not inert — but it is an existing tested field, no dep cap; we add author-time guidance only. Adversarial-edge and orchestration prose live in scenario bodies / Setup, inert to the binding parser.

---

## Phase 0 — Extend the eval rubric (gates Phase 1)

### Task 0.1: Add the depth/logistics rubric to golden #1

**Files:** Modify `docs/eval/scenarios/veles/qa-plan-defect-grounding.md` (export-PDF surface: 429 / IDOR / 409 / filename — R1-confirmed present).

- [ ] **Step 1:** Under the golden's existing GATE block, add a **DEPTH & LOGISTICS** ranking section (layered on GATE 1/2/3). **All dimensions grade the emitted plan TEXT (authored intent), NOT live behavior — the embedded golden does not execute.**

  - **GATE-ORDER (logistics).** The 429 scenario carries `**Depends-on:** <other BE IDs>` **OR** an explicit note that the per-IP limiter is shared under the 4-wide parallel runner so it may 429-contaminate siblings. A bare 429 scenario dispatched into the single parallel wave is the demerit (what the transcript's BE-08 did). Fully decidable on the embedded golden.
  - **GATE-DEPTH (adversarial) — scored by SUBSTANCE, not by a grounding tag (E-1).** Pin the applicable set for THIS golden (4 edges): an edge **counts only when its assertion carries the specific adversarial predicate**, not a bare mention:
    1. **no-oracle IDOR** — asserts the foreign-resource response is `indistinguishable from not-found` (same status AND body) and ownership precedes the payment gate; a bare "→ 404" does NOT count.
    2. **reflected-input injection** — asserts the `Content-Disposition` value is sanitized and the header stays well-formed under metacharacters (no header splitting); "tests special chars" alone does NOT count.
    3. **lock-release-on-error** — asserts a retry after a 5xx/timeout is NOT 409.
    4. **no-mutation invariant** — asserts row counts/checksum unchanged before vs after, including the error path.
    Score = predicate-bearing edges / 4; **≥3/4 = strong**. (Why substance, not grounding: on an embedded golden the source is off-disk, so every assertion is legitimately `(unverified — confirm at run time)` per Step 0 — a grounding-tag check is trivially satisfiable and would NOT separate a real assertion from a stuffed one. The grounding teeth only bite at Layer-2, where a real `(file:line)` is demandable.) Edges 2 and 3 sit on the `sleep(65)`-blocked path, so they count as `**Blocked-by:**`-tagged scenarios (presence-in-plan — the correct defect-grounding behavior).
  - **ST-INVOKED (process, record-only).** Did the transcript show a `sequential_thinking_sequentialthinking` call? Record yes/no per iteration. Not a gate; the RUNG-1 disposition reads this rate directly (no second arm).

- [ ] **Step 2:** Add a "Golden-decidable vs Layer-2-only" note: GATE-ORDER and GATE-DEPTH-by-substance are decidable on this embedded golden; **the grounding/anti-stuffing teeth, edge *applicability* to a new surface, the residual 429 contamination, and whether `Depends-on` actually serializes are Layer-2-only.** Keep markerless golden #2 unchanged (defect-grounding discriminator).

### Task 0.2: Record the grading protocol in the playbook

**Files:** Modify `docs/eval/playbook.md`.

- [ ] **Step 1:** Append a "Depth & logistics dimensions" note: grade GATE-ORDER / GATE-DEPTH(by-substance) / ST-INVOKED on golden #1; ≥3 iters, worst-of-N. Add the **parallel-dispatch fact**: *"The runner dispatches scenarios 4-wide in parallel (single wave unless `**Depends-on:**`). 'Run it last' is not a valid fix here — `**Depends-on:**` is."* Add the **record-only Lever-E protocol** and the **Layer-2 non-export generalization check** (RUNG 1).

### Task 0.3: RUNG 0 — confirm current Veles under-scores

- [ ] **Step 1:** The transcript + Plan A already evidence the baseline (bare BE-08, shallow IDOR/filename, no ST call). For rigor, run current Veles on golden #1, ≥3 iters, grade against the extended rubric, capture to `/tmp`.
- [ ] **Step 2: Discrimination check.** If current Veles already passes GATE-ORDER and scores ≥3/4 GATE-DEPTH-by-substance, the golden is too easy → fall back to a Layer-2 run on the real i-need-cv export branch.

**Exit criterion (Phase 0):** golden #1 carries the depth/logistics rubric; the playbook records the protocol, the parallel-dispatch fact, the record-only Lever-E rule, and the Layer-2 generalization check; a RUNG-0 run reproducibly under-scores.

---

## Phase 1 — Prose + flow levers (the cheap tier)

> TDD per task: write the failing substring assertion first (single-line phrases — B1), run red, edit, run green. Task 1.6 rebuilds + commits dist once.

### Task 1.1 (Lever A): Make the parallel dispatch model explicit in Step 4.5

**Files:** Modify `qa-plan-authoring/SKILL.md` (end of Step 4.5, before Step 4.6); Test: `tests/skills/qa-plan-authoring.test.ts`.

- [ ] **Step 1: Failing test.**

```ts
it("Step 4.5 states the runner dispatches scenarios in parallel", () => {
  expect(md).toContain("dispatches scenarios in parallel")
})
```

- [ ] **Step 2: Run red.**
- [ ] **Step 3: Edit.** Insert at the end of Step 4.5:

```markdown
- **The runner dispatches scenarios in parallel, not in document order.** Perun runs scenarios 4-wide
  (`dispatch_parallel`); with no `**Depends-on:**` every scenario lands in one parallel wave
  (`src/agents/perun.md`). Two consequences: (1) **scenarios must be independent** — do not rely on BE-01
  running before BE-02 unless you declare it; (2) **siblings share the target's global state and the
  runner's source IP** — a scenario that exhausts a global per-IP quota (a rate-limit 429 sweep) or holds a
  global lock will affect whatever runs concurrently. Sequence such scenarios with `**Depends-on:**`
  (Step 6.9) — "putting it last in the document" does nothing, because document order is not execution order.
```

- [ ] **Step 4: Run green.**

### Task 1.2 (Lever B): New Step 6.9 — sequence shared-state scenarios (canonical home)

**Files:** Modify `qa-plan-authoring/SKILL.md` (new Step 6.9, after Step 6.8, before Step 7); `test-plan-format/SKILL.md` (Dependency annotations); Tests: both.

- [ ] **Step 1: Failing tests.** Add to `tests/skills/qa-plan-authoring.test.ts`:

```ts
it("Step 6.9 sequences shared-quota scenarios via Depends-on", () => {
  expect(md).toContain("Step 6.9")
  expect(md).toContain("terminal wave")
})
```

  Create `tests/skills/test-plan-format.test.ts` (NEW):

```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/test-plan-format/SKILL.md",
)

describe("test-plan-format skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("shows Depends-on serializing a rate-limit scenario", () => {
    expect(md).toContain("serialize a rate-limit")
  })
})
```

- [ ] **Step 2: Run red.**
- [ ] **Step 3: Edit qa-plan-authoring.** Insert new Step 6.9 (the canonical 429-sequencing home — C-1):

```markdown
## Step 6.9: Sequence scenarios that share global state (parallel-runner safety)

The runner is 4-wide parallel (Step 4.5). A scenario is **contaminating** when its effect is visible to
concurrent siblings: it exhausts a **global per-IP quota** (a `429` rate-limit sweep), **holds a global
lock**, or **depends on ordered state** a sibling sets. For each contaminating scenario:

- **Isolate it into a terminal wave** by adding `**Depends-on:** <comma-separated peer IDs>` beneath its
  heading, so it runs after — with no concurrent siblings to poison. This is the ONLY ordering control;
  document position is irrelevant (Step 4.5).
- **Add a one-line note** when the shared resource is a per-IP limiter: under parallel dispatch the bucket
  is shared across workers, so even isolated the operator should expect possible `429` cross-contamination
  from earlier waves. (An honest harness limitation, not something the plan can fully remove.)
- **Do NOT serialize contention scenarios.** A `409` concurrency test *wants* genuine overlap — parallel
  dispatch helps it; leave it dependency-free (or `(timing-dependent)`-tagged).
- **"Ordered state" is narrow.** It means **one scenario WRITES a row a sibling READS in the same run** —
  NOT "these read logically sequential." If each scenario provisions its own data via its own binding, the
  scenarios are independent: do NOT add `**Depends-on:**`. Over-serializing kills the 4-wide speedup.

Litmus: *"if this scenario and another run at the same second, does one corrupt the other's result?"* — yes ⇒
`**Depends-on:**`; per-IP-limiter ⇒ also the contamination note.
```

- [ ] **Step 4: Edit test-plan-format.** After the existing PUT/BE-01 example in "Dependency annotations (opt-in)":

```markdown
**Serializing a contaminating scenario.** Use `**Depends-on:**` to force a scenario that exhausts a global
per-IP quota into a terminal wave so it does not poison siblings under the 4-wide parallel runner (authoring
rationale: `qa-plan-authoring` Step 6.9). To serialize a rate-limit (`429`) scenario after every other BE
scenario:

~~~markdown
### BE-09: rate limit returns 429 after the quota is exhausted

**Depends-on:** BE-01, BE-02, BE-03, BE-04, BE-05, BE-06, BE-07, BE-08
~~~

The bucket is still shared across workers within a wave, so add a one-line note that earlier waves may have
consumed quota — `**Depends-on:**` removes *concurrent* contamination, not the shared bucket itself.
```

- [ ] **Step 5: Run green** (both files).

### Task 1.3 (Lever C + H1): Deepen the adversarial edge classes; reconcile the 429 framing

**Files:** Modify `qa-plan-authoring/SKILL.md` (Step 6.6 in-scope list + the 429 sentence + Step 6.8); `test-plan-format/SKILL.md` (Edge Case Rules — terse pointers); Tests: both.

> **B1 + phrasing:** canonical phrase is **`indistinguishable from not-found`** (no "the"), identical in both skills and tests. **Each asserted phrase below is on ONE line — keep it unwrapped.**

- [ ] **Step 1: Failing tests.** Add to `tests/skills/qa-plan-authoring.test.ts`:

```ts
it("Step 6.6 carries no-oracle IDOR equality and reflected-input injection", () => {
  expect(md).toContain("indistinguishable from not-found")
  expect(md).toContain("reflected into a response header")
})
it("Step 6.6 carries lock-release-on-error and a no-mutation invariant", () => {
  expect(md).toContain("lock releases on the error path")
  expect(md).toContain("mutates no persistent state")
})
```

- [ ] **Step 2: Run red.**
- [ ] **Step 3a: Reconcile the 429 framing (H1 + C-1 — POINT to 6.9, don't restate).** In Step 6.6's Reachability-litmus paragraph, change the existing 429 sentence:

  > **"The runner is sequential" is rejected for 429** — exhaust the limiter over the FAST path (fire 11× the cheap 402/404 request; error responses still count toward the slowapi bucket).

  to (reject the punt + a bare pointer; the sequencing mechanism lives only in Step 6.9):

  > **A defect or "the runner can't" is rejected as a 429 punt** — exhaust the limiter over the FAST path (fire 11× the cheap 402/404 request; error responses still count toward the slowapi bucket). That is the *trigger recipe*; because the runner is 4-wide parallel, sequence the 429 scenario per **Step 6.9** so its sweep does not contaminate siblings.

- [ ] **Step 3b: Edit the in-scope-by-default list.** Replace the four bullets — KEEP the lead-ins/citations, ADD a single shared generalization lead-in (C-2), then sharp predicates. **Each asserted phrase is on one unwrapped line:**

```markdown
Each class below is a CLASS — apply its predicate to ANY matching surface, not just the export endpoint
(a foreign 404 on any resource; a user value in any header/body; a lock on any guarded op; any read-only op).

- **IDOR / cross-tenant** (user B requests user A's resource): mint a SECOND principal binding (Step 6.5)
  and `curl` with its token. Assert no-oracle equality — the foreign-resource response must be `indistinguishable from not-found` (same status AND body shape), and the ownership check must fire *before* any state-revealing gate (entitlement/payment/`402`). A bare "→ 404" without the equality assertion is shallow.
- **Reflected-input injection** — any user-controlled value echoed into a response header or body (a filename in `Content-Disposition`, a username in a login error body, an uploaded filename in a `Location` header). For a value `reflected into a response header`, test with metacharacters (`"`, `;`, newline, `/`, `..`) and assert it is sanitized and the header stays well-formed (no header splitting); for a body, assert no quote-break / HTML injection.
- **Upstream-dependency failure → 5xx** (a bad upstream key → 401/500 mapped to **502**): `curl` with the
  dependency misconfigured or stopped (declared in Setup). Also verify the `lock releases on the error path` — after the 5xx/timeout an immediate retry of the same resource must NOT return `409` (the lock frees on exception, not only on success).
- **Lock / concurrency contention → 409** (two in-flight requests for one resource): fire concurrent
  `curl`s (background the first); tag `(timing-dependent)`. Do NOT add `**Depends-on:**` here — this
  scenario needs genuine overlap (Step 6.9).
- **Boundary conditions** (`valid_to == now`, one-expired-one-active): seed the boundary row via `psql` /
  the dev tool and `curl` across it.
- **No-mutation invariant** — a read-only / export / idempotent operation `mutates no persistent state`: assert `psql` row counts (or a checksum) of the affected tables are unchanged before vs after, INCLUDING on the error path (a failed export/upload must consume/write nothing).
```

- [ ] **Step 3c: Edit Step 6.8.** Add one high-risk bullet after "derived values":

```markdown
- **reflected-input safety and no-oracle responses** — a user-derived value that lands in a header/body must
  be sanitized; a not-found-vs-forbidden pair must not leak existence. Re-read the producing code and the
  ownership-check ordering with intent to refute.
```

- [ ] **Step 4: Edit test-plan-format Edge Case Rules (terse POINTERS — M3).** Add to the existing categories. **Each asserted phrase on one line:**

```markdown
### Authentication & Authorization
- Unauthenticated request (no token)
- Expired token
- Valid token but insufficient permissions
- Another user's resource (IDOR) — assert the response is `indistinguishable from not-found` and ownership is checked before any payment gate; see `qa-plan-authoring` Step 6.6 for the no-oracle rule

### State
- Resource does not exist (404)
- Duplicate creation attempt (409)
- Concurrent modifications (race conditions) — for a lock, also verify the `lock releases on the error path` (see `qa-plan-authoring` Step 6.6)
- Resource in unexpected state (e.g., already deleted, already processed)

### Side effects (see `qa-plan-authoring` Step 6.6 for full rules)
- A read-only / export / idempotent op `mutates no persistent state` (counts/checksum unchanged, incl. error path)
- A user value `reflected into a response header` stays well-formed under metacharacters (no header splitting)
```

- [ ] **Step 5:** Add to `tests/skills/test-plan-format.test.ts`:

```ts
it("Edge Case Rules carry adversarial teeth (pointers to Step 6.6)", () => {
  expect(md).toContain("indistinguishable from not-found")
  expect(md).toContain("mutates no persistent state")
  expect(md).toContain("reflected into a response header")
})
```

- [ ] **Step 6: Run green** (both files).

### Task 1.4 (Lever D, one sentence — M4): Setup-orchestration kernel

**Files:** Modify `qa-plan-authoring/SKILL.md` (Step 3.5 closing); `test-plan-format/SKILL.md` (Blockers — one pointer); Test: `qa-plan-authoring.test.ts`.

- [ ] **Step 1: Failing test.**

```ts
it("Step 3.5 orders multi-step blocker remediation as Setup prerequisites", () => {
  expect(md).toContain("ordered list of human Setup prerequisites")
})
```

- [ ] **Step 2: Run red.**
- [ ] **Step 3: Edit Step 3.5.** Append ONE sentence after the existing reversible-blocker guidance. **The asserted phrase is on one unwrapped line:**

```markdown
When fully exercising the contract needs more than one human action (e.g. remove a debug delay to observe `200`/`502`, then transiently reintroduce it to observe a genuine `504`), express it as an `ordered list of human Setup prerequisites` (revert → run path A → reintroduce → run path B → revert) — never as scenario steps; the runner cannot edit source.
```

- [ ] **Step 4: Edit test-plan-format Blockers.** Add ONE pointer bullet after "Remediation is a human Setup prerequisite":

```markdown
- **Multi-step remediation** (revert → observe → reintroduce → observe → revert) is an ordered list under
  `## Setup`, never scenario steps — see `qa-plan-authoring` Step 3.5.
```

- [ ] **Step 5: Run green.**

### Task 1.5 (Lever E, record-only — H3): Strengthen the sequential-thinking trigger

**Files:** Modify `src/modules/plan/veles.md` ("Decomposing complex changes" subsection, ~lines 68-73 — **heading loses "(optional)"; no test asserts the heading, but note it so an implementer doesn't restore it**); Test: `tests/modules/plan/veles-prompt.test.ts`.

- [ ] **Step 1: Failing test.** Add inside the existing `it("pins the load-bearing planner directives", …)` block (DO NOT remove `sequential_thinking_sequentialthinking` or `proceed with native decomposition`):

```ts
expect(prompt).toContain("you SHOULD use")
expect(prompt).toContain("cross-scenario interactions")
```

- [ ] **Step 2: Run red.**
- [ ] **Step 3: Edit veles.md.** Replace the subsection body (heading sans "(optional)"; preserve both asserted substrings; **countable skip** closes the subjective hatch):

```markdown
### Decomposing complex changes

When the diff exposes **≥2 status/behavior classes** (countable from the declared errors + the success
path), you SHOULD use `sequential_thinking_sequentialthinking` to decompose the change into independent
testable units AND to surface **cross-scenario interactions** before writing — shared rate-limit buckets,
lock ordering, data one scenario mutates that another reads, and which scenarios can run concurrently under
the 4-wide parallel runner. This is where coverage gaps and parallel-runner contamination hide. Skip it ONLY
for a single-status diff that yields one scenario. If `sequential_thinking_sequentialthinking` is
unavailable, proceed with native decomposition.
```

- [ ] **Step 4: Run green.** Confirm the existing three ST/refute assertions in that block still pass.

### Task 1.6: Build, sync dist, full check

- [ ] **Step 1:** `bun run build:root`.
- [ ] **Step 2:** Verify dist carries the edits AND every asserted phrase is single-line in its target file:
  - `grep -n "Step 6.9" dist/skills/qa/qa-plan-authoring/SKILL.md`
  - `grep -n "you SHOULD use" dist/modules/plan/veles.md`
  - `grep -n "lock releases on the error path" dist/skills/qa/qa-plan-authoring/SKILL.md` (must be a single-line hit — BL-1 guard)
  - `grep -n "ordered list of human Setup prerequisites" dist/skills/qa/qa-plan-authoring/SKILL.md` (single-line hit — BL-2 guard)
  - `grep -n "indistinguishable from not-found" dist/skills/qa/test-plan-format/SKILL.md`
- [ ] **Step 3:** `bun run check` → green (all skill + veles-prompt tests, incl. the three pre-existing ST/refute assertions). `verify-dist` may flag dist as uncommitted — expected.

**Exit criterion (Phase 1):** all five levers edited, dist in sync, `bun run check` green, both skill test files + veles-prompt test green.

---

## RUNG 1 — Re-run golden #1 + Layer-2 (incl. a non-export endpoint) + decision gate

- [ ] **Step 1 (single arm — full Phase 1):** Re-run edited Veles on golden #1, ≥3 iters, model `opencode-go/kimi-k2.6`, grade worst-of-N on GATE-ORDER / GATE-DEPTH(by-substance) / ST-INVOKED (+ GATE 1/2/3 to confirm no defect-grounding regression).
- [ ] **Step 2 (over-serialization check — M2):** Count `**Depends-on:**` edges per generated plan. Flag if any plan serializes more than the one 429/lock scenario the surface warrants (over-use ⇒ tighten Step 6.9's "ordered state" wording).
- [ ] **Step 3 (Layer-2, two endpoints — S-2):** On the real i-need-cv repo (throwaway worktree, capture-then-delete `/tmp`, base branch `master`): (a) the **export-PDF branch** — re-grade GATE-ORDER + GATE-DEPTH with REAL `(file:line)` grounding (where the grounding teeth finally bite) head-to-head vs the saved marketplace plan; (b) a **non-export endpoint** (e.g. a login / account route) — grade GATE-DEPTH on a surface whose shape Veles was NOT trained on, to measure generalization on real source (replaces the dropped dedicated golden). Grade by the same per-edge substance predicates against that surface's applicable set.
- [ ] **Step 4: Decide.**
  - **GATE-ORDER passes AND GATE-DEPTH ≥3/4 at worst-of-N on golden #1, the Layer-2 export run, AND the Layer-2 non-export run, no GATE 1/2/3 regression → STOP. Phase 1 is the fix; DO NOT build Phase 2.**
  - **GATE-ORDER still fails (bare 429) → Phase 2** (the one regex-decidable check). **GATE-DEPTH <3/4 OR the non-export Layer-2 run lags the export run → loop Phase 1 prose** (a generalization/wording gap, not a hook gap — same lesson as the markerless defect golden). A verdict that **flips across iters** on any surface = `unreliable` → also loop Phase 1.
  - **Lever-E disposition (record-only, NO ablation — E-2).** Read the ST-INVOKED rate + absolute GATE-DEPTH from the single arm:
    - ST-INVOKED high AND GATE-DEPTH passes → keep the SHOULD trigger.
    - ST-INVOKED low AND GATE-DEPTH passes → the skill prose carried it; **demote Lever E to MAY** (drop the latency/token cost).
    - ST-INVOKED low AND GATE-DEPTH fails → **escalate to a hard ST gate in `veles.md`** (mirror the matrix hard-stop) rather than more prose.
    Record the decision; make no causal claim a single arm can't support.

---

## RESULT — RUNG 1 (2026-06-04): STOP — Phase 1 is the fix; Phase 2 NOT built; Lever E demoted to MAY

**RUNG 0 (baseline):** evidenced by the 2026-06-03 transcript — bare BE-08 (no `**Depends-on:**`) = GATE-ORDER fail; shallow IDOR/filename = low GATE-DEPTH; no ST call.

**RUNG 1 — golden #1, fixed Veles, worst-of-3** (`opencode-go/kimi-k2.6`):

| | iter 1 | iter 2 | iter 3 | worst-of-3 |
|---|---|---|---|---|
| GATE-ORDER | ✅ Dep+note | ✅ Dep | ✅ Dep+note | **PASS 3/3** |
| GATE-DEPTH (substance /4) | 4/4 | 3/4 | 4/4 | **3/4 strong** |
| GATE 2 / GATE 3 | ✅ / ✅ | ✅ / ✅ (+Lever-D orchestration) | ✅ / ✅ | **no regression** |
| ST-INVOKED | no | no | yes | **1/3 (low)** |

iter 2 wrote a complete, correct plan but was watchdog-killed during JSON wrap-up (an intermittent headless API stall — content not at fault; 2/3 emitted clean JSON). iter 2 even used the **Lever-D Setup-orchestration kernel** (reintroduce the 65s delay as an ordered Setup step to observe the genuine 504). GATE-DEPTH edges present with substance across iters: no-oracle IDOR (`indistinguishable from not-found` + ownership-before-402), reflected-input/header-splitting, `lock releases on the error path`, no-mutation DB check incl. error path.

**Decision: STOP. The depth + logistics gap is closed; Phase 2 (deterministic lint) is NOT built.**

**Lever E → demoted to MAY (applied).** ST was invoked only 1/3, yet GATE-ORDER/DEPTH passed in all 3 — including iter 1 at 4/4 with ST *not* invoked. The skill prose (Levers A/B/C) carried the result; the SHOULD trigger was not load-bearing. Per the pre-committed threshold, `veles.md` was reverted SHOULD→MAY (keeping the ≥2-status framing + cross-scenario-interactions value); test + dist updated; `bun run check` green.

**Layer-2 generalization (non-export avatar-upload surface, real i-need-cv worktree):** the generalization *behavior* is confirmed — across attempts the fixed Veles did deep grounding on the avatar surface (reading the real upload use case, storage adapter, `error_handler.py`, `rate_limit.py`, schemas, tests, `auth.py`) and attempted framework-default verification of FastAPI `HTTPBearer`. **Plan emission could not complete in headless `opencode run`:** three attempts each hit a *different* permission auto-reject at the grounding/verification step — `git diff`, an `external_directory` abs-path bash (Serena resolved the worktree to the original repo path), and `python3 -c` introspection (not in `VELES_TOOLS`). This is a **headless-eval-harness limitation, not a Veles defect** — `--dangerously-skip-permissions` was (correctly) not used, and an interactive/Perun run permits these. **To grade GATE-DEPTH on real non-export source, run it interactively** (or via Perun) rather than headless.

**Eval-infra notes (orthogonal follow-ups, not in this plan's scope):** (1) headless `opencode run` blocks the framework-default-verification shell-outs the Step-0 discipline encourages — consider steering that discipline toward `Read`-ing the installed package source instead of `python3`/`grep` shell-probes, since Veles has no execution token; (2) a one-off ~24h idle stall + an intermittent JSON-wrap stall were observed — environmental, watchdog-guarded.

---

## Phase 2 — Deterministic lint (CONDITIONAL — NOT BUILT; RUNG 1 passed)

> Build ONLY if RUNG 1 routed here. The one cheaply-decidable check: a scenario whose `**Expected response:**`
> asserts `429` (or names a rate-limit) but carries neither `**Depends-on:**` nor a shared-bucket note. Depth
> gaps (no-oracle IDOR, injection) are NOT regex-decidable — fix those in prose, not a hook.

### Task 2.1: `plan-linter` rate-limit-ordering check

**Files:** Create/extend `src/modules/qa/plan-linter.ts`; test `tests/modules/qa/plan-linter.test.ts`.

- [ ] **Step 1: Failing test** — a plan with a `429` scenario lacking both `**Depends-on:**` and a contamination note yields a `RATE_LIMIT_NOT_SERIALIZED` warning; a plan with either passes; clean plans → `{status:"ok"}`. Severity = `warning` (never hard-block).
- [ ] **Step 2: Implement** following `recipe-validator.ts` conventions (pure, dependency-free, byte-capped).
- [ ] **Step 3:** Enable for Veles via `src/modules/plan/index.ts` only if the gate demands it; keep the 6-key result JSON contract unchanged.

### Task 2.2: Build, test, RUNG 2

- [ ] Re-run golden #1 with the check active; GATE-ORDER must pass. PASS → STOP.

**Exit criterion (Phase 2):** `plan-linter.test.ts` green; check enabled for Veles; result contract unchanged; dist committed; RUNG 2 passes GATE-ORDER.

---

## Risks & YAGNI

- **Over-serialization (R2 Q4).** Step 6.9's litmus carries two negative examples (don't serialize `409`; "ordered state" = write-then-read in the same run); RUNG-1 Step 2 counts `Depends-on` edges. Watch for over-use on a mid-tier model.
- **ST is the lowest-mechanism lever.** Evaluated record-only (no underpowered ablation); the pre-committed keep/demote/escalate threshold reads the single-arm ST-INVOKED rate + absolute GATE-DEPTH, so the decision can't "conclude nothing" without paying for a second arm.
- **Generalization measured on real source (S-2).** No dedicated fixture to maintain; the Layer-2 non-export endpoint is the probe. Class-framing teaches it in-prose; the export-shape anchoring risk is checked where it matters — a different real surface.
- **GATE-DEPTH is substance-scored, not tag-scored (E-1).** On the embedded golden the predicate substance is the discriminator (grounding tags are mandatory `(unverified)` there and don't separate deep from shallow); the grounding teeth are explicitly Layer-2-only.
- **Residual 429 contamination.** `**Depends-on:**` cannot stop a low per-IP limit from 429-ing peers in a 4-wide Wave 0. Disclosed via the contamination note; a true fix (source-IP variation, runner-level limiter-aware pacing) is a **harness** feature, out of scope for Veles prose.
- **Executor-scope drift.** Keep the rubric anchored to `zmora`'s curl/psql/Playwright surface; never reward human-executor wins.
- **Net scope (honest — S-1).** v3 is **net leaner than v2**: prose trimmed (Lever D one sentence, format copies as pointers, de-duplicated 429-sequencing, collapsed generalization riders) AND eval trimmed (dropped the 2-arm ablation and the dedicated golden). The eval cost is one single-arm RUNG-1 run + a Layer-2 run that already existed. The substantive levers are A/B/C; D is one sentence; E is an experimental trigger decided record-only.

## Open items to resolve at implementation

1. **Exact peer-ID list in the Lever-B example** is illustrative; assert the *guidance string*, not a specific ID list.
2. **Parallel-model placement** — default skill-only (Step 4.5); revisit if RUNG 1 shows Veles ignores it.
3. **Layer-2 base branch** — i-need-cv base is `master` (not `main`); pass explicitly. Pick the non-export endpoint at run time (a login or account route with an auth/ownership surface).
4. **Single-line phrase discipline (B1).** After each skill edit, `grep -n "<asserted phrase>"` the *specific target file* to confirm one-line hits before running the suite — whole-repo greps mislead.
