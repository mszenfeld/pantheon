# Design: A reusable disciplined grader + narrow Veles grounding riders

**Date:** 2026-06-05
**Status:** v2 — after one mixture-of-agents review round (3 reviewers +
sequential-thinking synthesis). Round 1 reshaped v1→v2: it found Half 1 was
~40% redundant with already-shipped prose, one recipe rule was backwards against
the binding allowlist, and the new tag was an orphan. The grader (Half 2) is the
justified payload; the author side shrank to three narrow riders.
**Scope:** new `docs/eval/grading-protocol.md` + a pointer in
`docs/eval/playbook.md`; narrow edits to `src/skills/qa/qa-plan-authoring/SKILL.md`,
`src/skills/qa/test-plan-format/SKILL.md`, `src/modules/plan/veles.md`; the
matching `dist/` artefacts (author side only) and tests.

> Written in English to match the codebase and existing docs; the brainstorming
> discussion was in Polish. All file:line claims below were verified against
> source during the v1 review.

## Revision history

- **v1 → v2** (round-1 review, 3 reviewers, all RESHAPE). v1 over-built the
  author half and mis-stated one recipe rule. Verified findings and fixes:
  - **Half 1 mostly already ships.** `qa-plan-authoring` Step 0 (lines 37-46)
    already carries the framework-default rule **with the exact HTTPBearer
    403→401 example** (plus SlowAPI fixed-window and IPv6 cases), and Step 6.8
    (lines 299-312) already lists auth/authz status, framework defaults, and
    error-envelope shape as refute classes. Veles got the 401 **right because the
    skill already told it**. v1's "new load-bearing additions" were a second copy
    of shipped prose. → Half 1 shrinks to three genuinely-new riders (§4).
  - **§4.3 was backwards.** The Bindings recipe allowlist (`test-plan-format.md:177`)
    rejects `python` outright — only `curl/psql/sqlite3/jq/grep/cut/head/tail/tr/printf`.
    A machine-executed recipe **cannot** call `grant_test_entitlement.py`; raw
    `psql` is *mandatory*. The "bypassed the sanctioned tool" complaint is invalid
    for a Bindings recipe. → Reversed (§4.3): the only real binding defect is the
    missing DSN credentials.
  - **Orphan tag.** v1 minted `(framework-mediated — confirm at runtime)`, but the
    runner recognizes only `(unverified — confirm at run time)` and
    `(exact text — brittle)` (`test-plan-format.md:214,223`); a third tag is
    silently mistreated. → Folded into `(unverified — confirm at run time)`.
  - **Grader leaned.** v1's five "disciplines" collapse to three rules + a re-read
    sentence; added a symmetry rule (verify PASS verdicts too, not only faults —
    the BE-02 body defect below is a false-*negative*) and a bounded-execution
    fence (no e2e stand-up).
  - **Validation split.** The grader acceptance test runs against the **i-need-cv**
    Layer-2 checkout (real source on disk); the committed embedded-diff golden
    only gets a form check. Author-side correctness gain is declared **unmeasured**
    at n=3 (deferred — consistent with the prior phase's dropped ablation).
  - **Stronger worked example.** BE-02's expected *body* is wrong, not just
    luck-adjacent on status (§1) — a cleaner illustration than v1's "wrong branch".

## 1. Motivation — a verified false-positive, and a body defect both sides missed

We compared two QA plans for `POST /api/v1/cvs/{cv_id}/export` (i-need-cv at
`/Users/mef1st0/Projects/i-need-cv`, branch `feature/incv-97-export-pdf-endpoint`):
**Plan A = Veles/our harness**, **Plan B = marketplace**. A Claude Code grading
pass declared *"Plan A's BE-02 is wrong — a missing Authorization header returns
403, not 401."*

Three layers, all verified against source during review:

- **The grader's verdict is false.** Installed FastAPI (0.136.1 / starlette
  0.50.0) raises **401** for missing credentials:
  `i-need-cv/backend/.venv/.../fastapi/security/http.py:87-99` —
  `make_not_authenticated_error()` → `HTTPException(HTTP_401_UNAUTHORIZED,
  "Not authenticated")`, raised by `__call__` when the header is absent. The
  functional test `test_returns_401_when_no_auth_header` (`test_export_cv.py:92-99`)
  **passes** on a no-override fixture (`conftest.py:201-206`); the catch-all
  `Exception` handler does not intercept `HTTPException` (verified). Modern FastAPI
  changed this from the old 403 the grader **remembered**. The grader committed
  the exact sin it accused the author of — asserting framework behavior from
  memory while holding `Read`/`Bash`/`grep` that could confirm it in seconds.
- **Veles got the status right — because the skill already told it.**
  `qa-plan-authoring` Step 0 (lines 39-41) literally states HTTPBearer "changed
  from 403 to 401 across versions — confirm against the installed version." The
  shipped prose worked.
- **But both sides missed the real defect: BE-02's expected *body* is wrong.**
  The plan asserts `{"error":{"code":"UNAUTHORIZED","message":"..."}}`
  (`...-test-plan.md:136`), citing `test_export_cv.py:98`. That test only asserts
  `status_code == 401` (line 99) — it never checks the body. The actual responses
  are `{"detail":"Not authenticated"}` (missing header, from HTTPBearer) and
  `{"detail":"Invalid or expired token"}` (invalid token, `auth.py:30`). The
  `{"code":"UNAUTHORIZED"}` envelope comes from the domain `UnauthorizedError`
  handler (`error_handler.py:76-81`), which is **not on this endpoint's auth
  path**. So Veles cited a status-only test as grounding for a body it invented.

This is the spine of the whole effort: **a grader that hallucinated a
false-positive on the status, and an author that mis-grounded the body in a test
that doesn't assert it.** Tuning Veles to satisfy the report would chase a phantom;
the priority is grading reliability, and the author side gets three narrow,
verified riders.

### What actually survives as real Veles defects (verified)

- **DSN not runnable as written.** The `QA_BIND_ENTITLEMENT_ID` recipe uses
  `psql "postgresql://127.0.0.1:54322/postgres"` (no credentials) and dropped
  `$DATABASE_URL` from the binding inputs. The documented DSN carries credentials:
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  (`i-need-cv/.env.example:31`). The recipe will not authenticate.
- **BE-02 body envelope** invented (above) — but note this is an *efficacy* miss,
  not a missing-prose miss: Step 6.8 already lists "error-envelope shape" as a
  refute class. Same-session self-refute is weak (see §6).
- **DB-check too shallow.** BE-01's `SELECT COUNT(*) ... WHERE cv_id=...` proves
  existence, not that the entitlement is *active* (`valid_to > now()`).

The "bypassed `grant_test_entitlement.py`" complaint is **invalid** for a Bindings
recipe (allowlist forbids `python`); the column set Veles used is schema-correct.
Format/coverage gripes are the marketplace's preference vs. our intentional
Bindings format — out of scope (§6).

## 2. Root cause and the unifying principle

> **Expected behavior is grounded by verifying against actual artifacts, never
> asserted from memory. A citation must support the specific claim. Tests
> corroborate; they are not to be mirrored, and a test that contradicts the
> implementation is a Finding — but a passing test on a non-overridden fixture is
> admissible evidence.**

Symmetric: **Veles (author)** applies it when deriving expected values;
**Claude Code (grader)** applies it when judging them — and the grader's failure
here is the one we fix first.

## 3. Source-of-truth hierarchy (shared definition)

For any expected status/behavior/value:

1. **Contract + implemented logic** — handler, use-case, error-mapper in the
   app's own source. Derive scenarios and expected values from here. Primary.
2. **Framework/library-mediated behavior** not decidable from app source — verify
   against the **installed dependency source** when reachable, else tag
   `(unverified — confirm at run time)` (the existing tag; do not mint a new one).
   **Never assert from memory.** (Runtime reality: in headless `opencode run`,
   reading `.venv`/site-packages is frequently permission-blocked — see §6 — so
   the `(unverified)` tag is the *honest common result*, not a failure.)
3. **Tests** — corroborating evidence, not a scenario to copy.
   - A passing test on a **non-overridden** fixture is admissible evidence and
     **keeps an assertion at full confidence** — never downgrade what such a test
     confirms. (This is the floor: it protects the BE-02 *status* win.)
   - But a test proves **only what it asserts** — a status-only test is not
     grounding for a body/envelope claim (the BE-02 body defect).
   - A test whose assertion contradicts (1)+(2), or relies on a
     `dependency_overrides` shadow, is a **suspected defective test → Finding**.
   - Never transcribe a test as a manual scenario (that re-runs CI; adds no value).

## 4. Author riders (narrow — most of this already ships)

**Already shipped, do NOT restate:** the framework-default/installed-version rule
+ HTTPBearer example (Step 0, lines 37-46); read-then-cite / `(unverified)`-last
(`veles.md:56-60`); the Step 6.8 refute classes incl. auth status, framework
defaults, error-envelope shape. The riders below are the only genuinely-new bits.

- **R1 — test-as-source tier (the user's core ask).** Add the §3 rule-3 tiering to
  `qa-plan-authoring` Step 0 and a one-line echo in `veles.md`: tests corroborate
  but are not the oracle; a status-only test does not ground a body claim; a
  contradicting/overridden test is a Finding; **a passing non-overridden test keeps
  full confidence** (the Y2 floor — without it this rider could regress the BE-02
  status win).
- **R2 — claim-specific citation.** One clause in Step 6.8: a `(file:line)`
  citation must support the *specific* claim (status AND body), and on the branch
  that fires for the scenario's input — not merely be a real line near the topic.
- **R3 — recipe/DB rules** in `test-plan-format`:
  - Recipe-runnability: a Bindings DSN must carry the credentials the local
    service requires; reference the documented `$DATABASE_URL` rather than a
    credential-less literal.
  - DB-check active-predicate: a check on a time-bounded entity asserts the
    *active* predicate (`valid_to > now()`), not bare existence.
  - **Sanctioned-tool note (reversed from v1):** a Bindings recipe uses `psql`
    because the recipe sandbox forbids `python` — cite any repo-sanctioned script
    (e.g. `grant_test_entitlement.py`) as the semantic reference in a comment, no
    bypass-confession. Preferring the script applies **only to human Setup
    prerequisites**, where `uv run python` is available.

## 5. Half 2 — the reusable disciplined grader (the payload)

**Files:** new `docs/eval/grading-protocol.md`; a "Grading discipline" pointer in
`docs/eval/playbook.md`. It is a Claude Code pass (not a Pantheon agent — no
momus). It **reuses the playbook's GATE/verdict vocabulary** rather than minting a
parallel one, and carries the playbook's banner (outputs to `/tmp/`, never
committed; no private-repo absolute paths in the protocol).

Three rules + a re-read + a fence:

1. **Verify-before-faulting.** To rule any expected value **wrong**, cite the
   installed/on-disk source that contradicts it (or a bounded probe — see fence).
   A from-memory framework claim is **inadmissible**. `needs-runtime-check` is
   allowed only for genuinely runtime-only facts — **not** when the deciding source
   is present on disk (installed deps almost always are).
2. **Symmetry — verify PASS verdicts too.** A contract-bearing assertion (status
   **and** body/envelope) marked PASS also needs a governing-source citation. Do
   not scrutinise only the values you fault — the BE-02 body defect is a
   false-*negative* the report missed precisely because it never checked passes.
3. **External findings are hypotheses.** A marketplace/external report's claims are
   verified against source before counted; never accepted as verdict.

- **Re-read pass:** after drafting, re-read every **wrong** verdict — *"did I read
  source or remember? does my citation contradict the actual value?"* (the
  self-refute, as one step, not a separate discipline).
- **Bounded-execution fence:** "run it" means a single **read-only** probe (one
  `TestClient`/REPL call or one `curl` against an already-running instance), never
  standing up e2e infra, never mutating state. This mirrors the author/runner
  "already-running instance, no stack lifecycle" rule and answers the explicit
  requirement that grading not become an e2e run.

Output: a per-plan rubric score on the GATE axes + a findings list, each finding
tagged `confirmed` / `needs-runtime-check` / `refuted-on-verification`.

## 6. Out of scope / explicitly deferred

- **No momus / no new harness agent.** The grader is eval-time Claude Code prose
  under `docs/eval/`, not a Pantheon module.
- **The BE-02 body-envelope class is a refute-*efficacy* gap, not a prose gap.**
  Step 6.8 already names "error-envelope shape"; same-session self-refute simply
  missed it. Prose cannot reliably fix efficacy — that is the independent-reviewer
  (momus) seam, **deferred** as in prior phases. R1/R2 sharpen the prose; they do
  not claim to guarantee the catch.
- **No format-compliance chase**, **no coverage-count target** (the Bindings format
  is intentional; depth comes from GATE-DEPTH, not a quota).

## 7. Validation / success criteria

- **Grader acceptance test (measurable, the priority).** Re-grade the existing
  Veles export-PDF plan with `grading-protocol.md`, against the **i-need-cv
  Layer-2 checkout** (real source + installed FastAPI on disk). Pass =
  (a) it does **not** fault BE-02's 401 (reads installed FastAPI → 401);
  (b) it **does** flag the BE-02 *body* `{"code":"UNAUTHORIZED"}` as wrong
  (real: `{"detail":...}`); (c) it **does** flag the DSN recipe as not runnable.
  On the committed *embedded-diff* golden (source off-disk) only a form check
  applies — the grader must not claim to have read source it cannot reach there.
- **Author riders: low-risk, correctness gain unmeasured.** R1-R3 are tiny prose
  additions. Validation is a RUNG form/no-regression check (worst-of-N≥3) — a
  presence check, honestly **not** a correctness measurement (same power limit as
  the ablation dropped in the prior phase). We do not overclaim it proves grounding
  improved.
- **Mechanical.** Author side: assertions in `tests/skills/qa-plan-authoring.test.ts`,
  `tests/skills/test-plan-format.test.ts`, `tests/modules/plan/veles-prompt.test.ts`;
  `bun run build:root`; `dist/` in sync; `bun run check` green. Grader side is
  docs-only (`docs/eval/` is outside the dist pipeline) — no rebuild.

## 8. Decisions resolved during brainstorm + review

- Priority = grader reliability first (the report's headline was a grader
  hallucination). ✔
- "Ground in logic, don't mirror tests" → §3 hierarchy, with the Y2 floor so it
  cannot regress the BE-02 status win. ✔
- Grader form = a reusable protocol (Option A), reusing playbook vocabulary. ✔
- Author half = three narrow riders; the framework/read-then-cite prose already
  ships and is NOT restated. ✔ (round-1 review)

## 9. Open question for the user (a real scope call)

Half 1 shrank to three small riders, and the most damaging author defect (the
BE-02 body) is efficacy-bound, not prose-fixable. Two reasonable scopes:

- **(a) Grader + the three riders** — ship R1-R3 alongside the grader.
- **(b) Grader only** — ship just the disciplined grader now; log R1-R3 as a tiny
  follow-up. Rationale: the framework-grounding prose already works, and R1-R3's
  correctness gain is unmeasured at n=3.

Recommendation: **(a)** — the riders are cheap, one of them (R1 test-tier) is the
user's explicit ask, and R3's DSN fix is a confirmed real defect.

## 10. Implementation order (detail deferred to the plan)

1. `docs/eval/grading-protocol.md` + playbook pointer.
2. Grader acceptance test against the i-need-cv Layer-2 checkout (proves the
   priority before touching Veles).
3. Author riders R1 (test-tier + floor) and R2 (claim-specific citation) in
   `qa-plan-authoring` Step 0 / Step 6.8 + `veles.md` echo.
4. R3 recipe/DB rules in `test-plan-format`.
5. Tests + `bun run build:root` + `bun run check`.
6. RUNG form/no-regression check (worst-of-N) → RESULT block (no correctness
   overclaim).
