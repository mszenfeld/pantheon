# Design: Raising Veles QA-plan quality

**Date:** 2026-06-02
**Status:** v2 — revised after a mixture-of-agents review (4 lenses: claim
fact-check, architecture coherence, adversarial effectiveness, implementation
feasibility). Ready for implementation planning.
**Scope:** `src/skills/qa/qa-plan-authoring`, `src/skills/qa/test-plan-format`,
`src/modules/plan/veles.md`, the QA runner skills
(`src/skills/qa/{be-testing,fe-testing,report-format}`),
`docs/eval/scenarios/veles/`, and the corresponding `dist/` artefacts.

> Written in English to match the codebase and existing docs; the brainstorming
> discussion was in Polish.

## What changed from v1 (review summary)

The v1 targets were right; the mechanism was over-built on an under-diagnosed
root cause. v2 keeps the targets, leads with the **cheap structural** levers,
and demotes the **expensive cognitive** ones behind evidence:

- **Diagnose before building** (new §0) — the failing run's behavior was assumed,
  not observed.
- **A1 becomes a structural "citation-or-`(unverified)`" requirement** (cheap,
  enforceable, genuinely shared) instead of relying on more forceful prose the
  model already ignored once.
- **A3 becomes targeted MUST-coverage of named missing classes** (from a diff of
  the two real plans), not a blanket "enumerate everything" sweep that fights the
  existing anti-padding rule. Scenario-count is dropped as a quality signal.
- **The re-read gate (B-expensive) is experiment-gated** — built into the hot
  path only if a one-shot test shows it catches the errors it is meant to catch.
- **The trap-seeded eval (C1) is relabeled a regression guard**, with a held-out,
  generically-graded scenario (C1b) added to avoid teaching-to-the-test.
- Added the **build/dist**, **tests-to-update**, **downstream-tag**, and
  **sequencing** sections the v1 omitted.

## Motivation

Two QA test plans were generated in parallel for the same change set (an
export-PDF endpoint):

- **Plan A** — produced via the **marketplace** `qa:create-plan`.
- **Plan B** — produced via the **Veles** planner in this harness.

An independent comparison rated Plan A higher. This design closes the *real*
quality gaps in Plan B.

### The format critique — discounted, but not dismissively

The report scored Plan B "format non-compliant" for using YAML frontmatter +
`## Setup` + `**Bindings:**`, whereas Plan A used `## Source` / `## Detected
Tools` body sections. The **current** `test-plan-format` skill
(`src/skills/qa/test-plan-format/SKILL.md:19`) describes the frontmatter form as
the structure and states there is *no* separate `## Source` / `## Detected Tools`
body section. So the report graded Veles against an **older marketplace
standard**.

We do **not** revert the format — and not only on "our skill is newer" grounds
(which would be motivated reasoning). Reverting to body-section metadata would
**break Perun's frontmatter-based parse** (`perun.md` reads `source` /
`base-url` / `detected-tools` from frontmatter), so it is a pipeline necessity,
not just taste. *Open question we concede:* the report may have rated Plan A
higher partly for **human legibility** of its body sections. The cheap answer is
to make the existing human-readable `## Changes Summary` section richer — not to
move machine-parsed metadata back into the body. (The one real filename defect —
Plan B dropped the `-test-plan` suffix — is addressed in A4.)

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
run, and for a self-contained diff its own prompt forbids it. **More
importantly:** the skills *already* contain a grounding rule ("DB checks with
real table/column names", `qa-plan-authoring` Step 6), a full edge-case taxonomy,
and a Plan Quality Checklist (`test-plan-format`) — all loaded, and the plan
still had vague DB checks and missed scenarios. That is direct evidence that
*adding more forceful prose* is the weakest lever. v2 therefore prefers
**structural, enforceable** rules over restated guidance.

### The real gaps (all in scope)

1. **Grounding / factual accuracy** — asserts behavior without reading code:
   "sliding window" (the limiter is default fixed-window), "deleted user → 401"
   (auth verifies signature/claims, not user existence), "IPv4-based"
   (`get_remote_address` returns the host, v4 or v6). Plus vague DB checks.
2. **Coverage depth** — missed specific behavior classes (to be enumerated in §0
   from a plan-vs-plan diff). *Not* "fewer scenarios" — count is not quality.
3. **Environment detection** — guessed *remote* Supabase + password grant
   instead of the repo's actual *local* Supabase (ES256, local ports).
4. **Assertion robustness** — asserts full human-readable message text (brittle).

## Guiding principle

> **Wrong-but-confident is worse than honestly-unverified.**

Every behavioral assertion is either traced to code the author read (cited
`file:line`), or explicitly tagged `(unverified — confirm at run time)`. The
model never guesses silently.

## Decisions locked during brainstorming + review

- **Mechanism:** layered — content rules in the shared skills + Veles-side
  enforcement. No new agents.
- **Self-review independence — inline only, and the re-read part is
  experiment-gated.** Rejected delegating verification to `triglav`: it is
  *tuned for exploration, not critique*, and under the recommended config also
  runs a cheaper model (`docs/configuring-agents.md` assigns it haiku vs Veles's
  opus; `triglav` is `cost: FREE`, Veles `EXPENSIVE`). **Note:** this is a
  configuration *convention*, not a code invariant — with no `pantheon.json`
  both inherit the same session model (`plan/index.ts:34`, `explore/index.ts:25`).
  Either way, verification belongs to a critique-tuned peer (the reserved
  `momus`), not to the explorer. True independent review waits for `momus`; the
  gate is shaped to delegate to it later with no restructuring.
- **Re-read gate is experiment-gated** (decision D1): ship the cheap structural
  requirement first; build the cognitive re-read into the hot path only if a
  one-shot efficacy test passes (§B-expensive).
- **`(unverified)` is taught to the runner** (decision D2): the QA runner
  downgrades a mismatch on an `(unverified)`-tagged expectation to a warning, not
  a HIGH issue — so the tag means something end-to-end.

---

## §0 — Diagnose first (best-effort prerequisite)

Before writing rules, ground them in data. Best-effort, not a hard blocker:

1. **Pull the failing export-PDF Veles run transcript** (if retained) and check:
   did it dispatch `triglav`? did it cite `file:line` for the wrong claims (e.g.
   "sliding window")? were the skills actually loaded? This tells us whether the
   failure is *missing attribution* (cheap rule fixes it) or *misreading cited
   code* (only re-read / `momus` fixes it).
2. **Diff the two real plans scenario-by-scenario** (both exist) and extract the
   *named* behavior classes Plan B missed (e.g. expiry boundary `valid_to =
   now()`, one-expired-one-active, "the limit counts all results not just 200s",
   lock cleanup, the worker-mismatch → 502 paths). These named classes become the
   targeted MUST-coverage in A3.

If the transcript is unavailable, proceed on the plan-diff alone and record
"did Veles dispatch triglav?" as an assumption to validate on the next real run.

---

## Section A — content rules (shared skills)

### A1. Citation-or-`(unverified)` — structural requirement (`qa-plan-authoring` Step 6)

Every behavioral assertion in a scenario — status code, rate-limit semantics,
auth/authz outcome, error-envelope shape, derived values such as a generated
filename — **must carry either a `file:line` citation (in an internal scratch
the author keeps) or the `(unverified — confirm at run time)` tag in the plan
body**. This is a *writing-discipline* rule, checkable structurally, not a plea
to "be accurate".

- Citations stay internal (they do not clutter scenarios); only the
  `(unverified)` tag surfaces in the body so the runner/human knows.
- **Acknowledged limit:** attaching a citation forces the author to *locate* the
  code (which empirically cuts pure invention) but does **not** prove the
  citation was read *correctly*. The "misread the cited code" failure is what
  §B-expensive (re-read) and, later, `momus` address. The escalation ladder is
  deliberate: cheap attribution now → experiment-gated re-read → independent
  `momus` later.

### A2. Test-environment detection — new `qa-plan-authoring` Step 4.6 (after 4.5, before 5)

Step 4 detects *tools*; Step 4.6 detects the *environment* by reading the repo's
real test infra instead of guessing:

- `supabase/config.toml` — local ports (e.g. 54321/54322), JWT signing alg
  (ES256 vs HS256).
- `.env`, `.env.test`, `.env.local`.
- `docker-compose*.yml` / `compose.yaml` — service ports, DSNs.
- `conftest.py`, test settings, `pytest.ini`, DB fixtures.

**Rule:** prefer the repo's declared local test infra over a guessed remote
endpoint; a remote URL may be emitted only if it came from a config file that
was read.

**Must satisfy the existing Setup Rules** (`test-plan-format` Setup Rules &
Bindings), or the emitted plan is locally-correct but harness-rejected:

- **Normalize IPv6 → `127.0.0.1` / `localhost`** in any DSN or binding host —
  IPv6 DSNs are rejected (`test-plan-format/SKILL.md:110`).
- A binding's **`Egress:` host must equal the host its recipe connects to**
  (`SKILL.md:146`); if auth and DB are on different discovered ports, do not mix
  them in one binding.
- Emit **env-var names only, never values**; never inline a secret into a recipe.
- Be aware credential-prefixed names (`SUPABASE_` / `DATABASE_` / `POSTGRES_`…)
  cannot be chat-pasted (`perun.md` credential-prefix refusal) — prefer binding
  inputs with neutral names where possible.

**Tooling constraint:** use only the skill's existing read tools
(`Read`/`Glob`/`Grep`). Do **not** add a new `Bash(...)` token — it would break
the `allowed-tools` subset invariant (see "Tests to update", M-2).

Detected values feed the frontmatter (`base-url`, DSNs) and `**Bindings:**`
recipes. Targets the "remote Supabase + password grant" defect.

### A3. Targeted MUST-coverage — new `qa-plan-authoring` Step 6.6 (after the existing 6.5)

> Note: Step **6.5 already exists** (Binding completeness check). A3 is **6.6**,
> the gate is **6.7**. Do not renumber 6.5.

Replace v1's blanket "enumerate every path" sweep (which fought Step 4.5's
anti-padding rule) with a **named coverage matrix**: for each changed surface,
the author confirms coverage of the *specific* behavior classes identified in §0
(success path; each error path the code can return; each auth/authz branch; the
named boundaries — expiry `valid_to = now()`, one-expired-one-active, "limit
counts all results", lock cleanup). 

- **Anti-padding stays supreme** (Step 4.5): a class with nothing observable over
  Playwright / HTTP / DB is listed under "Out of harness scope", not padded into
  a fake scenario.
- Coupled with A1: you cannot claim "this error path is covered" without a
  citation for the path. Grounding and coverage reinforce each other.
- **Scenario count is not a quality signal** and is not used as one.

### A4. Assertion style — `test-plan-format`

- **Primary:** stable status code + structural body shape (keys/types).
- **Secondary, opt-in only when status+shape cannot disambiguate:** exact
  human-readable message text, tagged `(exact text — brittle)`.
- The runner treats an `(exact text — brittle)` assertion as **substring/contains,
  not equality** (see "Downstream tag handling").
- Reinforce `qa-plan-authoring` Step 7: the saved filename **must** carry the
  `-test-plan` suffix.

---

## Section B — enforcement (Veles)

Change is confined to `src/modules/plan/veles.md` (the "QA test plan" mode):
insert a hard step between authoring and the JSON contract.

### B-cheap. Structural gate before JSON (ship now)

Before emitting the result JSON, Veles must confirm the **structural** A1
requirement: every behavioral assertion in the draft carries a citation or an
`(unverified)` tag, the A3 named-coverage matrix is filled (or omissions are
listed as out-of-scope), and the filename has the `-test-plan` suffix.

- This is the genuinely *shared* discipline: A1's citation-or-tag rule is skill
  content both callers write to. **Enforcement, however, is Veles-only** — the
  marketplace `/create-qa-plan` has no output contract to hold it accountable
  (`create-qa-plan.md` ends at "propose next step"). v2 states this honestly:
  the marketplace command **inherits the guidance, not a hard gate** (resolves
  the v1 "both benefit" overclaim).
- **Hard-stop rule:** "You may not emit the result JSON until every behavioral
  assertion is cited or tagged `(unverified)` and the coverage matrix is filled.
  Wrong-but-confident is worse than honestly-unverified." Removes the
  finish-pressure of the JSON contract: quality first, contract second.

### B-expensive. Cognitive re-read pass (experiment-gated — D1)

After the cheap gate, optionally re-read each cited fragment with explicit intent
to *refute* the assertion, and fix mismatches. **Do not build this into the hot
path until it earns its place:**

- **Efficacy experiment (run first):** feed the actual failing export-PDF plan
  back to the Veles-class model with the refute-prompt and measure how many of
  the 3 seeded errors ("sliding window", "deleted-user→401", "IPv4-based") it
  catches. Build into the hot path **only if it catches ≥ 2/3**; otherwise leave
  it out and wait for `momus`.
- Rationale: the same model re-reading a fragment it just summarized may simply
  re-confirm its own confident error. The experiment is one eval run — cheap
  insurance against shipping theater into an `EXPENSIVE` agent's hot path.

### B-seam. `momus` delegation seam

Phrase the gate so it can delegate later: *"When a dedicated reviewer (`momus`)
is available, this gate delegates per-claim verification to it; until then Veles
performs the structural check itself."* **Preserve a `(reserved)` mention** for
`momus` in `veles.md` (the prompt test asserts the `(reserved)` token — see
"Tests to update", M-1).

### Reconciling two existing rules

- **`veles.md:11` "do NOT redo a search you delegated" vs the re-read pass.**
  Frame the re-read as a *scoped exception*: verification is not exploration.
  `veles.md` must say so explicitly, not leave the two rules adjacent and
  contradictory.
- **Ordering.** The gate is **pre-save** (runs as Step 6.7, before Save Step 7)
  and verifies the **in-memory draft**. Drop any "after the skill saves the
  draft" phrasing — it contradicts the step order.

---

## Section C — measurement (before/after)

### C1. Trap-seeded scenario — a REGRESSION GUARD (not proof of general gain)

A scenario seeded with the report's exact traps, used to catch *regressions* of
the three known failures. **Traps are embedded inline in the `## Query` diff**
(matching the Layer-1 self-contained convention of
`qa-plan-from-diff.md`); **no fixture files are committed** (a real
`supabase/config.toml` would pollute the harness repo and break the
self-contained contract):

- rate limiter with no `strategy` (correct = fixed-window) → penalize "sliding";
- auth verifying only the signature → penalize "deleted-user→401";
- `get_remote_address` → penalize "IPv4-based";
- a local `supabase/config.toml` block in the diff (ES256, local ports) →
  penalize a guessed remote Supabase + password grant;
- real column `valid_to` available → expect it in DB checks;
- boundary MUSTs (expiry `valid_to = now()`, one-expired-one-active).

**Explicitly:** passing C1 proves the three named regressions are absent — it
does **not** prove general quality improvement.

### C1b. Held-out scenario — generic grounding (the honest measure)

A **different-domain** scenario whose rubric grades grounding *generically*:
"any behavioral claim contradicted by the diff/code = penalty", "every behavioral
claim is cited or `(unverified)`-tagged". The rubric **never names** the three
trap strings. This measures the general tendency the design targets. Run **more
iterations** than the default ≥2 so the effect clears the temperature noise floor.

### C2. Strengthen existing grounding signals

Both `qa-plan-from-diff.md` and `qa-plan-multi-principal.md` *already* have a
"Grounding / no hallucination" signal. C2 **strengthens the wording** to grade
the new failure classes (cite-or-tag discipline; local-vs-remote infra) — it does
not add a missing signal.

### C3. Explicitly out of scope

- `momus` / independent verification — seam only; implementation later.
- Reworking exploration so Veles reads everything first-hand — not touched.
- The report's incidental finding (a test-scenario identifier in production code,
  `pdf-worker:63`) — belongs to a different repo and to code-review.

---

## Build & CI (mechanical, but mandatory)

`dist/` is **git-tracked** (`.gitignore` force-un-ignores it) and gate-enforced:
`package.json`'s `verify-dist` runs `bun run build` then fails on any `dist/`
drift. Production loads prompts from `dist/` (`load-asset.ts` resolves siblings
of the compiled `dist/modules/plan/prompt.js`); `scripts/copy-root-assets.mjs`
copies `src/{commands,agents,skills}/**.md` into `dist/` during `build:root`.

**Therefore:** after editing the `src/` files, run `bun run build` and **commit
the regenerated `dist/` siblings** in the same change. CI's `verify-dist` is the
gate. Editing only `src/` ships nothing.

## Tests to update

- **M-1 — `tests/modules/plan/veles-prompt.test.ts`:** asserts the prompt
  `toContain` a fixed set of strings including `"(reserved)"`. B-seam must keep a
  `(reserved)` mention; add assertions for the new gate / hard-stop language.
- **M-2 — `tests/modules/plan/allowed-tools.test.ts` +
  `tests/skills/qa-plan-authoring.test.ts`:** assert the skill `allowed-tools` ⊆
  `VELES_TOOLS` ⊆ command tools. A2 must use existing read tools so this
  invariant holds; if any tool is ever added, add it to all three frontmatters.
- No snapshot tests exist (none use `toMatchSnapshot`), so nothing to regenerate.

## Downstream tag handling (decision D2 — teach the runner)

- **Perun** parses scenarios by heading/`Depends-on` regex only and ignores
  expected-result prose → **no change needed**; the tags pass through inert.
- **QA runner** (`be-testing`, `fe-testing`, `report-format`): add a small rule —
  a mismatch on an expectation tagged `(unverified — confirm at run time)` is
  reported as a **warning**, not a HIGH issue; an `(exact text — brittle)`
  assertion is matched as **substring/contains, not equality**.

---

## Affected files (summary)

| File | Change |
|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | A1 (Step 6), A2 (new Step 4.6), A3 (new Step 6.6 — 6.5 already taken), B-cheap gate (new Step 6.7), A4 filename reinforcement (Step 7) |
| `src/skills/qa/test-plan-format/SKILL.md` | A4 assertion-style + `(unverified)` / `(exact text — brittle)` tag format; richer `## Changes Summary` guidance |
| `src/modules/plan/veles.md` | B-cheap enforcement before JSON; hard-stop; B-seam (`momus`, preserve `(reserved)`); reconcile delegation rule; pre-save ordering |
| `src/skills/qa/{be-testing,fe-testing,report-format}/SKILL.md` | D2 — `(unverified)` → warning; `(exact text — brittle)` → substring |
| `docs/eval/scenarios/veles/` | C1 inline trap regression scenario; C1b held-out generic scenario; C2 strengthen existing signals |
| `tests/modules/plan/veles-prompt.test.ts`, `allowed-tools.test.ts`, `tests/skills/qa-plan-authoring.test.ts` | M-1 / M-2 |
| `dist/**` | regenerated via `bun run build`, committed (verify-dist gate) |
| `src/agents/perun.md` | **no change** (tags are inert to its parser) |

## Implementation order

1. §0 diagnose (transcript + plan-vs-plan diff → named coverage classes for A3).
2. A4 (format tags) → A1 (citation-or-tag, Step 6) → A2 (env detection, Step 4.6)
   → A3 (targeted coverage, Step 6.6).
3. B-cheap (gate = Step 6.7) → hard-stop → B-seam (preserve `(reserved)`);
   reconcile delegation rule + pre-save ordering.
4. Update `veles-prompt.test.ts` (M-1); confirm tool-subset invariant (M-2).
5. D2 runner rules (`be-testing`/`fe-testing`/`report-format`).
6. `bun run build` + commit regenerated `dist/`.
7. C2 (strengthen signals) → C1 (regression) + C1b (held-out).
8. Run the **B-expensive efficacy experiment**; build the re-read into the hot
   path only if it catches ≥ 2/3 seeded errors.
9. Run C1 + C1b to check success criteria.

## Success criteria

- **Structural (cheap, always):** in a faithful run, every behavioral assertion
  carries a citation or an `(unverified)` tag; DB checks use real columns; the
  filename has the `-test-plan` suffix; the JSON contract still validates.
- **Grounding (held-out C1b, the honest measure):** no behavioral claim
  contradicts the diff/code; the score improves over the pre-change baseline
  across the powered iteration count.
- **Regression (C1):** the "sliding window", "deleted-user→401", and
  "IPv4-based" errors do not reappear, and the run targets local Supabase (ES256)
  with the named boundary scenarios covered.
- **Re-read gate:** built into the hot path **iff** the efficacy experiment
  passed (≥ 2/3); otherwise documented as deferred to `momus`.
