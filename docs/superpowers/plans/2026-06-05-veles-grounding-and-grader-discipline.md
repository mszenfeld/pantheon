# Grounding-grader + Veles riders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable disciplined grading protocol (the payload) plus three narrow Veles grounding riders, implementing the approved spec `docs/superpowers/specs/2026-06-05-veles-grounding-and-grader-discipline-design.md` (v2, scope (a)).

**Architecture:** Two halves under one principle ("verify against artifacts, never from memory"). Half 2 (grader) is a docs-only Claude Code protocol in `docs/eval/` — no harness agent, no dist rebuild. Half 1 (riders) is three small prose additions to already-shipped skills; most framework-grounding prose ALREADY exists and must NOT be restated. Author-side changes go through `bun run build:root` → `dist/` sync. Tests assert presence of new prose (the runner-facing behavior is prose-only).

**Tech Stack:** Markdown skills/docs; TypeScript prompt assembly (`src/modules/plan`); Vitest; Bun build (`build:root`); manual model-eval (`docs/eval/playbook.md`).

**Critical constraints (from the spec + prior phases):**
- **No momus / no new harness agent.** The grader is eval-time Claude Code prose under `docs/eval/`.
- **Do NOT restate shipped prose.** `qa-plan-authoring` Step 0 (lines 37-46) already carries the framework-default rule + the HTTPBearer 403→401 example; Step 6.8 already lists auth-status / framework-defaults / error-envelope-shape refute classes; `veles.md:56-60` already carries read-then-cite/`(unverified)`-last. Only the items below are new.
- **No new prose tag.** Fold framework-mediated uncertainty into the existing `(unverified — confirm at run time)`.
- **No correctness overclaim.** Author-side RUNG check is form/no-regression only (presence, not a grounding-correctness measurement) at n=3.
- **Tests at root:** run `npx vitest run <path>` (NOT `bun run test -- <path>`, which forwards to a sub-package and exits 1).
- **Commits:** `AV_COMMIT_SKILL=1 git add … && git commit -m "…"`. NO push. NO Co-Authored-By / AI attribution.
- **Eval scratch:** capture to `/tmp`, never commit a grading that references a private repo or absolute `i-need-cv` paths.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `docs/eval/grading-protocol.md` | The reusable disciplined grader (Half 2) | **Create** |
| `docs/eval/playbook.md` | Manual eval runbook | Modify — add a "Grading discipline" pointer |
| `src/skills/qa/qa-plan-authoring/SKILL.md` | QA-plan authoring orchestration | Modify — R1 (Step 0 test-tier), R2 (Step 6.8 claim-specific citation) |
| `src/modules/plan/veles.md` | Veles agent prompt | Modify — one-line R1 echo |
| `src/skills/qa/test-plan-format/SKILL.md` | Plan format rules | Modify — R3 (DSN credentials, sanctioned-tool note, DB-check active-predicate) |
| `tests/skills/qa-plan-authoring.test.ts` | Skill prose assertions | Modify — assert R1/R2 phrases |
| `tests/skills/test-plan-format.test.ts` | Format prose assertions | Modify — assert R3 phrases |
| `tests/modules/plan/veles-prompt.test.ts` | Prompt assembly assertions | Modify — assert R1 echo phrase |
| `dist/**` | Built artefacts | Regenerate (author side only) via `bun run build:root` |

**Substring discipline (B1, from prior phases):** every phrase asserted by a `toContain` test must sit on a **single unwrapped line** in its target file. Each inserted block below is pre-wrapped so the asserted phrase is contiguous; verify per target file, not via a whole-repo grep.

---

## Task 1: Create the disciplined grading protocol (Half 2 — the payload)

**Files:**
- Create: `docs/eval/grading-protocol.md`
- Test: none (pure operator-facing doc; its acceptance test is Task 2). A presence grep stands in for a unit test.

- [ ] **Step 1: Create `docs/eval/grading-protocol.md` with this exact content**

````markdown
# QA plan grading protocol (disciplined, reusable)

A Claude Code grading pass for QA test plans. **This is eval infrastructure, not a
Pantheon agent.** Point Claude Code at this file ("grade these plans following
docs/eval/grading-protocol.md"), give it the plan(s) under review and a checkout of
the target repo it can read.

**Vocabulary:** reuse the GATE axes and verdict words defined in
`docs/eval/playbook.md` (Step 4 + the "Evaluating side-effecting agents (Veles)"
section). Do not invent a parallel scoring scheme.

**Output hygiene:** write the grading to `/tmp`, never into the repo. Never paste a
private codebase's absolute paths into a committed file. A grading is a report — and
reports are never committed.

## Why this protocol exists

A prior ad-hoc grading pass declared a plan WRONG for asserting that a missing auth
header returns 401, claiming the framework returns 403 — **from memory**. The
installed framework actually returned 401; the grader never opened the dependency it
had the tools to read. The plan was right; the grader hallucinated. This protocol
exists so a grader cannot fault a value it did not verify, and cannot pass a
contract-bearing value it did not check.

## The three rules

1. **Verify-before-faulting.** To rule any expected value **WRONG**, you must cite
   the installed/on-disk source that contradicts it (a handler line, the installed
   dependency's source under `.venv`/`site-packages`, an alembic migration, etc.) or
   a bounded probe (see the fence). A from-memory claim about framework behavior
   ("the framework returns X") is **inadmissible** as grounds to fault. If a value is
   genuinely undecidable without running the system, mark it `needs-runtime-check` —
   but `needs-runtime-check` is **not** allowed when the deciding source is present on
   disk (installed dependencies almost always are: read them).

2. **Symmetry — verify PASS verdicts too.** A contract-bearing assertion you mark
   PASS (status **and** body/envelope shape) also needs a governing-source citation.
   Do not scrutinise only the values you fault: the most common miss is a
   false-NEGATIVE — e.g. a plan asserts a `{"error":{"code":"..."}}` envelope while
   the path actually returns the framework's `{"detail":"..."}`. A status-only test
   does not prove a body claim.

3. **External findings are hypotheses.** Treat any marketplace/external comparison
   report's claims as hypotheses to verify against source — never as a verdict to
   adopt.

## Re-read pass (mandatory, before emitting)

Re-read every **WRONG** verdict you drafted and ask: *"did I read source for this, or
did I assert from memory? Does my cited line actually contradict the plan's value, on
the branch that fires for this input?"* Downgrade any verdict that fails this to
`needs-runtime-check` or retract it.

## Execution fence

"Run it" means a **single read-only probe** — one REPL/`TestClient` call or one
`curl` against an already-running instance — to read a value off the live system.
**Never** stand up e2e infrastructure, never run a full test suite as the grading
method, never mutate state. Grading reads; it does not become an e2e run.

## Output

For each plan, independently (do not compare until both are scored):
- A per-plan **rubric score** on the GATE axes: grounding correctness · coverage ·
  executability/logistics · Blockers & Findings · contract adherence.
- A **findings list**, each finding tagged `confirmed` / `needs-runtime-check` /
  `refuted-on-verification`, each with a `(file:line)` citation for confirmed/refuted.

Only after both plans are independently scored: a short comparison and verdict.
````

- [ ] **Step 2: Verify the protocol carries its load-bearing rules**

Run: `grep -c "Verify-before-faulting\|Symmetry — verify PASS\|inadmissible\|read-only probe\|External findings are hypotheses" docs/eval/grading-protocol.md`
Expected: `5`

- [ ] **Step 3: Confirm it is docs-only (no dist rebuild needed)**

Run: `grep -n "docs" scripts/copy-root-assets.mjs || echo "docs/ not in dist pipeline — OK"`
Expected: prints the "OK" line (the asset copier walks `commands`/`agents`/`skills`/`src/modules`, not `docs/`), confirming this file needs no build.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/eval/grading-protocol.md
AV_COMMIT_SKILL=1 git commit -m "feat(eval): add disciplined QA-plan grading protocol (verify-before-faulting)"
```

---

## Task 2: Grader acceptance test against the i-need-cv Layer-2 checkout (the priority)

This proves the payload before touching Veles. It is a **manual operator step**, not a repo unit test. The target repo `i-need-cv` is on disk at `/Users/mef1st0/Projects/i-need-cv` with real source + installed FastAPI under `.venv`. The two plans live at `i-need-cv/docs/testing/plans/2026-06-04-export-pdf-endpoint-test-plan.md` (Plan A = Veles) and `…-pdf-export-endpoint-test-plan.md` (Plan B = marketplace).

**Files:** none committed. Grading output goes to `/tmp/grading-<date>.md`.

- [ ] **Step 1: Run a fresh Claude Code grading pass using the protocol**

Prompt the grader: *"Follow docs/eval/grading-protocol.md. Grade Plan A and Plan B for the export-PDF endpoint, reading source under /Users/mef1st0/Projects/i-need-cv. Write the grading to /tmp/grading-2026-06-05.md."*

- [ ] **Step 2: Assert the three pass criteria on the output**

The grading at `/tmp/grading-2026-06-05.md` MUST:
1. **NOT** fault Plan A's BE-02 401 — instead cite installed `fastapi/security/http.py` (`make_not_authenticated_error` → `HTTP_401_UNAUTHORIZED`) confirming 401.
2. **DO** flag Plan A's BE-02 **body** `{"error":{"code":"UNAUTHORIZED"}}` as wrong (real: `{"detail":"Not authenticated"}` / `{"detail":"Invalid or expired token"}`; the envelope comes from the domain `UnauthorizedError` handler, not this path).
3. **DO** flag Plan A's `QA_BIND_ENTITLEMENT_ID` DSN as not runnable (missing credentials vs `.env.example:31` `postgresql://postgres:postgres@…`).

- [ ] **Step 3: If any criterion fails, fix `grading-protocol.md` and re-run**

A failure means the protocol is not disciplined enough. Tighten the relevant rule (most likely Rule 1's `needs-runtime-check` clause or Rule 2's symmetry), re-commit Task 1, and re-run Step 1. Do not proceed to Task 3 until all three pass.

- [ ] **Step 4: Record the acceptance result (do NOT commit the grading itself)**

Note pass/fail of the three criteria in the plan's RESULT block (Task 6). Delete `/tmp/grading-2026-06-05.md` after recording.

---

## Task 3: Author riders R1 + R2 (qa-plan-authoring + veles.md echo)

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (after line 46; inside Step 6.8 list near line 312)
- Modify: `src/modules/plan/veles.md` (the "Wrong-but-confident" sentence)
- Test: `tests/skills/qa-plan-authoring.test.ts`, `tests/modules/plan/veles-prompt.test.ts`

- [ ] **Step 1: Add failing assertions to `tests/skills/qa-plan-authoring.test.ts`**

Insert before the closing `})` of the `describe` block (after line 103):

```typescript
  it("Step 0 tiers tests as corroboration, not oracle, with a confidence floor", () => {
    expect(md).toContain("they are not the oracle")
    expect(md).toContain("keeps an assertion at full confidence")
    expect(md).toContain("suspected defective test")
  })

  it("Step 6.8 requires a claim-specific, branch-governing citation", () => {
    expect(md).toContain("branch-governing citation")
  })
```

- [ ] **Step 2: Add a failing assertion to `tests/modules/plan/veles-prompt.test.ts`**

Inside the `it("pins the load-bearing planner directives", …)` block, after the existing `expect(prompt).toContain("cross-scenario interactions")` line (line 39):

```typescript
    // R1 echo (2026-06-05): tests corroborate, never the oracle
    expect(prompt).toContain("never the oracle")
```

- [ ] **Step 3: Run the tests to verify they FAIL**

Run: `npx vitest run tests/skills/qa-plan-authoring.test.ts tests/modules/plan/veles-prompt.test.ts`
Expected: FAIL — the new `toContain` assertions fail (phrases not yet in source).

- [ ] **Step 4: Add R1 to `src/skills/qa/qa-plan-authoring/SKILL.md`** — insert immediately after line 46 (the end of the framework-defaults paragraph, before `## Step 1`), as a new paragraph:

```markdown

**Tests corroborate; they are not the oracle** — a test proves *only what it
asserts*. A passing test on a **non-overridden** fixture (no `dependency_overrides`
shadowing the tested path) is admissible evidence and
**keeps an assertion at full confidence** — never downgrade what such a test
confirms. A status-only test (`assert status == 401`) does NOT ground a
body/envelope claim — cite the producing code for the body. A test that
contradicts the implementation, or runs under an overriding fixture, is a
**suspected defective test** → Blocker/Finding. Never transcribe a test as a
manual scenario; that re-runs CI and adds nothing.
```

- [ ] **Step 5: Add R2 to `src/skills/qa/qa-plan-authoring/SKILL.md`** — insert as a new bullet in the Step 6.8 high-risk list, immediately after the reflected-input bullet that ends at line 312 (`ownership-check ordering with intent to refute.`):

```markdown
- **claim-specific, branch-governing citation** — a `(file:line)` must support the
  *specific* claim (status AND body/envelope) and point at the branch that fires for
  *this* scenario's input, not merely a real line near the topic. A status-only test
  cited as grounding for a body is a refute failure.
```

- [ ] **Step 6: Add the R1 echo to `src/modules/plan/veles.md`** — append to the "Wrong-but-confident" sentence (the paragraph ending at line 58 with `…is itself a defect.`). Change:

```markdown
not first; an `(unverified)` tag on code you could have opened is itself a defect.
```
to:
```markdown
not first; an `(unverified)` tag on code you could have opened is itself a defect.
A test corroborates but is **never the oracle** — a status-only test does not ground
a body, and a test that contradicts the code is a Finding.
```

- [ ] **Step 7: Run the tests to verify they PASS**

Run: `npx vitest run tests/skills/qa-plan-authoring.test.ts tests/modules/plan/veles-prompt.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 8: Verify each asserted phrase is on a single unwrapped line (B1 discipline)**

Run: `for p in "they are not the oracle" "keeps an assertion at full confidence" "suspected defective test" "branch-governing citation"; do grep -c "$p" src/skills/qa/qa-plan-authoring/SKILL.md; done; grep -c "never the oracle" src/modules/plan/veles.md`
Expected: `1` for each (five `1`s). A `0` means the phrase wrapped across a newline — reflow the inserted block.

- [ ] **Step 9: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md src/modules/plan/veles.md tests/skills/qa-plan-authoring.test.ts tests/modules/plan/veles-prompt.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): tier tests as corroboration + require claim-specific citations (R1/R2)"
```

---

## Task 4: Author rider R3 (test-plan-format recipe/DB rules)

**Files:**
- Modify: `src/skills/qa/test-plan-format/SKILL.md` (grounding-tags DB note near line 213; recipe rules near line 180; sanctioned-tool note)
- Test: `tests/skills/test-plan-format.test.ts`

- [ ] **Step 1: Add failing assertions to `tests/skills/test-plan-format.test.ts`**

Insert before the closing `})` of the `describe` block (after line 21):

```typescript
  it("requires runnable DSN credentials and the sanctioned-tool note", () => {
    expect(md).toContain("carry the credentials the local service requires")
    expect(md).toContain("cite any repo-sanctioned seeding script")
  })

  it("requires DB-checks to assert the active predicate, not bare existence", () => {
    expect(md).toContain("asserts the active predicate")
  })
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npx vitest run tests/skills/test-plan-format.test.ts`
Expected: FAIL — new assertions fail.

- [ ] **Step 3: Add the DSN-credentials + sanctioned-tool note to `src/skills/qa/test-plan-format/SKILL.md`** — insert as new bullets in the `validateRecipe()` rules list, immediately after the file-reader-path-confinement bullet (line 180, `…are rejected.`):

```markdown
- **Runnable as written.** A DB DSN in a recipe must
  **carry the credentials the local service requires** — reference the documented
  `$DATABASE_URL` rather than a credential-less literal; a recipe that cannot
  authenticate is a defect. The recipe sandbox forbids `python`, so seed via `psql`
  and **cite any repo-sanctioned seeding script** (e.g. one named in `CLAUDE.md`)
  as the semantic reference in a comment — preferring the script itself applies only
  to human Setup prerequisites, where `uv run python` is available.
```

- [ ] **Step 4: Add the DB-check active-predicate rule to `src/skills/qa/test-plan-format/SKILL.md`** — append to the grounding-tags DB note. Change the bullet at lines 210-213 ending `…for a derived value cite the producer).` by adding a sentence:

```markdown
  the column is implicit in the SQL; for a derived value cite the producer). A
  DB-check on a time-bounded entity **asserts the active predicate** (`valid_to >
  now()`), not bare existence — a `COUNT(*)` that ignores the validity window is
  incomplete.
```

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `npx vitest run tests/skills/test-plan-format.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify each asserted phrase is on a single unwrapped line (B1)**

Run: `for p in "carry the credentials the local service requires" "cite any repo-sanctioned seeding script" "asserts the active predicate"; do grep -c "$p" src/skills/qa/test-plan-format/SKILL.md; done`
Expected: `1` for each (three `1`s).

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/skills/qa/test-plan-format/SKILL.md tests/skills/test-plan-format.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): require runnable DSNs and active-predicate DB-checks (R3)"
```

---

## Task 5: Playbook pointer, dist rebuild, and full check

**Files:**
- Modify: `docs/eval/playbook.md` (pointer to the protocol)
- Regenerate: `dist/**` (author side)

- [ ] **Step 1: Add the grading-discipline pointer to `docs/eval/playbook.md`** — insert as a new top-level section immediately before `## Evaluating side-effecting agents (Veles)` (line 337):

```markdown
## Grading discipline (applies to every scoring pass)

When grading a QA plan (Step 4, or any plan-vs-plan comparison), follow
**`docs/eval/grading-protocol.md`**: to fault an expected value as WRONG, cite
contradicting on-disk/installed source or a bounded read-only probe — a from-memory
framework claim is inadmissible (→ `needs-runtime-check`, and that is not allowed
when the source is on disk). Verify PASS verdicts too (status AND body), and treat
any external/marketplace report as hypotheses to verify, never a verdict.

```

- [ ] **Step 2: Commit the docs pointer (docs-only, no rebuild)**

```bash
AV_COMMIT_SKILL=1 git add docs/eval/playbook.md
AV_COMMIT_SKILL=1 git commit -m "docs(eval): point the playbook at the grading protocol"
```

- [ ] **Step 3: Rebuild dist (author-side skills/prompt changed)**

Run: `bun run build:root`
Expected: exits 0; `dist/skills/qa/qa-plan-authoring/SKILL.md`, `dist/skills/qa/test-plan-format/SKILL.md`, and `dist/modules/plan/veles.md` updated.

- [ ] **Step 4: Confirm dist carries the new prose**

Run: `grep -c "they are not the oracle" dist/skills/qa/qa-plan-authoring/SKILL.md; grep -c "asserts the active predicate" dist/skills/qa/test-plan-format/SKILL.md; grep -c "never the oracle" dist/modules/plan/veles.md`
Expected: `1`, `1`, `1`.

- [ ] **Step 5: Run the full check**

Run: `bun run check`
Expected: exits 0 (all root tests + packages green, lint/format/types clean, dist in sync).

- [ ] **Step 6: Commit the dist artefacts**

```bash
AV_COMMIT_SKILL=1 git add dist
AV_COMMIT_SKILL=1 git commit -m "chore(dist): sync built skills/prompt for grounding riders"
```

---

## Task 6: RUNG form/no-regression check + RESULT block

**Files:**
- Modify: `docs/superpowers/plans/2026-06-05-veles-grounding-and-grader-discipline.md` (this file — append RESULT)

This is a manual eval, worst-of-N (≥3 iters), on the existing Veles golden scenario (`docs/eval/scenarios/veles/qa-plan-defect-grounding.md` / the export-PDF regression scenario), per `docs/eval/playbook.md`. **It is a form/no-regression check, not a correctness measurement** — at n=3 it can detect gross GATE regressions and confirm the new prose surfaces, but it does NOT prove grounding correctness improved (that is efficacy-bound and deferred to momus; do not overclaim it).

- [ ] **Step 1: Run the Veles eval per the playbook (worst-of-N ≥3)**

Follow `docs/eval/playbook.md` "Evaluating side-effecting agents (Veles)". Capture transcripts/JSON to `/tmp` (never commit).

- [ ] **Step 2: Confirm no GATE regression**

Worst-of-N across iters: GATE-1 (JSON contract), GATE-2 (defect→Blocker), GATE-3 (no deviance-encoding), GATE-ORDER, GATE-DEPTH must not regress vs the Phase-1 baseline.

- [ ] **Step 3: Confirm the riders surface (presence, not correctness)**

In the authored plan(s), check that test-grounded assertions are not over-trusted (R1), citations are claim-specific (R2), and any DB-check/DSN follows R3. Record presence; do not claim a correctness delta.

- [ ] **Step 4: Append a RESULT block to this plan**

Append a `## RESULT — (2026-06-05)` section recording: the Task-2 grader acceptance verdict (the measurable win — must-not-fault-401 / must-flag-body / must-flag-DSN), the worst-of-N GATE table, and the explicit note that author-side correctness gain is unmeasured at n=3 (deferred to momus). Then commit:

```bash
AV_COMMIT_SKILL=1 git add docs/superpowers/plans/2026-06-05-veles-grounding-and-grader-discipline.md
AV_COMMIT_SKILL=1 git commit -m "docs(plan): record RUNG result for grounding-grader phase"
```

---

## Self-review (run before execution)

**1. Spec coverage:**
- §5 grader (3 rules + re-read + fence + playbook vocab + banner) → Task 1. ✔
- §7 grader acceptance test (Layer-2, 3 criteria incl. body) → Task 2. ✔
- §4 R1 (test-tier + Y2 floor) → Task 3 Steps 4/6. ✔
- §4 R2 (claim-specific citation) → Task 3 Step 5. ✔
- §4 R3 (DSN credentials, reversed sanctioned-tool note, DB active-predicate) → Task 4. ✔
- §7 mechanical (tests, build:root, check, dist) → Task 5. ✔
- §7 author validation honest/unmeasured → Task 6 (explicit no-overclaim). ✔
- Playbook pointer (§5) → Task 5 Step 1. ✔
- No new tag minted; framework-mediated folds into `(unverified)` → no task creates a tag (constraint honored). ✔
- No restated shipped prose → Task 3 inserts only the test-tier (new); the framework/HTTPBearer prose is left untouched. ✔

**2. Placeholder scan:** every code/prose step shows the literal content to insert and the exact anchor line; commands have expected output. No TBD/TODO. ✔

**3. Consistency:** asserted phrases match between the test steps and the inserted prose verbatim ("they are not the oracle", "keeps an assertion at full confidence", "suspected defective test", "branch-governing citation", "never the oracle", "carry the credentials the local service requires", "cite any repo-sanctioned seeding script", "asserts the active predicate"). dist greps in Task 5 reuse the same phrases. ✔
