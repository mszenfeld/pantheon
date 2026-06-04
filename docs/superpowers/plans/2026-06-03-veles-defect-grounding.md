# Veles Defect-Grounding & Coverage-Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Revision v2 (2026-06-03):** incorporates a 4-reviewer spec review. Changes vs v1: narrowed the `veles.md` edit so it no longer breaks existing tests (blocker); GATE 3 made decidable; a second *markerless* golden added and the Phase-1-STOP gate now requires both; the Phase-2 `lint` JSON field cut (keeps the 6-key contract strict); test literals derived from finalized prose; Phase-2 tool-enabling task added; Coverage Matrix made conditional; Step 5.5 folded into 6.8.

**Goal:** Stop Veles from *normalizing a discovered code defect into a fixed environmental fact* (which collapsed test-plan coverage on the 2026-06-03 export-PDF eval), by making the correct behaviour — flag the defect as a Blocker, keep the contract-correct scenario, never punt a behavior because of a bug — the path of least resistance, and measure it with golden regressions that cover both the marker-bearing and markerless shapes of the failure.

**Architecture:** Eval-gated, three-phase. **Phase 0** builds two golden regressions and proves current Veles fails them. **Phase 1** is prose+flow edits to the QA-authoring skills + the Veles prompt (no TS, cheap). **Phase 2** (conditional) builds a deterministic in-process plan-linter — *only if Phase 1 still fails a golden*. The governing principle: the failure was not a missing rule (Veles ignored its own Step 6.6 anti-punt rule), so prefer mechanisms hard to ignore — **deterministic gate > forced emitted artifact > flow reordering > prose** — but do not build the expensive tier until the eval demands it.

**Honest scope of Phase 1 (review finding R2):** Phase 1's emitted artifacts (the `## Blockers` section, the `## Coverage Matrix`) *raise visibility and reduce* normalization, but in a Phase-1-only world they remain **self-attested** — a model in the failure mental-state can still fill a consistent-but-wrong row. The real enforcement is the golden eval, and (if it fails) Phase-2 Check A. The matrix is hardened by being **checkable against the diff's own enumerated contract** (one row per status the diff declares), which is the most decidable form available without a reviewer agent.

**Tech Stack:** Markdown skills (`src/skills/qa/**`), the Veles prompt module (`src/modules/plan/prompt.ts`, which embeds `veles.md` and builds into `dist/modules/plan/prompt.js`), TypeScript QA module (`src/modules/qa/**`), `bun` build (`tsup` + `copy-root-assets.mjs`, **committed `dist/`**), `vitest`. Manual model-eval via `docs/eval/playbook.md`.

---

## Background & root cause (read once)

On the 2026-06-03 eval, the same QA-plan task ran two ways on the i-need-cv export-PDF branch: **v1 = Veles** (`/Users/mef1st0/Projects/i-need-cv/docs/testing/plans/2026-06-03-export-pdf-endpoint-test-plan.md`), **v2 = a marketplace agent** (`…-v2-test-plan.md`). Marketplace won decisively.

Veles read a leftover debug artifact — `await asyncio.sleep(65)` at `/Users/mef1st0/Projects/i-need-cv/pdf-worker/src/pdf_worker/api/routes.py:64`, comment `# TEMPORARY: Add 65s delay for timeout test (BE-06)` — treated the forced 504 as immovable, scoped out 200/502/429/409/503/500 (only 6 scenarios), and made BE-06 **expect 504** (the bug as contract). The marketplace plan flagged a `⚠️ BLOCKER` and covered the full spec (10 scenarios).

Root cause = **normalization of deviance**: (1) accuracy ≠ judgment — Veles was accurate about what the code *does* but anchored expectations to buggy runtime, not the spec; (2) the Step 6.6 anti-punt litmus is bypassed *transitively* ("unreachable BECAUSE OF defect Y"); (3) no `## Blockers` concept distinct from `## Out of harness scope`. **Constraint: no momus / no new review agent** — every fix lives in Veles's single-agent flow or in deterministic code. The defect shape was a *marker-bearing* one (`TEMPORARY` + `sleep`); the failure *class* also covers *markerless* shapes (a commented-out auth guard, a hardcoded `return True`, a feature flag) — the plan must fix the class, not the instance (review finding R2).

Veles's strengths must be **preserved** (it lost on judgment, not form): executable `Bindings` recipes, YAML frontmatter, the automation-traceability `## Out of harness scope` section, `(file:line)` citations. All edits are additive.

---

## Naming conventions (fix the v1 token drift — review finding R3)

- **`## Blockers / Findings`** — the emitted section (exact heading). Entries are `### BLK-NN:`.
- **`**Blocked-by:** BLK-NN`** — the scenario *tag* (capital B, inert prose, peer in placement to `**Depends-on:**`, NOT parsed).
- **`blocked-by`** (lowercase) — the **Coverage-Matrix disposition keyword**. Both the tag and the keyword reference the same `BLK-NN` id.

Use these spellings verbatim everywhere; the Task-1.4 tests assert the lowercase content forms.

---

## File Structure

| File | Phase | Responsibility |
|---|---|---|
| `docs/eval/scenarios/veles/qa-plan-defect-grounding.md` | 0 | NEW golden #1 (marker-bearing): the sleep(65) shape |
| `docs/eval/scenarios/veles/qa-plan-defect-grounding-markerless.md` | 0 | NEW golden #2 (markerless): a commented-out guard, no `TEMPORARY`/`sleep` marker |
| `.gitignore` | 0 | allowlist both new public scenarios (blanket `veles/*` ignore otherwise hides them) |
| `docs/eval/scenarios/veles/README.md` | 0 | register both scenarios |
| `docs/eval/playbook.md` | 0/1 | write the ≥3-iter worst-of-N + GATE grading protocol; add the regression-guard ritual |
| `src/skills/qa/test-plan-format/SKILL.md` | 1 | define `## Blockers / Findings` (mandatory), `## Coverage Matrix` (conditional), the `**Blocked-by:**` tag |
| `src/skills/qa/qa-plan-authoring/SKILL.md` | 1 | Steps 1.5 (pin contract), 3.5 (blocker scan), 6.6 (transitive-punt clause), 6.7 (forced matrix), 6.8 (contract-vs-runtime refute, with the folded decision table) |
| `src/modules/plan/veles.md` | 1 | extend (NOT replace) the hard-stop with the artifact-keyed bullets |
| `tests/skills/qa-plan-authoring.test.ts`, `tests/modules/plan/veles-prompt.test.ts`, a new `parseBindings` regression test | 1 | assert new substrings; prove parser-inertness |
| `src/modules/qa/plan-linter.ts` (+ `index.ts`, `src/modules/plan/index.ts`, tests) | 2 (conditional) | deterministic post-authoring analyzer + Veles tool-enable |

**Parser-safety invariant (verified in the review — R1 ran the real parser).** `parse_plan`/`parseBindings` read only frontmatter + `## Setup → **Bindings:**` and break at the next `##`; `fe_count`/`be_count` come from Veles's result JSON, keyed on `### FE|BE|SETUP-\d+`. So `## Blockers / Findings` (with `### BLK-NN:`), a `## Coverage Matrix` table, and `**Blocked-by:**` prose are all inert — confirmed against `src/modules/qa/binding-parser.ts`. Do NOT wire `**Blocked-by:**` into the parser (out of scope). Task 1.4 adds a regression test that constructs a plan with the new sections and asserts `parseBindings` is unaffected.

---

## Phase 0 — Measurement first (gates everything)

### Task 0.1: Author golden #1 (marker-bearing — the sleep shape)

**Files:**
- Create: `docs/eval/scenarios/veles/qa-plan-defect-grounding.md`
- Modify: `.gitignore`, `docs/eval/scenarios/veles/README.md`

- [ ] **Step 1: Write the scenario file** (follow the README "Scenario file convention"). The Query embeds a self-contained diff carrying the intended status surface AND the leftover `# TEMPORARY … await asyncio.sleep(65)` hunk.

~~~markdown
# Veles: QA plan from a diff containing a leftover debug artifact (deviance-normalization guard, marker shape)

**Agent:** Veles - Planner
**Target codebase:** self-contained — the diff below is the complete change set;
plan only from it, do not read repo source, do not dispatch sub-agents, do not ask
clarifying questions. Save the plan and end with the required JSON.

## Query

> Generate a QA test plan for the following self-contained changes. The diff below
> is the complete and only change set — plan only from it.
>
> ```diff
> --- /dev/null
> +++ b/api/export/router.py
> @@
> +from fastapi import APIRouter, Depends, HTTPException, Request
> +from .auth import get_current_user_id            # 401 on bad/expired token
> +from .entitlements import require_active          # 402 when no active entitlement
> +from .lock import per_doc_lock                    # 409 + Retry-After on contention
> +from .worker import render_pdf                    # calls the PDF worker (httpx, 60s timeout)
> +
> +router = APIRouter()
> +
> +@router.get("/api/export/{doc_id}/pdf")
> +@limiter.limit("10/minute")                       # slowapi, fixed-window, per-IP
> +async def export_pdf(doc_id: str, request: Request,
> +                     user_id: str = Depends(get_current_user_id)):
> +    """Export a document to PDF.
> +
> +    Contract:
> +      200 → application/pdf body (starts with %PDF), Content-Disposition attachment
> +      401 → missing/invalid/expired bearer token
> +      402 → no active entitlement for this user
> +      404 → doc missing or owned by another user (IDOR-safe, not 403)
> +      409 → a render for the same doc_id is already in flight (Retry-After: 30)
> +      429 → more than 10 requests/minute from one IP (fixed window)
> +      502 → PDF worker returns an HTTP error
> +      504 → PDF worker exceeds the backend's 60s httpx timeout
> +    """
> +    require_active(user_id)
> +    async with per_doc_lock(doc_id):              # raises 409 if held
> +        return await render_pdf(doc_id)           # maps worker timeout→504, HTTPError→502
> --- /dev/null
> +++ b/worker/routes.py
> @@
> +@app.post("/render")
> +async def render(req: RenderRequest):
> +    # TEMPORARY: Add 65s delay for timeout test (BE-06)
> +    await asyncio.sleep(65)
> +    return Response(content=render_to_pdf(req), media_type="application/pdf")
> --- /dev/null
> +++ b/supabase/config.toml
> @@
> +[api]
> +port = 54321
> +[db]
> +port = 5432
> +[auth]
> +jwt_algorithm = "ES256"
> ```

## Expected coverage

**MUST:**
- A `## Blockers / Findings` entry names the leftover `await asyncio.sleep(65)` at
  `worker/routes.py` as a temporary debug artifact that must not ship, with a
  remediation modelled as a human Setup prerequisite ("revert the delay + restart
  the worker before the happy-path scenarios").
- A **200 happy-path** scenario exists (asserts `%PDF` body + `Content-Disposition`),
  tagged `**Blocked-by:**` the artifact — NOT dropped, NOT rewritten to expect 504.
- 502 (worker HTTP error), 409 (lock contention + `Retry-After`), 429 (fixed-window,
  per-IP) are **covered** scenarios — not punted because "every call 504s" or "the
  runner is sequential".
- 401, 402, 404 (IDOR-safe) covered; the IDOR case mints a SECOND principal binding.
- The 504 scenario (if present) tests the *intended* timeout path via instrumentation —
  never asserts 504 as the normal outcome of the leftover delay.
- Veles strengths intact: YAML frontmatter; `## Setup` `**Bindings:**` with executable
  recipes and no dangling `$QA_BIND_*`; every assertion carries `(file:line)` or
  `(unverified — confirm at run time)`.

**NICE-TO-HAVE:**
- A `## Coverage Matrix` (≥2 statuses → required here) enumerating each contract status
  with disposition (covered / blocked-by / out-of-scope+reason).
- Boundary cases (entitlement `valid_to == now()`), filename edge cases.

## Quality signals

Gate-then-rank (gate-then-rank has precedent in `qa-plan-from-diff.md` /
`qa-plan-multi-principal.md`; the iteration + grading protocol is defined in
`docs/eval/playbook.md` → Veles section, written in Task 0.2 Step 0):

- **GATE 1 — JSON contract.** Exactly the 6 keys (`status`, `plan_path`, `fe_count`,
  `be_count`, `setup_prereqs`, `topic`), valid JSON, nothing after it. Else `degenerate`.
- **GATE 2 — defect flagged as a blocker (decidable).** `## Blockers / Findings` contains
  an entry whose body matches `sleep` or `TEMPORARY` and cites `worker/routes.py`.
  Absent → `degenerate`.
- **GATE 3 — no deviance-encoding (decidable, 3 string checks).** `degenerate` iff:
  (any scenario's `**Expected response:**` status == `504`) AND (`## Blockers / Findings`
  names no `sleep`/`TEMPORARY`) AND (that scenario carries no `**Blocked-by:**` tag). No
  judgment — three string checks. The richer "is this 504 attributed to the defect"
  notion is a RANKING demerit, not a gate.
- **PRIMARY RANKING — contract coverage breadth.** Each MUST status reachable-after-revert
  covered or blocked-by (not punted). **Transitive-punt demerit:** each behavior punted to
  `## Out of harness scope` with the artifact as its reason; ≥3 caps the verdict at
  `acceptable`. 503 (can't stop DB) and 500 (non-deterministic) are the only legitimate punts.
- **STRENGTH-PRESERVATION GATE.** Missing frontmatter / Bindings / citations, or any dangling
  `$QA_BIND_*` → `degenerate`, labelled `regressed-strengths` (distinct root cause).
- **Variance:** ≥3 iterations; grade worst-of-N. Flag `unreliable` if GATE-2/GATE-3 pass/fail
  flips across iterations — counted as "still normalizing".

**Scope limit (mirrors `qa-plan-export-pdf-regression.md`'s §A0 note):** source is not on
disk, so `(unverified — confirm at run time)` is the CORRECT tag, not a defect; this scenario
grades *reasoning about the artifact visible in the diff text*, not read-grounding (a Layer-2
concern).

## What this discriminates

- **Deviance-normalization, marker shape** (primary): a plan that encodes the leftover artifact
  as a fixed contract (a scenario expecting 504) and punts the happy path + downstream errors,
  vs. a plan that flags the artifact and keeps contract-correct, `Blocked-by:`-tagged coverage.
- See also `qa-plan-defect-grounding-markerless.md` (markerless shape) and
  `qa-plan-export-pdf-regression.md` (orthogonal confidently-wrong-claims discriminator).
~~~

- [ ] **Step 2: Allowlist in `.gitignore`.** The blanket `docs/eval/scenarios/veles/*` rule (line 32) hides this public scenario. Add a `!` exception after the `!docs/eval/scenarios/veles/qa-plan-export-pdf-regression.md` line (currently line 35), before the `TEMPLATE.md` allow line:

```diff
 !docs/eval/scenarios/veles/qa-plan-export-pdf-regression.md
+!docs/eval/scenarios/veles/qa-plan-defect-grounding.md
+!docs/eval/scenarios/veles/qa-plan-defect-grounding-markerless.md
 !docs/eval/scenarios/veles/TEMPLATE.md
```

- [ ] **Step 3: Register in the README** under "What's here" (after the `qa-plan-multi-principal.md` bullet):

```markdown
- `qa-plan-defect-grounding.md` — **Layer 1**, public. An embedded diff carrying a leftover
  `# TEMPORARY … asyncio.sleep(65)` artifact alongside the full intended status surface.
  Discriminates **deviance-normalization (marker shape)**: a plan encoding the bug as the
  contract `degenerate`s on GATE 2/3; flagging it as a Blocker + keeping contract-correct
  `Blocked-by:` coverage passes.
- `qa-plan-defect-grounding-markerless.md` — **Layer 1**, public. Same failure *class*, but the
  defect is a **commented-out entitlement guard with no `TEMPORARY`/`sleep` marker** — proves the
  fix generalizes past the marker regex (the case a Phase-2 regex would miss).
```

- [ ] **Step 4: Verify tracked.** Run: `git check-ignore -v docs/eval/scenarios/veles/qa-plan-defect-grounding.md`
  Expected: prints the `!`-negation line (NOT ignored). If it prints the blanket-ignore line, fix the allowlist order.

### Task 0.1b: Author golden #2 (markerless — a commented-out guard)

**Files:**
- Create: `docs/eval/scenarios/veles/qa-plan-defect-grounding-markerless.md`

- [ ] **Step 1: Write it** with the same section schema. The Query embeds a diff where an entitlement guard is **commented out with no marker word in Check-A's set** (`# require_active_subscription(...)  # disabled during billing migration`), so the contract's 402 path is unobservable, yet there is no `TEMPORARY`/`sleep`/`HACK`/`FIXME`/`XXX`/`DEBUG` token:

~~~markdown
# Veles: QA plan from a diff with a commented-out guard (deviance-normalization guard, markerless shape)

**Agent:** Veles - Planner
**Target codebase:** self-contained — plan only from the diff below; no repo source,
no sub-agents, no clarifying questions. Save the plan and end with the required JSON.

## Query

> Generate a QA test plan for the following self-contained changes. The diff below is the
> complete and only change set — plan only from it.
>
> ```diff
> --- /dev/null
> +++ b/api/billing/router.py
> @@
> +@router.get("/api/billing/{invoice_id}/pdf")
> +async def get_invoice_pdf(invoice_id: str, user_id: str = Depends(get_current_user_id)):
> +    """Return an invoice as PDF.
> +
> +    Contract:
> +      200 → invoice owned by the caller, caller has an active subscription
> +      401 → missing/invalid token
> +      402 → caller has NO active subscription
> +      404 → invoice missing or owned by another user
> +    """
> +    # require_active_subscription(user_id)   # disabled during billing migration
> +    invoice = await db.scalar(
> +        "SELECT body FROM invoices WHERE id = :id AND owner_id = :uid",
> +        {"id": invoice_id, "uid": user_id},
> +    )
> +    if invoice is None:
> +        raise HTTPException(404, "not found")
> +    return Response(content=render_invoice(invoice), media_type="application/pdf")
> ```

## Expected coverage

**MUST:**
- A `## Blockers / Findings` entry names the **commented-out `require_active_subscription`**
  guard (`api/billing/router.py`) as a defect: the contract promises 402 on no subscription,
  but with the guard disabled an unsubscribed owner gets 200. Remediation = a human Setup
  prerequisite (re-enable the guard before asserting the 402 path).
- A **402 (no-subscription)** scenario exists, asserting 402 per the contract, tagged
  `**Blocked-by:**` the guard finding — NOT dropped, NOT rewritten to expect 200.
- 200 / 401 / 404 covered; expectations follow the contract.
- Veles strengths intact (frontmatter, Bindings, citations).

## Quality signals

Gate-then-rank (protocol per `docs/eval/playbook.md` Veles section):

- **GATE 1 — JSON contract.** The 6 keys, valid JSON. Else `degenerate`.
- **GATE 2 — defect flagged (decidable).** `## Blockers / Findings` names
  `require_active_subscription` / "commented out" / "disabled". Absent → `degenerate`.
- **GATE 3 — no deviance-encoding.** `degenerate` iff a 200-expecting scenario covers the
  no-subscription case AND no Blocker names the disabled guard AND no `**Blocked-by:**` tag —
  i.e. the plan treats "unsubscribed → 200" as the contract.
- **PRIMARY RANKING — coverage of 402/401/404** + whether the 402 path is kept (blocked-by) vs punted.
- **Variance:** ≥3 iters, worst-of-N.

**Scope limit:** embedded diff → `(unverified)` tags are correct; grades reasoning about the
visible commented-out guard, not read-grounding.

## What this discriminates

- **The markerless shape of deviance-normalization** — a defect with no lexical marker, so it
  is invisible to a `TEMPORARY|sleep`-style regex. Passing this proves the fix internalized the
  *contract-vs-runtime* principle, not just a marker-matching trick. This is the case Phase-2
  Check A (regex-based) is expected to MISS — making it the harder, generalization bar.
~~~

- [ ] **Step 2: Register** in the README (done in Task 0.1 Step 3's second bullet) and confirm the gitignore allowlist (Task 0.1 Step 2 already adds both). Verify with `git check-ignore -v docs/eval/scenarios/veles/qa-plan-defect-grounding-markerless.md`.

### Task 0.2: RUNG 0 — prove current Veles fails both goldens

**Files:** Modify `docs/eval/playbook.md` (the grading protocol); the run itself writes only to `/tmp`.

- [ ] **Step 0: Add the defect-golden grading note to the playbook.** The playbook's "Evaluating side-effecting agents (Veles)" section already defines gate-then-rank, the binding-completeness gate, the verdict vocabulary, and capture-then-delete. What it lacks is the **≥3-iteration, worst-of-N** rule for the defect-grounding goldens (the section defaults to 2 iters). Add one bullet covering that + the regression tripwire, citing **Lesson 9** (billable-run cost) and **Lesson 10** (keep the golden discriminating — *both exist in the playbook's Lessons section*; an earlier review claim that "Lesson 10 doesn't exist" was a **false positive caught at implementation by grounding**). The GATE-1/2/3 specifics stay in the scenario files, as other Veles scenarios already do. *(Done in Phase 0.)*
- [ ] **Step 1: Prerequisites + run.** Requires `opencode` in PATH, the Veles model authed in `~/.local/share/opencode/auth.json`, and `veles.model` configured in `~/.config/opencode/pantheon.json` (playbook Step 1 pre-flight). **This is a billable LLM run.** Run BOTH goldens against CURRENT Veles, ≥3 iterations each, on the configured Veles model, following the playbook (serve plugin → dispatch `Veles - Planner` with the scenario `## Query` → capture the saved plan to a guaranteed `/tmp` path). The i-need-cv repo is NOT needed (both goldens are self-contained / Layer 1).
- [ ] **Step 2: Grade against the gates.** Expected baseline: **FAIL** both — golden #1 fails GATE 2/3 with ≥3 transitive punts; golden #2 fails GATE 2/3 (treats unsubscribed→200 as contract). Record per-iteration verdicts + `sessionID` to `/tmp`.
- [ ] **Step 3: Discrimination check (review finding R2 — take seriously).** Golden #1's contract is spelled out in a docstring and the marker is loud, so current Veles **might pass it** — if so, it is too easy to be an arbiter. If either golden passes RUNG 0: (a) for #1, make the contract diffuse (move the status surface out of the docstring into `raise`/handler lines) and/or move the `# TEMPORARY` comment to a context line above the hunk; (b) golden #2 is the harder discriminator by design — if even it passes, the failure does not reproduce synthetically and you must fall back to a **Layer-2 run on a throwaway i-need-cv clone** (the real conditions that produced the failure) before trusting the Phase-1 result. **Do not proceed to Phase 1 until at least one golden reproducibly FAILS** — a non-discriminating golden cannot prove a fix.

**Exit criterion (Phase 0):** both scenarios committed + tracked + registered; the playbook carries the grading protocol; a RUNG-0 run reproducibly FAILS (with `/tmp` evidence). If only #1 reproduces synthetically, note that #2 / Layer-2 is the generalization check.

---

## Phase 1 — Prose + flow fixes (the cheap tier)

### Task 1.1: `test-plan-format` — new sections + tag

**Files:** Modify `src/skills/qa/test-plan-format/SKILL.md`

- [ ] **Step 1: Add the section conventions to the structure skeleton.** In the `~~~markdown … ~~~` Plan Structure block, after the `## Changes Summary` block (lines 45–47) and before `## FE Test Scenarios` (line 49), insert:

```markdown
## Blockers / Findings

<Defects in the code under test that obstruct HOW it must be tested. A Blocker is NOT
"out of harness scope": out-of-scope = the harness physically cannot observe the behavior;
a Blocker = the behavior IS in scope but current code is wrong/instrumented so the spec'd
result can't be observed. This section is MANDATORY — if you found none, write `None found.`>

### BLK-01: <one-line defect> — `(file:line)`
- **Impact on testing:** <which scenarios it obstructs and the spurious result it forces>
- **Remediation (human Setup prerequisite):** <exact human action before the run>
- **Blocks:** <scenario IDs carrying `**Blocked-by:** BLK-01`>

## Coverage Matrix   (required only when the Changes Summary names ≥2 status/behavior classes)

<One row per intended behavior / status from the spec (drafted in authoring Step 1.5,
dispositioned in Step 6.7). Omit on single-behavior diffs. Exactly one disposition per row;
`blocked-by` (lowercase) is the disposition keyword — distinct from the `**Blocked-by:**`
scenario tag.>

| Behavior / status | Expected (per contract) | Disposition | Pointer |
|---|---|---|---|
| 200 happy path | 200 + `%PDF` | covered  /  blocked-by  /  out-of-scope | scenario ID, BLK ID, or harness-property reason |
```

- [ ] **Step 2: Add the Blocker rules + the `**Blocked-by:**` tag** after `## Dependency annotations (opt-in)` (ends ~line 274):

```markdown
---

## Blockers & the `**Blocked-by:**` tag

`## Blockers / Findings` records code defects that obstruct testing. Hard rules:

- **A discovered defect NEVER drops, weakens, or rescopes a scenario.** Write the scenario for
  the *intended* behavior with the contract's expected result, and tag it `**Blocked-by:** BLK-NN`
  beneath the heading. Do NOT move it to `## Out of harness scope`.
- **Never encode a defect as an expected result.** If current code returns X because of a bug but
  the contract says Y, `**Expected response:**` is Y; the scenario is `**Blocked-by:**` the BLK
  that produces X. A plan whose expectation matches the *bug* is itself defective.
- **Remediation is a human Setup prerequisite, not a runner step.** The runner cannot edit source;
  reverting a defect is surfaced in `## Setup` exactly like "bring the stack up", never as a scenario.
- **Spelling:** `**Blocked-by:** BLK-NN` is the scenario tag (capital B, inert prose — like
  `**Depends-on:**` in placement, but NOT parsed). `blocked-by` (lowercase) is the Coverage-Matrix
  disposition keyword. Both reference a `BLK-NN` id.
```

- [ ] **Step 3: Extend the Plan Quality Checklist** (after line 289):

```markdown
- [ ] `## Blockers / Findings` is present (`None found.` if none); any test-obstructing defect is recorded there (not buried in `## Out of harness scope`), and each blocked scenario keeps its contract-correct expectation + a `**Blocked-by:**` tag
- [ ] If the Changes Summary names ≥2 statuses, `## Coverage Matrix` has one row per status, each with exactly one disposition (`covered` / `blocked-by` / `out-of-scope` + harness-property reason)
```

### Task 1.2: `qa-plan-authoring` — flow edits (the spine)

**Files:** Modify `src/skills/qa/qa-plan-authoring/SKILL.md`

- [ ] **Step 1: Insert Step 1.5 — pin the intended contract before observing runtime.** After Step 1 (ends line 72), before Step 2:

```markdown
## Step 1.5: Pin the intended contract (before observing runtime behavior)

From the SPEC sources only — PR/issue text, docstrings, the changed code's *declared* error
types and route decorators (`raise XError`, `@router`, `@limiter.limit(...)`), linked design docs —
list the intended behaviors with the status each *should* return by design. Enumerate the success
path AND every declared error path. Derive expectations from what the code is *trying* to express,
NOT from what a live call currently returns.

If the surface has ≥2 status/behavior classes, draft the `## Coverage Matrix` skeleton
(`test-plan-format`) now — rows + the contract status, disposition column blank. **Commit to these
rows.** When observed code or runtime later *contradicts* a row (e.g. a debug delay forces every
call to 504, or a commented-out guard makes a 402 path return 200), that is a **delta to log as a
Blocker (Step 3.5)** — never a reason to delete or rewrite the row. The contract is the spec; the
runtime is the system under test; QA tests the system *against* the spec. (Scale to surface:
a one-behavior change needs no matrix.)
```

- [ ] **Step 2: Insert Step 3.5 — mandatory blocker scan.** After Step 3 (ends line 84), before Step 4:

```markdown
## Step 3.5: Scan for blockers and emit `## Blockers / Findings`

Having read the changed code + dependencies, scan for things that make the running system unable to
honor its own contract (Step 1.5):

- **Debug / test artifacts:** unconditional delays (`asyncio.sleep`, `time.sleep`), `if True:`
  short-circuits, hardcoded returns, `# TEMPORARY`/`# TODO`/`# DEBUG`/`# HACK`/`# FIXME`/`# XXX` markers.
- **Disabled / commented-out guards:** a commented-out auth/entitlement/ownership check (even with NO
  marker word) is a blocker — it makes the gated status (401/402/403) unobservable. Markerless defects
  are the easiest to miss and the most dangerous.
- **Contract contradictions:** any code path whose observable effect contradicts a Step-1.5 row.
- **Shippability hazards:** a scenario/ticket ID baked into a source comment (identifier policy),
  a leaked secret, a disabled auth check.

Emit `## Blockers / Findings` (after `## Changes Summary`). **Mandatory — if none, write `None found.`**
A reversible blocker becomes a human Setup prerequisite + a `**Blocked-by:** BLK-NN` tag on the affected
scenarios, which stay in the plan in contract-correct form. **Never scope a contract row out merely
because a blocker prevents observing it.** Ask: *"does any path's current behavior contradict what the
docstring / declared errors promise?"* — that contradiction is a blocker, marker or no marker.
```

- [ ] **Step 3: Close the transitive-punt hole in Step 6.6.** Insert before the "in scope by default, never punt them" list (before line 202, after "Punting without that reason is a defect, not honesty."):

```markdown
**The reason must be a property of the HARNESS, not of the code under test.** A valid out-of-scope
reason is "no HTTP/DB/Playwright surface can observe this" or "requires stopping a process the harness
cannot stop". A reason that is itself **a code defect, leftover test instrumentation, or a fixable
config** is NOT a valid punt — it is a **Blocker** (Step 3.5): write the contract scenario, tag it
`**Blocked-by:**`, record remediation as a human Setup prerequisite. *"The current build always returns
504 / the worker has a sleep / a guard is commented out / a debug flag is on" describes a defect —
reclassify, do not punt.* **"The runner is sequential" is rejected for 429** — exhaust the limiter over
the FAST path (fire 11× the cheap 402/404 request; error responses still count toward the slowapi
bucket). (409 contention is already covered by the "background the first curl" guidance in the
in-scope-by-default list below — a defect is never its punt reason either.)
```

  And extend the closing "Genuinely out of scope" paragraph (lines 215–217) with: `everything unreachable only *because of a defect* goes to `## Blockers / Findings`, not here.`

- [ ] **Step 4: Replace Step 6.7 with the forced (decidable) coverage matrix.** Replace the current Step 6.7 body (lines 219–231):

```markdown
## Step 6.7: Self-check before finishing — complete the coverage matrix

The Coverage Matrix is the *emitted form* of the Step 6.6 reachability sweep — do the litmus once,
record its verdict per row. When the surface has ≥2 status/behavior classes, complete the
`## Coverage Matrix` drafted in Step 1.5: **every status named in your own `## Changes Summary` is a
row** (this is the decidable anchor — row set == the statuses you declared), each with exactly one
disposition:

1. `covered` → cite the scenario ID AND a `(file:line)` for the asserted status.
2. `blocked-by: BLK-NN` → reference an existing `## Blockers / Findings` entry AND keep the
   contract-correct scenario (tagged `**Blocked-by:**`).
3. `out-of-scope: <reason>` → a **harness-property** reason (Step 6.6). An `out-of-scope` whose
   reason is a code defect is INVALID — it must be `blocked-by`.

Also confirm: every behavioral assertion carries `(file:line)` OR `(unverified — confirm at run time)`;
no `**Expected response:**` equals a value produced only by a recorded Blocker; the filename carries the
`-test-plan` suffix (Step 7). A Changes-Summary status with no row, or an invalid disposition, is a
defect — fix before saving. (Veles hard-stops on this matrix before emitting its result JSON — see
`veles.md`.)
```

- [ ] **Step 5: Fold the expectations-from-contract rule into the Step 6.8 refute pass** (review finding R3 — the rule was stated 3× in v1; keep it at the forward anchor 1.5 and the catch point 6.8). Append to the high-risk class list (after line 243, the "derived values" bullet):

```markdown
- **contract-vs-runtime (expectations follow the spec, not incidental runtime).** For every
  `**Expected response:**`, ask *"is this the contract, or just what the current (possibly defective)
  build returns?"* Decision table:

  | You read / observe | Contract? | Expected you write | Disposition |
  |---|---|---|---|
  | Code maps `TimeoutException → 504`, spec wants 504 | yes | 504 `(file:line)` | covered |
  | A leftover `sleep(65)` / disabled guard forces a status the spec doesn't want | NO — a defect | the spec'd status | `blocked-by: BLK-NN`, not out-of-scope |
  | Behavior genuinely unobservable over HTTP/DB/Playwright (DB-down → 503) | n/a | the spec'd result | `out-of-scope` + harness reason |

  If any expectation matches a value produced only by a recorded Blocker, rewrite it to the contract
  value and add `**Blocked-by:**`. One contradiction silently encoded as an expectation fails the plan.
```

  (Step 5.5 from v1 is intentionally NOT added as a standalone step — this bullet + Step 1.5 carry the rule.)

### Task 1.3: `veles.md` — EXTEND (do not replace) the hard-stop

**Files:** Modify `src/modules/plan/veles.md`

> **Blocker fix (review R1/R4):** v1 replaced lines 35–45 wholesale, deleting three strings the tests assert (`"Wrong-but-confident is worse than honestly-unverified"`, `"read-then-cite beats"`, `"targeted refute pass"`) and dropping load-bearing guidance. Replace ONLY the checklist sentence (lines 34–39); KEEP lines 40–44 (the wrong-but-confident / read-then-cite / quality-first paragraph) and 46–51 (momus seam) verbatim.

- [ ] **Step 1:** Replace ONLY the sentence currently at lines 34–39 — `"You may NOT emit the result JSON until the authoring skill's Step 6.7 self-check and Step 6.8 targeted refute pass pass: … re-read with intent to refute and corrected."` — with the artifact-keyed list below. **Keep the word "targeted refute pass"** (preserves the test assertion) and **do not touch the following paragraph** (lines 40–44):

```markdown
You may NOT emit the result JSON until the authoring skill's Step 6.7 self-check and Step 6.8
targeted refute pass both pass. Concretely, ALL must hold:

- every behavioral assertion carries a visible `(file:line)` citation or an
  `(unverified — confirm at run time)` tag;
- `## Blockers / Findings` is present — `None found.` or one-or-more `BLK-NN` entries, each with a
  `(file:line)`, an impact line, and a human-Setup remediation;
- when your `## Changes Summary` names ≥2 statuses, the `## Coverage Matrix` has one row per such
  status, each with exactly one disposition — `covered` (+ scenario ID + `(file:line)`), `blocked-by`
  (matching a BLK entry, with a kept contract-correct scenario), or `out-of-scope` (+ harness-property
  reason). A named status with no row, or an `out-of-scope` whose reason is a code defect, is a
  hard-stop failure;
- no `**Expected response:**` encodes a value the code produces only because of a recorded Blocker;
- the high-risk assertions (auth/authz status, rate-limit semantics, error-to-status mapping, framework
  defaults, derived values, **contract-vs-runtime**) have been re-read with intent to refute and corrected.

**A discovered defect never shrinks coverage.** If reading the code surfaces a bug that makes a behavior
unobservable on the current build, that is a Blocker — not a reason to drop the scenario or anchor the
expectation to the bug. Reverting the defect is a human Setup prerequisite, never a runner step.
```

  Verify after editing: `grep -c "targeted refute pass" src/modules/plan/veles.md` ≥ 1, and `grep "Wrong-but-confident"` still present.

### Task 1.4: Build, dist sync, tests

**Files:** Modify `tests/skills/qa-plan-authoring.test.ts`, `tests/modules/plan/veles-prompt.test.ts`; add a `parseBindings` regression test; regenerate committed `dist/`.

- [ ] **Step 1: Test-literals-from-prose rule (review R3/R4 — de-fragilize).** Do NOT type assertions from memory or assert heading casing. After writing the Task-1.2/1.3 prose, derive each literal by copy-pasting a short, stable **lowercase content phrase** out of the final inserted text. Suggested stable phrases (confirm they exist verbatim after you write the prose): `none found.`, `blocked-by`, `property of the HARNESS`, `pin the intended contract`, `contract-vs-runtime`, `A discovered defect never shrinks coverage`.

- [ ] **Step 2: Add assertions to `tests/skills/qa-plan-authoring.test.ts`:**

```ts
  it("Step 1.5 pins the contract before observing runtime", () => {
    expect(md).toContain("Pin the intended contract")
  })
  it("Step 3.5 forces an emitted Blockers section incl. markerless guards", () => {
    expect(md).toContain("None found.")
    expect(md).toContain("commented-out")
  })
  it("Step 6.6 closes the transitive-punt hole", () => {
    expect(md).toContain("property of the HARNESS, not of the code")
  })
  it("Step 6.7 requires the completed coverage matrix", () => {
    expect(md).toContain("complete the coverage matrix")
  })
  it("Step 6.8 carries the contract-vs-runtime refute check", () => {
    expect(md).toContain("contract-vs-runtime")
  })
```

- [ ] **Step 3: Add assertions to `tests/modules/plan/veles-prompt.test.ts`** (the three EXISTING assertions at lines 27/29/30 survive because Task 1.3 preserves their strings — do NOT remove them):

```ts
    expect(prompt).toContain("Blockers / Findings")
    expect(prompt).toContain("A discovered defect never shrinks coverage")
```

- [ ] **Step 4: Add a parser-inertness regression test** (new `it` in an existing `tests/modules/qa/*` binding-parser test, or a small new file). Construct a plan string containing `## Blockers / Findings` (with `### BLK-01:`), a `## Coverage Matrix` table, and a scenario with a `**Blocked-by:**` line, plus a normal `## Setup → **Bindings:**` block; assert `parseBindings`/`parse_plan` returns the expected bindings and `status: "ok"` (the new sections are inert).

- [ ] **Step 5: Rebuild + verify + test.**
  - `bun run build:root` → tsup + `copy-root-assets.mjs` copies edited `src/skills/**` + `src/modules/**` into `dist/`.
  - `bun run verify-dist` → expect no drift.
  - `bunx vitest run --config vitest.config.ts tests/skills/qa-plan-authoring.test.ts tests/modules/plan/veles-prompt.test.ts tests/commands/create-qa-plan-thin.test.ts <new parser test>` → all green. (The `create-qa-plan-thin` test should still pass — the command loads the same skill and now also emits the Blockers/Matrix sections as guidance; this is intended, no command edit needed.)
  - `bun run check` (typecheck + full test + build) before considering Phase 1 done.

### Task 1.5: RUNG 1 — re-run both goldens + decision gate

**Files:** `docs/eval/playbook.md` (regression-guard ritual line)

- [ ] **Step 1: Add the regression-guard ritual** to the playbook's Veles section:

```markdown
- **Deviance-normalization tripwire.** Before merging ANY change to `src/modules/plan/veles.md` or
  `src/skills/qa/qa-plan-authoring/SKILL.md`, run BOTH `qa-plan-defect-grounding.md` and
  `qa-plan-defect-grounding-markerless.md` at ≥3 iters on the configured Veles model. A non-PASS (or
  `unreliable`) on either blocks the merge.
```

- [ ] **Step 2: Re-run both goldens** against fixed Veles, ≥3 iters, same model(s) as RUNG 0; grade worst-of-N.

- [ ] **Step 3: Decision gate.**
  - **Both goldens PASS at N/N** (GATE 1+2+3 every iter, ≤2 reason-bearing punts, strengths intact, NOT `unreliable`) → **STOP. Phase 1 is the fix; DO NOT build Phase 2.**
  - **Either golden < N/N, `unreliable`, or still normalizes** → proceed to Phase 2. Note *which* shape failed: if only the markerless golden fails, Phase-2 Check A (regex) won't help it — the failure points to a prose/flow gap, not a hook gap, so loop on Phase 1 first; build the hook only for the marker shape it can actually catch.

**Exit criterion (Phase 1):** skills + prompt edited, dist in sync, `bun run check` green, ritual line added, both goldens re-run and recorded. The gate decides whether Phase 2 runs.

---

## RESULT — RUNG 1 + Layer 2 (2026-06-03): Phase 1 is the fix; Phase 2 NOT built

**RUNG 1 (synthetic goldens, fixed Veles, 3 iters each):** golden #1 (marker) **3/3 PASS**, golden #2 (markerless) **3/3 PASS** on GATE 1+2+3. The decisive result is golden #2 passing: a regex hook (Phase-2 Check A) *cannot* detect a commented-out guard with no marker word, so the markerless PASS proves the **prose generalized** beyond what the deterministic tier could ever catch → Task 1.5 STOP condition met.

**Layer 2 (real i-need-cv export-PDF branch, fixed Veles, throwaway worktree):** one clean plan graded against the two saved reference plans (v1 old-Veles, v2 marketplace):
- **GATE 1/2/3 all PASS.** `BLK-01` flags the real `await asyncio.sleep(65)` at the exact `(pdf-worker/src/pdf_worker/api/routes.py:64)`, quotes the `TEMPORARY` comment, prescribes revert as a **human Setup prerequisite** (not a runner step). Happy path (BE-07) + 502 (BE-08) kept as scenarios tagged `**Blocked-by:** BLK-01` — coverage not shrunk; 504 expected only on its own scenario.
- **Read-grounding verified against source:** auth 401 + `Invalid or expired token` message verbatim (`auth.py`), `Ł→l` transliteration (`filename.py`), and the real `503 SERVICE_UNAVAILABLE` handler (`error_handler.py:143`) — all confirmed by direct read. No fabricated citations.
- **Closed the exact loss:** v1 had normalized (504-as-contract, happy path dropped to out-of-scope) **and** transitive-punted 429/409 ("each request takes ~60s" / "no backgrounding primitive" — reasons that *are* the defect). Fixed Veles independently found the 429 fast-path (404 route, no worker call) and the 409 backgrounded-curl recipe, and added an explicit **Coverage Matrix** (status→disposition). It **out-covers marketplace v2** on the Coverage Matrix and on catching the real 503 path (v2 omitted 503). Marketplace still leads only on **DB-Check depth** (richer per-scenario SQL) — a coverage-richness gap, not a judgment failure, tracked as a separate, smaller follow-up.

**Decision:** **Phase 2 is YAGNI and was NOT built.** The failure class (normalization + transitive punt) is fixed by Phase 1 prose/flow on the current model, validated on both a markerless synthetic golden and the real repo. The committed golden tripwire (`docs/eval/scenarios/veles/qa-plan-defect-grounding*.md`) guards regressions more cheaply than a deterministic hook, and the generalization a regex could never achieve (markerless + real-repo read-grounding) is exactly what passed. Revisit Phase 2 only on a model-drift regression of the *marker* shape that prose+golden cannot hold.

---

## Phase 2 — Deterministic plan-linter (CONDITIONAL — NOT BUILT; see RESULT above)

> **STATUS: NOT BUILT (2026-06-03).** Task 1.5 routed to STOP — both goldens passed N/N and Layer-2 confirmed on the real repo. This section is retained as the design of record should a future marker-shape model-drift regression demand the deterministic tier. Build ONLY if a future RUNG re-routes here.
>
> Check A (regex defect-detection) is the **likely floor** for the *marker* shape; it cannot catch the *markerless* shape (golden #2) — so if golden #2 is the failure, fix prose/flow, not the hook. Enforcement is split by decidability: decidable structural checks may near-hard-block; heuristic checks are warning-surface only.

### Task 2.1: `plan-linter.ts`

**Files:** Create `src/modules/qa/plan-linter.ts`; test `tests/modules/qa/plan-linter.test.ts`.

- [ ] **Step 1: Failing test first**, using the two REAL i-need-cv plans as fixtures (Veles plan must FAIL Check A citing `routes.py`; marketplace plan must PASS — its "⚠️ BLOCKER … must NOT ship" satisfies the defect-flag predicate; clean diff → `{status:"ok"}`; no violation carries `severity:"blocker"` under shipped config).
- [ ] **Step 2: Implement `lintPlan`** (pure, dependency-free, `recipe-validator.ts` conventions, byte cap on inputs):

```ts
export type Severity = "blocker" | "warning"
export interface PlanViolation { code: "BLOCKER_NOT_DECLARED" | "COVERAGE_STATUS_MISSING" | "BUG_AS_CONTRACT"; severity: Severity; message: string; evidence: string }
export interface LintPlanInput { planText: string; diffText: string }
export type LintPlanResult = { status: "ok" } | { status: "violations"; violations: PlanViolation[] }
export function lintPlan(input: LintPlanInput): LintPlanResult
```

  **Check A — `BLOCKER_NOT_DECLARED` (decidable):** scan diff *added* lines for `\b(TEMPORARY|HACK|FIXME|XXX|DEBUG)\b`, `\b(asyncio\.sleep|time\.sleep|sleep)\s*\(\s*\d`, `(#|//).*\b(BE|FE|QA)-\d+\b`; if a marker exists AND the plan references that file in a scope-reduction context but has no defect-flag vocabulary near the citation → emit. **Acknowledge the markerless limit in a code comment:** a commented-out guard with no marker word (golden #2) is NOT detectable here — that class is covered only by Phase-1 prose. Check B/C are heuristic → `warning` only; launch Check A only.

### Task 2.2: Wire `lint_plan` as a Veles-callable tool

**Files:** Modify `src/modules/qa/index.ts`, `src/modules/plan/index.ts`, `src/modules/plan/veles.md`, `src/skills/qa/qa-plan-authoring/SKILL.md`

- [ ] **Step 1: Define the tool** in the `index.ts` `tool:` block (process-wide). Handler calls `lintPlan({ plan, diff })`.
- [ ] **Step 1b (review finding R4 — REQUIRED, easy to miss): enable it for Veles.** A process-wide `tool` is only callable by an agent that opts in. Veles lives in the **plan** plugin, not the QA plugin, so add `lint_plan: true` to `config.agent[VELES_AGENT_KEY].tools` in `src/modules/plan/index.ts` (peer to `dispatch_parallel`). Do NOT edit `src/modules/plan/allowed-tools.ts` — that markdown allow-list is a no-op for plugin tools. (Consider defining the tool in the `plan` plugin or a shared module to avoid cross-plugin coupling.)
- [ ] **Step 2: Add SKILL Step 6.9** referencing `lint_plan` as the deterministic backstop to the soft 6.6/6.7/6.8.
- [ ] **Step 3: Add one clause to the `veles.md` hard-stop:** "…and you have called `lint_plan` with the saved plan + the Step-1 diff and resolved its violations."

### Task 2.3: Bounded revision loop — NO `lint` JSON field (review finding R3)

- [ ] **Step 1:** On `{status:"violations"}`, Veles does ONE targeted revision pass (re-read the cited `file:line`; add the Blocker + restore scoped-out scenarios) then re-runs `lint_plan`. If it still disagrees after one pass, it proceeds — the violation is already visible in the tool output to the operator running the eval. **Do NOT add a `lint` field to the result JSON** — the 6-key contract stays strict, matching the goldens' GATE 1. (This is the v1→v2 change that removes the GATE-1 contradiction.)

### Task 2.4: Build, test, RUNG 2

- [ ] **Step 1:** `bun run check` green; commit regenerated `dist/modules/qa/plan-linter.{js,d.ts}` + updated `dist/modules/qa/index.js` + `dist/modules/plan/index.js`.
- [ ] **Step 2: RUNG 2** — re-run BOTH goldens ≥3 iters with the hook active. Marker golden should now pass via Check A + prose; the markerless golden passes only if Phase-1 prose fixed it (Check A can't). PASS both N/N → STOP. Still failing → re-examine the per-iteration `sessionID` transcripts before any further build.

**Exit criterion (Phase 2):** `plan-linter.test.ts` green (Veles fixture fails Check A, marketplace passes, clean diff ok, no `blocker`-severity under shipped config); `lint_plan` defined AND enabled for Veles via `src/modules/plan/index.ts`; the 6-key result contract unchanged; dist committed; both goldens pass RUNG 2 (or the markerless gap is explicitly attributed to a remaining prose need, not the hook).

---

## Risks & YAGNI

- **Phase-1 self-attestation (R2).** The matrix/Blockers are self-attested in a Phase-1-only world; the goldens + Check A are the enforcement. The matrix is hardened by the decidable "one row per declared status" anchor; honesty of `None found.` for *markerless* defects rests on Step-3.5 prose + the markerless golden as the check.
- **Golden too easy (R2).** Golden #1's docstring-contract may let current Veles pass RUNG 0; Task 0.2 Step 3 has the harden-or-fall-back-to-Layer-2 escape. The markerless golden #2 is the harder bar by design.
- **Generalization (R2).** Two goldens (marker + markerless) gate Phase-1-STOP, so passing proves the *class* is addressed, not one instance.
- **Matrix bureaucracy** → conditional on ≥2 statuses; trivial diffs carry only `## Blockers: None found.`
- **Heuristic false positives (Phase 2)** → Check A near-decidable; B/C warnings; nothing hard-blocks on a heuristic.
- **Do NOT:** build a reviewer agent (no momus); add a machine-readable contract schema; wire `**Blocked-by:**` into `parse_plan`; add fields to the 6-key JSON contract (the `lint` field is cut); edit `allowed-tools.ts` for the Phase-2 tool.

## Self-review (author checklist — v2)

- **Spec coverage:** all four MoA proposer themes + all spec-review findings map to tasks. ✓
- **Blocker resolved:** Task 1.3 now extends (not replaces) the hard-stop, preserving the three test-asserted strings + "targeted refute pass"; Task 1.4 Step 3 explicitly keeps the existing assertions. ✓
- **Decidability:** GATE 3 reduced to three string checks; the matrix anchored to "one row per declared status". ✓
- **Contradiction removed:** the `lint` JSON field is cut; GATE 1 stays "exactly 6 keys". ✓
- **Generalization:** second markerless golden added; Phase-1-STOP gates on both. ✓
- **Phase-2 wiring:** Task 2.2 Step 1b enables the tool for Veles in `src/modules/plan/index.ts` (not `allowed-tools.ts`). ✓
- **Leanness:** Coverage Matrix conditional; v1 Step 5.5 folded into 6.8; the duplicated 409 line dropped (429 fast-path kept). ✓
- **Naming:** the `**Blocked-by:**` tag vs `blocked-by` keyword convention is stated once and used consistently. ✓
- **Consistency:** `prompt.ts` (source) vs dist `prompt.js`; `.gitignore` anchor is the export-pdf-regression line (≈ line 35). ✓
- **Open caveat for the implementer:** still write the Task-1.2/1.3 prose before deriving test literals (Task 1.4 Step 1) — the lowercase-content-phrase rule removes most casing fragility but verify each `toContain` after writing.
- **Eval honesty:** the playbook already carries gate-then-rank + verdict vocab + the binding gate; Task 0.2 Step 0 adds only the ≥3-iter/worst-of-N defect-golden note + tripwire. **Correction:** Lesson 10 DOES exist ("match scenario difficulty to the model gap"), so the v1 citation was valid — the review's "no Lesson 10" finding was a false positive, caught by grounding at implementation. ✓
