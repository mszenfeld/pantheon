# Veles Surface-Coverage & Derived-Value Discipline — Design Spec

**Status:** approved (brainstorming → ready for writing-plans)
**Date:** 2026-06-05
**Branch:** `feature/veles-plan-quality`
**Goal:** Close the two *genuine prose gaps* the 2026-06-05 export-PDF grading eval surfaced between Veles (Plan A) and the marketplace `/create-qa-plan` (Plan B), and add one enforcement loop-back for an already-shipped rule Veles under-applied — all as surgical edits to existing skill sections.

---

## §0 Background — the eval that motivated this

A disciplined grading run (`/tmp/qa-plan-grading-export-pdf-2026-06-05.md`, protocol `docs/eval/grading-protocol.md`) compared two QA plans for the i-need-cv `POST /api/v1/cvs/{cv_id}/export` branch:

- **Plan A** = produced by **Veles** (`2026-06-05-export-pdf-endpoint-test-plan.md`) — frontmatter + typed `$QA_BIND_*` bindings + Coverage Matrix.
- **Plan B** = produced by the **marketplace `/create-qa-plan`** (`2026-06-05-pdf-export-endpoint-test-plan.md`) — prose preconditions + Execution Order + Quality Checklist.

The verdict was a near-tie. Each plan carried **exactly one** confirmed wrong contract value (Plan A: a garbled `filename*` percent-encoding sub-step; Plan B: the canonical 403-vs-401 framework-status trap on the primary auth path — which Veles got *right*). The deltas that separated them, and their honest classification against what the skills **already ship**:

| Eval delta | Who won | Already shipped? | Classification |
|---|---|---|---|
| Coverage of the two diff-only surfaces (`grant_test_entitlement.py`, direct worker `/render`) | B | Step 6.6 *softly* says "for each changed surface" — but the only **decidable** matrix anchor (Step 6.7) is **status-keyed** | **genuine gap** → R-A |
| Hand-computed derived literal wrong (Veles's own F2) | — (Veles lost) | Grounding-tags says "cite the producer" + "assert shape / `(exact text — brittle)`" — but nothing covers **function-computed** values, and "cite the producer" was satisfied by a wrong literal | **genuine gap** → R-B |
| QA-ID-in-source-comment finding; `valid_to == now()` boundary | B | **Yes** — Step 3.5 lists "a scenario/ticket ID baked into a source comment" as a shippability hazard; Step 6.6 lists `valid_to == now` as an in-scope boundary | **already ships, under-applied** → R-C (enforcement only, no new prose) |
| Imprecise auth citation (F3: Plan A cited `auth.py:33` for a no-header 401 that actually comes from `HTTPBearer`) | — (Veles wrong branch) | **Yes** — Step 6.8 already has a "claim-specific, branch-governing citation" refute class | **already ships, under-applied → acknowledged & parked** (see §6) |
| Typed bindings + Coverage Matrix + format conformance; correct auth contract | **A** | n/a | **Veles's moat** — the marketplace plan can't reproduce it |

**Reframe of the original premise.** None of Plan B's advantages are architectural limits Veles "cannot reproduce." Two are gate/technique gaps (R-A, R-B); the third already ships and was merely under-applied (R-C). What is genuinely *not* reproducible runs the other way: Veles's format/runnability moat, and the fact that Veles won the auth contract precisely **because** its grounding discipline made it read the installed framework version. The lever is therefore to **extend the gate along the axes it does not yet measure**, not to chase parity.

**Oracle caveat (be honest about what this rests on).** The grader's own bottom line leaned to **Plan B on merit, Plan A on form** — it scored Plan B's coverage gap against Plan A as a *substantive* defect. This spec deliberately weights Veles's runnability/format as the durable moat and treats the coverage/finding deltas as fixable gate gaps; that is a *judgment that overrides the grader's merit lean*, not a claim the moat "settles" it. And the targeting rests on **n=1 grading run** of a near-tie where each plan had exactly one wrong value — a noisy oracle on fine deltas. R-A's diagnosis (a status-keyed anchor cannot demand a surface row) holds independent of the run; R-B/R-C are pinned to one-shot observations and are framed accordingly (§2.5).

---

## §1 Scope

Three changes, in priority order:

- **R-A — surface-coverage decidable anchor** (highest leverage, lowest risk). Add a *second* hard-stop anchor beside the existing status anchor: every **external surface named in the plan's own `## Changes Summary`** gets exactly one Coverage-Matrix disposition (the same self-referential closure the status anchor uses).
- **R-B — derived-value assertion discipline** (correctness gain, not just parity). For *function-computed* values (percent-encoding, hashing, slugging, formatting, signing), assert the generating rule + producer `(file:line)`, never a hand-computed literal; show an exact literal only when a fixture/test pins it.
- **R-C — findings enforcement loop-back** (the chosen treatment for the already-shipped delta-3 — the *finding* half only; the `valid_to == now()` boundary half stays under Step 6.6 coverage, see §5). One Step 6.7 self-check clause that re-runs the Step 3.5 hazard scan over the changed files and confirms each distinct hazard has its own emitted entry.

**Approach (chosen):** *Mirror the existing anchors.* Each rider extends its natural home and copies a pattern that already ships. No new sections, no consolidated subsection, no measure-only-via-grader detour.

---

## §2 Constraints (binding)

1. **No new harness agent.** Gate/skill edits only — no momus, no coverage-reviewer agent. (`momus` remains *reserved* in `veles.md` / Step 6.8.)
2. **No new tag.** Reuse the existing `(unverified — confirm at run time)` and `(exact text — brittle)` tags; introduce none.
3. **Do not restate already-shipped prose.** Step 0 framework-defaults (qa-plan-authoring lines ~37–46), Step 6.8 refute classes, Step 3.5 shippability hazards, and Step 6.6 boundary/surface guidance already ship — **extend** their decidable enforcement, do not paraphrase the behavior. R-C in particular adds *enforcement*, never new behavior prose.
4. **Skill edits require a dist rebuild.** `src/skills/**` and `src/modules/plan/veles.md` are mirrored byte-for-byte into git-tracked `dist/` by `bun run build:root`. Unlike the docs-only grader phase, this phase **must** rebuild and pass `bun run check`.
5. **No overclaim at n=3.** Author-quality gain is unmeasured. The re-run of the export-PDF eval is **one corroborating data point, not proof.** Success criteria are **structural** (the gate exists and fires; the rule removes a class of error), never statistical.

---

## §3 R-A — surface-coverage decidable anchor

### Problem
Step 6.7's sole decidable hard-stop is *"every status named in your own `## Changes Summary` is a row."* It is **status-keyed**. A changed entry point that introduces no new *status* of the primary endpoint has no row it is obligated to fill, so it can be silently dropped. Veles named both missing surfaces in its own Changes Summary (lines 100, 104 of Plan A) yet generated no disposition for either — because no gate demanded one. The fix reuses the status anchor's **self-referential closure**: both surfaces *were* named, so a second anchor keyed on *Changes-Summary-named surfaces* catches them with no diff re-classification at gate time.

### Definition — "external surface"
A *new or changed externally-reachable entry point*:
- an HTTP route,
- a CLI / dev script,
- a worker-or-public API contract,
- a DB-observable schema change.

**Not** an internal collaborator (error mappers, use-cases, ports, locks, adapters; an internal worker task invoked only in-process) — those are exercised *through* a surface and need no row of their own. This kind-based list is **authoring guidance** — it tells Step 2 / Step 6.6 what to name in the `## Changes Summary`. The *gate* (Step 6.7, below) does not re-classify the diff; it only cross-checks that each surface the plan **named** owns a disposition. That split keeps the hard-stop decidable, avoids the wrong-granularity trap (a row per collaborator file — many files collaborate on one behavior), and bounds false-stop risk on large diffs.

### Disposition semantics — identical to the status anchor
Exactly one of:
1. `covered` → scenario ID + `(file:line)`. *(The worker `/render` X-API-Key contract lands here: it is curl-reachable, so it earns a real BE scenario.)*
2. `blocked-by: BLK-NN` → references a `## Blockers / Findings` entry; the contract-correct scenario is kept and tagged `**Blocked-by:**`.
3. `out-of-scope: <harness-property reason>` → **first-class.** *(The `grant_test_entitlement.py` surface lands here: the runner cannot execute `uv run python` (Step 4.5), so it is honestly out-of-scope — its effect is observed via the entitlement path. It is **accounted for**, never force-written as an un-runnable scenario. Note: Plan B's BE-11 runs the script as a scenario, which arguably breaches harness scope; the grader scored BE-11 as Plan B coverage, so R-A **intentionally diverges** — Step 4.5 makes `uv run python` runner-inexecutable, so out-of-scope-with-effect-observed is the doctrinally correct call, not imitation of Plan B.)*

**Anti-padding guarantee:** because `out-of-scope` (with a harness reason) is a valid disposition, R-A forces *accounting*, not *more scenarios*. Scenario count remains a non-signal (existing Step 6.6 doctrine). The harness-property-reason requirement (Step 6.6 reachability litmus) still applies: an `out-of-scope` reason that is a code defect is invalid and must be `blocked-by`.

**Accounting ≠ coverage — close the satisfice loophole.** A hard-stop on *disposition presence* can be passed by a satisficing author who marks the awkward surface `out-of-scope` with a plausible-sounding reason. So an `out-of-scope` disposition **for a surface** is itself a high-risk assertion: add it to the Step 6.8 refute-pass classes (re-read its harness-property reason with intent to refute; a reason that is really a defect or a reachable surface fails). The hard-stop enforces *accounting*; the Step 6.8 refute pass enforces that the accounting is *honest*. This is the only place R-A leans on a non-gated check, and it is named so the plan does not over-trust the gate.

### Edits (three touch-points, all existing homes)
1. **`src/skills/qa/qa-plan-authoring/SKILL.md` — Step 6.7** (~lines 288–307): add the surface anchor beside the status anchor — *"every external surface named in your own `## Changes Summary` is a row"* — with the **same self-referential, decidable closure** as the status anchor ("row set == the surfaces you declared"). Add a one-line back-reference — "the behavior-class sweep is Step 6.6; this anchor only checks each named surface owns a disposition" — so it does **not** paraphrase Step 6.6's soft sweep (no-restate). State it is a hard-stop of the same shape as the status anchor.
2. **`src/skills/qa/test-plan-format/SKILL.md`** — Coverage-Matrix description (~lines 61–70) and the final Plan-Quality-Checklist item (~line 358): "one row per status **and per changed external surface**."
3. **`src/modules/plan/veles.md`** — hard-stop bullet list (~lines 37–50): add a bullet so Veles cannot emit its result JSON until every changed external surface is dispositioned.

### Matrix-trigger interaction (regression bound)
The surface anchor fires under the **same condition the Coverage Matrix already requires** — the Changes Summary names ≥2 status/behavior classes (Step 1.5 / `test-plan-format` matrix trigger). A single-surface or FE-only diff that legitimately omits the matrix today is a **no-op**: the surface anchor adds no obligation there, so existing passing plans do not regress. (This is the second-most-important correctness property after the self-referential closure; it is demonstrated, not just asserted — see §7's regression guard.)

### Enforcement tier
**Veles:** hard-stop (cannot emit result JSON). **`/create-qa-plan`:** inherited as guidance, no hard gate — exactly as the status anchor already degrades (Step 6.7 final parenthetical).

---

## §4 R-B — derived-value assertion discipline

### Problem
Veles cited the producer (`filename.py:38`) **and still** shipped a wrong hand-computed `filename*` literal — it dropped the `CV%20` prefix and garbled the multibyte `ł`. The shipped grounding-tags rule "cite the producer" was satisfied by a wrong literal; the "assert shape / `(exact text — brittle)`" rule targets *human-readable messages*, not *function-computed* values. Plan B avoided the error precisely because it asserted the **rule** ("percent-encoded UTF-8 of `\"Łukasz Żółć.pdf\"`"), not a hand-computed literal.

**Dogfooding note (don't enshrine a "correct" literal).** The grader's *corrected* bytes are themselves a hand-computation and are **not** fixture-pinned — `test_filename.py` pins only the ASCII slug (`cv-lukasza-zolc.pdf`), not the `filename*` percent-encoding. So this spec deliberately states no "correct" literal: a function-derived value is trustworthy only as a **rule** or a **fixture-pinned** literal. That is exactly R-B's thesis, applied to R-B's own evidence.

### The rule (a confidence ladder, not a push to `(unverified)`)
For a value produced at runtime by a function — percent-encoding, hashing, slugging, formatting, signing:
1. **Best — literal pinned by a fixture/test:** show the exact literal and cite the test that asserts it (e.g. `test_filename.py:15`). Full confidence.
2. **Good — rule + producer from readable source:** assert the *generating rule* and cite the producer, e.g. *"RFC 5987 percent-encoded UTF-8 of `<name>.pdf` via `quote(…, safe='')` (`filename.py:38`)."* This is **full-confidence grounding, not a punt** — it keeps Step 0's "don't over-tag `(unverified)` when source is readable" intact.
3. **Last — `(unverified — confirm at run time)`:** only when the producer cannot be read.

**Never:** assert a hand-computed encoding/hash/slug **literal** that is neither pinned by a test nor expressed as a rule.

### Edits (two touch-points)
1. **`src/skills/qa/test-plan-format/SKILL.md` — "Grounding tags & assertion style"** (~lines 211–237): add the function-derived-value rule (the ladder above), explicitly distinguished from the existing human-message-text `(exact text — brittle)` rule.
2. **`src/skills/qa/qa-plan-authoring/SKILL.md` — Step 6.8** (~line 319, the "derived values (generated filenames, slugs)" refute class): one clause — "…and never assert a *hand-computed* encoding/hash/slug literal — assert the producing rule, or cite the fixture that pins the bytes."

### Enforcement tier
Authoring guidance + refute-pass check. Not a separate `veles.md` hard-stop bullet (it is part of the Step 6.8 pass Veles already runs before emitting JSON). The asymmetry with R-A's hard-stop is intentional, not arbitrary: R-A is gateable because the surface set is **enumerable** from the Changes Summary, whereas a gate cannot cheaply decide whether a given literal was hand-computed or fixture-pinned — so R-B lives in the refute pass, where judgment is available, rather than as a decidable hard-stop.

---

## §5 R-C — findings enforcement loop-back

### Problem
Step 3.5 already lists "a scenario/ticket ID baked into a source comment (identifier policy), a leaked secret, a disabled auth check" as shippability hazards to emit under `## Blockers / Findings`. Veles ran the scan, folded the `sleep(65)` into BLK-01, but did **not** separately emit the `# … (BE-06)` QA-ID-in-comment finding. This is an adherence gap, not an absence — adding new behavior prose would breach Constraint §2.3.

### The edit (one touch-point)
**`src/skills/qa/qa-plan-authoring/SKILL.md` — Step 6.7 self-check** (~lines 288–307, appended *after* R-A's surface anchor): one loop-back clause that **re-runs the Step 3.5 hazard scan over the changed files** and confirms each *distinct* hazard is its **own** `## Blockers / Findings` entry — *"re-scan the changed files for the Step 3.5 hazard classes (debug/test artifacts, disabled guards, an identifier-policy QA/ticket ID in a comment, a leaked secret) and confirm each distinct hazard is its own entry, not folded into another blocker."*

This targets the **actual** Plan-A failure mode: the QA-ID lived on the *same line* as the `sleep(65)` that became BLK-01, so Veles processed the line as one blocker and never surfaced the second hazard. A loop-back that only asked "was each *noted* hazard emitted?" would be **vacuous** — the hazard was never separately noted. So R-C hardens **detection (re-scan) + distinct emission**, not emission alone. It re-runs an existing scan (Step 3.5) with intent and adds no new hazard taxonomy (no-restate). Same theme as R-A: turn a soft scan into a confirmed check.

### Enforcement tier
Step 6.7 self-check clause. No new `veles.md` hard-stop bullet — the section is already mandatory (Step 3.5 + the existing checklist item); this only confirms completeness. Light touch by design.

### Why findings only, not the boundary
The delta-3 decision named two under-applied behaviors: the QA-ID-in-comment **finding** and the `valid_to == now()` **boundary**. R-C enforces only the *finding* half because the Step 3.5 hazard classes have a **concrete re-scan target** — the changed files' comments and markers — that the loop-back can sweep again. The boundary has no such re-scannable artifact (it is a behavior-class judgment, not a textual marker); enforcing it would require either new prose (breaching §2.3 — it already ships in Step 6.6's in-scope-by-default list) or a new scan step (scope creep). The boundary stays covered by the general Step 6.6/6.7 coverage discipline, which R-A's surface accounting reinforces. This is a deliberate scoping of the chosen treatment, not a dropped requirement.

---

## §6 Non-goals / explicitly out of scope

- **No new prose for delta-3 behaviors.** Step 3.5 (findings) and Step 6.6 (`valid_to == now` boundary) already ship; R-C adds enforcement only. The boundary edge is **not** touched — it already ships.
- **No new tag**, no momus, no coverage-reviewer agent (§2.1–2.2).
- **No imitation of Plan B's harness-scope breach.** The grant-script surface is dispositioned `out-of-scope`, not turned into a `uv run python` scenario.
- **No re-statement** of Step 0 framework-defaults, Step 6.8 refute classes, or Step 6.6 surface/boundary guidance.
- **F3 (imprecise auth citation) acknowledged but not separately gated.** Plan A cited the wrong branch for a *correct* 401 — the same "already-shipped, under-applied" shape as delta-3 (Step 6.8 already has a "claim-specific, branch-governing citation" refute class that names it). We **park it**: a *second* enforcement loop-back in the same phase would over-gate at n=1. R-C's detection-loop-back is the template if a future eval shows F3-class misses recur.
- **F4 / F5 (needs-runtime-check edges) out of scope.** The grader did not confirm F4 (Plan A's "rate-limit before auth" ordering sub-claim) or F5 (Plan B's 422-vs-400 ambiguity). These are author-judgment edges left to the general Step 6.8 refute pass (rate-limit semantics and error-to-status mapping are already refute classes there), not new gates.
- **No statistical quality claim.** See §7.

---

## §7 Validation

### Tests (TDD — assertions before edits)
- `tests/skills/qa-plan-authoring.test.ts` — assert the Step 6.7 surface anchor string and the R-C loop-back clause; assert the Step 6.8 derived-value clause.
- `tests/skills/test-plan-format.test.ts` — assert the Coverage-Matrix "per changed external surface" wording, the final checklist item, and the function-derived-value grounding rule.
- `tests/modules/plan/veles-prompt.test.ts` — assert the new `veles.md` surface hard-stop bullet appears in the compiled prompt, **scoped to the ≥2-class matrix-trigger condition** (regression guard: a single-surface / FE-only plan must not acquire a new obligation — see §3 "Matrix-trigger interaction").

### Build & check
- `bun run build:root` to regenerate `dist/` (byte-for-byte mirror), then `bun run check` (`typecheck && test && build`) green. `verify-dist-sync.mjs` will flag uncommitted dist drift by design — commit the rebuilt dist alongside src.

### Eval (one corroborating data point, not proof)
Re-run the export-PDF grading after the edits. **Structural** success criteria:
- The surface anchor *fires*: a Veles plan for that diff now carries a disposition for both the `/render` contract (expected `covered`) and the grant-script surface (expected `out-of-scope` with a harness reason).
- The derived-value rule *removes* the F2 class: the `filename*` assertion is expressed as a rule (or pinned to `test_filename.py`), not a hand-computed literal.
- The Step 6.7 loop-back *catches* the QA-ID-in-comment hazard as its own emitted finding (re-scan, distinct entry).
- **No false-stop:** a single-surface or FE-only diff still authors and emits its result JSON without the surface anchor forcing a matrix — confirm on at least one such case (an existing FE-only / single-status golden, or a quick second fixture).

No claim that author correctness "improved" at n=3.

---

## §8 Files touched

| File | Change |
|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | Step 6.7: surface anchor + matrix-trigger scoping (R-A) + findings re-scan loop-back (R-C); Step 6.8: out-of-scope-surface refute class (R-A) + derived-value clause (R-B) |
| `src/skills/qa/test-plan-format/SKILL.md` | Coverage-Matrix description + final checklist item (R-A); Grounding-tags function-derived-value rule (R-B) |
| `src/modules/plan/veles.md` | hard-stop bullet for the surface anchor (R-A) |
| `dist/skills/qa/qa-plan-authoring/SKILL.md`, `dist/skills/qa/test-plan-format/SKILL.md`, `dist/modules/plan/veles.md` | regenerated by `bun run build:root` (byte-for-byte) |
| `tests/skills/qa-plan-authoring.test.ts`, `tests/skills/test-plan-format.test.ts`, `tests/modules/plan/veles-prompt.test.ts` | new assertions (R-A/R-B/R-C) |

---

## §9 Implementation order (for writing-plans)

1. **R-A** — tests first (surface anchor in all three test files, incl. the matrix-trigger-scoping regression guard), then Step 6.7 anchor + Step 6.8 out-of-scope-surface refute class + test-plan-format + veles.md edits; rebuild; `bun run check`.
2. **R-B** — tests first (grounding-tags rule + Step 6.8 clause), then edits; rebuild; `bun run check`.
3. **R-C** — test first (loop-back clause), then Step 6.7 edit; rebuild; `bun run check`.
4. **Build/sync gate** — `bun run build:root` + `bun run check` green; dist committed with src.
5. **Eval re-run** — manual; surface as a checkpoint, capture-then-delete the scratch report (never commit; reports never in repo), record only the structural verdict.

Commits: `AV_COMMIT_SKILL=1`, Conventional Commits, **no push**, **no co-author attribution**.
