# Provisionable QA Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Veles to author *provisionable* QA plans (provability ladder + `provisioning-blocked` disposition + seam-seed mechanics + auth-authority grounding) so a Pantheon QA loop needs far less human engagement — per the approved spec `docs/superpowers/specs/2026-07-01-provisionable-qa-plans-design.md`.

**Architecture:** Doc-only change set — five markdown prompt/skill files (`qa-plan-authoring`, `test-plan-format`, `be-testing`, `veles.md`, `perun.md`) plus optional eval scenarios. No TypeScript changes; the coverage-disposition vocabulary is prose the agents self-enforce. Verification = the repo's existing doc-guard vitest suites + full gate (tsc, vitest, build, dist-sync, review-id guard). The spec's **§10 file-by-file change set is the authoritative source**; this plan turns it into ordered, anchored edits.

**Tech Stack:** Markdown agent prompts/skills, Bun (`bun run build`), Vitest, Node guard scripts.

---

## Ground rules (read before Task 1)

1. **Spec is law.** Every edit below implements `docs/superpowers/specs/2026-07-01-provisionable-qa-plans-design.md` (§3 Moves 1–5, §4 companions, §5 format changes, §10 table). If an anchor below doesn't match the file (drift), re-read the spec section and adapt the anchor — never skip the edit.
2. **Commit protocol.** The repo's pre-commit hook blocks bare `git commit`. Every commit MUST be `AV_COMMIT_SKILL=1 git commit -m "..."`. Conventional Commits format. **NEVER add Co-Authored-By or any AI attribution. NEVER push.**
3. **Doc-guard pins (do not break):**
   - `perun.md` must **never** contain the literal token `base_url` (write `base-url`), nor `fix-auto`, `integrity_abort`, `result_if_terminal`, `op:` for `qa_loop_step` (tests/agents/perun-tool-contract.test.ts, perun-qa-loop-workflow.test.ts). Keep headings `Preflight prerequisites`, `Service bring-up (auto, via Stribog)`, `Parse bindings`, `Compute waves` intact.
   - `test-plan-format/SKILL.md` must keep the phrase `one row per status and per changed external surface` (tests/skills/test-plan-format.test.ts).
   - `qa-plan-authoring/SKILL.md` must keep `Reachability litmus`, `Targeted refute pass`, `intent to *refute*`, `The converse is equally binding`, `HTTPBearer`, `IDOR / cross-tenant` (tests/skills/qa-plan-authoring.test.ts).
   - `veles.md` edits are additive; keep every phrase pinned by tests/modules/plan/veles-prompt.test.ts (e.g. `do not execute`, the JSON field names).
   - Never write per-review issue IDs (`SEC-`/`DOC-`/`ARCH-`-NNN…) into any file (scripts/verify-no-review-ids.mjs).
4. **Per-task verify:** run the named vitest file(s) after each task. **Task 9 runs the full gate.** Line numbers below are pre-edit positions — earlier edits in the SAME file shift later lines; anchors are quoted text, trust the text not the number.

---

### Task 1: Branch + commit the pending work

The working tree (on `master`) holds two logically separate uncommitted change sets: the qa-loop parser defect fixes and the design spec. Put everything on the feature branch first.

**Files:**
- No content edits. Branch: `feat/provisionable-qa-plans`.

- [ ] **Step 1: Verify the expected dirty state**

Run: `git status --porcelain`
Expected (exactly these, possibly reordered):
```
 M dist/agents/perun.md
 M dist/modules/qa-loop/tools.js
 M src/agents/perun.md
 M src/modules/qa-loop/tools.ts
 M tests/modules/qa-loop/tools-start.test.ts
?? docs/superpowers/plans/2026-07-02-provisionable-qa-plans.md
?? docs/superpowers/specs/2026-07-01-provisionable-qa-plans-design.md
```
If anything else appears, STOP and surface it to the user.

- [ ] **Step 2: Create the branch**

Run: `git switch -c feat/provisionable-qa-plans`
Expected: `Switched to a new branch 'feat/provisionable-qa-plans'`

- [ ] **Step 3: Sanity-run the touched suites**

Run: `bunx vitest run tests/modules/qa-loop/ tests/agents/`
Expected: all pass (includes the 2 new loud-failure tests).

- [ ] **Step 4: Commit 1 — the defect fixes**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-start.test.ts src/agents/perun.md dist/modules/qa-loop/tools.js dist/agents/perun.md
AV_COMMIT_SKILL=1 git commit -m "fix(qa-loop): accept documented H3 scenario headings and error loudly on an empty dispatch set

qa_loop_start's splitScenarios matched only '## FE-01' (H2) while
test-plan-format documents '### FE-01:' (H3), so every conformant plan
parsed to zero scenarios and returned ok + dispatch_set: [] silently.
Parser now accepts #{2,4}; zero-parse and all-stripped now return
status:\"error\" with actionable reasons, and perun.md STOPs on them."
```

- [ ] **Step 5: Commit 2 — the spec + this plan**

```bash
git add docs/superpowers/specs/2026-07-01-provisionable-qa-plans-design.md docs/superpowers/plans/2026-07-02-provisionable-qa-plans.md
AV_COMMIT_SKILL=1 git commit -m "docs(spec): provisionable QA plans design + implementation plan

14-round MoA-converged spec: provability ladder (Step 4.7),
provisioning-blocked disposition, seam-seed mechanics, auth-authority
grounding, minimized provisionable set. Doc-only change set."
```

---

### Task 2: `test-plan-format/SKILL.md` — disposition vocabulary + seed shape

**Files:**
- Modify: `src/skills/qa/test-plan-format/SKILL.md`
- Test: `tests/skills/test-plan-format.test.ts`

- [ ] **Step 1: Amend the Coverage-Matrix header gate (line ~62)**

Find:
```
## Coverage Matrix   (required only when the Changes Summary names ≥2 status/behavior classes)
```
Replace with:
```
## Coverage Matrix   (required when the Changes Summary names ≥2 status/behavior classes OR any changed surface is `provisioning-blocked`)
```

- [ ] **Step 2: Rewrite the matrix comment block (lines ~64–69) — omit-clause, reachable-clause, provisioning-blocked pointer rule**

Find:
```
dispositioned in Step 6.7). Omit on single-behavior diffs. Exactly one disposition per row;
`blocked-by` (lowercase) is the disposition keyword — distinct from the `**Blocked-by:**`
scenario tag.
A changed surface with a harness-observable interface (route / DB-effect / Playwright) takes `covered` or `blocked-by`, never `out-of-scope`.
A `blocked-by` row whose contract is unobservable live may add a `hermetic: <path>::<test>` pointer in its Pointer cell.>
```
Replace with:
```
dispositioned in Step 6.7). Omit on single-behavior diffs UNLESS a changed surface is `provisioning-blocked` (then a one-row matrix is required). Exactly one disposition per row;
`blocked-by` (lowercase) is the disposition keyword — distinct from the `**Blocked-by:**`
scenario tag.
A changed surface with a harness-observable interface (route / DB-effect / Playwright) takes `covered`, `blocked-by`, or `provisioning-blocked` (reachable read interface, but a precondition artifact the runner cannot mint) — never `out-of-scope`.
A `blocked-by` row whose contract is unobservable live may add a `hermetic: <path>::<test>` pointer in its Pointer cell.
A `provisioning-blocked` row MUST carry, in its Pointer cell, a `**Setup prerequisite:**` naming the exact human provisioning action and/or a `hermetic: <path>::<test>` pointer (a REAL on-disk test asserting the skipped producer — a pointer to an absent file or an unrelated test is a hard-stop defect), plus a one-clause reason the artifact is un-mintable by `curl`/`psql`/`sqlite3`/Playwright.>
```

- [ ] **Step 3: Extend the example table (lines ~71–73)**

Find:
```
| 200 happy path | 200 + `%PDF` | covered  /  blocked-by  /  out-of-scope | scenario ID, BLK ID, or harness-property reason |
```
Replace with:
```
| 200 happy path | 200 + `%PDF` | covered  /  blocked-by  /  out-of-scope  /  provisioning-blocked | scenario ID, BLK ID, harness-property reason, or Setup-prerequisite / `hermetic:` pointer |
| confidence.score propagation | score persisted to `user_tasks` | provisioning-blocked | hermetic: `tests/unit/…/test_user_task_executor.py::test_extract_confidence_score` — live trigger needs a pre-published external workflow the runner cannot create |
```

- [ ] **Step 4: Add the Coverage Ladder authoring note (after the closing `~~~` of the Plan Structure template, before `### Frontmatter fields`)**

Insert:
```
### Coverage Ladder (authoring note)

Scenario shapes climb a provability ladder (authoring skill Step 4.7). **First run the
provisionability litmus** (can the trigger/precondition be minted by `curl`/`psql`/
`sqlite3`/Playwright?); if yes pick the cheapest live rung that proves THIS change —
**R1** a schema-grounded `psql`/`sqlite3` seam-seed + read, **R2** a `curl` scenario,
**R3** a Playwright scenario — climbing only when the change crosses a seam
(data → API → UI). **R0** is the orthogonal escape when the trigger is un-provisionable:
no live scenario; a `provisioning-blocked` matrix row instead (which forces the matrix
even on a single-behavior diff). An R1 seed's INSERT is schema-grounded from a
COMMITTED source, cited `(file:line)`, never guessed or live-probed; no committed
schema ⇒ best-effort seed or a seedless read (first assertion = a seed-existence check
failing as *seed-missing*) tagged `(unverified — confirm at run time)` +
`**Coverage delta:**` — never `provisioning-blocked` (the row stays mintable). Seed +
read ship as a SINGLE scenario (a split pair loses strip- and failure-coupling
guarantees — Step 4.7).
```

- [ ] **Step 5: Add the optional Seed step to the BE scenario template (inside the `~~~markdown` template, between `### BE-01: <scenario name>` and `**Method:**`)**

Insert:
```
**Seed (psql/sqlite3):** *(optional — only for a plan-authored from-scratch write, Step 4.7)*
```sql
<single INSERT statement, schema-grounded (file:line)>
```
*(Executed FIRST via exactly ONE plan-declared connection reference — e.g. `psql "$DATABASE_URL" -c '<SQL>'`, the `$VAR`/DSN declared under `## Setup` — no other target. Requires the `## Setup` `**Seeds fixtures:**` bullet.)*

```

- [ ] **Step 6: Add Setup Rules bullets (after the `Env var names.` bullet, before `Omit when unused.`)**

Insert:
```
- **Minimize prerequisites.** Every `**Required environment variables:**` name and every binding `Inputs:` `$VAR` MUST be referenced by at least one scenario or recipe — drop unreferenced prerequisites; they inflate the preflight wall for nothing.
- **Seeds fixtures marker.** `**Seeds fixtures:** BE-NN[, BE-NN…] (requires allow_mutations)` is a `## Setup` bullet that is MANDATORY whenever any scenario carries a `**Seed (psql/sqlite3):**` step (an R1 seam-seed OR a covered stage-driving write — authoring Step 4.7). It is the defined marker Perun's seed-consent gate keys on; omitting it means the seed strips silently under the mutation guard or the run stalls.
```

- [ ] **Step 7: Add the auth-authority grounding rule to Bindings field rules (after the `**Recipe.**` bullet)**

Insert:
```
- **Auth authority grounding.** A token-minting recipe derives its login URL + `Egress:` host from the app's CONFIGURED authority (authoring Step 4.6) — never a guessed well-known endpoint (a hard-coded `login.microsoftonline.com` against a CIAM tenant fails with every secret present). Only a bare routing endpoint (scheme://host / tenant slug, no secret component) may be inlined; anything secret-bearing is declared by NAME. Runtime-only authority → declare `$AUTHORITY`/`$ISSUER` as a Required env var AND list it in the binding's `Inputs:` (a recipe `$VAR` absent from `Inputs:` is rejected by `parse_plan`); `$AUTHORITY` must be the WHOLE authority (`Egress: $AUTHORITY`; recipe `"$AUTHORITY/<tenant>/oauth2/v2.0/token"`) and the pasted value a bare `scheme://host` with NO path (a paste-time contract — the egress lock checks only the template). The grounded authority is app-level: a second-principal binding declares the SAME `$AUTHORITY`/`$ISSUER` in its own `Inputs:` and reuses it — never a re-guessed endpoint for user B.
```

- [ ] **Step 8: Document `**Coverage delta:**` in Grounding tags (after the `Function-derived values` bullet, before `Assertion style:`)**

Insert:
```
- **`**Coverage delta:**`** — an inert scenario annotation (the parser ignores
  expected-result prose) naming exactly what this scenario does NOT prove — e.g. a
  downstream seam-seeded read that skips the upstream derivation, or an `(unverified)`
  path that may be absent at run time. Required on every downstream seam-seed and every
  `(unverified)` covered scenario riding an unconfirmed path (authoring Step 4.7). Keep
  its prose free of bare present-tense write verbs (Step 4.7 rule (c)).
```

- [ ] **Step 9: Extend the spelling note (lines ~349–351)**

Find:
```
  `**Depends-on:**` in placement, but NOT parsed). `blocked-by` (lowercase) is the Coverage-Matrix
  disposition keyword. Both reference a `BLK-NN` id.
```
Replace with:
```
  `**Depends-on:**` in placement, but NOT parsed). `blocked-by` (lowercase) is the Coverage-Matrix
  disposition keyword. Both reference a `BLK-NN` id. `provisioning-blocked` (lowercase) is the
  fourth disposition keyword — CORRECT code + a reachable read interface, but a precondition
  artifact the runner cannot mint; its Pointer cell carries a `**Setup prerequisite:**` and/or
  `hermetic:` pointer, never a BLK id (a genuine defect always routes to `blocked-by`).
```

- [ ] **Step 10: Amend the Plan Quality Checklist (lines ~368–369) + add two items**

Find:
```
- [ ] If the Changes Summary names ≥2 statuses, `## Coverage Matrix` has one row per status and per changed external surface, each with exactly one disposition (`covered` / `blocked-by` / `out-of-scope` + harness-property reason)
- [ ] No changed surface with a curl/psql/Playwright interface or effect is dispositioned `out-of-scope` (reachable ⇒ `covered`/`blocked-by`)
```
Replace with:
```
- [ ] If the Changes Summary names ≥2 statuses OR any changed surface is `provisioning-blocked`, `## Coverage Matrix` has one row per status and per changed external surface, each with exactly one disposition (`covered` / `blocked-by` / `out-of-scope` + harness-property reason / `provisioning-blocked` + Setup-prerequisite and/or `hermetic:` pointer)
- [ ] No changed surface with a curl/psql/Playwright interface or effect is dispositioned `out-of-scope` (reachable ⇒ `covered`/`blocked-by`/`provisioning-blocked`)
- [ ] Every scenario carrying `**Seed (psql/sqlite3):**`: `## Setup` carries `**Seeds fixtures:**`, the seed has exactly ONE plan-declared connection reference, and the block is free of BLOCKED-class negative phrasing (Step 4.7 rule (a))
- [ ] Every read-only scenario (no Seed step) keeps its entire block free of bare present-tense write verbs (create/insert/update/write/save/delete/mutate/persist — Step 4.7 rule (c))
```

- [ ] **Step 11: Verify**

Run: `bunx vitest run tests/skills/test-plan-format.test.ts && grep -c "one row per status and per changed external surface" src/skills/qa/test-plan-format/SKILL.md`
Expected: tests pass; grep prints ≥1.

- [ ] **Step 12: Commit**

```bash
git add src/skills/qa/test-plan-format/SKILL.md
AV_COMMIT_SKILL=1 git commit -m "docs(qa): add provisioning-blocked disposition + seed scenario shape to test-plan-format

Fourth Coverage-Matrix disposition (reachable-but-un-mintable, with
mandatory Setup-prerequisite/hermetic pointer), matrix forced on
single-surface provisioning-blocked diffs, Seed (psql/sqlite3) BE step +
Seeds-fixtures Setup marker, auth-authority grounding binding rule,
Coverage-delta annotation, minimize-prerequisites rule, Coverage Ladder note."
```

---

### Task 3: `qa-plan-authoring/SKILL.md` part 1 — Step 4.6 additions + new Step 4.7

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md`
- Test: `tests/skills/qa-plan-authoring.test.ts`

- [ ] **Step 1: Replace the stale credential-paste bullet + add minimize (Step 4.6, lines ~198–199)**

Find:
```
- Credential-prefixed names (`SUPABASE_`/`DATABASE_`/`POSTGRES_`…) cannot be
  chat-pasted — prefer binding inputs with neutral names.
```
Replace with:
```
- Credential-prefixed names in the denylist (`AWS_`/`GCP_`/`AZURE_`/`DATABASE_`/
  `POSTGRES_`/`REDIS_`/`MONGO_`/`SUPABASE_`… — `bindings-store.ts` `DENYLIST_PREFIXES`)
  ARE chat-pasteable once DECLARED in the plan (as a binding `Inputs:` or a Required
  env var): preflight registers plan-declared names and `record_input` then exempts
  them. Declaring the name is the correct route — do NOT rename it to a neutral alias
  to dodge the denylist. Process-control names (`PATH`/`LD_*`/`NODE_OPTIONS`/`HOME`…)
  are never exemptable.
- **Minimize the provisionable set.** Every `**Required environment variables:**` name
  and every binding `Inputs:` `$VAR` MUST trace to at least one scenario or recipe that
  references it — drop unreferenced prerequisites; they inflate the preflight wall for
  nothing.
```

- [ ] **Step 2: Append the auth-authority grounding sub-section to Step 4.6 (after the bullet list from Step 1, immediately before `## Step 5:`)**

Insert:
```
### Auth-authority grounding (never guess the IdP)

When a scenario needs an authenticated call, GROUND the token issuer/authority against
the app's REAL auth config — never a well-known default. Read the auth settings in the
tree (issuer / authority / tenant / token-url keys, a `.well-known/openid-configuration`
reference, the auth dependency's configured base) and derive the binding recipe login
URL + `Egress:` host FROM that. A hard-coded `login.microsoftonline.com` when the app's
configured authority is a CIAM tenant (`<tenant>.ciamlogin.com`) is a grounding defect:
the token fails with every secret present.

- **VALUE vs NAME.** Grounding extracts only the non-secret ROUTING value (authority
  host, tenant slug, token-URL) — the same class this step already inlines for
  `base-url` and DSN hosts. A token, key, password, or credential-bearing connection
  string is a SECRET: emit its NAME only (never the value) and use the carve-out below.
  When in doubt, treat it as a secret.
- **Runtime-only carve-out (preferred form).** Authority injected at deploy time, not
  readable in the tree → declare `AUTHORITY`/`ISSUER` as a Required env var, ALSO list
  it in the binding's `Inputs:` (a recipe `$VAR` absent from that binding's `Inputs:`
  is rejected by `parse_plan`), and reference `$AUTHORITY` in the recipe. `$AUTHORITY`
  must be the WHOLE authority (`Egress: $AUTHORITY`; recipe
  `"$AUTHORITY/<tenant>/oauth2/v2.0/token"`); the pasted value is a bare `scheme://host`
  with NO path — a paste-time contract. The `(unverified — confirm at run time)` tag +
  the config key name is the last resort; never emit a guessed authority as grounded.
- **Multi-principal.** The grounded authority is APP-level. A second-principal binding
  (Step 6.5) declares the SAME `$AUTHORITY`/`$ISSUER` in its OWN `Inputs:` and reuses
  the value/`Egress:`, substituting only per-user credential inputs — a re-guessed
  endpoint for user B is the same grounding defect as the first.
```

- [ ] **Step 3: Insert the new Step 4.7 (immediately after the Step-2 insert, still before `## Step 5:`)**

Insert:
```
## Step 4.7: Classify the change & pick the cheapest proving seam (provability ladder)

For each changed surface, FIRST run the provisionability litmus (Step 6.7's
`provisioning-blocked` rules): *can the trigger/precondition artifact be produced by
the runner's four tools (`curl` / `psql` / `sqlite3` / Playwright)?* Only if YES, pick
the **cheapest live rung** that proves THIS change, climbing only when the change scope
crosses a seam (data → API → UI) — do not default every change to a browser flow. R0 is
NOT a rung: it fires only when NO live rung is executable, and choosing it over an
available live rung is a coverage-honesty defect (Step 6.8 refutes it).

- **R0 — escape (un-provisionable trigger):** emit NO live scenario for that surface.
  Record a `provisioning-blocked` matrix row (Step 6.7) carrying its mandatory
  evidence: a `hermetic: <path>::<test>` pointer when a repo test asserts the logic
  (the preferred evidence for pure-logic/transform changes — a parser/mapper/scorer, a
  multi-hop propagation), and/or a `**Setup prerequisite:**` naming the human
  provisioning action (mandatory when the surface is also currently unobservable).
- **R1 — data-layer read-back:** a `psql`/`sqlite3` seam-seed (INSERT) + read scenario.
  See the R1 rules below.
- **R2 — API / contract:** a `curl` scenario.
- **R3 — UI / wiring / user-visible:** a Playwright scenario.

**R1 seam-seed rules.**
- **Schema-grounded, committed source only.** The INSERT's columns, every
  NOT-NULL/FK/CHECK target, and enum/status literals are read from the migration / ORM
  model / committed OpenAPI-schema artifact in the tree and cited `(file:line)` — never
  guessed, and NEVER via a live `psql`/`curl` probe (you have `Read`/`Grep`/`Glob`
  only). If no committed schema source exists, `provisioning-blocked` is INVALID (the
  row stays psql-mintable — un-provisionability is a harness fact, not an
  author-grounding limitation). Fall back inside the `covered` channel: (a) a plausible
  column set from the read path's own queries/serializers/DTOs → author the seed with
  each unconfirmed literal tagged `(unverified — confirm at run time)` + a
  `**Coverage delta:**` naming the unconfirmed INSERT shape; (b) not even plausible →
  drop the seed, author only the live read whose FIRST assertion is an existence check
  on the manually-seeded row (fails loudly as *seed-missing*, not a code defect) + a
  `**Coverage delta:**` stating the row must be seeded manually.
- **Exactly one connection reference.** The `**Seed (psql/sqlite3):**` step carries the
  fenced SQL plus ONE plan-declared connection reference — the `$VAR`/DSN declared
  under `## Setup` `**Required databases:**`/Required env vars (the executor composes
  `psql "$DATABASE_URL" -c '<SQL>'`). No other target: the dispatched runner receives
  only the scenario block + base URL (never `## Setup`), so the reference must live in
  the step, and the scenario path has NO machine-enforced DSN egress check — the
  declared-token rule + the throwaway-target consent are the egress guards.
- **Single scenario.** Author seed + read-back as ONE scenario (INSERT first step, then
  the read assertion + DB Check). A split pair loses BOTH guarantees: the mutation
  guard strips per-scenario and is `**Depends-on:**`-blind, and `**Depends-on:**` is
  order-only (predecessor failure does NOT block dependents) — a read whose seed was
  stripped or failed reports a false result against an empty table. If a split is
  unavoidable: `**Depends-on:** <seed ID>` AND the read's first assertion is a
  seed-existence check failing as *seed-missing*.

**Seed write-safety (mutation-guard interaction).** The Phase-0 guard classifies over
the ENTIRE scenario block (including `**Edge cases:**`) and strips only
`mutating && expectsSuccess`. Two failure modes: (1) a clean-phrased seed IS stripped
under the default `allow_mutations: false` — so any plan with a Seed step MUST emit the
`## Setup` bullet `**Seeds fixtures:** BE-NN[, …] (requires allow_mutations)` (the
marker Perun's consent gate keys on); (2) a seed whose block carries a BLOCKED-class
token anywhere (*reject / block / deny / forbidden / unauthorized / must not / should
not / no state change|row|change* or a `401`/`403`/`4xx` literal) classifies
`expectsSuccess=false` and is NOT stripped — its INSERT lands even without
`allow_mutations`. (Bare *invalid*/*negative* do NOT flip it.) Authoring rules:
(a) a seed scenario keeps its ENTIRE block free of negative/blocked phrasing — every
negative assertion or edge case goes in a SEPARATE non-mutating scenario (banning ALL
negative-ish phrasing is deliberate safe over-coverage); (b) the dedicated throwaway
target + throwaway DB is the ONLY reliable defense for seed writes — MANDATORY;
(c) a READ-ONLY scenario (seedless read, `(unverified)` covered read,
existence-check-only) keeps its ENTIRE block — assertions, edge cases,
`**Coverage delta:**` prose — free of bare present-tense write verbs
(*create/insert/update/write/save/delete/mutate/persist*): they classify the read as
mutating and strip it, and a seedless plan has no consent-gate recovery. Phrase
existence checks as *"assert a row with `<PK>=<v>` is present"* and deltas as *"the row
must be seeded manually"* (past-tense and *seed/seeded* are safe).
**Write-safety is marker-keyed, not disposition-keyed:** ANY plan-authored
from-scratch DB write — an R1 seam-seed OR a `covered` stage-driving write (below) —
MUST carry the `**Seed (psql/sqlite3):**` label and all rules above.

**Propagation vs read-back (`**Coverage delta:**`).** A seam-seed INSERT proves the
READ path, not any derivation the diff introduced UPSTREAM of the seed. When the
changed code IS that upstream producer, first apply the litmus to the **originating
producer — the earliest stage the diff actually changed** (mid-chain hop if that is
what changed; a row-write is never the target): if a `curl`/`psql`/Playwright action
can drive the changed stage FROM ITS OWN INPUT, prefer that scenario — it fires the
real changed code and is `covered` (even mid-chain); an INSERT/POST reproducing the
changed stage's OUTPUT (or any stage downstream of it) is a seam-seed, not coverage.
Only when the originating trigger is un-provisionable (even if a later hop is
independently mintable) keep the downstream seam-seed for the read path, emit a
`**Coverage delta:**` naming what it skips, and disposition the propagation
`provisioning-blocked` with a `hermetic:` pointer. Demoting a reachable producer to
`provisioning-blocked` — suppressing real coverage behind a pointer — is itself a
coverage-honesty defect.
```

- [ ] **Step 4: Verify**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts tests/commands/create-qa-plan-thin.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/skills/qa/qa-plan-authoring/SKILL.md
AV_COMMIT_SKILL=1 git commit -m "docs(qa): provability ladder (Step 4.7) + auth-authority grounding in qa-plan-authoring

Litmus-first rung selection (R0 escape / R1 seam-seed / R2 curl / R3
Playwright), schema-grounded seeds with covered-channel fallbacks,
single-connection-reference + single-scenario seed rules, whole-block
mutation-guard phrasing rules (a)/(b)/(c), propagation-vs-read-back
honesty, IdP grounding with VALUE-vs-NAME bound + multi-principal reuse,
accurate post-declaredInput credential-paste rule, minimize-set rule."
```

---

### Task 4: `qa-plan-authoring/SKILL.md` part 2 — Steps 1.5, 6.5, 6.7, 6.8

**Files:**
- Modify: `src/skills/qa/qa-plan-authoring/SKILL.md`
- Test: `tests/skills/qa-plan-authoring.test.ts`

- [ ] **Step 1: Step 1.5 advisory carve-out (lines ~99–100)**

Find:
```
runtime is the system under test; QA tests the system *against* the spec. (Scale to surface:
a one-behavior change needs no matrix.)
```
Replace with:
```
runtime is the system under test; QA tests the system *against* the spec. (Scale to surface:
a one-behavior change needs no matrix — UNLESS Step 4.7 later classifies a surface
`provisioning-blocked`, which forces a one-row matrix. That verdict does not exist yet at
this step: draft the skeleton now only if you already foresee an un-provisionable trigger;
otherwise Step 6.7 forces the matrix retroactively.)
```

- [ ] **Step 2: Step 6.5 — thread `$AUTHORITY` through the second principal (lines ~233–234)**

Find:
```
- Give it its own `Inputs:` for the second principal (e.g. `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD`) — and add those names to `**Required environment variables:**` so preflight verifies them.
- Reuse the same `Egress:` and `Recipe:` shape as the first binding, substituting the second principal's input names.
```
Replace with:
```
- Give it its own `Inputs:` for the second principal (e.g. `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD`) — and add those names to `**Required environment variables:**` so preflight verifies them. When the authority is the declared `$AUTHORITY`/`$ISSUER` var (Step 4.6), list that SAME var in this binding's `Inputs:` too — `Inputs:` are per-binding (no ambient recipe env), and `parse_plan` rejects an undeclared recipe `$VAR`.
- Reuse the same `Egress:` and `Recipe:` shape as the first binding — including the SAME grounded authority, never a re-guessed endpoint for user B (Step 4.6 multi-principal rule) — substituting only the second principal's credential input names.
```

- [ ] **Step 3: Step 6.7 — amend the opening conditional (lines ~301–302)**

Find:
```
record its verdict per row. When the surface has ≥2 status/behavior classes, complete the
`## Coverage Matrix` drafted in Step 1.5:
```
Replace with:
```
record its verdict per row. When the surface has ≥2 status/behavior classes OR any changed
surface is `provisioning-blocked`, complete the
`## Coverage Matrix` drafted in Step 1.5 (drafting the one-row matrix now if Step 1.5 emitted none):
```

- [ ] **Step 4: Step 6.7 — rewrite the binary sentence and add the fourth disposition (lines ~315–317)**

Find:
```
3. `out-of-scope: <reason>` → a **harness-property** reason (Step 6.6). An `out-of-scope` whose
   reason is a code defect is INVALID — it must be `blocked-by`.
   A changed surface with a harness-observable interface (a curl-able route, a `psql`-observable DB effect, or a Playwright surface) cannot be `out-of-scope` — only `covered` or `blocked-by`; `out-of-scope` survives only for a changed surface with no such interface at all.
```
Replace with:
```
3. `out-of-scope: <reason>` → a **harness-property** reason (Step 6.6). An `out-of-scope` whose
   reason is a code defect is INVALID — it must be `blocked-by`.
   A changed surface with a harness-observable interface (a curl-able route, a `psql`-observable DB effect, or a Playwright surface) cannot be `out-of-scope`; it is `covered`, `blocked-by`, or (real read interface but an un-mintable precondition artifact) `provisioning-blocked` — `out-of-scope` survives only for a changed surface with no such interface at all.
4. `provisioning-blocked: <artifact>` → CORRECT code + a real `curl`/`psql`/Playwright read
   interface, but a precondition artifact the runner's four tools cannot mint (a pre-published
   external workflow, a third-party-issued token/cert). MANDATORY evidence in the Pointer cell:
   a `**Setup prerequisite:**` naming the exact human provisioning action and/or a
   `hermetic: <path>::<test>` pointer — Step-0-grounded: the file exists in the tree and the
   named test asserts the ORIGINATING producer the row skips (a hallucinated pointer is a
   hard-stop defect; with no on-disk test, the Setup prerequisite is required). Rules:
   - **Litmus + earn-the-punt.** *Un-provisionable* = the artifact needs an out-of-band issuer
     the four tools cannot reach. "Can it be minted?" is often a runtime fact — so EXHAUST the
     tree for a create-path (route table / OpenAPI / write-endpoint / factory / migration)
     first. A plausible create-path ⇒ emit the `covered` live scenario tagged
     `(unverified — confirm at run time)` — never punt. Affirmative out-of-band evidence ⇒
     `provisioning-blocked`. Neither settled ⇒ DEFAULT into `(unverified)` `covered` (the R1
     seedless-branch fallback, existence-check first assertion + `**Coverage delta:**`) —
     never a stall, silent drop, or punt.
   - **`(unverified)` backstop.** An `(unverified)` covered scenario riding an unconfirmed
     path MUST carry a `**Coverage delta:**` naming what goes unproven should the path be
     absent, plus a `hermetic:` pointer whenever Step 4.6 test-infra detection knows an
     on-disk test asserting the changed logic (the runner's `(unverified)` handling only
     downgrades a mismatch to LOW — no reclassification happens at run time).
   - **Necessity for the change (conjunctions).** With several preconditions, the row is
     `provisioning-blocked` only if an un-mintable one sits ON THE CAUSAL PATH of the
     CHANGED behavior AND no live rung observes the change without it; if the mintable
     subset already reaches the diff's behavior, the surface is `covered`.
   - **Tie-break (un-provisionable AND un-observable):** decide by remediability — a single
     named Setup prerequisite would make it observable ⇒ `provisioning-blocked` (that
     prerequisite is then mandatory; a hermetic pointer alone is insufficient); no
     provisioning action in the four-tool world could ever ⇒ `out-of-scope`.
   - **Tie-break (defect AND un-provisionable):** the DEFECT wins ⇒ `blocked-by`, with BOTH
     gates stated in the BLK entry's `**Remediation (human Setup prerequisite):**` field
     (revert the defect AND provision the artifact). `provisioning-blocked` is reserved for
     correct code.
   - **Row-anchoring.** A multi-hop propagation whose TERMINAL effect is a DB-observable
     write is anchored as that DB-observable schema surface and earns its own
     `provisioning-blocked` row; the intermediate hops are internal collaborators exercised
     through it (the internal-collaborator exclusion above does not suppress this row).
```

- [ ] **Step 5: Step 6.8 — three-way reclassify + new refute classes (line ~350 and after)**

Find:
```
  Decidable test: if the changed surface has a curl/psql/Playwright interface or effect, `out-of-scope` is invalid — reclassify to `covered` (reachable) or `blocked-by` (a defect obstructs it).
```
Replace with:
```
  Decidable test: if the changed surface has a curl/psql/Playwright interface or effect, `out-of-scope` is invalid — reclassify to `covered` (reachable now via an artifact the runner's four tools can create), `blocked-by` (a defect obstructs it), or `provisioning-blocked` (reachable only after a precondition artifact those tools cannot create — carries a Setup prerequisite and/or hermetic pointer).
- **`provisioning-blocked` rows (Step 4.7/6.7)** — re-read with intent to refute all of:
  (i) the named artifact is genuinely un-mintable by the four tools AND on the causal path of
  the CHANGED behavior (a mintable-or-plausible create-path, or an unrelated-to-the-diff
  artifact, reclassifies to `covered`); (ii) the `hermetic:` pointer RESOLVES — file on disk,
  named test asserts the originating producer (not an adjacent behavior); (iii) the row was
  not chosen over an executable live rung (R0-as-lazy-shortcut is a defect).
- **Seam-seed scenarios (Step 4.7)** — refute: (i) INSERT schema-grounding (every
  column/enum cited from a committed source; an ungrounded seed is a coverage defect);
  (ii) whole-block phrasing — a seed block carrying a BLOCKED-class token anywhere bypasses
  the mutation guard (its INSERT lands unguarded); a READ-ONLY scenario whose block trips a
  bare present-tense write verb strips with no consent-gate recovery (rule (c));
  (iii) marker completeness — any from-scratch write scenario missing the
  `**Seed (psql/sqlite3):**` label + `**Seeds fixtures:**` Setup bullet either strips
  silently (voiding a row still marked `covered`) or lands unguarded; (iv) an
  `(unverified)` covered row with neither `**Coverage delta:**` nor an available hermetic
  pointer is the same defect class as an un-pointed `provisioning-blocked` row.
- **Auth authority / token endpoint (Step 4.6)** — re-read the app's auth config with
  intent to refute the recipe's login URL and `Egress:` host: a well-known IdP host
  reproduced from memory (e.g. `login.microsoftonline.com` against a configured CIAM
  authority) is a refute failure; verify the second-principal binding reuses the SAME
  grounded authority and declares `$AUTHORITY`/`$ISSUER` in its own `Inputs:`.
```

- [ ] **Step 6: Verify**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts tests/modules/plan/ tests/commands/create-qa-plan-thin.test.ts`
Expected: pass (pins `Reachability litmus` / `Targeted refute pass` / `intent to *refute*` intact).

- [ ] **Step 7: Commit**

```bash
git add src/skills/qa/qa-plan-authoring/SKILL.md
AV_COMMIT_SKILL=1 git commit -m "docs(qa): provisioning-blocked disposition, litmus + refute classes in qa-plan-authoring

Step 6.7 gains the fourth disposition with earn-the-punt litmus,
undetermined-middle default, necessity-for-the-change, both tie-breaks,
Step-0-grounded hermetic pointers and row-anchoring; Step 6.8 reclassify
goes three-way with seam-seed/auth/provisioning-blocked refute classes;
Step 1.5 advisory carve-out; Step 6.5 threads \$AUTHORITY to user B."
```

---

### Task 5: `veles.md` — hard-stop enum + matrix trigger (REQUIRED companion)

**Files:**
- Modify: `src/modules/plan/veles.md:42-47`
- Test: `tests/modules/plan/veles-prompt.test.ts`

- [ ] **Step 1: Amend the matrix trigger + disposition enumeration**

Find:
```
- when your `## Changes Summary` names ≥2 statuses, the `## Coverage Matrix` has one row per such
  status and per changed external surface named in the Changes Summary, each with exactly one
  disposition — `covered` (+ scenario ID + `(file:line)`), `blocked-by` (matching a BLK entry, with
  a kept contract-correct scenario), or `out-of-scope` (+ harness-property reason). A named status
  or surface with no row, or an `out-of-scope` whose reason is a code defect, is a hard-stop failure;
  a reachable changed surface (curl/psql/Playwright interface or effect) dispositioned `out-of-scope` is likewise a hard-stop failure;
```
Replace with:
```
- when your `## Changes Summary` names ≥2 statuses OR any changed surface is `provisioning-blocked`,
  the `## Coverage Matrix` has one row per such
  status and per changed external surface named in the Changes Summary (a single-surface
  `provisioning-blocked` diff still requires its one-row matrix), each with exactly one
  disposition — `covered` (+ scenario ID + `(file:line)`), `blocked-by` (matching a BLK entry, with
  a kept contract-correct scenario), `out-of-scope` (+ harness-property reason), or
  `provisioning-blocked` (correct code + a reachable read interface, but a precondition artifact
  un-mintable by curl/psql/sqlite3/Playwright). A `provisioning-blocked` row MUST carry a
  `**Setup prerequisite:**` and/or a Step-0-grounded `hermetic: <path>::<test>` pointer (file present
  in the tree; the named test asserts the skipped producer) — a row with neither, a hallucinated
  pointer, or one whose precondition artifact IS mintable by those four tools (then it is `covered`;
  never key this on a read interface existing — every valid `provisioning-blocked` row has one) is a
  hard-stop failure. A named status
  or surface with no row, or an `out-of-scope` whose reason is a code defect, is a hard-stop failure;
  a reachable changed surface (curl/psql/Playwright interface or effect) dispositioned `out-of-scope` is likewise a hard-stop failure — `provisioning-blocked` is the disposition for reachable-but-un-mintable; `out-of-scope` stays reserved for no-interface;
```

- [ ] **Step 2: Verify**

Run: `bunx vitest run tests/modules/plan/ tests/modules/agent-registry/`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/plan/veles.md
AV_COMMIT_SKILL=1 git commit -m "docs(plan): veles hard-stop admits provisioning-blocked + forces its matrix row

Fourth disposition in the hard-stop enum keyed on precondition
mintability (not interface existence), with Step-0-grounded pointer
requirement; matrix trigger extended so a single-surface
provisioning-blocked diff cannot drop its row at the enforcement layer."
```

---

### Task 6: `perun.md` — four edits (preflight prompt, seed-consent, sanitizer, §3.10)

**Files:**
- Modify: `src/agents/perun.md`
- Test: `tests/agents/` + `tests/modules/coordinator/`

⚠️ Never write the token `base_url` (use `base-url`); never write `fix-auto`.

- [ ] **Step 1: Un-stale the preflight prompt route (a) note (lines ~427–428)**

Find:
```
     NO restart needed. Note: credential-style names (e.g. DATABASE_, AWS_,
     SUPABASE_, POSTGRES_ prefixes) are refused for chat-paste and must use (b).
```
Replace with:
```
     NO restart needed. Note: credential-style names (e.g. DATABASE_, AWS_,
     SUPABASE_, POSTGRES_ prefixes) ARE pasteable when this plan DECLARES them
     (as a Required env var or a binding Input) — preflight has already
     registered the declared names, so paste NAME=value and it is recorded
     immediately. An UNDECLARED credential-prefixed name is still refused —
     use (b) for that one.
```

- [ ] **Step 2: Add the seed-consent bullet (in the `qa_loop_start` return-notes list, immediately after the `**If `status` is `"error"`…STOP the run.**` bullet)**

Insert:
```
- **Seed-consent (`allow_mutations`).** Keep `allow_mutations: false` UNLESS the plan's `## Setup` carries `**Seeds fixtures:**` (the defined marker for plan-declared `**Seed (psql/sqlite3):**` writes). Never flip it silently: surface a one-line consent gate — *"this plan seeds fixtures via `<the exact declared DB token name(s) the Seed steps reference>`; confirm the base-url AND each of those DBs point at a dedicated throwaway instance (never shared/prod)"* — and pass `allow_mutations: true` only after the user confirms (or the run was invoked with `--allow-mutations`). The seed's write egress is the declared DSN host, a field separable from the base-url — the gate names BOTH.
```

- [ ] **Step 3: Sanitizer — exfil exception (line ~133)**

Find:
```
- **Block unauthorized network exfil:** Reject any step that sends data to an external host not declared in the plan frontmatter. Mark the scenario SKIP with reason "Security: blocked unauthorized network request".
```
Replace with:
```
- **Block unauthorized network exfil:** Reject any step that sends data to an external host not declared in the plan frontmatter. Mark the scenario SKIP with reason "Security: blocked unauthorized network request". EXCEPTION: a plan-declared `**Seed (psql/sqlite3):**` step whose single connection reference is the `$VAR`/DSN declared under the plan's `## Setup` `**Required databases:**`/Required env vars targets a declared host — pass it; any OTHER connection target in a Seed step is rejected.
```

- [ ] **Step 4: Sanitizer — BE allowlist (line ~137)**

Find:
```
   - **BE allowed operations:** `curl` HTTP requests, `psql`/`sqlite3` queries, API response assertions.
```
Replace with:
```
   - **BE allowed operations:** `curl` HTTP requests, `psql`/`sqlite3` queries AND plan-declared `**Seed (psql/sqlite3):**` writes (gated by the `**Seeds fixtures:**` consent + `allow_mutations` — see the seed-consent bullet above), API response assertions.
```

- [ ] **Step 5: §3.10 carve-out (line ~626)**

Find:
```
Rationale: seeding a from-scratch FK chain is the QA recipe flow's job; a wrong-project or missing-ancestor stop signals an operator or plan error, not a gap to brute-force with broad tooling.
```
Replace with:
```
Rationale: seeding a from-scratch FK chain is the QA recipe flow's job; a wrong-project or missing-ancestor stop signals an operator or plan error, not a gap to brute-force with broad tooling. EXCEPTION: a plan-declared `**Seed (psql/sqlite3):**` step inside a BE scenario is ordinary scenario execution by zmora-be (schema-grounded, gated by the `**Seeds fixtures:**` consent + `allow_mutations`) — NOT a fixture-mutation task under this rule; the no-from-scratch-FK-chain prohibition stays absolute for Stribog, for `general`/non-roster fallback, and for any recipe/credential path.
```

- [ ] **Step 6: Step 3.8 scope-note mirror (line ~200, end of the 3.8 paragraph)**

Find:
```
Stribog only mutates an **already-identified** row.
```
Replace with:
```
Stribog only mutates an **already-identified** row. (A plan-declared `**Seed (psql/sqlite3):**` step inside a BE scenario is NOT such a mutation task — it is ordinary zmora-be scenario execution, gated by the Workflow-1 seed-consent rule.)
```

- [ ] **Step 7: Verify (pins + guards)**

Run: `bunx vitest run tests/agents/ tests/modules/coordinator/ && grep -c "base_url" src/agents/perun.md; grep -c "fix-auto" src/agents/perun.md`
Expected: tests pass; both greps print `0` (grep exits 1 on zero matches — that is the wanted outcome).

- [ ] **Step 8: Commit**

```bash
git add src/agents/perun.md
AV_COMMIT_SKILL=1 git commit -m "docs(coordinator): seed-consent gate, sanitizer seed exception, accurate paste rule

Preflight prompt now states the declared-name paste exemption; new
Seeds-fixtures consent gate names base-url AND the seed DSN token(s)
before passing allow_mutations; Step-3 sanitizer passes a plan-declared
Seed step targeting the declared DB (and only that) and allowlists Seed
writes; §3.10 + Step 3.8 carve the Seed step out as ordinary zmora-be
scenario execution."
```

---

### Task 7: `be-testing/SKILL.md` — leading Seed step in the executor workflow

**Files:**
- Modify: `src/skills/qa/be-testing/SKILL.md:45-54`

- [ ] **Step 1: Insert the Seed step and renumber**

Find:
```
1. **Read the scenario** — understand method, endpoint, payload, expected response, DB checks
2. **Execute the request** — send HTTP request with proper method, headers, body
3. **Verify response** — check status code, response body structure, specific values
4. **Verify DB state** (if DB Check specified) — run query, compare against expected
5. **Execute edge cases** — run each edge case as a sub-test
6. **Record result** — pass/fail with response details
```
Replace with:
```
1. **Read the scenario** — understand method, endpoint, payload, expected response, DB checks
2. **Execute the Seed FIRST** (only if the scenario carries `**Seed (psql/sqlite3):**`) — run the fenced SQL as a single statement via the step's ONE plan-declared connection reference, e.g. `psql "$DATABASE_URL" -c '<SQL>'` (the `$VAR`/DSN declared under the plan's `## Setup`). A Seed step with any other/undeclared connection target, or whose `$VAR` is unset in the environment, is `NEED_INFO` — never guess a connection. A failed seed reports as *seed-missing*, not as a code defect.
3. **Execute the request** — send HTTP request with proper method, headers, body
4. **Verify response** — check status code, response body structure, specific values
5. **Verify DB state** (if DB Check specified) — run query, compare against expected
6. **Execute edge cases** — run each edge case as a sub-test
7. **Record result** — pass/fail with response details (include the seed outcome when present)
```

- [ ] **Step 2: Verify + commit**

Run: `bunx vitest run tests/skills/`
Expected: pass.

```bash
git add src/skills/qa/be-testing/SKILL.md
AV_COMMIT_SKILL=1 git commit -m "docs(qa): be-testing executes a plan-declared Seed step before the request

Seed runs via the step's single plan-declared connection reference;
undeclared/unset targets are NEED_INFO; seed failures report as
seed-missing, never as a code defect."
```

---

### Task 8 *(recommended — trim on user request; §9 manual smoke is the accepted validation floor)*: veles eval scenarios

**Files:**
- Modify: `docs/eval/scenarios/veles/qa-plan-multi-principal.md`
- Create: `docs/eval/scenarios/veles/qa-plan-provisioning-blocked.md`

- [ ] **Step 1: Read the two sibling scenarios for exact structure**

Run: `Read docs/eval/scenarios/veles/qa-plan-multi-principal.md` and `Read docs/eval/scenarios/veles/qa-plan-from-diff.md`. Mirror their section structure (Query / Expected coverage MUST vs NICE-TO-HAVE / Quality signals / What this discriminates) and their fixture pattern under `fixtures/`.

- [ ] **Step 2: Extend `qa-plan-multi-principal.md` with the auth-GROUNDING variant**

Add a variant (or MUST items) whose fixture diff configures a **CIAM authority** (`https://<tenant>.ciamlogin.com/<tenant-id>`) in a committed config file, discriminating exactly:
- **MUST:** the `QA_BIND_JWT*` recipes derive login URL + `Egress:` from the configured CIAM authority (fail = any `login.microsoftonline.com` guess);
- **MUST:** user B's binding declares the SAME `$AUTHORITY`/`$ISSUER` in its own `Inputs:` and reuses the grounded authority (fail = re-guessed endpoint or missing Input);
- **MUST:** `$AUTHORITY` (when used) is the whole authority; pasted-value contract stated.

- [ ] **Step 3: Create `qa-plan-provisioning-blocked.md` (Layer-1, embedded diff)**

Fixture: a diff adding a multi-hop derived-value propagation (executor→worker→DB write of `score`) whose only live trigger needs a pre-published external workflow (un-mintable), plus a readable detail endpoint. Discriminators:
- **MUST:** an R1 seam-seed + read scenario for the read path — single scenario, `**Seed (psql/sqlite3):**` label, ONE plan-declared connection reference, schema-grounded INSERT, whole-block positive phrasing;
- **MUST:** `## Setup` carries `**Seeds fixtures:** BE-NN (requires allow_mutations)`;
- **MUST:** a `## Coverage Matrix` row `provisioning-blocked` for the propagation with a resolving `hermetic:` pointer (fixture includes the unit test) + un-mintable reason — NOT `covered`, NOT `out-of-scope`, and no stall on an un-gettable env var (fail = an `AI_WORKFLOW_ID`-style Required env var with no fallback);
- **MUST:** the seam-seed read carries `**Coverage delta:**` naming the skipped propagation;
- **NICE-TO-HAVE:** undetermined-middle handling → `(unverified)` covered with existence-check first assertion.

- [ ] **Step 4: Commit**

```bash
git add docs/eval/scenarios/veles/
AV_COMMIT_SKILL=1 git commit -m "docs(eval): veles scenarios for auth-authority grounding + provisioning-blocked ladder"
```

---

### Task 9: Full gate + dist rebuild + spec cross-check

**Files:**
- Modify: `dist/**` (generated)

- [ ] **Step 1: Doctrine grep-check (cross-file consistency)**

Run:
```bash
grep -c "provisioning-blocked" src/skills/qa/qa-plan-authoring/SKILL.md src/skills/qa/test-plan-format/SKILL.md src/modules/plan/veles.md
grep -c "Seeds fixtures" src/skills/qa/qa-plan-authoring/SKILL.md src/skills/qa/test-plan-format/SKILL.md src/agents/perun.md
grep -c "Seed (psql/sqlite3)" src/skills/qa/test-plan-format/SKILL.md src/skills/qa/be-testing/SKILL.md src/agents/perun.md
grep -cE "base_url|fix-auto" src/agents/perun.md || echo OK-absent
```
Expected: every counted token ≥1 in each listed file; the last line prints `OK-absent`.

- [ ] **Step 2: Full verification gate**

Run:
```bash
node scripts/verify-no-review-ids.mjs && bunx tsc --noEmit && bunx vitest run && bun run build
```
Expected: guard ✅, tsc clean, **all tests pass**, build succeeds.

- [ ] **Step 3: Commit the regenerated dist**

Run `git status --porcelain dist/` — expect modified copies of exactly the five edited markdown files (+ none other).
```bash
git add dist/
AV_COMMIT_SKILL=1 git commit -m "build(qa): regenerate dist for provisionable-QA-plans doc set"
```

- [ ] **Step 4: Spec §10 cross-check (final)**

Open `docs/superpowers/specs/2026-07-01-provisionable-qa-plans-design.md` §10 and tick every row against `git log --oneline master..HEAD` + `git diff master..HEAD --stat`. Every §10 row must map to a commit; any miss = go back and fix before reporting done.

- [ ] **Step 5: Report**

Summarize: commits on `feat/provisionable-qa-plans`, test counts, and the two **post-merge manual steps** the spec leaves to the human (§9): the manual smoke (re-author a plan for the transcript's diff in the private repo; confirm the seam-seed + `provisioning-blocked` row + grounded `QA_BIND_JWT` authority) and, optionally, running the eval scenarios. Do NOT push; the user decides about the PR.

---

## Self-review (done at authoring time)

- **Spec coverage:** §10 rows → Tasks: qa-plan-authoring→3+4; test-plan-format→2; be-testing→7; veles.md→5; perun.md→6; dist→9; eval→8. §4b's four perun edits = Task 6 steps 1–6 (two sanitizer steps + §3.10 + 3.8 mirror = the "fourth edit" pair). §9 validation = Tasks 8–9. ✔
- **Placeholder scan:** Task 8 deliberately specifies discriminator content + structure-mirroring rather than full fixture text (optional task; fixtures are derivative of sibling files the executor must read first — an explicit read step, not a TBD). All other tasks carry complete find/replace text. ✔
- **Consistency:** marker names (`**Seeds fixtures:**`, `**Seed (psql/sqlite3):**`, `provisioning-blocked`, `**Coverage delta:**`, `$AUTHORITY`) identical across Tasks 2–7 and match the spec. ✔
