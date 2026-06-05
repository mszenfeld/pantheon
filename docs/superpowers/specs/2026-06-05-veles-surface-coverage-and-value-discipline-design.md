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
| Typed bindings + Coverage Matrix + format conformance; correct auth contract | **A** | n/a | **Veles's moat** — the marketplace plan can't reproduce it |

**Reframe of the original premise.** None of Plan B's advantages are architectural limits Veles "cannot reproduce." Two are gate/technique gaps (R-A, R-B); the third already ships and was merely under-applied (R-C). What is genuinely *not* reproducible runs the other way: Veles's format/runnability moat, and the fact that Veles won the auth contract precisely **because** its grounding discipline made it read the installed framework version. The lever is therefore to **extend the gate along the axes it does not yet measure**, not to chase parity.

---

## §1 Scope

Three changes, in priority order:

- **R-A — surface-coverage decidable anchor** (highest leverage, lowest risk). Add a *second* hard-stop anchor beside the existing status anchor: every changed **external surface** gets exactly one Coverage-Matrix disposition.
- **R-B — derived-value assertion discipline** (correctness gain, not just parity). For *function-computed* values (percent-encoding, hashing, slugging, formatting, signing), assert the generating rule + producer `(file:line)`, never a hand-computed literal; show an exact literal only when a fixture/test pins it.
- **R-C — findings enforcement loop-back** (the chosen treatment for the already-shipped delta-3). One Step 6.7 self-check clause confirming every Step 3.5 shippability hazard was actually emitted.

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
Step 6.7's sole decidable hard-stop is *"every status named in your own `## Changes Summary` is a row."* It is **status-keyed**. A changed entry point that introduces no new *status* of the primary endpoint has no row it is obligated to fill, so it can be silently dropped. Veles named both missing surfaces in its own Changes Summary (lines 100, 104 of Plan A) yet generated no disposition for either — because no gate demanded one.

### Definition — "external surface"
A *new or changed externally-reachable entry point*:
- an HTTP route,
- a CLI / dev script,
- a worker-or-public API contract,
- a DB-observable schema change.

**Not** an internal collaborator (error mappers, use-cases, ports, locks, adapters) — those are exercised *through* a surface and need no row of their own. This kind-based filter keeps the gate decidable without forcing a row per collaborator file (which would be both noise and the wrong granularity — many files collaborate on one behavior).

### Disposition semantics — identical to the status anchor
Exactly one of:
1. `covered` → scenario ID + `(file:line)`. *(The worker `/render` X-API-Key contract lands here: it is curl-reachable, so it earns a real BE scenario.)*
2. `blocked-by: BLK-NN` → references a `## Blockers / Findings` entry; the contract-correct scenario is kept and tagged `**Blocked-by:**`.
3. `out-of-scope: <harness-property reason>` → **first-class.** *(The `grant_test_entitlement.py` surface lands here: the runner cannot execute `uv run python` (Step 4.5), so it is honestly out-of-scope — its effect is observed via the entitlement path. It is **accounted for**, never force-written as an un-runnable scenario. Note: Plan B's BE-11, which runs the script as a scenario, arguably breaches harness scope — R-A's honest disposition is out-of-scope, not imitation of Plan B.)*

**Anti-padding guarantee:** because `out-of-scope` (with a harness reason) is a valid disposition, R-A forces *accounting*, not *more scenarios*. Scenario count remains a non-signal (existing Step 6.6 doctrine). The harness-property-reason requirement (Step 6.6 reachability litmus) still applies: an `out-of-scope` reason that is a code defect is invalid and must be `blocked-by`.

### Edits (three touch-points, all existing homes)
1. **`src/skills/qa/qa-plan-authoring/SKILL.md` — Step 6.7** (~lines 288–307): add the surface anchor beside the status anchor, with the kind-based definition and the disposition list above. State it is a hard-stop of the same shape as the status anchor.
2. **`src/skills/qa/test-plan-format/SKILL.md`** — Coverage-Matrix description (~lines 61–70) and the final Plan-Quality-Checklist item (~line 358): "one row per status **and per changed external surface**."
3. **`src/modules/plan/veles.md`** — hard-stop bullet list (~lines 37–50): add a bullet so Veles cannot emit its result JSON until every changed external surface is dispositioned.

### Enforcement tier
**Veles:** hard-stop (cannot emit result JSON). **`/create-qa-plan`:** inherited as guidance, no hard gate — exactly as the status anchor already degrades (Step 6.7 final parenthetical).

---

## §4 R-B — derived-value assertion discipline

### Problem
Veles cited the producer (`filename.py:38`) **and still** shipped a wrong hand-computed `filename*` literal (`%C5%81%C5%82ukasza…`, which drops the `CV%20` prefix and doubles `ł` → decodes to "Łłukasza"). The shipped grounding-tags rule "cite the producer" was satisfied by a wrong literal; the "assert shape / `(exact text — brittle)`" rule targets *human-readable messages*, not *function-computed* values. Plan B avoided the error precisely because it asserted the **rule** ("percent-encoded UTF-8 of `\"Łukasz Żółć.pdf\"`"), not a hand-computed literal.

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
Authoring guidance + refute-pass check. Not a separate `veles.md` hard-stop bullet (it is part of the Step 6.8 pass Veles already runs before emitting JSON).

---

## §5 R-C — findings enforcement loop-back

### Problem
Step 3.5 already lists "a scenario/ticket ID baked into a source comment (identifier policy), a leaked secret, a disabled auth check" as shippability hazards to emit under `## Blockers / Findings`. Veles ran the scan, folded the `sleep(65)` into BLK-01, but did **not** separately emit the `# … (BE-06)` QA-ID-in-comment finding. This is an adherence gap, not an absence — adding new behavior prose would breach Constraint §2.3.

### The edit (one touch-point)
**`src/skills/qa/qa-plan-authoring/SKILL.md` — Step 6.7 self-check** (~lines 288–307): one loop-back clause — *"confirm every shippability hazard noted in your Step 3.5 scan was emitted as a `## Blockers / Findings` entry (a QA/ticket ID in a comment, a leaked secret, a disabled guard you noticed but folded into another blocker)."* No new behavior; it closes the scan→emit loop. Same theme as R-A: turn a soft scan into a confirmed check.

### Enforcement tier
Step 6.7 self-check clause. No new `veles.md` hard-stop bullet — the section is already mandatory (Step 3.5 + the existing checklist item); this only confirms completeness. Light touch by design.

### Why findings only, not the boundary
The delta-3 decision named two under-applied behaviors: the QA-ID-in-comment **finding** and the `valid_to == now()` **boundary**. R-C enforces only the *finding* half, because Step 3.5 produces an explicit scan list that a loop-back can decidably check against ("was each hazard emitted?"). The boundary has **no equivalent scan list** to loop against; enforcing it would require either new prose (breaching §2.3 — it already ships in Step 6.6's in-scope-by-default list) or a new scan step (scope creep). The boundary stays covered by the general Step 6.6/6.7 coverage discipline, which R-A's surface accounting reinforces. This is a deliberate scoping of the chosen treatment, not a dropped requirement.

---

## §6 Non-goals / explicitly out of scope

- **No new prose for delta-3 behaviors.** Step 3.5 (findings) and Step 6.6 (`valid_to == now` boundary) already ship; R-C adds enforcement only. The boundary edge is **not** touched — it already ships.
- **No new tag**, no momus, no coverage-reviewer agent (§2.1–2.2).
- **No imitation of Plan B's harness-scope breach.** The grant-script surface is dispositioned `out-of-scope`, not turned into a `uv run python` scenario.
- **No re-statement** of Step 0 framework-defaults, Step 6.8 refute classes, or Step 6.6 surface/boundary guidance.
- **No statistical quality claim.** See §7.

---

## §7 Validation

### Tests (TDD — assertions before edits)
- `tests/skills/qa-plan-authoring.test.ts` — assert the Step 6.7 surface anchor string and the R-C loop-back clause; assert the Step 6.8 derived-value clause.
- `tests/skills/test-plan-format.test.ts` — assert the Coverage-Matrix "per changed external surface" wording, the final checklist item, and the function-derived-value grounding rule.
- `tests/modules/plan/veles-prompt.test.ts` — assert the new `veles.md` surface hard-stop bullet appears in the compiled prompt.

### Build & check
- `bun run build:root` to regenerate `dist/` (byte-for-byte mirror), then `bun run check` (`typecheck && test && build`) green. `verify-dist-sync.mjs` will flag uncommitted dist drift by design — commit the rebuilt dist alongside src.

### Eval (one corroborating data point, not proof)
Re-run the export-PDF grading after the edits. **Structural** success criteria:
- The surface anchor *fires*: a Veles plan for that diff now carries a disposition for both the `/render` contract (expected `covered`) and the grant-script surface (expected `out-of-scope` with a harness reason).
- The derived-value rule *removes* the F2 class: the `filename*` assertion is expressed as a rule (or pinned to `test_filename.py`), not a hand-computed literal.
- The Step 6.7 loop-back *catches* the QA-ID-in-comment hazard as an emitted finding.

No claim that author correctness "improved" at n=3.

---

## §8 Files touched

| File | Change |
|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | Step 6.7: surface anchor (R-A) + findings loop-back (R-C); Step 6.8: derived-value clause (R-B) |
| `src/skills/qa/test-plan-format/SKILL.md` | Coverage-Matrix description + final checklist item (R-A); Grounding-tags function-derived-value rule (R-B) |
| `src/modules/plan/veles.md` | hard-stop bullet for the surface anchor (R-A) |
| `dist/skills/qa/qa-plan-authoring/SKILL.md`, `dist/skills/qa/test-plan-format/SKILL.md`, `dist/modules/plan/veles.md` | regenerated by `bun run build:root` (byte-for-byte) |
| `tests/skills/qa-plan-authoring.test.ts`, `tests/skills/test-plan-format.test.ts`, `tests/modules/plan/veles-prompt.test.ts` | new assertions (R-A/R-B/R-C) |

---

## §9 Implementation order (for writing-plans)

1. **R-A** — tests first (surface anchor in all three test files), then Step 6.7 + test-plan-format + veles.md edits; rebuild; `bun run check`.
2. **R-B** — tests first (grounding-tags rule + Step 6.8 clause), then edits; rebuild; `bun run check`.
3. **R-C** — test first (loop-back clause), then Step 6.7 edit; rebuild; `bun run check`.
4. **Build/sync gate** — `bun run build:root` + `bun run check` green; dist committed with src.
5. **Eval re-run** — manual; surface as a checkpoint, capture-then-delete the scratch report (never commit; reports never in repo), record only the structural verdict.

Commits: `AV_COMMIT_SKILL=1`, Conventional Commits, **no push**, **no co-author attribution**.
