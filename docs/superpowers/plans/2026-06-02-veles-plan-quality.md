# Veles QA-Plan Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the quality of QA test plans produced by the Veles planner — grounding (visible `(file:line)` citations or `(unverified)` tags), test-environment detection, targeted coverage, robust assertions — by editing the shared QA skills + the Veles prompt, teaching the runner the new tags, and adding a regression eval.

**Architecture:** Content rules live in the **shared** skills (`qa-plan-authoring`, `test-plan-format`) so both Veles and the marketplace `/create-qa-plan` inherit them; the **hard gate** and the optional sequential-thinking (ST) decomposition aid are **Veles-only** (`veles.md` + `VELES_TOOLS`). The QA runner skills learn to treat the new tags. A regression eval scenario + an experiment-gated re-read pass close the loop. All prompt/skill `.md` lives in `src/` and is compiled into the git-tracked `dist/` by `bun run build`.

**Tech Stack:** TypeScript (Bun + tsup build, Vitest), OpenCode plugin/agent/skill markdown, an MCP sequential-thinking tool.

**Source spec:** `docs/superpowers/specs/2026-06-02-veles-plan-quality-design.md` (v5).

---

## CRITICAL conventions for every task

- **Commits are hook-gated.** A pre-commit hook blocks plain `git commit`. Every commit command in this plan is prefixed with `AV_COMMIT_SKILL=1`. (Equivalently, invoke the `/commit` skill.)
- **`dist/` is git-tracked and CI-gated.** After ANY edit under `src/`, you must run `bun run build` and commit the regenerated `dist/**` siblings in the same logical change. `bun run verify-dist` fails on drift. Tasks that edit `src/` include an explicit build+commit step.
- **Branch:** work on `feature/veles-plan-quality` (already checked out).
- **Run the full suite** with `bun run test` (it runs `build:root` + `build:skill-utils` then `vitest run`). For a single file use `bunx vitest run <path>`.

---

## Open items resolved up front (Task 0 is a hard blocker for Tasks 9 and 11)

The spec names four open items. Two are pure-prose and handled inside their tasks (A0 precondition → Task 3; ST graceful-degradation wording → Task 7). Two require external decisions/artefacts and are resolved in **Task 0** below.

---

## File structure (what each touched file is responsible for)

- `src/skills/qa/test-plan-format/SKILL.md` — the canonical plan *format*: adds the visible-citation / `(unverified)` / `(exact text — brittle)` tag grammar + assertion-style guidance + richer `## Changes Summary`.
- `src/skills/qa/qa-plan-authoring/SKILL.md` — the *authoring procedure*: adds A0 (grounding precondition), A1 (visible citation rule, amends Step 6), A2 (Step 4.6 env detection), A3 (Step 6.6 targeted coverage), B-shared (Step 6.7 self-check).
- `src/modules/plan/veles.md` — Veles-only enforcement: hard stop before JSON, `momus` seam, delegation-rule reconciliation, pre-save ordering, Section D ST decomposition guidance + graceful-degradation clause.
- `src/modules/plan/allowed-tools.ts` — adds the ST tool token to `VELES_TOOLS` only.
- `src/skills/qa/{be-testing,fe-testing,report-format}/SKILL.md` + `src/modules/qa/prompt-sections/{overlay-be,overlay-fe}.md` — teach the runner the three tags.
- `docs/eval/scenarios/veles/*` — C2 strengthen signals, C1 new regression scenario.
- `tests/modules/plan/veles-prompt.test.ts`, `tests/modules/plan/allowed-tools.test.ts` — assert the new prompt strings + the ST token.

---

## Task 0: Resolve external open items (BLOCKER for Tasks 9 & 11)

**No code.** Produces two decisions/artefacts the later tasks consume. This task is "done" when the four sub-items below are recorded (e.g. appended to the spec's Open-items section or noted in the PR description).

- [ ] **Step 1: Pin the ST tool token.** Determine the literal allow-list string for the sequential-thinking MCP tool **as this harness exposes it**. Inspect a known-good OpenCode config (the one where the ST MCP server is enabled) and how serena tools are named in `src/modules/plan/allowed-tools.ts:9-17` (short form `serena_find_symbol`). Candidates: `sequential_thinking_sequentialthinking` (the literal used in `packages/code-review/src/agents/*.md`), or a `<serverKey>_sequentialthinking` form matching the config key. Record the final token. **Default used by this plan:** `sequential_thinking_sequentialthinking` — if Task 0 pins a different string, substitute it everywhere in Tasks 7 and 9.

- [ ] **Step 2: Confirm server-enablement caveat.** Record that the token is **inert unless** a sequential-thinking server is enabled in `config.mcp` (same as serena). No code; this is a note for the deployer.

- [ ] **Step 3: Obtain the failing export-PDF plan + refute-prompt for the 8a experiment.** The original Plan A / Plan B and the failing export-PDF plan are NOT in this repo. Get the **failing plan** (the one with "sliding window", "deleted-user→401", "IPv4-based") from the user and save it to `docs/eval/scenarios/veles/fixtures/2026-06-01-export-pdf-failing-plan.md`. Write the literal **refute-prompt** to use in Task 11 and record it in this task's notes:

  > "Below is a QA plan you wrote and the code it targets. For EACH behavioral assertion, re-read the cited code with the explicit goal of REFUTING the assertion. For each, output: assertion, cited location, verdict ∈ {confirmed, REFUTED, not-verifiable}, and the correct value if refuted. Be adversarial — default to REFUTED if the cited code does not unambiguously support the claim."

- [ ] **Step 4: Record the decisions.** Append the pinned token, the enablement caveat, the fixture path, and the refute-prompt to the spec's "Open items" section (or the PR description). Commit if you edited the spec:

```bash
AV_COMMIT_SKILL=1 git add docs/superpowers/specs/2026-06-02-veles-plan-quality-design.md docs/eval/scenarios/veles/fixtures/ 2>/dev/null; AV_COMMIT_SKILL=1 git commit -m "docs(spec): record resolved open items (ST token, eval fixture, refute-prompt)" || echo "nothing to commit yet"
```

---

## Task 1: Transcribe the §0.2 named coverage classes (input for Task 5)

**Files:**
- Create: `docs/eval/scenarios/veles/fixtures/coverage-classes.md` (a short reference the A3 task and the C1 scenario reuse)

The spec's §0.2 says the plan-vs-plan diff is the source of the named missed classes, and lists them inline. The original Plan A/B are not in-repo, but the named classes ARE in the spec — transcribe them so Task 5 and Task 10 have a single source.

- [ ] **Step 1: Write the reference file**

```markdown
# Export-PDF coverage classes (from spec §0.2 / C1)

Named behavior classes Plan B missed — A3 MUST-cover these for the export-PDF surface:

- Entitlement expiry boundary: `valid_to = now()` (exactly-expired is treated as expired).
- One expired + one active entitlement → the active one wins.
- Rate limit counts ALL results, not only 200s.
- Lock cleanup / no lock leak; lock is per-cv_id, not global.
- Independence of /duplicate vs /export rate limits.
- Multiple 502 triggers: PDF_WORKER_API_KEY mismatch → worker 401 → 502; missing key → 500 → 502; container stopped; worker 400.
- Content-Disposition filename correctness across unicode names (e.g. "Łukasz Żółć" → `lukasz-zolc.pdf`).
```

- [ ] **Step 2: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/eval/scenarios/veles/fixtures/coverage-classes.md && AV_COMMIT_SKILL=1 git commit -m "docs(eval): transcribe export-pdf coverage classes for A3/C1"
```

---

## Task 2: A4 — assertion-style + tag grammar in `test-plan-format`

**Files:**
- Modify: `src/skills/qa/test-plan-format/SKILL.md` (add a section after `## Scenario Naming`, before `## Edge Case Generation Rules`)

- [ ] **Step 1: Insert the tag-grammar + assertion-style section**

Add this block immediately before the `## Edge Case Generation Rules` heading:

````markdown
## Grounding tags & assertion style

Behavioral assertions (status codes, rate-limit semantics, auth/authz outcomes,
error-envelope shape, derived values like generated filenames) carry **inline
evidence**:

- **Visible citation:** append the source the author read, e.g.
  `**Expected response:** status 429 after the 6th request in 60s (`api/auth/ratelimit.py:12`).`
  One citation on the single most load-bearing line per assertion (for a DB Check
  the column is implicit in the SQL; for a derived value cite the producer).
- **`(unverified — confirm at run time)`** — use when the author could NOT read
  the code that produces the behavior (source not on disk, foreign repo). Never
  emit a `(file:line)` you cannot back; a well-formed-but-ungrounded citation is
  worse than this tag.

Assertion style:

- **Primary:** assert the stable status code + structural body shape (keys/types).
- **Secondary (opt-in only when status+shape cannot disambiguate):** exact
  human-readable message text, tagged `(exact text — brittle)`. The runner matches
  a `(exact text — brittle)` assertion as **substring/contains, not equality**.

These tags appear in scenario bodies / `**Expected response:**` lines only; the
plan parser ignores expected-result prose, so they are inert to it.
````

- [ ] **Step 2: Enrich the `## Changes Summary` guidance** (round-4 legibility answer). Find the `## Changes Summary` line in the template block and replace its placeholder line:

Replace:
```markdown
<Brief description of what changed and what needs testing. List affected areas.>
```
with:
```markdown
<Human-readable summary: what changed, which files/endpoints, and what needs testing. This is the legible "Source / Changes" view for a human reader — keep it specific (endpoints, files, behaviors), not a one-liner.>
```

- [ ] **Step 3: Run the suite to confirm nothing broke**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts tests/modules/plan/allowed-tools.test.ts`
Expected: PASS (no tool-list change in this task).

- [ ] **Step 4: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/skills/qa/test-plan-format/SKILL.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(qa): A4 — visible-citation/unverified/brittle tag grammar + assertion style"
```

---

## Task 3: A0 + A1 — grounding precondition & visible-citation rule in `qa-plan-authoring`

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (insert A0 before Step 1; amend Step 6)

- [ ] **Step 1: Insert the A0 precondition** immediately after the skill's intro paragraph and before `## Step 1: Resolve the diff source`:

````markdown
## Step 0: Grounding precondition — the target source must be on disk

A `(file:line)` citation may be emitted **only** for a file actually present and
read in the working tree. When the changed source is NOT on disk (a foreign-repo
PR reference, a pasted diff, or an embedded-diff eval), do **not** invent a
citation — tag the assertion `(unverified — confirm at run time)` instead. A
well-formed citation to absent/unread source manufactures false confidence and is
worse than the honest tag. Likewise Step 4.6's config-file detection only "reads"
files that are in the tree; from a diff-embedded config block you may read the
*diff text* but must not claim to have read an on-disk file.
````

- [ ] **Step 2: Amend Step 6 (Generate scenarios)** — append the visible-citation rule. Find the Step 6 `- **BE**` bullet and add a new bullet after the FE/BE bullets:

````markdown
- **Grounding (every scenario):** each behavioral assertion (status code,
  rate-limit semantics, auth/authz outcome, error-envelope shape, derived
  filename) carries a visible `(file:line)` citation to code you actually read,
  or the `(unverified — confirm at run time)` tag (see Step 0 and the
  `test-plan-format` "Grounding tags & assertion style" section). Citations go on
  the single most load-bearing line per assertion.
````

- [ ] **Step 3: Run the subset tests** (frontmatter unchanged, so they must stay green)

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: PASS.

- [ ] **Step 4: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(qa): A0 grounding precondition + A1 visible-citation rule"
```

---

## Task 4: A2 — test-environment detection (new Step 4.6)

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (insert Step 4.6 after Step 4.5, before Step 5)

- [ ] **Step 1: Insert Step 4.6** immediately before `## Step 5: Output format + Setup section`:

````markdown
## Step 4.6: Detect the test environment (don't guess it)

Read the repo's real test infra instead of guessing remote endpoints (using only
`Read`/`Glob`/`Grep` — do NOT add a new Bash token):

- `supabase/config.toml` — local ports (e.g. 54321/54322), JWT signing alg
  (ES256 vs HS256).
- `.env`, `.env.test`, `.env.local`.
- `docker-compose*.yml` / `compose.yaml` — service ports, DSNs.
- `conftest.py`, test settings, `pytest.ini`, DB fixtures.

**Rule:** prefer the repo's declared LOCAL test infra over a guessed remote
endpoint. A remote URL may be emitted only if it came from a config file you
read (see Step 0).

Feed detected values into the frontmatter (`base-url`, DSNs) and `**Bindings:**`,
**while satisfying the existing Setup Rules** (`test-plan-format`):

- Normalize IPv6 → `127.0.0.1` / `localhost` in any DSN/binding host (IPv6 DSNs
  are not yet supported).
- A binding's `Egress:` host must equal the host its recipe connects to; do not
  mix auth/DB ports in one binding.
- Emit env-var **names only, never values**; never inline a secret into a recipe.
- Credential-prefixed names (`SUPABASE_`/`DATABASE_`/`POSTGRES_`…) cannot be
  chat-pasted — prefer binding inputs with neutral names.
````

- [ ] **Step 2: Run the subset tests** (frontmatter `allowed-tools` unchanged — A2 uses existing Read/Glob/Grep)

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts tests/modules/plan/allowed-tools.test.ts`
Expected: PASS.

- [ ] **Step 3: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(qa): A2 — read real test-env config instead of guessing"
```

---

## Task 5: A3 — targeted MUST-coverage (new Step 6.6)

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (insert Step 6.6 after the existing Step 6.5, before Step 7)

> Step 6.5 (Binding completeness check) already exists — do NOT renumber it.

- [ ] **Step 1: Insert Step 6.6** immediately before `## Step 7: Save`:

````markdown
## Step 6.6: Targeted coverage sweep

For each changed surface, confirm coverage of the *specific* behavior classes the
change exposes — the success path, **each** error path the code can return, each
auth/authz branch, and each boundary. (For the export-PDF surface the named
classes are catalogued in `docs/eval/scenarios/veles/fixtures/coverage-classes.md`;
in general, derive them by reading the changed code — Step 0 applies.)

- **Anti-padding stays supreme (Step 4.5):** a class with nothing observable over
  Playwright / HTTP / DB goes under a short `## Out of harness scope` note, never
  a fake scenario.
- A "covered" claim for an error path needs a `(file:line)` citation for that path
  (Step 6 grounding). **Scenario count is not a quality signal** — do not pad to a
  number.
````

- [ ] **Step 2: Run the subset tests**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: PASS.

- [ ] **Step 3: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(qa): A3 — targeted MUST-coverage sweep (Step 6.6)"
```

---

## Task 6: B-shared — the Step 6.7 self-check

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md` (insert Step 6.7 after Step 6.6, before Step 7)

- [ ] **Step 1: Insert Step 6.7** immediately before `## Step 7: Save`:

````markdown
## Step 6.7: Self-check before finishing

Scan the draft and confirm, on the in-memory draft (pre-save):

1. Every behavioral assertion carries a visible `(file:line)` citation OR an
   `(unverified — confirm at run time)` tag.
2. The Step 6.6 coverage matrix is filled (or omissions are listed under
   `## Out of harness scope`).
3. The filename will carry the `-test-plan` suffix (Step 7).

Fix any gap before saving. (Veles additionally hard-stops on this check before
emitting its result JSON — see `veles.md`. The `/create-qa-plan` command inherits
this self-check as guidance, without a hard gate.)
````

- [ ] **Step 2: Run the subset tests**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: PASS.

- [ ] **Step 3: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/skills/qa/qa-plan-authoring/SKILL.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(qa): B-shared — Step 6.7 grounding/coverage self-check"
```

---

## Task 7: Veles enforcement + Section D ST guidance (TDD via M-1)

**Files:**
- Modify: `tests/modules/plan/veles-prompt.test.ts` (add assertions FIRST)
- Modify: `src/modules/plan/veles.md` (then make them pass)

> Uses the token from Task 0 (default `sequential_thinking_sequentialthinking`).

- [ ] **Step 1: Write the failing assertions.** In `tests/modules/plan/veles-prompt.test.ts`, inside the `"pins the load-bearing planner directives"` test, append before its closing `})`:

```typescript
    // v5 gate + Section D (ST decomposition aid)
    expect(prompt).toContain("Wrong-but-confident is worse than honestly-unverified")
    expect(prompt).toContain("(unverified — confirm at run time)")
    expect(prompt).toContain("sequential_thinking_sequentialthinking")
    expect(prompt).toContain("proceed with native decomposition")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/plan/veles-prompt.test.ts`
Expected: FAIL — prompt does not yet contain the new strings.

- [ ] **Step 3: Edit `veles.md`.** In the `### Mode: QA test plan (active)` section, after the numbered authoring steps (step 3 "return your result as the JSON object"), insert a new subsection:

````markdown
### Before emitting the result JSON (hard stop)

You may NOT emit the result JSON until the authoring skill's Step 6.7 self-check
passes: every behavioral assertion carries a visible `(file:line)` citation or an
`(unverified — confirm at run time)` tag, and the coverage matrix is filled.
**Wrong-but-confident is worse than honestly-unverified** — quality first, the
JSON contract second. Only cite a `file:line` for a file present in your working
tree (see the skill's Step 0); otherwise tag `(unverified — confirm at run time)`.

This is a deliberate, scoped exception to "do NOT redo a search you delegated":
*verification is not exploration* — re-reading cited code to confirm a claim is
allowed and expected. (When the reviewer `momus` becomes available — currently
*(reserved)* — this self-check delegates per-claim verification to it; until then
you perform it yourself.)

### Decomposing complex changes (optional)

When a change is genuinely tangled, you MAY use `sequential_thinking_sequentialthinking`
to decompose it into smaller testable units before writing scenarios, so coverage
is deeper. This is optional — for simple diffs, skip it. If
`sequential_thinking_sequentialthinking` is unavailable, proceed with native
decomposition.
````

> Note: the existing `momus` line already contains `*(reserved — not yet available)*`; the M-1 `(reserved)` assertion stays green. Do not remove it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/plan/veles-prompt.test.ts`
Expected: PASS (all `toContain`, including the pre-existing `(reserved)`).

- [ ] **Step 5: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add tests/modules/plan/veles-prompt.test.ts src/modules/plan/veles.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(plan): Veles hard-stop gate + Section D ST decomposition aid"
```

---

## Task 8: D2 — teach the QA runner the new tags

**Files:**
- Modify: `src/skills/qa/be-testing/SKILL.md` (add a "Tag handling" subsection)
- Modify: `src/skills/qa/fe-testing/SKILL.md` (add the same subsection)
- Modify: `src/skills/qa/report-format/SKILL.md` (note on the severity table)
- Modify: `src/modules/qa/prompt-sections/overlay-be.md`, `overlay-fe.md` (one line each)

- [ ] **Step 1: Add tag handling to `be-testing/SKILL.md`** — after the `## Execution Workflow` block (before `## API Testing Patterns`), insert:

````markdown
## Tag handling (plan grounding tags)

Expected-result text may carry these author tags — handle them, do not match on
the tag text itself:

- `(unverified — confirm at run time)` — the author could not ground this. A
  mismatch here is reported as **LOW** (not HIGH), with a note that the
  expectation was author-flagged as unverified.
- `(exact text — brittle)` — match the quoted message as **substring/contains,
  not equality**.
- `(file:line)` — a source citation for humans/`momus`; **ignore** it when matching.
````

- [ ] **Step 2: Add the identical subsection to `fe-testing/SKILL.md`** — after its `## ...` execution/result section (mirror Step 1; same markdown block).

- [ ] **Step 3: Note the severity mapping in `report-format/SKILL.md`** — under `## Severity Levels`, append a row note after the table (after the `LOW` row):

```markdown

> A mismatch on an expectation the plan tagged `(unverified — confirm at run time)` is **LOW** — the author explicitly flagged it as unconfirmed, so it is not a HIGH regression.
```

- [ ] **Step 4: Add one line to each overlay.** In `src/modules/qa/prompt-sections/overlay-be.md`, in "Step 3: Execute the scenario", after sub-item 3 ("Verify response status code + body"), add:

```markdown
   Expected-result text may carry `(file:line)` / `(unverified — confirm at run time)` / `(exact text — brittle)` tags — defer to the be-testing skill's "Tag handling" rules; do not fold a tag into the matched string.
```

In `src/modules/qa/prompt-sections/overlay-fe.md`, in "Step 3", after sub-item 4 ("If expected result is met → PASS"), add:

```markdown
   Expected-result text may carry `(file:line)` / `(unverified — confirm at run time)` / `(exact text — brittle)` tags — defer to the fe-testing skill's "Tag handling" rules.
```

- [ ] **Step 5: Run the suite**

Run: `bun run test`
Expected: PASS (these are prose-only skill edits; no assertions target them).

- [ ] **Step 6: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/skills/qa/be-testing/SKILL.md src/skills/qa/fe-testing/SKILL.md src/skills/qa/report-format/SKILL.md src/modules/qa/prompt-sections/overlay-be.md src/modules/qa/prompt-sections/overlay-fe.md dist && AV_COMMIT_SKILL=1 git commit -m "feat(qa): D2 — runner handles unverified/brittle/citation tags"
```

---

## Task 9: Section D — add the ST token to `VELES_TOOLS` (TDD via M-2)

**Files:**
- Modify: `tests/modules/plan/allowed-tools.test.ts` (assertion FIRST)
- Modify: `src/modules/plan/allowed-tools.ts`

> **Blocked by Task 0 Step 1** (token pin). Uses `sequential_thinking_sequentialthinking` unless Task 0 pinned another string.

- [ ] **Step 1: Write the failing assertion.** In `tests/modules/plan/allowed-tools.test.ts`, inside the first `it(...)`, after the `question` assertion, add:

```typescript
    expect(VELES_TOOLS).toContain("sequential_thinking_sequentialthinking")
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/modules/plan/allowed-tools.test.ts`
Expected: FAIL — token not in `VELES_TOOLS`.

- [ ] **Step 3: Add the token.** In `src/modules/plan/allowed-tools.ts`, add an MCP-reasoning group and include it in the export:

```typescript
const MCP_REASONING_TOOLS = ["sequential_thinking_sequentialthinking"]

export const VELES_TOOLS: string[] = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_TOOLS,
  ...BASH_TOOLS,
  ...HARNESS_TOOLS,
  ...MCP_REASONING_TOOLS,
]
```

- [ ] **Step 4: Run all plan tests to verify pass + invariants intact**

Run: `bunx vitest run tests/modules/plan/allowed-tools.test.ts tests/modules/plan/veles-prompt.test.ts tests/skills/qa-plan-authoring.test.ts`
Expected: PASS. (`skill ⊆ VELES_TOOLS` still holds — the skill did not add the token; `skill ⊆ command` is unaffected; `veles-prompt` allow-list line auto-tracks `VELES_TOOLS`.)

- [ ] **Step 5: Build + commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add tests/modules/plan/allowed-tools.test.ts src/modules/plan/allowed-tools.ts dist && AV_COMMIT_SKILL=1 git commit -m "feat(plan): enable sequential-thinking tool for Veles (VELES_TOOLS only)"
```

---

## Task 10: C — eval (C2 strengthen + C1 regression scenario)

**Files:**
- Modify: `docs/eval/scenarios/veles/qa-plan-from-diff.md`, `docs/eval/scenarios/veles/qa-plan-multi-principal.md` (C2)
- Create: `docs/eval/scenarios/veles/qa-plan-export-pdf-regression.md` (C1)

- [ ] **Step 1: C2 — strengthen the grounding signal** in both existing scenarios. In each, find the "Grounding / no hallucination" bullet and append:

```markdown
  Also grade: every behavioral assertion carries a visible `(file:line)` citation or an `(unverified — confirm at run time)` tag; and the run prefers the repo's local test infra over a guessed remote endpoint (no invented remote Supabase / password-grant when a local config exists).
```

- [ ] **Step 2: C1 — create the regression scenario** at `docs/eval/scenarios/veles/qa-plan-export-pdf-regression.md`, following the Layer-1 self-contained convention (inline diff in `## Query`, no fixture files). Use this skeleton, embedding a diff that contains the three traps (rate limiter with no `strategy`; auth verifying only the signature; `get_remote_address`), a `supabase/config.toml` block (ES256, local ports), and a `valid_to` column:

````markdown
# Veles: QA plan from an export-PDF diff (grounding regression guard)

**Agent:** Veles - Planner
**Target codebase:** self-contained — the diff below is the complete change set;
plan only from it, do not read repo source, do not dispatch sub-agents, do not ask
clarifying questions. Save the plan and end with the required JSON.

## Query

> Generate a QA test plan for the following self-contained changes. [embed a diff
> containing: a SlowAPI `Limiter(key_func=get_remote_address)` with NO `strategy=`
> (correct = fixed-window); a JWT dependency that verifies signature/claims only
> (does NOT check user existence); an export endpoint reading entitlements with a
> `valid_to` column; and a `supabase/config.toml` block with ES256 + local ports
> 54321/54322.]

## Expected coverage

**MUST:**
- Rate-limit scenario describes a **fixed-window** reset (penalize "sliding window").
- Auth: a valid token for a deleted/absent user passes auth and fails later on
  ownership (penalize "deleted-user → 401").
- Client IP via `get_remote_address` is host-based, not "IPv4-only" (penalize "IPv4-based").
- DB checks use the real column `valid_to` (incl. the `valid_to = now()` boundary).
- Setup targets the LOCAL Supabase from `config.toml` (ES256, local ports) — penalize
  a guessed remote `https://<ref>.supabase.co` + password grant.
- Every behavioral assertion carries a visible `(file:line)` citation OR an
  `(unverified — confirm at run time)` tag.

## Quality signals
- **Regression gate:** none of "sliding window" / "deleted-user→401" / "IPv4-based" appears.
- **Scope limit (see spec §A0):** because this is an embedded-diff scenario, the
  source is not on disk — this scenario validates citation/tag **form** + the
  local-vs-remote infra choice, NOT read-grounding. Real read-grounding is graded
  by the Layer-2 real-repo eval.

## What this discriminates
- Confidently-wrong behavioral claims (the three named errors); guessed remote infra;
  missing visible-citation/`(unverified)` discipline.
````

- [ ] **Step 3: Commit** (docs only — no build needed; `docs/eval` is not copied into `dist`)

```bash
AV_COMMIT_SKILL=1 git add docs/eval/scenarios/veles/ && AV_COMMIT_SKILL=1 git commit -m "test(eval): C2 strengthen grounding signals + C1 export-pdf regression scenario"
```

---

## Task 11: B-expensive — the re-read efficacy experiment (8a/8b)

**Blocked by Task 0 Step 3** (needs the failing export-PDF plan + the refute-prompt).

- [ ] **Step 1: 8a — run the experiment.** Feed `docs/eval/scenarios/veles/fixtures/2026-06-01-export-pdf-failing-plan.md` plus the code it targets to a Veles-class model with the Task-0 refute-prompt. Count how many of the 3 seeded errors ("sliding window", "deleted-user→401", "IPv4-based") it catches. Record the count.

- [ ] **Step 2: 8b — decide.** If caught ≥ 2/3: add a re-read pass to `veles.md`'s hard-stop subsection (re-read each cited fragment with intent to refute, fix mismatches) and the matching M-1 assertion + build + commit. If < 2/3: do NOT add the re-read; record "deferred to momus" in the spec's Success criteria. Either way, document the result.

- [ ] **Step 3 (only if 8b builds the re-read): commit**

```bash
bun run build && AV_COMMIT_SKILL=1 git add src/modules/plan/veles.md tests/modules/plan/veles-prompt.test.ts dist && AV_COMMIT_SKILL=1 git commit -m "feat(plan): add re-read verification pass (efficacy experiment passed)"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full suite + dist sync**

Run: `bun run test && bun run verify-dist`
Expected: all tests PASS; verify-dist reports no drift (clean).

- [ ] **Step 2: Spec success-criteria walk.** Confirm against the spec: structural (citations/tags present), regression (C1 traps absent on a sample run), re-read built iff 8a passed, Open items recorded. Note any deferrals.

---

## Self-review notes (author)

- **Spec coverage:** §0.1 transcript is best-effort (Task 0 Step 3 captures the artefact); §0.2 → Task 1; A0/A1 → Task 3; A2 → Task 4; A3 → Task 5; B-shared → Task 6; A4 → Task 2; B-cheap/B-seam/reconcile/ordering + Section D → Task 7; ST token → Task 9; D2 (+overlays) → Task 8; C1/C2 → Task 10; B-expensive 8a/8b → Task 11; Build & CI → every src task + Task 12; M-1/M-2 → Tasks 7 & 9.
- **Open items:** ST token + enablement (Task 0/9), eval artefacts + refute-prompt (Task 0/11), A0 encoding (Task 3). All first-class.
- **Token consistency:** `sequential_thinking_sequentialthinking` used identically in Task 7 (prompt + assertion) and Task 9 (VELES_TOOLS + assertion); Task 0 may substitute a pinned value everywhere.
