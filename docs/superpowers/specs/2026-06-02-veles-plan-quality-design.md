# Design: Raising Veles QA-plan quality

**Date:** 2026-06-02
**Status:** v5 — after four mixture-of-agents review rounds (round 1 reshaped
v1→v2; round 2 audited v2; round 3 audited a sequential-thinking proposal and
reshaped it into Section D; round 4 audited all of v4 and found the
source-on-disk grounding precondition + open items). Ready for implementation
planning, modulo the named Open items.
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
- **v3 → v4** (round-3 review): a proposal to make sequential-thinking (ST)
  *mandatory like Serena* was audited by three reviewers and **rejected as
  scoped** — it failed on effectiveness (the audited steps were a lookup + a
  structural scan, not ST's sweet spot), an unfalsifiable anti-theater
  safeguard, a consistency double-standard vs the experiment-gated re-read, and
  integration incoherence (guessed MCP key → toast spam, "MUST use" contradicting
  Serena's advisory-only precedent, a marketplace leak via the shared skill). The
  use we actually wanted was different — **ST as a decomposition aid during
  scenario *generation***, not verification. v4 adds that as **Section D**:
  MAY-use, Veles-only, real token, no detector/toast, no shared-skill placement,
  no new gate.
- **v4 → v5** (round-4 review): a full re-audit found a real defect three rounds
  missed — A1/A2/§0.2 silently assumed the **target repo's source is on disk**,
  which fails in the Layer-1 embedded-diff eval and for foreign-repo/pasted diffs,
  making a `(file:line)` citation *well-formed but ungrounded* (worse than
  `(unverified)`). v5 adds **§A0** (source-on-disk precondition + `(unverified)`
  fallback), **scopes C1 down** to validating citation *form* (real grounding moves
  to the Layer-2 real-repo eval), **corrects the M-2 invariant** statement (two
  separate subsets, not a chain; serena — not dispatch — is the precedent),
  requires **Section D's graceful-degradation clause**, adds a **principle
  carve-out** for optional process aids, routes **D2 to the zmora overlays**, maps
  "warning" → **LOW**, and consolidates the residual **Open items** (ST token,
  eval artefacts, refute-prompt).

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

> **Carve-out.** The corollary "adding more forceful prose/process is the weakest
> lever" targets *prose presented as a fix* (restated guidance the model already
> ignored). It does **not** forbid an *optional, near-zero-cost* process aid that
> claims no enforcement strength — Section D (MAY-use ST) is such an exception:
> honestly weak, opt-in, and never load-bearing for a success criterion.

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

### A0. Grounding precondition — the target source must be on disk (round-4 finding)

A1/A2/§0.2 all assume Veles can **read the target repo's source at plan time**.
That holds on the normal production path (Veles runs with the target repo as its
working tree / a checkout), but **not** when it is handed a diff whose paths are
not on disk: a foreign-repo PR reference, a pasted diff, or the Layer-1
embedded-diff eval (where reading repo paths is by design a negative signal).

**Rule (governs A1 + A2):** a `(file:line)` citation may be emitted **only** for a
file actually present and read in the working tree. When the source is absent,
Veles must tag the assertion `(unverified — confirm at run time)` instead — a
well-formed citation to absent/foreign/unread source is **worse** than
`(unverified)`, because it manufactures false confidence and suppresses the
skepticism the tag would invite (this is the honest counter-weight to the
guiding principle's "evidence travels with the claim"). Likewise A2's
config-file detection only fires when those files are in the tree; from a
diff-embedded config block it may read the *diff text* but must not claim to have
read an on-disk file.

This precondition is why C1 (embedded-diff eval) can validate only citation/tag
**form**, while real read-grounding is validated by the Layer-2 real-repo eval
(see C1 and Success criteria).

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
- **Source-absent case:** see **A0** — when the cited file is not in the working
  tree, tag `(unverified)` instead of emitting a citation that cannot be backed.

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

**Scope limit (round-4, see A0):** because C1 is a Layer-1 *embedded-diff*
scenario, the changed files are not on disk — so C1 validates citation/tag
**form** (every assertion is `(file:line)`-cited or `(unverified)`-tagged) and the
local-vs-remote infra choice read from the diff-embedded config block. It does
**not** validate read-*grounding* (a citation here is parsed off the diff hunk,
not a real file). Real read-grounding is validated by the **Layer-2 real-repo
eval** (`README.md` private-repo path), where Veles resolves a real diff against
on-disk source and A1/A2 genuinely fire.

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

## Section D — sequential thinking as an optional decomposition aid (Veles-only)

A third review round audited "make sequential-thinking (ST) mandatory like
Serena" and rejected that framing (see Revision history). What survives is the
*use we actually wanted*: **ST to decompose a complex/tangled change into smaller
testable units during scenario generation (Step 6)** — to improve coverage depth
(gap #2). This is a genuine multi-step reasoning task (ST's sweet spot), unlike
the lookup/scan steps the rejected version targeted, and it is **not** the
verification bet the re-read pass already owns — so it carries no consistency
double-standard.

**Shape (all constraints from the round-3 review):**

- **MAY-use, not mandatory.** Veles *may* reach for ST when it judges a change
  genuinely tangled; for simple diffs it does not. This matches the repo's own ST
  precedent (`packages/code-review`, which always pairs the ST directive with a
  graceful-degradation clause — some entry points are MAY-use, others
  use-by-default). It neutralizes the *per-plan* cost objection (no forced
  round-trips), but the asymmetry vs the experiment-gated re-read must be stated
  honestly: the re-read was a per-plan **default**, so it had to earn its place;
  ST here is **opt-in per-diff**, so un-gated is acceptable — yet the cost of an
  opt-in ST invocation on an EXPENSIVE/opus agent is **accepted-but-unmeasured**,
  not "free". Absence of ST is **normal operation**, not a degraded mode.
- **No detector, no toast.** We do **not** mirror `serena-detect.ts` — Serena's
  toast is justified because its absence is genuinely degraded (no semantic
  index); ST's is not. A guessed MCP key would only produce false-alarm toast
  spam. So no `isSequentialThinkingAvailable`, no `session.created` toast (also
  avoids breaking the "warns exactly once" test).
- **Graceful-degradation clause (required wording).** The `veles.md` directive
  MUST carry the verbatim fallback every `code-review` ST callsite uses — *"If
  `sequential_thinking_sequentialthinking` is unavailable, proceed with native
  decomposition"* — so a model that opts into ST when the server is absent skips
  gracefully instead of hard-erroring on an unconfigured tool. Assert this clause
  in M-1.
- **Veles-only; the shared skill stays tool-agnostic.** The decomposition
  *guidance* lives in `veles.md` only (a Veles-only prompt pointing at the
  authoring activity). The shared `qa-plan-authoring` Step 6 keeps describing
  *what* to produce (scenarios that decompose complex changes into testable
  units), never *which tool* to reason with — so the marketplace `/create-qa-plan`
  path is unchanged and there is no tool leak into it.
- **Token (MUST-VERIFY open item).** The literal allow-list string is *not* settled
  by the repo: `packages/code-review` uses `sequential_thinking_sequentialthinking`
  only in **prose** (never an allow-list); serena uses the short form
  `serena_find_symbol`; the live MCP id is
  `mcp__plugin_sequentialthinking_sequential-thinking__sequentialthinking`. The
  implementer MUST pin the exact token against a known-good config, reconciled with
  how `allowed-tools.ts` names serena's MCP tools, and note that the token is
  **inert unless a sequential-thinking server is enabled in `config.mcp`** (exactly
  like serena). Add it **only to `VELES_TOOLS`** (`src/modules/plan/allowed-tools.ts`).
- **M-2 invariant (corrected).** The tests enforce two *separate* subsets —
  `skill ⊆ VELES_TOOLS` (`allowed-tools.test.ts`) and `skill ⊆ command`
  (`qa-plan-authoring.test.ts`) — **not** a three-way `skill ⊆ VELES_TOOLS ⊆
  command` chain (`VELES_TOOLS ⊄ command` already holds, via the serena tools).
  Adding ST to `VELES_TOOLS` only leaves both tested invariants intact — exactly as
  the **serena read tools** already sit in `VELES_TOOLS` without being in the skill
  or command. (The dispatch plugin tools are *not* the precedent — they live in the
  `AgentConfig.tools` map, not `VELES_TOOLS`.)
- **Not a gate; measured indirectly.** ST leaves no artefact in the plan file, so
  it cannot be verified or made a success-criterion. It is an *aid*: its payoff
  shows up only as coverage depth, observed via C1 + the §0.2 named classes. We
  do **not** build an ST-specific check or A/B experiment (MAY-use ⇒ low cost ⇒ a
  hard gate is not warranted); if it proves useless it simply goes unused.

**Honest residual:** whether ST beats Opus's native decomposition is unproven —
but as MAY-use, Veles-only, zero-plumbing guidance, the downside is bounded
(occasional wasted round-trips when the model opts in) and needs no new
machinery. This is the minimal viable form of the idea.

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
  `(reserved)` mention; add assertions for the new gate / hard-stop language **and
  for the Section D ST decomposition directive + its graceful-degradation clause**.
- **M-2 — `tests/modules/plan/allowed-tools.test.ts:24-31` +
  `tests/skills/qa-plan-authoring.test.ts:36-40`:** these enforce **two separate**
  subsets — `skill ⊆ VELES_TOOLS` and `skill ⊆ command` (not a `⊆ VELES_TOOLS ⊆
  command` chain). A2 must use existing read tools so both hold; Section D's ST
  token goes to `VELES_TOOLS` only (skill unchanged), so both still hold.
- No snapshot tests exist (none use `toMatchSnapshot`).

## Downstream tag handling (decision D2)

- **Perun** parses by heading/`Depends-on` regex + frontmatter and ignores
  expected-result prose (`perun.md:72`) → **no change needed**; the inline
  citations and tags are inert to it.
- **QA runner** (`be-testing`, `fe-testing`, `report-format`): a mismatch on an
  expectation tagged `(unverified — confirm at run time)` is reported as **LOW**,
  not HIGH (the severity table is HIGH/MEDIUM/LOW — "warning" maps to LOW, with a
  note that the expectation was author-flagged as unverified); an
  `(exact text — brittle)` assertion is matched as **substring/contains, not
  equality**; visible `(file:line)` citations are **ignored** by the runner
  (human/`momus`-facing only).
- **Zmora overlays** (`src/modules/qa/prompt-sections/overlay-be.md`,
  `overlay-fe.md`): these carry their *own* inline expected-matching directives, so
  add one line to each — *expected-result text may carry `(file:line)` /
  `(unverified)` / `(exact text — brittle)` tags; defer to the `be`/`fe-testing`
  skill's tag rules* — so the overlay does not fold a citation into the matched
  string (round-4 finding #5).

---

## Affected files (summary)

| File | Change |
|---|---|
| `src/skills/qa/qa-plan-authoring/SKILL.md` | A0 (source-on-disk precondition + `(unverified)` fallback), A1 (amends Step 6 in place), A2 (new Step 4.6), A3 (new Step 6.6 — 6.5 already taken), B-shared self-check (new Step 6.7), A4 filename reinforcement (Step 7) |
| `src/skills/qa/test-plan-format/SKILL.md` | A4 assertion style; visible `(file:line)` / `(unverified)` / `(exact text — brittle)` tag format; richer `## Changes Summary` guidance |
| `src/modules/plan/veles.md` | B-cheap hard stop before JSON; B-seam (`momus`, preserve `(reserved)`); reconcile delegation rule; pre-save ordering; Section D MAY-use ST decomposition guidance |
| `src/modules/plan/allowed-tools.ts` | Section D — add `sequential_thinking_sequentialthinking` to `VELES_TOOLS` only (NOT the shared skill / command → M-2 invariant untouched) |
| `src/skills/qa/{be-testing,fe-testing,report-format}/SKILL.md` | D2 — `(unverified)` → LOW; `(exact text — brittle)` → substring; ignore `(file:line)` |
| `src/modules/qa/prompt-sections/{overlay-be,overlay-fe}.md` | D2 — defer expected-matching to the be/fe-testing tag rules (don't match on tag text) |
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
3b. **Section D:** add MAY-use ST decomposition guidance to `veles.md`; add
    `sequential_thinking_sequentialthinking` to `VELES_TOOLS` only.
4. Update `veles-prompt.test.ts` (M-1 — gate/hard-stop + Section D ST directive);
   confirm tool-subset invariant (M-2 — adding ST to `VELES_TOOLS` only keeps it).
5. D2 runner rules (`be-testing`/`fe-testing`/`report-format`) **+ the two zmora
   overlays** (`overlay-be.md` / `overlay-fe.md`).
6. `bun run build` + commit regenerated `dist/`.
7. C2 (strengthen signals) → C1 (regression scenario).
8. **8a** run the B-expensive efficacy experiment (**requires the Open-items
   artifacts: the failing export-PDF plan + the literal refute-prompt**), record
   pass/fail → **8b** build the re-read into the hot path **iff ≥ 2/3**.
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
- **Section D (ST):** not a success criterion — MAY-use, unobservable in the plan
  file. Its only expected signature is coverage depth (C1 + §0.2 named classes);
  if it adds nothing, it simply goes unused at no structural cost.

## Open items to resolve at implementation (round-4)

These are not blockers to *planning*, but each is an undecided value or an
external artefact that must be settled before the relevant step runs:

1. **ST token + availability (Step 3b).** Pin the exact `VELES_TOOLS` string
   against a known-good config, reconciled with `allowed-tools.ts`'s serena naming;
   confirm the ST MCP server is enabled in `config.mcp` (the token is inert
   otherwise). Until pinned, do not commit a guessed literal.
2. **Eval / experiment artefacts (Steps §0.2, 8a).** Plan A, Plan B, and the
   failing export-PDF plan are **not in this repo**. §0.2's named coverage classes
   are already extracted inline (so A3 can proceed), but the **8a efficacy
   experiment cannot run** without the actual failing plan. The user holds these
   (they ran both plans) — supply them by path or commit, or replace 8a's input
   with a named synthetic plan in the spec.
3. **Refute-prompt text (Step 8a).** The literal prompt fed to the model in the
   re-read efficacy experiment is unspecified — write it (or mark TBD-at-experiment)
   so 8a is reproducible.
4. **A0 source-on-disk precondition** must be encoded in `veles.md` /
   `qa-plan-authoring` as an explicit rule, not left implicit.

## Follow-ups (v2.1+)

- **C1b** held-out generic grounding eval (fully specified above).
- **`momus`** adversarial reviewer → becomes the executor of the B-seam gate.
- Reconsider whether richer `## Changes Summary` fully answers the legibility
  open-question after the first cut ships.

---

## Round 2 (v6) — escape-hatch fixes + validated re-read pass

Round-1 (v5) fixed the *structure* — frontmatter, bindings, coverage matrix,
out-of-scope section, and citations all shipped and were praised in a round-2 A/B
comparison (our Veles plan vs a marketplace plan). It also opened **two escape hatches**
the model over-used on a real-repo (Layer-2) run:

1. **`(unverified)` instead of reading.** A0 governed only the source-*absent* case,
   leaving `(unverified)` a frictionless default; the `veles.md` "wrong-but-confident is
   worse than honestly-unverified" line nudged toward hedging. The round-2 plan hedged
   facts it could have read.
2. **`## Out of harness scope` instead of covering.** Step 4.5/6.6 let the model punt
   with no obligation to prove unreachability; it punted curl-testable classes (IDOR,
   502, lock contention).

**Part 1 (shipped)** — `qa-plan-authoring` Step 0 gains the *converse* rule
(`(unverified)` is a **defect** on on-disk-readable assertions) + a framework-default
trap (verify against the *installed version*, never lore). `veles.md` gate reframed:
*read-then-cite beats both wrong-but-confident and honestly-unverified*.

**Part 2 (shipped)** — Step 6.6 gains the **reachability litmus** (earn the punt: prove
a class is unreachable over Playwright/curl/psql before listing it out-of-scope) + an
in-scope-by-default catalogue (IDOR, upstream-5xx→502, lock-409, boundaries).

**Part 3 (shipped)** — Step 6.8 **targeted refute pass** over high-risk classes
(auth/authz status, rate-limit semantics, error-to-status mapping, framework defaults,
derived values), wired into the Veles hard-stop gate and framed as the **`momus` seam**.
Built per §B-expensive only after the D1 experiment cleared ≥2/3.

### Re-read efficacy experiment (Task 11 — resolved)

Round-2 Plan A was ephemeral, so per open-item #2 the substrate was a **seeded synthetic
plan grounded in the real `i-need-cv` code** (8 assertions: 4 confident-wrong + 4 correct
controls), audited by `opencode-go/kimi-k2.6` (read-only `plan` agent) with read access
to the real repo. Refute prompt + plan archived under `/tmp/refute-exp/` (not committed —
private-repo hygiene). 2 iterations, both `done` (183s / 231s).

**Result (deterministic across both iters):** 3/3 valid planted errors caught
(sliding→fixed, deleted-user→401, IPv4-based), **0 false positives** on 5 controls,
**+2 unplanted real errors** caught (no-entitlement is 402 not 403; fixed-window reset
semantics). The pass *probed* (`TestClient`, slowapi source), not just re-read — the
"same model re-confirms its own error" theater worry did not materialize.

**Premise correction (important).** The 4th planted error — "missing bearer header → 401
should be 403" — was **invalid**: a direct `TestClient` probe in the repo's venv shows
**FastAPI 0.136.1 returns 401** (the classic 403 behavior changed across versions). So
our harness's original "401" was correct; the round-2 *report's* headline critique was
itself a verification miss. The skill's framework-trap example and the C1 scenario were
corrected to teach the real lesson (status drifted 403→401 → verify against the installed
version). This is the strongest single piece of evidence for the pass: it beat both a
human report and the author's assumption by testing.

**Decision.** Build a **targeted** self-refute (high-risk classes only), framed as the
`momus` seam so it lifts out unchanged when `momus` lands. Full every-assertion refute
was rejected on cost (~2× Veles latency); defer-to-`momus` was rejected because `momus`
is unscheduled.

**Open item (v6.1).** The experiment validated a *separate-session* refute (the `momus`
shape); the shipped in-session self-refute extrapolates from it. Re-measure once `momus`
exists, or if a later eval shows the in-session pass under-catching.
