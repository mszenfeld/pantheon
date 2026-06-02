# Design: Raising Veles QA-plan quality

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation planning
**Scope:** `src/skills/qa/qa-plan-authoring`, `src/skills/qa/test-plan-format`, `src/modules/plan/veles.md`, `docs/eval/scenarios/veles/`

> Written in English to match the codebase and existing docs; the brainstorming
> discussion was in Polish.

## Motivation

Two QA test plans were generated in parallel for the same change set (an
export-PDF endpoint):

- **Plan A** — produced via the **marketplace** `qa:create-plan`.
- **Plan B** — produced via the **Veles** planner in this harness.

An independent comparison rated Plan A higher. This design closes the *real*
quality gaps in Plan B without copying Plan A's stale format.

### What the report got wrong (a false signal we explicitly discount)

The report scored Plan B as "format non-compliant" because it used YAML
frontmatter + `## Setup` + `**Bindings:**` + `SETUP-XX`, whereas Plan A used
`## Source` / `## Detected Tools` body sections.

This is backwards. The **current** `test-plan-format` skill
(`src/skills/qa/test-plan-format/SKILL.md:19`) *mandates exactly the format Plan
B used* and *explicitly forbids* the `## Source` / `## Detected Tools` body
sections that Plan A used. The report graded Veles against an **older
marketplace standard**. We do **not** revert the format. (The one real
filename defect — Plan B dropped the `-test-plan` suffix — is addressed in A4.)

### Architectural insight

Both callers load the **same two skills**: `qa-plan-authoring` →
`test-plan-format`. The quality difference is therefore *not* in the skill
content — it is in the **agent wrapper / execution context**. So:

- Content rules (gaps #1–#4) belong in the **shared skills** → they lift *both*
  the marketplace command and Veles.
- The "stop early / emit unverified claims" behavior is a **Veles-wrapper**
  problem → fixed in `veles.md`.

### Root cause

Veles plans **second-hand** (delegates exploration to `triglav`, synthesizes
summaries — "do NOT redo a search you delegated") and runs under a "finish and
return JSON" pressure, with **no verification or completeness gate**. The
marketplace `/create-qa-plan` reads code first-hand in a richer context, so it
produces real DB columns, fewer hallucinations, and deeper coverage. Veles
writes plausible-but-unverified claims and stops early.

### The real gaps (all in scope)

1. **Grounding / factual accuracy** — asserts behavior without reading code:
   "sliding window" (the limiter is default fixed-window), "deleted user → 401"
   (auth verifies signature/claims, not user existence), "IPv4-based"
   (`get_remote_address` returns the host, v4 or v6). Plus vague DB checks with
   no real columns.
2. **Coverage depth** — 10 scenarios vs 14; fewer boundaries/edge cases.
3. **Environment detection** — guessed *remote* Supabase + password grant
   instead of the repo's actual *local* Supabase (ES256, local ports).
4. **Assertion robustness** — asserts full human-readable message text (brittle).

## Guiding principle

> **Wrong-but-confident is worse than honestly-unverified.**

Every behavioral assertion is either traced to code the author actually read, or
explicitly tagged `(unverified — confirm at run time)`. The model never guesses
silently.

## Decisions locked during brainstorming

- **Mechanism:** layered — content rules in the shared skills + an inline
  self-verification gate in Veles. No new agents.
- **Self-review independence:** *inline only* (the same Veles model re-reads the
  cited code). Rejected delegating verification to `triglav` — it runs a *weaker*
  model than Veles, so a weaker model "reviewing" a stronger one's claims is an
  inverted pyramid that adds cost and false confidence. True independent review
  waits for the reserved `momus` (peer-or-stronger critic), not yet built. The
  gate is shaped to delegate to `momus` later with no restructuring.
- **Gate placement:** defined once as a step in the shared `qa-plan-authoring`
  skill (so the marketplace command benefits too); `veles.md` enforces that it
  actually ran before emitting JSON.

---

## Section A — content rules (shared skills)

### A1. Grounding discipline — `qa-plan-authoring` Step 6

Every behavioral assertion in a scenario — status code, rate-limit semantics,
auth/authz outcome, error-envelope shape, derived values such as a generated
filename — **must be traced to a specific `file:line` the author actually
read**. If the code that produces a behavior has not been read: either read it,
or tag the expectation `(unverified — confirm at run time)`.

- Citations are an **internal gate**, not plan-body content — they do not
  clutter scenarios.
- Only the `(unverified)` tag surfaces in the plan body, so the runner/human
  knows which expectations were not confirmed.
- Directly targets the "sliding window", "deleted-user→401", and "IPv4" classes
  of error, and the vague DB checks.

### A2. Test-environment detection — new `qa-plan-authoring` Step ~4.7

Today Step 4 detects *tools* (`curl`/`psql`/…). It does **not** detect the
actual test *environment*. Add a step that reads the repo's real test infra
instead of guessing:

- `supabase/config.toml` — local ports (e.g. 54321/54322), JWT signing alg
  (ES256 vs HS256).
- `.env`, `.env.test`, `.env.local`.
- `docker-compose*.yml` / `compose.yaml` — service ports, DSNs.
- `conftest.py`, test settings, `pytest.ini`, DB fixtures.

**Rule:** prefer the repo's declared local test infra over a guessed remote
endpoint; if a remote URL is emitted, it must come from a config file that was
read. Detected values feed the frontmatter (`base-url`, DSNs) and `**Bindings:**`
recipes (local login with the correct grant). Targets the "remote Supabase +
password grant" defect.

### A3. Completeness sweep — new `qa-plan-authoring` Step ~6.6 (pre-save)

A forcing function for depth. For each changed surface, the author builds an
*internal* matrix (changed endpoint × edge-case classes from the existing
taxonomy) and explicitly enumerates: the success path, **every** error path the
code can return, every auth/authz branch, and every boundary (expiry
`valid_to = now()`, one-expired-one-active, "the limit counts all results, not
just 200s", lock cleanup, …). Omissions must be **justified**, not just stopped
at N.

- Coupled with the anti-padding rule already in Step 4.5 (a small honest plan
  beats a large un-runnable one).
- Coupled with A1: you cannot enumerate "the error paths the code can return"
  without reading the code. Grounding and completeness reinforce each other.
- Aligns with how the eval already grades ("shallow/incomplete plan" is its
  primary discriminator). Targets the 10-vs-14 gap.

### A4. Assertion style — `test-plan-format`

- **Primary:** stable status code + structural body shape (keys/types).
- **Secondary, optional:** exact human-readable message text — and when present,
  tagged brittle, e.g. `(exact text — brittle)`.
- Reinforce `qa-plan-authoring` Step 7: the saved filename **must** carry the
  `-test-plan` suffix (the one real naming defect in Plan B).

---

## Section B — self-verification gate (Veles)

Change is confined to `src/modules/plan/veles.md` (the "QA test plan" mode). The
flow today is *load skill → author → return JSON*. Insert a hard step **between**
authoring and JSON.

### B1. Verify-before-emit gate

After the skill saves the draft but **before** Veles emits the result JSON, it
must run the verification pass. The pass is **defined as `qa-plan-authoring`
Step 6.7** (shared, so the marketplace command runs it too); `veles.md` only
enforces that it *actually ran*:

1. Collect every behavioral assertion in the draft with its `file:line`
   citation.
2. Re-read each cited fragment (serena-first) and mark it confirmed / mismatch /
   not-verifiable.
3. Mismatch → fix the scenario. Not-verifiable → tag `(unverified)`.
4. Run the completeness sweep (A3) — confirm the matrix is full.

### B2. Hard stop rule

> You may not emit the result JSON until every behavioral assertion is either
> traced in code or tagged `(unverified)`, and the completeness sweep is closed.
> Wrong-but-confident is worse than honestly-unverified.

This deliberately removes the "finish pressure" created by the JSON contract:
quality first, contract second.

### B3. Seam for `momus`

Phrase the step so it can delegate later: *"When a dedicated reviewer (`momus`)
is available, this gate delegates per-claim verification to it; until then you
perform it yourself."* One sentence, zero restructuring when `momus` lands — it
becomes the executor of the same step.

**Acknowledged trade-off:** the same (strong) Veles model verifies its own
claims — weaker than an independent critic, but *re-reading the cited code with
explicit intent to refute* is a different mode from generation and catches a
large share of "wrote it from memory" errors. Full independence waits for
`momus`.

---

## Section C — measurement (before/after)

The eval playbook already exists under `docs/eval/scenarios/veles/`.

### C1. New eval scenario modeled on the real export-pdf case

A scenario seeded with the report's traps, to measure exactly these gaps. Uses
the existing file convention (**MUST / NICE-TO-HAVE / Quality signals / What
this discriminates**, ranking not pass/fail, ≥2 iterations):

- **Grounding:** a rate limiter with no `strategy` (correct = fixed-window) →
  penalize "sliding"; auth that verifies only the signature → penalize
  "deleted-user→401"; `get_remote_address` → penalize "IPv4-based".
- **Real DB columns:** scenarios must use actual columns (e.g. `valid_to`), not a
  vague description.
- **Env detection:** fixture contains a local `supabase/config.toml` (ES256,
  local ports) → penalize a guessed remote Supabase + password grant.
- **Coverage depth:** MUST items on boundaries (expiry `valid_to = now()`,
  one-expired-one-active, "the limit counts all results").
- **Assertion style:** prefer stable codes; full text only when tagged.

### C2. Light update to existing scenarios

Add an explicit "grounding / no-hallucination" signal to
`qa-plan-from-diff.md` and `qa-plan-multi-principal.md` where it is not already a
named criterion, so the new rules are graded consistently.

### C3. Explicitly out of scope

- `momus` / independent verification — seam only; implementation later.
- Reworking exploration so Veles reads everything first-hand instead of using
  `triglav` — not touched; grounding forces re-reading of *cited* code, which
  targets the problem without overturning the architecture.
- The report's incidental finding (a test-scenario identifier embedded in
  production code, `pdf-worker:63`) — belongs to a *different* repo and to
  code-review, not to the planning harness. Noted, out of scope.

---

## Affected files (summary)

| File | Change |
|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | A1 (Step 6), A2 (new Step ~4.7), A3 (new Step ~6.6), B1 gate (new Step 6.7), A4 filename reinforcement (Step 7) |
| `src/skills/qa/test-plan-format/SKILL.md` | A4 assertion-style guidance; `(unverified)` / `(exact text — brittle)` tags in the format |
| `src/modules/plan/veles.md` | B1/B2/B3 — enforce the gate before JSON; hard-stop rule; `momus` seam |
| `docs/eval/scenarios/veles/` | C1 new export-pdf-style scenario; C2 grounding signal on existing two |

## Success criteria

On the C1 eval scenario, a faithful run:

- does not assert the "sliding window", "deleted-user→401", or "IPv4-based"
  errors (grounding);
- uses real DB columns in DB checks;
- targets the repo's local Supabase (ES256), not a guessed remote endpoint;
- covers the boundary scenarios listed in C1 (depth ≥ the marketplace plan);
- asserts stable status codes, with any full-text assertion tagged brittle;
- still satisfies the existing JSON contract gate and the `-test-plan` filename
  convention.
