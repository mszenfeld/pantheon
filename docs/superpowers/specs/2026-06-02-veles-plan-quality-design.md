# Design: Raising Veles QA-plan quality

**Date:** 2026-06-02
**Status:** v3 — after two mixture-of-agents review rounds (round 1 reshaped v1→v2;
round 2 audited v2 and found one decisive defect + polish). Ready for
implementation planning.
**Scope:** `src/skills/qa/qa-plan-authoring`, `src/skills/qa/test-plan-format`,
`src/modules/plan/veles.md`, the QA runner skills
(`src/skills/qa/{be-testing,fe-testing,report-format}`),
`docs/eval/scenarios/veles/`, and the corresponding `dist/` artefacts.

> Written in English to match the codebase and existing docs; the brainstorming
> discussion was in Polish.

## Revision history

- **v1 → v2** (round-1 review): under-diagnosed root cause and two over-built
  mechanisms. v2 added a diagnose-first step, made A1 structural, replaced the
  blanket completeness sweep with targeted coverage, experiment-gated the
  re-read, de-circularized the eval, and added build/dist + tests + sequencing.
- **v2 → v3** (round-2 review): v2 closed all 17 round-1 findings and added no
  false claims, but two independent reviewers flagged the same decisive defect —
  **A1's citations were invisible**, so the cheap gate could only enforce the
  honesty tag, not grounding, and the eval could not observe its own primary
  mechanism. v3 fixes:
  - **Citations are VISIBLE inline** in the plan body (decision Q1). This is the
    decisive change — it makes the gate, the eval, and the future `momus` seam
    all real.
  - A1 amends the existing Step 6 in place; the Step 6.7 **self-check** is a
    shared-skill step; the **hard stop before JSON is Veles-only** (resolves the
    "gate home" ambiguity).
  - §0.2 (the plan-vs-plan diff) is a **hard prerequisite** for A3; only the
    transcript pull (§0.1) stays best-effort.
  - The re-read experiment's **fail outcome is named** in Success Criteria.
  - **C1b deferred to a named v2.1 follow-up** (decision Q2) — it was unbuildable
    as written, and a vague "honest measure" is worse than none.
  - Minor fact-check wording fixes (verify-dist indirection, "not yet" IPv6,
    load-asset sibling).

## Motivation

Two QA test plans were generated in parallel for the same change set (an
export-PDF endpoint): **Plan A** via the **marketplace** `qa:create-plan`, and
**Plan B** via the **Veles** planner in this harness. An independent comparison
rated Plan A higher. This design closes the *real* quality gaps in Plan B.

### The format critique — discounted, but not dismissively

The report scored Plan B "format non-compliant" for using YAML frontmatter +
`## Setup` + `**Bindings:**`, whereas Plan A used `## Source` / `## Detected
Tools` body sections. The **current** `test-plan-format` skill
(`src/skills/qa/test-plan-format/SKILL.md:19`) describes the frontmatter form as
the structure and states there is *no* separate `## Source` / `## Detected Tools`
body section. So the report graded Veles against an **older marketplace
standard**.

We do **not** revert the format — and not only on "our skill is newer" grounds
(motivated reasoning). Reverting to body-section metadata would **break Perun's
frontmatter-based parse** (`perun.md` reads `source` / `base-url` /
`detected-tools` from frontmatter), so it is a pipeline necessity, not taste.
*Open question we concede:* the report may have rated Plan A higher partly for
**human legibility** of its body sections. v3 answers this two ways: visible
inline citations (A1) put evidence in front of a human reader, and the cheap
fix for the metadata is a richer human-readable `## Changes Summary` — not moving
machine-parsed metadata back into the body. (The one real filename defect — Plan
B dropped the `-test-plan` suffix — is addressed in A4.)

### Architectural insight

Both callers load the **same two skills**: `qa-plan-authoring` →
`test-plan-format` (`veles.md:29`, `create-qa-plan.md:31`,
`qa-plan-authoring/SKILL.md:88`). So content rules belong in the shared skills
(they lift both callers); only the **enforcement** of a hard gate is
wrapper-specific.

### Root cause — to be confirmed, not assumed (see §0)

Working hypothesis: Veles emits plausible-but-unverified claims and stops early,
without a grounding or coverage gate. v1 also blamed "second-hand planning via
`triglav`" — but we have no evidence Veles dispatched `triglav` in the failing
run. **More importantly:** the skills *already* contain a grounding rule ("DB
checks with real table/column names", `qa-plan-authoring` Step 6), a full
edge-case taxonomy, and a Plan Quality Checklist (`test-plan-format`) — all
loaded, and the plan still had vague DB checks and missed scenarios. That is
direct evidence that *adding more forceful prose* is the weakest lever. v3
prefers **structural, observable** rules over restated guidance — hence visible
citations.

### The real gaps (all in scope)

1. **Grounding / factual accuracy** — asserts behavior without reading code:
   "sliding window" (the limiter is default fixed-window), "deleted user → 401"
   (auth verifies signature/claims, not user existence), "IPv4-based"
   (`get_remote_address` returns the host, v4 or v6). Plus vague DB checks.
2. **Coverage depth** — missed specific behavior classes (enumerated in §0.2 from
   the plan-vs-plan diff). *Not* "fewer scenarios" — count is not quality.
3. **Environment detection** — guessed *remote* Supabase + password grant instead
   of the repo's actual *local* Supabase (ES256, local ports).
4. **Assertion robustness** — asserts full human-readable message text (brittle).

## Guiding principle

> **Wrong-but-confident is worse than honestly-unverified.**

Every behavioral assertion either carries a **visible `(file:line)` citation** to
code the author read, or is tagged `(unverified — confirm at run time)`. The
model never guesses silently, and the evidence travels with the claim.

## Decisions locked during brainstorming + review

- **Mechanism:** layered — content rules in the shared skills + Veles-side
  enforcement. No new agents.
- **Self-review independence — inline only; the re-read part is
  experiment-gated.** Rejected delegating verification to `triglav`: it is
  *tuned for exploration, not critique*, and under the recommended config also
  runs a cheaper model (`docs/configuring-agents.md` assigns it haiku vs Veles's
  opus; `triglav` is `cost: FREE`, Veles `cost: EXPENSIVE`). **Note:** this is a
  configuration *convention*, not a code invariant — with no `pantheon.json`
  both inherit the same session model (`plan/index.ts:34`, `explore/index.ts`).
  Either way, verification belongs to a critique-tuned peer (the reserved
  `momus`), not the explorer; the gate is shaped to delegate to it later.
- **Visible citations** (decision Q1): `(file:line)` appears inline on the
  assertion in the plan body — same shape as the existing `(unverified)` /
  `(exact text — brittle)` tags, which Perun's parser ignores.
- **Re-read gate is experiment-gated** (decision D1): ship the cheap structural
  requirement first; build the cognitive re-read into the hot path only if a
  one-shot efficacy test passes (§B-expensive).
- **`(unverified)` is taught to the runner** (decision D2): the runner downgrades
  a mismatch on an `(unverified)`-tagged expectation to a warning, not a HIGH
  issue.
- **C1b deferred to v2.1** (decision Q2): the first cut ships the C1 regression
  guard; the held-out generic measure is a named follow-up, specified properly
  later rather than shipped vague.

---

## §0 — Diagnose first

Ground the rules in data before writing them.

- **§0.1 — Transcript pull (best-effort, skippable).** If the failing export-PDF
  Veles run transcript is retained, check: did it dispatch `triglav`? did it cite
  `file:line` for the wrong claims? were the skills loaded? This distinguishes
  *missing attribution* (cheap rule fixes it) from *misreading cited code* (only
  re-read / `momus` fixes it). If unavailable, record "did Veles dispatch
  triglav?" as an assumption to validate on the next real run.
- **§0.2 — Plan-vs-plan diff (HARD prerequisite for A3).** Diff the two real
  plans scenario-by-scenario (both exist) and extract the *named* behavior
  classes Plan B missed: expiry boundary `valid_to = now()`,
  one-expired-one-active, "the limit counts all results not just 200s", lock
  cleanup, the worker-mismatch → 502 paths. These named classes are the **sole
  source** of A3's targeted coverage. **A3 MUST NOT be implemented before §0.2 is
  complete** — otherwise A3 silently degrades into the blanket guidance it
  replaced. (Several classes are already extracted here, so the load-bearing half
  is largely done.)

---

## Section A — content rules (shared skills)

### A1. Visible citation-or-`(unverified)` — amends `qa-plan-authoring` Step 6 in place

> A1 is an **in-place amendment to the existing Step 6 ("Generate scenarios")**,
> not a new step.

Every behavioral assertion in a scenario — status code, rate-limit semantics,
auth/authz outcome, error-envelope shape, derived values such as a generated
filename — **must carry, inline in the plan body, either a visible `(file:line)`
citation to the code the author read, or the `(unverified — confirm at run time)`
tag.** Example:

> **Expected response:** status 429 after the 6th request within 60s
> (`api/auth/ratelimit.py:12`).

Form rules (control clutter): one citation on the **single most load-bearing
line** per assertion, not every line; for DB checks the column citation is
implicit in the real SQL; for derived values cite the producer (e.g.
`filename.py`).

- **What the gate can check (real, observable):** the citation is **present and
  well-formed** (`path:line` shape) for every non-`(unverified)` assertion — a
  structural check on the durable plan file, not a private self-attestation.
- **Acknowledged limit:** presence ≠ correctness. Forcing a visible citation
  makes the author *locate* the code (which cuts pure invention) but does not
  prove it was read *correctly*. The "misread the cited code" failure is what
  §B-expensive (re-read) and, later, `momus` address. Escalation ladder: visible
  attribution now → experiment-gated re-read → independent `momus` later.

### A2. Test-environment detection — new `qa-plan-authoring` Step 4.6 (after 4.5, before 5)

Step 4 detects *tools*; Step 4.6 detects the *environment* by reading the repo's
real test infra instead of guessing: `supabase/config.toml` (local ports,
ES256 vs HS256), `.env` / `.env.test` / `.env.local`, `docker-compose*.yml` /
`compose.yaml` (ports, DSNs), `conftest.py` / test settings / `pytest.ini` / DB
fixtures.

**Rule:** prefer the repo's declared local test infra over a guessed remote
endpoint; a remote URL may be emitted only if it came from a config file read.

**Must satisfy the existing Setup Rules** (`test-plan-format`), or the plan is
locally-correct but harness-rejected:

- **Normalize IPv6 → `127.0.0.1` / `localhost`** in any DSN or binding host —
  IPv6 DSNs are *not yet supported* (`test-plan-format/SKILL.md:110`).
- A binding's **`Egress:` host must equal the host its recipe connects to**
  (`SKILL.md:156`); do not mix auth/DB ports in one binding.
- Emit **env-var names only, never values**; never inline a secret into a recipe.
- Credential-prefixed names (`SUPABASE_` / `DATABASE_` / `POSTGRES_`…) cannot be
  chat-pasted (`perun.md:298-299`) — prefer binding inputs with neutral names.

**Tooling constraint:** use only the skill's existing read tools
(`Read`/`Glob`/`Grep`). Do **not** add a new `Bash(...)` token — it would break
the `allowed-tools` subset invariant (see "Tests to update", M-2).

### A3. Targeted MUST-coverage — new `qa-plan-authoring` Step 6.6 (after the existing 6.5)

> Step **6.5 already exists** (Binding completeness check). A3 is **6.6**, the
> self-check is **6.7**. Do not renumber 6.5.

Replace v1's blanket "enumerate every path" sweep with a **named coverage
matrix**: for each changed surface, confirm coverage of the *specific* behavior
classes from §0.2 (success path; each error path the code can return; each
auth/authz branch; the named boundaries). **Depends on §0.2** for its class list.

- **Anti-padding stays supreme** (Step 4.5): a class with nothing observable over
  Playwright / HTTP / DB is listed under "Out of harness scope", not padded.
- Coupled with A1: a "covered" claim for an error path needs a citation for the
  path. **Scenario count is not a quality signal** and is not used as one.

### A4. Assertion style — `test-plan-format`

- **Primary:** stable status code + structural body shape (keys/types).
- **Secondary, opt-in only when status+shape cannot disambiguate:** exact
  message text, tagged `(exact text — brittle)`; the runner matches it as
  **substring/contains, not equality**.
- Reinforce `qa-plan-authoring` Step 7: the saved filename **must** carry the
  `-test-plan` suffix.

---

## Section B — enforcement (Veles + a shared self-check)

### B-shared. Step 6.7 self-check (shared skill content)

A new `qa-plan-authoring` **Step 6.7**: scan the draft and confirm every
behavioral assertion is cited (visible `file:line`) or `(unverified)`-tagged, the
A3 coverage matrix is filled (or omissions listed out-of-scope), and the filename
has the `-test-plan` suffix. Both callers run this step; it is cheap and inert
for the marketplace path.

### B-cheap. Hard stop before JSON (Veles-only)

`veles.md` adds the enforcement that the marketplace command structurally cannot
have (it has no output contract — `create-qa-plan.md` just proposes a next step):

> You may not emit the result JSON until the Step 6.7 self-check passes — every
> behavioral assertion is cited or `(unverified)`-tagged and the coverage matrix
> is filled. Wrong-but-confident is worse than honestly-unverified.

This is the honest resolution of the v1 "both benefit" overclaim: the **writing
rule + self-check are shared**; the **hard gate is Veles-only**; the marketplace
command **inherits the guidance, not a hard gate**.

### B-expensive. Cognitive re-read pass (experiment-gated — D1)

Optionally, after the cheap gate, re-read each cited fragment with intent to
*refute* the assertion and fix mismatches. **Build into the hot path only if it
earns its place:** run the efficacy experiment first — feed the actual failing
export-PDF plan back to the Veles-class model with the refute-prompt and measure
how many of the 3 seeded errors ("sliding window", "deleted-user→401",
"IPv4-based") it catches. Build in **only if ≥ 2/3**; otherwise leave it out and
wait for `momus`. (Same model re-reading what it just summarized may re-confirm
its own confident error — the experiment is cheap insurance against shipping
theater into an `EXPENSIVE` agent.)

### B-seam. `momus` delegation seam

Phrase the gate so it can delegate later: *"When `momus` is available, this gate
delegates per-claim verification to it; until then Veles performs the structural
check itself."* **Preserve a `(reserved)` mention** for `momus` in `veles.md`
(the prompt test asserts the `(reserved)` token — "Tests to update", M-1).

### Reconciling two existing rules

- **`veles.md:11` "do NOT redo a search you delegated" vs the re-read pass.**
  Frame the re-read as a *scoped exception*: verification is not exploration.
  `veles.md` must say so, not leave the two rules adjacent and contradictory.
- **Ordering.** The self-check/gate is **pre-save** (Step 6.7, before Save Step 7)
  and verifies the **in-memory draft**. Drop any "after the skill saves" phrasing.

---

## Section C — measurement (before/after)

### C1. Trap-seeded scenario — a REGRESSION GUARD (ships in the first cut)

A scenario seeded with the report's exact traps, used to catch *regressions* of
the three known failures. **Traps embedded inline in the `## Query` diff**
(Layer-1 self-contained convention of `qa-plan-from-diff.md`); **no fixture files
committed** (a real `supabase/config.toml` would pollute the harness repo):

- rate limiter with no `strategy` (correct = fixed-window) → penalize "sliding";
- auth verifying only the signature → penalize "deleted-user→401";
- `get_remote_address` → penalize "IPv4-based";
- a local `supabase/config.toml` block in the diff (ES256, local ports) →
  penalize a guessed remote Supabase + password grant;
- real column `valid_to` available → expect it in DB checks;
- boundary MUSTs (expiry `valid_to = now()`, one-expired-one-active);
- **a check that behavioral assertions carry a visible `(file:line)` citation or
  `(unverified)` tag** (now observable from the plan file).

**Explicitly:** passing C1 proves the three named regressions are absent — it
does **not** prove general quality improvement (that is C1b's job, deferred).

### C2. Strengthen existing grounding signals (first cut)

Both `qa-plan-from-diff.md` and `qa-plan-multi-principal.md` already have a
"Grounding / no hallucination" signal. C2 **strengthens the wording** to grade
the new failure classes (visible-citation-or-tag discipline; local-vs-remote
infra) — it does not add a missing signal.

### C1b. Held-out generic grounding measure — DEFERRED to v2.1 (named follow-up)

The honest, general measure. **Not shipped in the first cut** because it is its
own design task; shipping it vague invites false confidence. When built, it needs
all of: a concrete embedded diff in a **different domain** (e.g. webhook-signature
or file-upload), **3–4 deliberately-misstatable behaviors** with a **committed
ground-truth answer key**, a grading procedure that scores claim-vs-key (now
aided by the visible citations), a **fixed iteration count**, and a **captured
pre-change baseline**. Until then, the first cut relies on C1 (regression) + the
visible-citation structural check.

### C3. Explicitly out of scope (this design)

- `momus` / independent verification — seam only.
- Reworking exploration so Veles reads everything first-hand — not touched.
- The report's incidental finding (a test-scenario identifier in production code,
  `pdf-worker:63`) — different repo, belongs to code-review.

---

## Build & CI (mandatory)

`dist/` is **git-tracked** (`.gitignore:2-4` ignores `dist/` then force-un-ignores
`!dist/` / `!dist/**`). Production loads prompts from `dist/`
(`load-asset.ts:31-33` resolves the `.md` sibling of the compiled
`dist/modules/plan/prompt.js`); `scripts/copy-root-assets.mjs` copies
`src/{commands,agents,skills}/**.md` (and `src/modules/**/*.md`) into `dist/`
during `build:root`. The `verify-dist` npm script delegates to
`scripts/verify-dist-sync.mjs`, which runs `bun run build` then `git status` over
tracked `dist/` paths and **exits non-zero on drift**.

**Therefore:** after editing the `src/` files, run `bun run build` and **commit
the regenerated `dist/` siblings** in the same change. Editing only `src/` ships
nothing; CI's `verify-dist` is the gate.

## Tests to update

- **M-1 — `tests/modules/plan/veles-prompt.test.ts:13-26`:** asserts the prompt
  `toContain` a fixed set including `"(reserved)"` (line 25). B-seam must keep a
  `(reserved)` mention; add assertions for the new gate / hard-stop language.
- **M-2 — `tests/modules/plan/allowed-tools.test.ts:24-31` +
  `tests/skills/qa-plan-authoring.test.ts:36-40`:** assert the skill
  `allowed-tools` ⊆ `VELES_TOOLS` ⊆ command tools. A2 must use existing read
  tools so the invariant holds.
- No snapshot tests exist (none use `toMatchSnapshot`).

## Downstream tag handling (decision D2)

- **Perun** parses by heading/`Depends-on` regex + frontmatter and ignores
  expected-result prose (`perun.md:72`) → **no change needed**; the inline
  citations and tags are inert to it.
- **QA runner** (`be-testing`, `fe-testing`, `report-format`): a mismatch on an
  expectation tagged `(unverified — confirm at run time)` is reported as a
  **warning**, not a HIGH issue; an `(exact text — brittle)` assertion is matched
  as **substring/contains, not equality**; visible `(file:line)` citations are
  ignored by the runner (human/`momus`-facing only).

---

## Affected files (summary)

| File | Change |
|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | A1 (amends Step 6 in place), A2 (new Step 4.6), A3 (new Step 6.6 — 6.5 already taken), B-shared self-check (new Step 6.7), A4 filename reinforcement (Step 7) |
| `src/skills/qa/test-plan-format/SKILL.md` | A4 assertion style; visible `(file:line)` / `(unverified)` / `(exact text — brittle)` tag format; richer `## Changes Summary` guidance |
| `src/modules/plan/veles.md` | B-cheap hard stop before JSON; B-seam (`momus`, preserve `(reserved)`); reconcile delegation rule; pre-save ordering |
| `src/skills/qa/{be-testing,fe-testing,report-format}/SKILL.md` | D2 — `(unverified)` → warning; `(exact text — brittle)` → substring; ignore `(file:line)` |
| `docs/eval/scenarios/veles/` | C1 inline trap regression scenario; C2 strengthen existing signals (C1b deferred to v2.1) |
| `tests/modules/plan/veles-prompt.test.ts`, `allowed-tools.test.ts`, `tests/skills/qa-plan-authoring.test.ts` | M-1 / M-2 |
| `dist/**` | regenerated via `bun run build`, committed (verify-dist gate) |
| `src/agents/perun.md` | **no change** (tags/citations inert to its parser) |

## Implementation order

1. **§0.2 plan diff** (hard prereq → named coverage classes for A3); §0.1
   transcript best-effort.
2. A4 (format incl. visible-citation tag shape) → A1 (visible citation-or-tag,
   amends Step 6) → A2 (env detection, Step 4.6) → A3 (targeted coverage, Step
   6.6).
3. B-shared self-check (Step 6.7) → B-cheap hard stop in `veles.md` → B-seam
   (preserve `(reserved)`); reconcile delegation rule + pre-save ordering.
4. Update `veles-prompt.test.ts` (M-1); confirm tool-subset invariant (M-2).
5. D2 runner rules (`be-testing`/`fe-testing`/`report-format`).
6. `bun run build` + commit regenerated `dist/`.
7. C2 (strengthen signals) → C1 (regression scenario).
8. **8a** run the B-expensive efficacy experiment, record pass/fail → **8b**
   build the re-read into the hot path **iff ≥ 2/3**.
9. Run C1 to check the regression criteria against the **resulting** hot path
   (cheap-only, or cheap+re-read per 8b).

## Success criteria (first cut)

- **Structural (always observable from the plan file):** every behavioral
  assertion carries a visible `(file:line)` citation or an `(unverified)` tag; DB
  checks use real columns; filename has the `-test-plan` suffix; the JSON
  contract validates.
- **Regression (C1):** the "sliding window", "deleted-user→401", and "IPv4-based"
  errors do not reappear; the run targets local Supabase (ES256); the named
  boundary classes are covered.
- **Re-read gate:** built into the hot path **iff** the 8a experiment passed
  (≥ 2/3). **If it fails**, the first cut ships *no grounding-correctness*
  improvement beyond visible attribution + A2 + C1 regression detection — this is
  an accepted, named outcome, with correctness deferred to `momus`, not a silent
  gap.
- **General grounding gain:** measured by **C1b — deferred to v2.1**; not claimed
  by the first cut.

## Follow-ups (v2.1+)

- **C1b** held-out generic grounding eval (fully specified above).
- **`momus`** adversarial reviewer → becomes the executor of the B-seam gate.
- Reconsider whether richer `## Changes Summary` fully answers the legibility
  open-question after the first cut ships.
