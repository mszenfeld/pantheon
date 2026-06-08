# Veles Grounding-Precision & Surface-Reachability Design

**Goal:** Close the five gaps the 2026-06-08 export-PDF re-eval surfaced between Veles (Plan A) and the marketplace `/create-qa-plan` (Plan B), so a Veles-authored plan stops losing on grounding correctness, coverage, and contract adherence — without adding a new harness agent or a new grounding tag.

**Architecture:** Prose-only hardening of the three QA homes (`src/skills/qa/qa-plan-authoring/SKILL.md`, `src/skills/qa/test-plan-format/SKILL.md`, `src/modules/plan/veles.md`), compiled to `dist/` by `bun run build:root`. The unifying principle is **decidability over exhortation**: every lever hooks into machinery that already exists (the Coverage Matrix, the Step 6.7 hard-stop, the Step 6.8 refute pass, the Step 3.5 Blockers) and makes the author *emit evidence the hard-stop then checks for* — rather than adding new advisory paragraphs. We **extend existing anchors**, we do not restate shipped prose.

**Tech Stack:** OpenCode skill/agent markdown in `src/`, mirrored byte-for-byte into git-tracked `dist/` (CI `scripts/verify-dist-sync.mjs` fails on drift); Vitest `toContain` string-presence tests; `bun run check` = typecheck && test && build.

**Source eval:** `/tmp/grading-2026-06-08-export-pdf-plans.md` (not committed — reports never live in the repo). The structural verdict is recorded here; the scratch report is not.

---

## Context — why Plan A lost (root-cause analysis)

The re-eval scored Plan A (Veles) vs Plan B (marketplace) on the five GATE axes: **3/3/3/4/3 vs 5/5/4/5/5**. Two of Plan A's defects were *confirmed* against on-disk code; the rest were coverage gaps. The decisive finding is that **three of the four misses were already covered by rules we shipped — the prose existed and the same-session author walked past it.**

| Plan A miss | Class | Already-shipped rule that should have caught it | Verdict |
|---|---|---|---|
| **BE-02** — asserted the unauth `401` body is `{"error":{"code"…}}` citing `error_handler.py:79`; that handler fires only for the domain `UnauthorizedError`, but `get_current_user_id` raises a raw framework `HTTPException`, so the body is `{"detail":"Not authenticated"}`. Status right, envelope wrong. | grounding / contract | Step 6.8 *"claim-specific, branch-governing citation … point at the branch that fires for THIS input, not merely a real line near the topic"* | Rule existed; self-refute missed it |
| **BE-09** — built the `429` scenario from **11 unauthenticated requests** ("auth fails after limit check passes"); but `Depends(get_current_user_id)` resolves *before* the limiter decorator's wrapper runs, so pre-auth-rejected requests never reach the bucket and no count of them yields `429`. | executability / mechanism | Step 6.6 already says fire **the cheap 402/404** request (authenticated-but-failing still counts toward the slowapi bucket) — right recipe, wrong request class used. No explicit **call-order** rule. | Partially covered; one genuine gap |
| **Worker `/render` punted `out-of-scope`** — `pdf-worker/.../routes.py` is *in the diff* and exposes a curl-able HTTP route on `:8001`; Veles read it (and ran `git diff` on it) yet dispositioned it out of scope. | coverage | Step 6.7 surface anchor + Step 6.8 *"out-of-scope surface dispositions"* refute (shipped as R-A) | Rule existed; self-refute missed it |
| **No 422** — the surface accepts a typed body; Pydantic validation-failure (`422`) was never a scenario. | coverage | `test-plan-format` edge-case rule *"Required fields missing (422)"* | Rule existed; not pulled into the sweep |
| **Single layer (live-only)** — the 65s pdf-worker `sleep` forces every live export to `504`, making `200`/headers/`502`/lock **unobservable live**. Plan B pointed at the repo's hermetic pytest suite (`tests/functional/api/v1/cvs/test_export_cv.py`, fakes, HS256 conftest), which observes them blocker-immune. | coverage / resilience | The current "never transcribe a test" rule actively *discourages* leveraging the hermetic layer. | Genuine gap |

**Plan A's genuine wins are preserved untouched:** parameterized `QA_BIND_JWT` (clean secret hygiene — Plan B inlined a live login/password), the tabular Coverage Matrix, and parsable frontmatter. This design adds nothing that would regress them.

**Meta-conclusion driving the architecture:** adding more advisory prose has hit diminishing returns — a same-session author keeps missing rules already written. The skill itself admits *"a same-session self-refute is weaker than an independent reviewer."* The highest-leverage fix (activate the reserved `momus` independent reviewer) is **explicitly out of scope this round** (no new harness agent). Therefore every lever here must convert soft guidance into an **emitted, hard-stop-checked artifact**, and we accept a known ceiling on L1 (below).

---

## Design principle: decidability over exhortation

1. **Extend existing anchors; never restate.** L1 extends the Step 6.8 branch-governing-citation bullet; L2 extends the Step 6.7 surface anchor and its Step 6.8 refute bullet; L3 extends the Step 6.6 in-scope-by-default class list; L4 carves an exception into the existing anti-transcribe rule; L5 extends the Step 0 probe clause. No new top-level sections.
2. **Emit-then-check.** Where possible the author must *emit* evidence (an order/branch citation, a disposition, a hermetic pointer) that the Step 6.7 self-check and the `veles.md` hard-stop verify. A *missing* emitted artifact is a hard-stop failure even where the *semantic* correctness can't be mechanically proven.
3. **Honesty about the ceiling (L1).** L1 is **forcing, not mechanically decidable**: requiring the chain-citation raises the bar and catches the *absent* trace, but a determined author can still mis-trace semantics. Full elimination is what an independent reviewer buys; that is deferred. No overclaim — the next eval is **one corroborating point, not proof** (n=3).

---

## Lever 1 — Call-order / branch-governing trace

**Closes:** BE-02 (envelope) and BE-09 (resolution order). **Homes:** `qa-plan-authoring` Step 6.8; `veles.md` hard-stop.

Both confirmed errors share one root cause: an outcome was asserted without tracing the **actual request path / layer order**. Two forcing functions, scoped to the high-risk classes that already head the Step 6.8 list (so this is an extension of that bullet set, not a new pass):

**1a. Envelope assertions must cite the (raise-site, catcher) pair.** Any assertion about an error **body/envelope shape** must cite *both* the site that raises the error **and** the handler that catches *that exception type* — or state explicitly that no domain handler is on the path and the framework default envelope applies. Concretely, one of:
- `domain XError → handler maps to {"error":{"code"}} (errors.py:NN, error_handler.py:MM)`, or
- `raised as a framework HTTPException; no domain handler on this path → {"detail":…} (auth.py:NN)`.

A citation to a handler that does **not** catch the exception type the path raises is a **hard-stop failure** (this is exactly BE-02). This extends — does not duplicate — the existing Step 6.8 *"claim-specific, branch-governing citation"* bullet by naming the *pair* as the required evidence for envelope claims.

**1b. Order-gated assertions must name the resolution order.** Any assertion whose truth depends on **which layer fires first** — auth dependency vs rate-limit decorator vs middleware vs exception handler — must state the resolution order it relies on, grounded in code. The decidable bite is on the `429` recipe specifically:
- A `429` scenario MUST fire the request **class that passes every gate preceding the limiter** (e.g. authenticated requests that then 402/404 — error responses still increment the slowapi bucket).
- Firing a request class **rejected before the limiter** (unauthenticated requests at a post-auth limiter, i.e. auth resolved as a `Depends` before the decorated body) is a **hard-stop failure** — no count of them produces `429` (this is exactly BE-09).

**Decidability:** 1a and 1b make a *missing or contradictory* order/branch citation fail the gate. They do **not** guarantee the author traces correctly in every case — that residual is the acknowledged ceiling.

**`veles.md` hard-stop:** the existing must-refute list already names "error-to-status mapping" and "rate-limit semantics." Tighten the wording so the refute is satisfied only when the **order/branch evidence is present** for these classes — not merely that the class was "considered."

---

## Lever 2 — Lock changed + reachable surfaces out of `out-of-scope`

**Closes:** the worker `/render` and grant-script punts. **Homes:** `qa-plan-authoring` Step 6.7 (surface-anchor disposition rule) + Step 6.8 (out-of-scope-surface refute bullet); `test-plan-format` Coverage-Matrix description + Plan-Quality checklist; `veles.md` hard-stop bullet.

Hardens the shipped R-A surface anchor. New rule:

> A surface **named in your own `## Changes Summary`** that is **itself modified in this diff** AND has a **harness-observable interface** — a curl-able HTTP route, a `psql`-observable DB effect, or a Playwright surface — **cannot** take the `out-of-scope` disposition. Its only valid dispositions are `covered` or `blocked-by`. `out-of-scope` is reserved for a changed surface with **no** curl/psql/Playwright-observable interface or effect at all (e.g. something only inspectable with `docker`/`make`).

Application to the eval:
- **Worker `/render`** — exposes an HTTP route the runner can `curl` (`http://localhost:8001`). Reachable ⇒ must be `covered` (or `blocked-by` if the 65s sleep obstructs a given row). Punting it `out-of-scope` is now a hard-stop failure.
- **`grant_test_entitlement.py`** — the runner cannot execute the script (Step 4.5: no arbitrary process exec), but its **effect** (an entitlement row with `valid_from`/`valid_to`) is `psql`-observable, and it already runs as a human Setup prerequisite to seed entitlements. DB-observable effect ⇒ `covered` via a DB-check, not `out-of-scope`. (Its exit-code contract, if material, is a `## Blockers / Findings` item, not a punt.)

This is well-bounded by the *existing* surface definition: internal collaborators (error mapper, use-case, port, lock, adapter) are already "exercised *through* a surface, not their own row," so L2 cannot manufacture false hard-stops on pure internal refactors. L2 only bites on **named external surfaces** (HTTP route, CLI/dev script with a DB effect, worker/public API contract, DB-observable schema).

**Step 6.8 refute extension:** the existing "out-of-scope surface dispositions" bullet gains the explicit test — *"if the changed surface has a curl/psql/Playwright interface or effect, `out-of-scope` is invalid; reclassify to `covered` or `blocked-by`."*

---

## Lever 3 — `422` / validation as an in-scope-by-default class

**Closes:** the missing-422 gap. **Home:** `qa-plan-authoring` Step 6.6 (one bullet appended to the "in scope by default" class list).

When a changed surface **accepts a typed request body or typed params** (a declared Pydantic model / typed query parameters), the **validation-failure class (`422`)** is in scope by default — apply its predicate to any matching surface, like the existing IDOR / reflected-input / lock classes:

> **Schema validation → 422** (a surface with a typed body/params): send a payload that violates the declared schema (missing required field, wrong type) and assert the framework validation status (`422` for FastAPI/Pydantic) and the error-envelope shape produced *by the framework's validation handler* — verify which envelope actually applies (interacts with L1: FastAPI's `RequestValidationError` envelope differs from a domain handler's).

`422` is already in `test-plan-format`'s Data-integrity edge-case list; L3 pulls it into the **sweep the Coverage Matrix checks**, so a typed-body surface that omits it is visible at Step 6.7.

---

## Lever 4 — Hermetic-observation pointer (annotation-only)

**Closes:** single-layer blindness. **Homes:** `qa-plan-authoring` Step 0 (carve-out to the anti-transcribe rule) + Step 3.5 (Blocker entry gains an optional pointer) ; `test-plan-format` Coverage-Matrix Pointer-cell guidance + Blockers section.

**Carve-out to the existing anti-transcribe rule.** The current rule — *"Never transcribe a test as a manual scenario; that re-runs CI and adds nothing"* — gains a bounded exception:

> **EXCEPTION (verification pointer, not a scenario):** when a recorded Blocker makes a contract row **unobservable on the live path**, and Step 4.6 test-env detection found a hermetic test that *does* observe it, record a `**Hermetic observation:** <path>::<test>` note on the Blocker entry and a `hermetic: <path>::<test>` note in that row's Coverage-Matrix Pointer cell. This is a **verification pointer** — the runner never executes it — recording that the contract *is* verified, just not by the live runner. It does NOT become a scenario and does NOT re-run CI.

This keeps the discipline intact (no transcribed test steps, no scenario that re-runs the suite) while capturing the exact edge Plan B won on: the 65s sleep makes `200`/headers/`502`/lock unobservable live, but the hermetic suite observes them under fakes.

**Boundary (kept narrow):** the pointer is a **SHOULD**, contingent on Step 4.6 having *found* such a test — never a hard-stop, because not every blocked row has a hermetic observer. The author does not author, run, or transcribe the test; it points at an existing one by `path::test_name`.

**Matrix shape (illustrative):**
```
| Behavior | Expected | Disposition | Pointer |
|---|---|---|---|
| 200 happy path | 200 + %PDF | blocked-by: BLK-01 | BE-03 (live, blocked); hermetic: tests/functional/.../test_export_cv.py::test_ok |
```
```
### BLK-01: pdf-worker sleep(65) forces 504 live (routes.py:63)
- **Hermetic observation:** tests/functional/.../test_export_cv.py asserts 200/headers/502/lock under fakes — unaffected by the live sleep.
```

---

## Lever 5 — Failed-probe escalation

**Closes:** the silent fallback to memory. **Home:** `qa-plan-authoring` Step 0 (one clause appended to the framework-defaults paragraph).

The transcript shows Veles ran `uv run python -c "…HTTPBearer…"`, the probe failed ("checking alternative"), and it then proceeded from memory — leaving the BE-02 envelope wrong and never re-confirming the `401` path. New clause:

> When a runtime probe **fails or is inconclusive** (the command errors, returns nothing, or the environment cannot run it), do **not** fall back to memory. Either ground the assertion by **reading the installed dependency's source in the tree** (e.g. the `fastapi/security/http.py` actually under `.venv`/site-packages), or tag the assertion `(unverified — confirm at run time)`. A confident assertion made *after* a failed probe is a defect.

Reuses the existing `(unverified — confirm at run time)` tag — no new tag.

---

## Homes & edit map

| File | Lever(s) | Edit |
|---|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | L1 | Extend Step 6.8 high-risk classes: envelope `(raise-site, catcher)` pair + order-gated 429 request-class rule. |
| | L2 | Extend Step 6.7 surface-anchor disposition rule + Step 6.8 out-of-scope-surface bullet with the reachable-surface lock. |
| | L3 | Append the `422` validation class to the Step 6.6 in-scope-by-default list. |
| | L4 | Step 0 anti-transcribe carve-out; Step 3.5 optional `**Hermetic observation:**` pointer on Blocker entries. |
| | L5 | Step 0 framework-defaults: failed-probe escalation clause. |
| `src/skills/qa/test-plan-format/SKILL.md` | L2 | Coverage-Matrix description + Plan-Quality checklist: reachable changed surface ⇒ not `out-of-scope`. |
| | L4 | Coverage-Matrix Pointer-cell guidance + Blockers section: `hermetic:` / `**Hermetic observation:**` convention. |
| `src/modules/plan/veles.md` | L1 | Tighten the hard-stop refute wording for error-to-status / rate-limit classes to require the order/branch evidence. |
| | L2 | Hard-stop matrix bullet: a reachable changed surface dispositioned `out-of-scope` is a hard-stop failure. |
| `dist/**` | all | Regenerated byte-for-byte via `bun run build:root`; committed with `src`. |
| `tests/skills/qa-plan-authoring.test.ts`, `tests/skills/test-plan-format.test.ts`, `tests/modules/plan/veles-prompt.test.ts` | all | `toContain` presence assertions for each new substring (tests first). |

---

## Testing approach

- **TDD, tests first**, one home at a time. Each new rule gets a `toContain` presence assertion against the compiled prompt / skill text.
- **Wrap-sensitivity:** `toContain` fails on any substring that spans a Markdown line-wrap. Every asserted substring must be pasted verbatim and kept on **one source line** — the plan provides the exact strings.
- **Regression guards:** assert the preserved invariants still hold — the surface anchor's "internal collaborator is not its own row" clause (L2 must not break it), the `(unverified — confirm at run time)` tag reuse (L5 adds no new tag), and the anti-transcribe rule's core ("don't re-run CI as a scenario") surviving the L4 carve-out.
- **Run:** `npx vitest run <path>` (NOT `bun run test --`). After any `src/skills/**` or `src/modules/plan/veles.md` edit: `bun run build:root` then `bun run check`; commit `src` + `dist` + tests together (CI fails on dist drift).
- **Manual eval re-run** is a separate, optional structural checkpoint the user runs (capture-then-delete scratch, never committed, structural verdict only) — not a CI blocker. n=3: one corroborating point, not proof.

---

## Constraints (hard)

- **No new harness agent** — `momus` stays reserved; the Step 6.8 / `veles.md` "Momus seam" prose is left intact (it already defers to momus "when available").
- **No new tag** — reuse `(unverified — confirm at run time)` and `(exact text — brittle)` only.
- **Do not restate shipped prose** — L1/L2 *extend* existing bullets; the design is a hardening, not a rewrite.
- **Skill edits require dist rebuild** — `bun run build:root` + `bun run check` green; dist committed with src.
- **Commits:** `AV_COMMIT_SKILL=1`, Conventional Commits, **no push**, **no co-author attribution** of any kind.
- **No `docs/superpowers/` links from other docs** (AGENTS.md:251); **no per-review issue IDs** (SEC-/MAINT-…) in source or tests (AGENTS.md:262).
- **Reports never committed** — the eval scratch lives in `/tmp` only.

---

## Success criteria

1. A re-authored Plan A on the export-PDF diff **cites the (raise-site, catcher) pair** for the unauth-body assertion and lands `{"detail":…}`, not the domain envelope (BE-02 fixed).
2. Its `429` scenario fires the **authenticated-but-failing** request class and names the auth-before-limiter order (BE-09 fixed).
3. The worker `/render` route and the grant-script effect both carry a `covered`/`blocked-by` disposition — **neither is `out-of-scope`** (L2).
4. A typed-body surface includes a `422` validation scenario (L3).
5. Blocked-unobservable rows carry a `**Hermetic observation:**` pointer when the repo has an observing test (L4).
6. All preserved wins intact: `QA_BIND_*` secret hygiene, Coverage Matrix, frontmatter.
7. `bun run check` green; dist byte-for-byte synced.

**Non-goals:** activating momus; introducing a first-class two-layer (L1/L2) plan structure (rejected in favor of the annotation-only pointer); any new grounding tag; changing the runner/executor.
