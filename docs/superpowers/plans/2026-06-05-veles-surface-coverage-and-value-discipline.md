# Veles Surface-Coverage & Derived-Value Discipline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add R-A (a surface-coverage decidable hard-stop anchor), R-B (function-derived-value assertion discipline), and R-C (a findings re-scan loop-back) to the Veles QA-plan authoring stack — all as surgical edits to existing skill sections — per the approved spec `docs/superpowers/specs/2026-06-05-veles-surface-coverage-and-value-discipline-design.md`.

**Architecture:** Three "riders" extend existing homes only. R-A adds a *second* decidable anchor in `qa-plan-authoring` Step 6.7 keyed on **surfaces named in the plan's own `## Changes Summary`** (same self-referential closure as the existing status anchor, fired only under the existing ≥2-class matrix condition), echoed in `test-plan-format`'s Coverage-Matrix + checklist and as a `veles.md` hard-stop bullet, plus an out-of-scope-surface refute class in Step 6.8. R-B adds a function-derived-value rule to `test-plan-format`'s grounding-tags and sharpens Step 6.8's derived-values refute class. R-C adds a re-scan loop-back to Step 6.7. Every `src/skills/**` and `src/modules/plan/veles.md` edit is mirrored byte-for-byte into git-tracked `dist/` via `bun run build:root`.

**Tech Stack:** Markdown skill/prompt prose; TypeScript (Bun + tsup build); Vitest. Tests are `toContain` string-presence assertions over the skill markdown (read from `src/`) and the assembled Veles prompt (`buildVelesPrompt()`, which reads `src/modules/plan/veles.md` at runtime).

---

## CRITICAL conventions for every task

- **Commits are hook-gated.** A pre-commit hook blocks plain `git commit`. Every commit command below is prefixed with `AV_COMMIT_SKILL=1`.
- **Run tests with `npx vitest run <path>`** — NOT `bun run test --`.
- **`bun run check`** = `typecheck && test && build`. The `build` step regenerates `dist/`. Run `bun run build:root` explicitly to regenerate the dist mirror, then commit `src` + `tests` + `dist` together so the byte-for-byte mirror stays in sync (the separate `verify-dist` / CI check fails on uncommitted dist drift by design).
- **No new harness agent** (momus stays *reserved*). **No new tag** (reuse `(unverified — confirm at run time)` and `(exact text — brittle)`). **Do NOT restate already-shipped prose** — R-A adds a *decidable* anchor distinct from Step 6.6's soft sweep; R-C re-runs the *existing* Step 3.5 scan and adds no new hazard taxonomy.
- **NO push. NO co-author attribution** of any kind in commit messages.
- **n=3 no overclaim:** the eval re-run (Task 5) is one corroborating data point with *structural* success criteria, never a statistical quality claim.

---

## File Structure

| File | Responsibility | Touched by |
|---|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | Authoring gate (Step 6.7 anchors, Step 6.8 refute classes) | R-A, R-B, R-C |
| `src/skills/qa/test-plan-format/SKILL.md` | Format contract (Coverage-Matrix desc, checklist, grounding-tags) | R-A, R-B |
| `src/modules/plan/veles.md` | Veles hard-stop list (compiled into the prompt) | R-A |
| `dist/skills/qa/qa-plan-authoring/SKILL.md`, `dist/skills/qa/test-plan-format/SKILL.md`, `dist/modules/plan/veles.md` | Byte-for-byte mirror (regenerated, never hand-edited) | all |
| `tests/skills/qa-plan-authoring.test.ts` | Asserts qa-plan-authoring prose (reads `src`) | R-A, R-B, R-C |
| `tests/skills/test-plan-format.test.ts` | Asserts test-plan-format prose (reads `src`) | R-A, R-B |
| `tests/modules/plan/veles-prompt.test.ts` | Asserts the assembled Veles prompt | R-A |

---

## Task 1: R-A — surface-coverage decidable anchor

Adds the second decidable anchor (surfaces named in Changes Summary) across all three homes, scoped to the existing ≥2-class matrix condition.

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (Step 6.7)
- Modify: `src/skills/qa/test-plan-format/SKILL.md` (Coverage-Matrix description + final Plan-Quality-Checklist item)
- Modify: `src/modules/plan/veles.md` (hard-stop Coverage-Matrix bullet)
- Test: `tests/skills/qa-plan-authoring.test.ts`, `tests/skills/test-plan-format.test.ts`, `tests/modules/plan/veles-prompt.test.ts`
- Regenerate: the three `dist/` mirrors

- [ ] **Step 1: Write the failing tests**

In `tests/skills/qa-plan-authoring.test.ts`, add inside the `describe("qa-plan-authoring skill", …)` block (after the existing `branch-governing citation` test):

```ts
  it("Step 6.7 carries the surface-coverage anchor (R-A, self-referential)", () => {
    expect(md).toContain("every external surface named in your own")
    expect(md).toContain("row set == the surfaces you declared")
  })
```

In `tests/skills/test-plan-format.test.ts`, add inside the `describe("test-plan-format skill", …)` block:

```ts
  it("Coverage Matrix and checklist require a row per changed external surface (R-A)", () => {
    expect(md).toContain("per changed external surface named in the Changes Summary")
    expect(md).toContain("one row per status and per changed external surface")
  })
```

In `tests/modules/plan/veles-prompt.test.ts`, add a new assertion inside the `it("pins the load-bearing planner directives", …)` block (after the `never the oracle` line):

```ts
    // R-A (2026-06-05): surface-coverage anchor, scoped to the ≥2-status matrix condition.
    // Two contiguous substrings (the wrapped bullet can't be matched as one span):
    // the surface phrase proves the edit; the opener proves it lives in the ≥2-status bullet.
    expect(prompt).toContain("per changed external surface named in the Changes Summary")
    expect(prompt).toContain('names ≥2 statuses, the `## Coverage Matrix` has one row per such')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run tests/skills/qa-plan-authoring.test.ts tests/skills/test-plan-format.test.ts tests/modules/plan/veles-prompt.test.ts
```
Expected: 3 new tests FAIL (strings not yet present); all pre-existing tests pass.

- [ ] **Step 3: Edit `qa-plan-authoring` Step 6.7 (add the surface anchor)**

In `src/skills/qa/qa-plan-authoring/SKILL.md`, find this sentence in Step 6.7:

```
record its verdict per row. When the surface has ≥2 status/behavior classes, complete the
`## Coverage Matrix` drafted in Step 1.5: **every status named in your own `## Changes Summary` is a
row** (this is the decidable anchor — row set == the statuses you declared), each with exactly one
disposition:
```

Replace it with (adds the surface anchor sentence, same conditional block → inherits ≥2-class scoping):

```
record its verdict per row. When the surface has ≥2 status/behavior classes, complete the
`## Coverage Matrix` drafted in Step 1.5: **every status named in your own `## Changes Summary` is a
row** (this is the decidable anchor — row set == the statuses you declared).
**And every external surface named in your own `## Changes Summary` is also a row** —
same self-referential closure: row set == the surfaces you declared. The Step 6.6 behavior-class sweep
finds the classes; this anchor only checks each named surface owns a disposition — a new/changed HTTP
route, CLI/dev script, worker-or-public API contract, or DB-observable schema (an internal collaborator
such as an error mapper, use-case, port, lock, or adapter is exercised *through* a surface, not its own
row). Each row has exactly one
disposition:
```

- [ ] **Step 4: Edit `qa-plan-authoring` Step 6.7 (surface-aware defect sentence)**

In the same Step 6.7, find:

```
at run time)` tag; no `**Expected response:**` equals a value produced only by a recorded Blocker
(recorded in Step 3.5 — see Step 6.8); the filename carries the `-test-plan` suffix (Step 7). A
Changes-Summary status with no row, or an invalid disposition, is a defect — fix before saving.
```

Replace the final sentence so surfaces are covered too:

```
at run time)` tag; no `**Expected response:**` equals a value produced only by a recorded Blocker
(recorded in Step 3.5 — see Step 6.8); the filename carries the `-test-plan` suffix (Step 7). A
Changes-Summary status OR named surface with no row, or an invalid disposition, is a defect — fix
before saving.
```

- [ ] **Step 5: Edit `test-plan-format` Coverage-Matrix description**

In `src/skills/qa/test-plan-format/SKILL.md`, find:

```
<One row per intended behavior / status from the spec (drafted in authoring Step 1.5,
dispositioned in Step 6.7). Omit on single-behavior diffs. Exactly one disposition per row;
```

Replace with:

```
<One row per intended behavior / status from the spec, and per changed external surface named in the Changes Summary (drafted in authoring Step 1.5,
dispositioned in Step 6.7). Omit on single-behavior diffs. Exactly one disposition per row;
```

- [ ] **Step 6: Edit `test-plan-format` final Plan-Quality-Checklist item**

In the same file, find the last checklist item:

```
- [ ] If the Changes Summary names ≥2 statuses, `## Coverage Matrix` has one row per status, each with exactly one disposition (`covered` / `blocked-by` / `out-of-scope` + harness-property reason)
```

Replace with:

```
- [ ] If the Changes Summary names ≥2 statuses, `## Coverage Matrix` has one row per status and per changed external surface, each with exactly one disposition (`covered` / `blocked-by` / `out-of-scope` + harness-property reason)
```

- [ ] **Step 7: Edit `veles.md` hard-stop Coverage-Matrix bullet**

In `src/modules/plan/veles.md`, find:

```
- when your `## Changes Summary` names ≥2 statuses, the `## Coverage Matrix` has one row per such
  status, each with exactly one disposition — `covered` (+ scenario ID + `(file:line)`),
  `blocked-by` (matching a BLK entry, with a kept contract-correct scenario), or `out-of-scope`
  (+ harness-property reason). A named status with no row, or an `out-of-scope` whose reason is a
  code defect, is a hard-stop failure;
```

Replace with (adds surfaces in the same ≥2-status-scoped bullet):

```
- when your `## Changes Summary` names ≥2 statuses, the `## Coverage Matrix` has one row per such
  status and per changed external surface named in the Changes Summary, each with exactly one
  disposition — `covered` (+ scenario ID + `(file:line)`), `blocked-by` (matching a BLK entry, with
  a kept contract-correct scenario), or `out-of-scope` (+ harness-property reason). A named status
  or surface with no row, or an `out-of-scope` whose reason is a code defect, is a hard-stop failure;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
npx vitest run tests/skills/qa-plan-authoring.test.ts tests/skills/test-plan-format.test.ts tests/modules/plan/veles-prompt.test.ts
```
Expected: all tests PASS (including the 3 new ones).

- [ ] **Step 9: Regenerate the dist mirror and run the full check**

Run:
```bash
bun run build:root
bun run check
```
Expected: `bun run check` green (typecheck + full test suite + build). The three `dist/` mirrors now match `src`.

- [ ] **Step 10: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md src/skills/qa/test-plan-format/SKILL.md src/modules/plan/veles.md dist/skills/qa/qa-plan-authoring/SKILL.md dist/skills/qa/test-plan-format/SKILL.md dist/modules/plan/veles.md tests/skills/qa-plan-authoring.test.ts tests/skills/test-plan-format.test.ts tests/modules/plan/veles-prompt.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): add surface-coverage decidable anchor (R-A)"
```

---

## Task 2: R-A — out-of-scope-surface refute class (close the satisfice loophole)

The hard-stop enforces *accounting*; this makes an `out-of-scope` *surface* reason a Step 6.8 refute class so accounting is *honest*.

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (Step 6.8 refute-class list)
- Test: `tests/skills/qa-plan-authoring.test.ts`
- Regenerate: `dist/skills/qa/qa-plan-authoring/SKILL.md`

- [ ] **Step 1: Write the failing test**

In `tests/skills/qa-plan-authoring.test.ts`, add:

```ts
  it("Step 6.8 treats an out-of-scope surface reason as a refute class (R-A)", () => {
    expect(md).toContain("out-of-scope surface dispositions")
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: the new test FAILS.

- [ ] **Step 3: Edit `qa-plan-authoring` Step 6.8 (add the refute class)**

In `src/skills/qa/qa-plan-authoring/SKILL.md` Step 6.8, find the existing refute-class bullet:

```
- **reflected-input safety and no-oracle responses** — a user-derived value that lands in a header/body must
  be sanitized; a not-found-vs-forbidden pair must not leak existence. Re-read the producing code and the
  ownership-check ordering with intent to refute.
```

Insert a new bullet immediately AFTER it:

```
- **out-of-scope surface dispositions** — an `out-of-scope` reason for a changed surface (the Step 6.7
  surface anchor) is high-risk: re-read it to confirm the reason is a property of the HARNESS (no
  HTTP/DB/Playwright surface can observe it; the runner cannot run the required tool), not a code
  defect or a reachable surface rationalized away. A defect is `blocked-by`; a reachable surface is
  `covered`. Only a true harness limit survives.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate dist and run the full check**

Run:
```bash
bun run build:root
bun run check
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md dist/skills/qa/qa-plan-authoring/SKILL.md tests/skills/qa-plan-authoring.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): treat out-of-scope surface reason as a refute class (R-A)"
```

---

## Task 3: R-B — derived-value assertion discipline

A function-derived-value rule in the grounding-tags section + a one-clause sharpening of Step 6.8's derived-values refute class.

**Files:**
- Modify: `src/skills/qa/test-plan-format/SKILL.md` ("Grounding tags & assertion style")
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (Step 6.8 derived-values bullet)
- Test: `tests/skills/test-plan-format.test.ts`, `tests/skills/qa-plan-authoring.test.ts`
- Regenerate: both `dist/` mirrors

- [ ] **Step 1: Write the failing tests**

In `tests/skills/test-plan-format.test.ts`, add:

```ts
  it("grounding tags carry the function-derived-value rule (R-B)", () => {
    expect(md).toContain("Function-derived values")
    expect(md).toContain("not a hand-computed literal")
  })
```

In `tests/skills/qa-plan-authoring.test.ts`, add:

```ts
  it("Step 6.8 forbids hand-computed derived literals (R-B)", () => {
    expect(md).toContain("never assert a hand-computed encoding/hash/slug literal")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/skills/test-plan-format.test.ts tests/skills/qa-plan-authoring.test.ts`
Expected: the 2 new tests FAIL.

- [ ] **Step 3: Edit `test-plan-format` grounding-tags (add the ladder)**

In `src/skills/qa/test-plan-format/SKILL.md`, find the `(unverified — confirm at run time)` bullet that closes the citation list:

```
- **`(unverified — confirm at run time)`** — use when the author could NOT read
  the code that produces the behavior (source not on disk, foreign repo). Never
  emit a `(file:line)` you cannot back; a well-formed-but-ungrounded citation is
  worse than this tag.
```

Insert a new bullet immediately AFTER it (before the `Assertion style:` line):

```
- **Function-derived values** (percent-encoding, hashing, slugging, formatting, signing):
  assert the **generating rule + producer `(file:line)`** — e.g. *"RFC 5987 percent-encoded UTF-8
  of `<name>.pdf` via `quote(…, safe='')` (`filename.py:38`)"* — **not a hand-computed literal**.
  Show an exact derived literal only when a fixture/test pins it (cite that test); otherwise it is
  unverifiable-by-reading and carries `(unverified — confirm at run time)`. A function output is
  grounded by its *rule*, distinct from the human-message `(exact text — brittle)` rule below.
```

- [ ] **Step 4: Edit `qa-plan-authoring` Step 6.8 (sharpen the derived-values bullet)**

In `src/skills/qa/qa-plan-authoring/SKILL.md` Step 6.8, find:

```
- derived values (generated filenames, slugs),
```

Replace with:

```
- derived values (generated filenames, slugs) — never assert a hand-computed encoding/hash/slug literal;
  assert the producing rule + `(file:line)`, or cite the fixture/test that pins the exact bytes,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/skills/test-plan-format.test.ts tests/skills/qa-plan-authoring.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate dist and run the full check**

Run:
```bash
bun run build:root
bun run check
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/skills/qa/test-plan-format/SKILL.md src/skills/qa/qa-plan-authoring/SKILL.md dist/skills/qa/test-plan-format/SKILL.md dist/skills/qa/qa-plan-authoring/SKILL.md tests/skills/test-plan-format.test.ts tests/skills/qa-plan-authoring.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): derived-value assertion discipline (R-B)"
```

---

## Task 4: R-C — findings re-scan loop-back

A Step 6.7 self-check clause that re-runs the Step 3.5 hazard scan over the changed files and confirms each distinct hazard is its own entry (catches the "folding" failure mode). Appended *after* R-A's anchor.

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (Step 6.7 "Also confirm" sentence)
- Test: `tests/skills/qa-plan-authoring.test.ts`
- Regenerate: `dist/skills/qa/qa-plan-authoring/SKILL.md`

- [ ] **Step 1: Write the failing test**

In `tests/skills/qa-plan-authoring.test.ts`, add:

```ts
  it("Step 6.7 carries the findings re-scan loop-back (R-C)", () => {
    expect(md).toContain("re-scan the changed files for the Step 3.5 hazard classes")
    expect(md).toContain("not folded into another blocker")
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: the new test FAILS.

- [ ] **Step 3: Edit `qa-plan-authoring` Step 6.7 (append the re-scan loop-back)**

In `src/skills/qa/qa-plan-authoring/SKILL.md` Step 6.7, find the sentence you edited in Task 1 Step 4 (now surface-aware):

```
Changes-Summary status OR named surface with no row, or an invalid disposition, is a defect — fix
before saving.
```

Replace with (append the R-C clause):

```
Changes-Summary status OR named surface with no row, or an invalid disposition, is a defect — fix
before saving. Finally, re-scan the changed files for the Step 3.5 hazard classes (debug/test
artifacts, disabled guards, an identifier-policy QA/ticket ID in a comment, a leaked secret) and
confirm each distinct hazard is its own `## Blockers / Findings` entry,
not folded into another blocker.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate dist and run the full check**

Run:
```bash
bun run build:root
bun run check
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md dist/skills/qa/qa-plan-authoring/SKILL.md tests/skills/qa-plan-authoring.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): findings re-scan loop-back (R-C)"
```

---

## Task 5: Final gate + eval re-run (manual checkpoint)

**Files:** none (verification only).

- [ ] **Step 1: Full check + dist-sync confirmation**

Run:
```bash
bun run check
git status --short
```
Expected: `bun run check` green; `git status` shows a clean tree (all src+dist+tests committed across Tasks 1–4 — no uncommitted dist drift).

- [ ] **Step 2: Confirm the dist mirror is byte-for-byte (sanity)**

Run:
```bash
diff <(git show HEAD:src/skills/qa/qa-plan-authoring/SKILL.md) <(git show HEAD:dist/skills/qa/qa-plan-authoring/SKILL.md) && echo "qa-plan-authoring in sync"
diff <(git show HEAD:src/skills/qa/test-plan-format/SKILL.md) <(git show HEAD:dist/skills/qa/test-plan-format/SKILL.md) && echo "test-plan-format in sync"
```
Expected: both report "in sync" (no diff). `veles.md` is verified indirectly by the green `veles-prompt.test.ts` in Step 1.

- [ ] **Step 3: Eval re-run (manual — surface as a checkpoint, do NOT automate)**

Re-run the export-PDF grading against the i-need-cv checkout, exactly as the prior run. **Structural** success criteria (per spec §7) — NOT a statistical quality claim:
- The surface anchor *fires*: a fresh Veles plan for that diff carries a Coverage-Matrix disposition for both the worker `/render` contract (expected `covered`) and the `grant_test_entitlement.py` surface (expected `out-of-scope` with a harness reason).
- The derived-value rule *removes* the F2 class: the `filename*` assertion is expressed as a rule (or pinned to `test_filename.py`), not a hand-computed literal.
- The Step 6.7 loop-back *catches* the QA-ID-in-comment hazard as its own emitted finding.
- **No false-stop:** a single-surface / FE-only diff still authors and emits its result JSON without the surface anchor forcing a matrix.

**Protocol:** the scratch grading report is throwaway — capture-then-delete (write under `/tmp`, never commit; reports never live in the repo). Record only the structural verdict here in the conversation.

- [ ] **Step 4: Done**

All four riders landed, dist in sync, eval verdict recorded. No push (per conventions).

---

## Notes for the implementer

- **Anchor drift:** Task 4 Step 3 edits a sentence that Task 1 Step 4 already changed — apply tasks **in order**. If you reorder, re-read the current Step 6.7 text before matching.
- **Two Step 6.8 edits:** Task 2 (out-of-scope-surface refute class) and Task 3 Step 4 (derived-values bullet) touch different bullets of the same refute-class list — no conflict, but apply in order.
- **Why each task rebuilds dist:** `verify-dist`/CI fails on any tracked-dist drift; committing src without the regenerated dist would leave the tree out of sync. Always `bun run build:root` before the commit.
- **If a `toContain` assertion is brittle** because surrounding prose was reworded during review, prefer matching the shortest stable, unique substring shown in the test snippets above (they were chosen to be edit-resilient).
