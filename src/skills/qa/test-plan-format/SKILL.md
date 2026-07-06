---
name: test-plan-format
description: Test plan structure, naming conventions, edge case generation rules, and file saving conventions for QA test plans.
activation: Load when creating or formatting QA test plans
---

# Test Plan Format

## File Conventions

- **Location:** `docs/testing/plans/`
- **Naming:** `YYYY-MM-DD-<topic>-test-plan.md` where `<topic>` is a slugified summary (lowercase, hyphens, no spaces)
- **Create directory if needed:** `mkdir -p docs/testing/plans`

---

## Plan Structure

Every test plan MUST follow this exact structure. Plan metadata lives in YAML frontmatter (parsed by Perun Step 2 — `source`, `branch`, `base-url`, `detected-tools`). There is no separate `## Source` or `## Detected Tools` body section; that metadata is the frontmatter.

~~~markdown
---
source: <PR #N / branch <name> / last N commits / staged changes>
branch: <branch name>
base-url: <http(s)://host:port>
detected-tools: [<tool1>, <tool2>, ...]
---

# Test Plan: <title>

## Setup

Use Setup to declare prerequisites that QA's preflight check must pass before any scenario runs. Omit this section if the plan needs no env vars, services, or databases.

**Required environment variables:**
- `TEST_USER_EMAIL` — login email for test account
- `TEST_USER_PASSWORD` — login password

**Required services:**
- App at `http://localhost:3000`

**Required databases:**
- `postgresql://localhost:5432/myapp_test`

## Changes Summary

<Human-readable summary: what changed, which files/endpoints, and what needs testing. This is the legible "Source / Changes" view for a human reader — keep it specific (endpoints, files, behaviors), not a one-liner.>

## Blockers / Findings

<Defects in the code under test that obstruct HOW it must be tested. A Blocker is NOT
"out of harness scope": out-of-scope = the harness physically cannot observe the behavior;
a Blocker = the behavior IS in scope but current code is wrong/instrumented so the spec'd
result can't be observed. This section is MANDATORY — if you found none, write `None found.`>

### BLK-01: <one-line defect> — `(file:line)`
- **Impact on testing:** <which scenarios it obstructs and the spurious result it forces>
- **Remediation (human Setup prerequisite):** <exact human action before the run>
- **Blocks:** <scenario IDs carrying `**Blocked-by:** BLK-01`>
- **Hermetic observation (optional):** `<path>::<test>` — an existing repo test that observes the blocked-unobservable contract when the live path cannot (see `qa-plan-authoring` Step 0)

## Coverage Matrix   (required when the Changes Summary names ≥2 status/behavior classes OR any changed surface is `provisioning-blocked`)

<One row per intended behavior / status from the spec, and per changed external surface named in the Changes Summary (drafted in authoring Step 1.5,
dispositioned in Step 6.7). Omit on single-behavior diffs UNLESS a changed surface is `provisioning-blocked` (then a one-row matrix is required). Exactly one disposition per row;
`blocked-by` (lowercase) is the disposition keyword — distinct from the `**Blocked-by:**`
scenario tag.
A changed surface with a harness-observable interface (route / DB-effect / Playwright) takes `covered`, `blocked-by`, or `provisioning-blocked` (reachable read interface, but a precondition artifact the runner cannot mint) — never `out-of-scope`.
A `blocked-by` row whose contract is unobservable live may add a `hermetic: <path>::<test>` pointer in its Pointer cell.
A `provisioning-blocked` row MUST carry, in its Pointer cell, a `**Setup prerequisite:**` naming the exact human provisioning action and/or a `hermetic: <path>::<test>` pointer (a REAL on-disk test asserting the skipped producer — a pointer to an absent file or an unrelated test is a hard-stop defect), plus a one-clause reason the artifact is un-mintable by `curl`/`psql`/`sqlite3`/Playwright.>

| Behavior / status | Expected (per contract) | Disposition | Pointer |
|---|---|---|---|
| 200 happy path | 200 + `%PDF` | covered  /  blocked-by  /  out-of-scope  /  provisioning-blocked | scenario ID, BLK ID, harness-property reason, or Setup-prerequisite / `hermetic:` pointer |
| confidence.score propagation | score persisted to `user_tasks` | provisioning-blocked | hermetic: `tests/unit/…/test_user_task_executor.py::test_extract_confidence_score` — live trigger needs a pre-published external workflow the runner cannot create |

## FE Test Scenarios

### FE-01: <scenario name>

**Steps:**
1. <action>
2. <action>
3. <verification>

**Expected result:** <expected result>

**Edge cases:**
- <edge case 1>
- <edge case 2>

## BE Test Scenarios

### BE-01: <scenario name>

**Seed (psql/sqlite3):** *(optional — only for a plan-authored from-scratch write, Step 4.7)*
```sql
<single INSERT statement, schema-grounded (file:line)>
```
*(Executed FIRST via exactly ONE plan-declared connection reference — e.g. `psql "$DATABASE_URL" -c '<SQL>'`, the `$VAR`/DSN declared under `## Setup` — no other target. Requires the `## Setup` `**Seeds fixtures:**` bullet.)*

**Method:** <HTTP method> <full URL or path>
**Headers:** <required headers, e.g. Content-Type: application/json>
**Payload:**
```json
<JSON body>
```

**Expected response:** status <code>, <response body description>.

**DB Check:**
```sql
<SQL query>
```
<Expected state, e.g. "Expect `last_login_at` updated to within the last 60 seconds.">

**Edge cases:**
- <edge case with expected response>
~~~

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

### Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `source` | yes | Human-readable origin: PR number, branch, "last N commits", "staged changes", "example", etc. |
| `branch` | yes | Branch name; use `example` or `n/a` for hand-written reference plans. |
| `base-url` | yes (when scenarios target a live host) | Used by Perun to inject as an additional required service and as the dispatch `Base URL` for Zmora. Omit only for plans with no live target. |
| `detected-tools` | yes | YAML list of tool names actually present (e.g. `[playwright, curl, psql]`). Used to gate dependent scenarios. |

### Section omission and placement

- `## Setup` MUST appear after the page title and before the scenario sections — see `## Setup Rules` below for the full rule set.
- `## Changes Summary` may appear before or after `## Setup`; both placements are accepted by the parser.
- Scenario sections (`## FE Test Scenarios`, `## BE Test Scenarios`) are omitted when not applicable — see `## Section Omission Rules` below.

---

## Setup Rules

- **Placement.** `## Setup` MUST appear after the YAML frontmatter and page title, and before `## FE Test Scenarios` / `## BE Test Scenarios`. `## Changes Summary` may appear before or after `## Setup`. The parser is single-pass.
- **Soft cap.** ≤50 total prerequisites (env vars + services + databases combined). Plans exceeding this are rejected — split the plan or drop unused items.
- **DSN scheme is required.** Databases must use an explicit scheme: `postgresql://`, `mysql://`, `redis://`, `sqlite:///`. Schemeless forms are rejected.
- **sqlite DSNs must be project-relative (3 slashes); 4-slash absolute paths are rejected for safety.** SQLAlchemy's 4-slash form (`sqlite:////tmp/foo.db`) addresses an absolute filesystem path, which would let the preflight probe act as a file-existence oracle for arbitrary host paths (CWE-200). Use the 3-slash project-relative form (`sqlite:///var/test.db`) instead. Paths containing `..` are also rejected.
- **IPv6 hosts are not yet supported in DSNs; use an IPv4 address or hostname.**
- **Env var names.** Must match `^[A-Z_][A-Z0-9_]*$`. Bullets that fail the regex are ignored with a warning.
- **Minimize prerequisites.** Every `**Required environment variables:**` name and every binding `Inputs:` `$VAR` MUST be referenced by at least one scenario or recipe — drop unreferenced prerequisites; they inflate the preflight wall for nothing.
- **Seeds fixtures marker.** `**Seeds fixtures:** BE-NN[, BE-NN…] (requires allow_mutations)` is a `## Setup` bullet that is MANDATORY whenever any scenario carries a `**Seed (psql/sqlite3):**` step (an R1 seam-seed OR a covered stage-driving write — authoring Step 4.7). It is the defined marker Perun's seed-consent gate keys on; omitting it means the seed strips silently under the mutation guard or the run stalls.
- **A scenario auth credential MUST be declared in `## Setup`.** If ANY scenario header carries an auth credential — `Authorization: Bearer <token>`, an `X-API-Key`/`Api-Key` header, or a session cookie — that credential MUST be declared under `## Setup`, in ONE of the two canonical forms, so `preflight` catches it UP FRONT and registers the declared NAME (never a placeholder like `<token>`):
  - a **static** credential the human supplies (a long-lived PAT, a pre-minted bearer) → a `**Required environment variables:**` NAME (e.g. `QA_API_BEARER_TOKEN`), and the scenario header references it by env var (`Authorization: Bearer $QA_API_BEARER_TOKEN`) — NOT the literal `<token>`; or
  - a **dynamic** credential minted at QA time from a login endpoint → a `**Bindings:**` `QA_BIND_*` entry (Auth-authority grounding rules apply), and the header references `$QA_BIND_<NAME>`.
  A plan whose scenarios need auth but whose `## Setup` declares NEITHER form is DEFECTIVE: `preflight([])` returns `ok` on the empty list, so the missing credential is invisible until every scenario fails mid-run with `NEED_INFO kind: "auth"/"credentials"` — the exact failure this rule exists to move to preflight time. (This is the belt-and-suspenders COMPLEMENT to shell-env injection, not its cause: a declared static NAME the user pastes via `record_input` reaches every `zmora-*` child through the `shell.env` hook regardless of declaration — declaring it only makes the gap visible UP FRONT and registers the name so a credential-prefixed one clears the paste denylist.)
- **Account existence is a human prerequisite, not a value.** An auth account that a binding's login credentials name must already EXIST before its recipe can mint a token; `preflight` verifies credential *presence*, never account *existence*. State it as an imperative human `## Setup` prerequisite carrying the exact creation command (never optional "if necessary" prose), or mark the dependent scenarios provisioning-blocked — see qa-plan-authoring Step 6.5.
- **Omit when unused.** A plan with no prerequisites can omit the entire `## Setup` section.

---

## Bindings (dynamic credentials)

Use `**Bindings:**` inside `## Setup` to declare credentials or tokens that must be **minted at QA time** (e.g. short-lived auth tokens fetched from a login endpoint). Unlike `Required environment variables` — which the preflight check only probes for presence — bindings are produced by a sandboxed shell **recipe** run inside Perun's binding executor and then exposed to dependent scenarios.

A binding is a first-class member of `## Setup`, peer to `**Required environment variables:**`, `**Required services:**`, and `**Required databases:**`. Omit the subsection entirely when no bindings are needed.

### Markdown shape

~~~markdown
**Bindings:**
- `QA_BIND_NAME` (secret|plain) — description
  - Inputs: $VAR1, $VAR2
  - Egress: `https://api.example.com`
  - Recipe:
    ```bash
    curl -sf -X POST "$VAR1/auth/login" \
      -H "Content-Type: application/json" \
      --data "{\"email\":\"$VAR2\"}" | jq -er .token
    ```
~~~

Each binding block has exactly four members and they MUST appear in this order: the header line, then `Inputs:`, `Egress:`, and `Recipe:` (with a fenced ```bash``` block). The parser is strict about indentation — sub-fields are indented two spaces beneath the header bullet, and the recipe fence is indented four spaces.

### Field rules

- **Name pattern.** `QA_BIND_[A-Z][A-Z0-9_]*` — the `QA_BIND_` prefix is mandatory. Names that fail the regex cause `parse_plan` to abort with an error.
- **Type.**
  - `secret` — value is scrubbed from logs, reports, and any other artefact the QA run emits. Use for tokens, passwords, API keys.
  - `plain` — value is NOT scrubbed. Use only for non-sensitive derived values (e.g. a discovered resource ID).
- **Inputs.** Comma-separated `$VAR` references. Every `$VAR` that appears in the recipe MUST be declared here; the parser rejects the binding otherwise. Inputs may reference other bindings (`$QA_BIND_OTHER`) — this creates a Wave-0 dependency edge.
- **Egress.** A single host URL the recipe is allowed to talk to. Applies to `curl` (URL host), `psql`, and `sqlite3` (DSN host). The parser rejects any recipe command whose connection target host does not match this value.
- **Recipe.** A single shell statement inside a fenced ```bash``` block. See sandbox rules below.
- **Auth authority grounding.** A token-minting recipe derives its login URL + `Egress:` host from the app's CONFIGURED authority (authoring Step 4.6) — never a guessed well-known endpoint (a hard-coded `login.microsoftonline.com` against a CIAM tenant fails with every secret present). Only a bare routing endpoint (scheme://host / tenant slug, no secret component) may be inlined; anything secret-bearing is declared by NAME. Runtime-only authority → declare `$AUTHORITY`/`$ISSUER` as a Required env var AND list it in the binding's `Inputs:` (a recipe `$VAR` absent from `Inputs:` is rejected by `parse_plan`); `$AUTHORITY` must be the WHOLE authority, tenant-id INCLUDED (`Egress: $AUTHORITY`; recipe `"$AUTHORITY/oauth2/v2.0/token"`) and the pasted value a bare authority `scheme://host/<tenant-id>` (the tenant-id is part of the authority; no `oauth2/…` endpoint path — a paste-time contract, the egress lock checks only the template). The grounded authority is app-level: a second-principal binding declares the SAME `$AUTHORITY`/`$ISSUER` in its own `Inputs:` and reuses it — never a re-guessed endpoint for user B.

### Recipe sandbox rules (summary)

The recipe is validated by `validateRecipe()` before it runs. Cross-check `src/modules/qa/binding-parser.ts` for the canonical list; the rules that matter at plan-authoring time are:

- **Single statement.** No `;`, `&&`, `||`, or newlines splitting commands. Pipes (`|`) are allowed — a pipeline is one statement.
- **Command allowlist.** Only `curl`, `psql`, `sqlite3`, `jq`, `grep`, `cut`, `head`, `tail`, `tr`, `printf`. Anything else (including `awk`, `sed`, `bash`, `sh`, `python`) is rejected outright.
- **No shell metaprogramming.** Forbidden: command substitution `$(...)`, backticks, heredocs/herestrings, process substitution `<(...) / >(...)`, `eval`, `source`, `export`, `unset`, `declare`/`local`/`readonly`/`set`, `function`, redirects to anywhere other than `/dev/null`, and trailing `&` backgrounding.
- **Egress host match.** Every `curl` URL host and every `psql`/`sqlite3` DSN host must equal the binding's `Egress:` host.
- **File-reader path confinement.** `grep`, `cut`, `head`, `tail`, `tr` may only read `./` relative paths, `-` (stdin), `/dev/null`, `/dev/stdin`, or `/dev/zero`. Absolute paths anywhere else (e.g. `/etc/passwd`) are rejected.
- **Runnable as written.** A DB DSN in a recipe must
  **carry the credentials the local service requires** — reference the documented
  `$DATABASE_URL` rather than a credential-less literal; a recipe that cannot
  authenticate is a defect. The recipe sandbox forbids `python`, so seed via `psql`
  and **cite any repo-sanctioned seeding script** (e.g. one named in `CLAUDE.md`)
  as the semantic reference in a comment — preferring the script itself applies only
  to human Setup prerequisites, where `uv run python` is available.
- **sqlite3 dot-command restrictions.** `.read`, `.shell`, `.system`, `.import`, `.save`, `.output`, `.log` are forbidden — they escape SQL into shell or read arbitrary files.
- **16 KiB cap.** The recipe body (after line-continuation collapse) must be ≤16 384 bytes.

### Wave-0 synthesis (Perun's responsibility)

You — the plan author — only write the declarative binding block. Perun synthesises one `### SETUP-<NN>: Provision QA_BIND_<NAME>` scenario per binding during Step 3.6 of its workflow (see `src/agents/perun.md`). These SETUP-* scenarios:

- Are inserted into the scenario list BEFORE wave computation, so they typically land in Wave 0.
- Inherit `Depends-on:` from any `Inputs:` that are themselves `QA_BIND_*` names — transitive bindings chain correctly.
- Have a one-line body that invokes `execute_recipe({ binding_name: "QA_BIND_<NAME>" })`.

Do NOT hand-author `### SETUP-XX:` scenarios in your plan — they are generated, not authored.

---

## Scenario Naming

- FE scenarios: `FE-01`, `FE-02`, ... `FE-NN` (zero-padded two digits)
- BE scenarios: `BE-01`, `BE-02`, ... `BE-NN` (zero-padded two digits)
- Numbering is sequential within each section, starting from 01

---

## Grounding tags & assertion style

Behavioral assertions (status codes, rate-limit semantics, auth/authz outcomes,
error-envelope shape, derived values like generated filenames) carry **inline
evidence**:

- **Visible citation:** append the source the author read, e.g.
  `**Expected response:** status 429 after the 6th request in 60s (`api/auth/ratelimit.py:12`).`
  One citation on the single most load-bearing line per assertion (for a DB Check
  the column is implicit in the SQL; for a derived value cite the producer). A
  DB-check on a time-bounded entity **asserts the active predicate** (`valid_to >
  now()`), not bare existence — a `COUNT(*)` that ignores the validity window is
  incomplete.
- **`(unverified — confirm at run time)`** — use when the author could NOT read
  the code that produces the behavior (source not on disk, foreign repo). Never
  emit a `(file:line)` you cannot back; a well-formed-but-ungrounded citation is
  worse than this tag.
- **Function-derived values** (percent-encoding, hashing, slugging, formatting, signing):
  assert the **generating rule + producer `(file:line)`** — e.g. *"RFC 5987 percent-encoded UTF-8
  of `<name>.pdf` via `quote(…, safe='')` (`filename.py:38`)"* — **not a hand-computed literal**.
  Show an exact derived literal only when a fixture/test pins it (cite that test); without a pin, that
  exact literal is unverifiable by reading — assert the rule + `(file:line)` (full confidence) and tag the
  literal `(unverified — confirm at run time)`. A function output is
  grounded by its *rule*, distinct from the human-message `(exact text — brittle)` rule below.

- **`**Coverage delta:**`** — an inert scenario annotation (the parser ignores
  expected-result prose) naming exactly what this scenario does NOT prove — e.g. a
  downstream seam-seeded read that skips the upstream derivation, or an `(unverified)`
  path that may be absent at run time. Required on every downstream seam-seed and every
  `(unverified)` covered scenario riding an unconfirmed path (authoring Step 4.7). Keep
  its prose free of bare present-tense write verbs (Step 4.7 rule (c)).

Assertion style:

- **Primary:** assert the stable status code + structural body shape (keys/types).
- **Secondary (opt-in only when status+shape cannot disambiguate):** exact
  human-readable message text, tagged `(exact text — brittle)`. The runner matches
  a `(exact text — brittle)` assertion as **substring/contains, not equality**.

These tags appear in scenario bodies / `**Expected response:**` lines only; the
plan parser ignores expected-result prose, so they are inert to it.

---

## Edge Case Generation Rules

For EVERY scenario, consider and include relevant edge cases from:

### Input boundaries
- Empty/null/missing values
- Maximum length strings
- Special characters (unicode, HTML entities, SQL metacharacters)
- Negative numbers, zero, boundary values (MAX_INT)

### Authentication & Authorization
- Unauthenticated request (no token)
- Expired token
- Valid token but insufficient permissions
- Another user's resource (IDOR) — assert the response is `indistinguishable from not-found` and ownership is checked before any payment gate; see `qa-plan-authoring` Step 6.6 for the no-oracle rule

### State
- Resource does not exist (404)
- Duplicate creation attempt (409)
- Concurrent modifications (race conditions) — for a lock, also verify the `lock releases on the error path` (see `qa-plan-authoring` Step 6.6)
- Resource in unexpected state (e.g., already deleted, already processed)

### Data integrity
- Required fields missing (422)
- Invalid data types (string where number expected)
- Referential integrity (foreign key does not exist)

### Side effects (see `qa-plan-authoring` Step 6.6 for full rules)
- A read-only / export / idempotent op `mutates no persistent state` (counts/checksum unchanged, incl. error path)
- A user value `reflected into a response header` stays well-formed under metacharacters (no header splitting)

### FE-specific
- Slow/no network connection
- Empty state (no data to display)
- Very long content (overflow, truncation)
- User not logged in
- Browser back/forward during operation

---

## Section Omission Rules

- If changes are **FE-only**: omit the `## BE Test Scenarios` section entirely
- If changes are **BE-only**: omit the `## FE Test Scenarios` section entirely
- If a tool is **unavailable**: omit it from the frontmatter `detected-tools` list and mark dependent scenarios with `(skip — <tool> unavailable)` in the scenario name

---

## Dependency annotations (opt-in)

Scenarios may declare dependencies on other scenarios via an optional `**Depends-on:**` field directly beneath the heading. Listed scenarios run to completion (any status — pass/fail/skip) before this scenario starts.

Example:

~~~markdown
### BE-02: PUT /api/users updates the user created in BE-01

**Depends-on:** BE-01

**Method:** PUT /api/users/<id>
...
~~~

**Serializing a contaminating scenario.** Use `**Depends-on:**` to force a scenario that exhausts a global per-IP quota into a terminal wave so it does not poison siblings under the 4-wide parallel runner (authoring rationale: `qa-plan-authoring` Step 6.9). To serialize a rate-limit (`429`) scenario after every other BE scenario:

~~~markdown
### BE-09: rate limit returns 429 after the quota is exhausted

**Depends-on:** BE-01, BE-02, BE-03, BE-04, BE-05, BE-06, BE-07, BE-08
~~~

The bucket is still shared across workers within a wave, so add a one-line note that earlier waves may have consumed quota — `**Depends-on:**` removes *concurrent* contamination, not the shared bucket itself.

Rules:

- Reference scenarios by their full ID (`FE-01`, `BE-02`). Multiple IDs are comma-separated.
- Cross-stack deps are allowed: `BE-02 **Depends-on:** FE-01`.
- No self-references, no cycles, no dangling refs (the run aborts at plan-parse time if any is detected).
- Predecessor failure does NOT block dependents. A dependent surfaces a diagnostic failure rather than skipping silently — better signal-to-noise than auto-skip cascades.

This field is **opt-in**. Plans without `**Depends-on:**` dispatch fully in parallel (subject to the 4-worker pool throttle).

---

## Blockers & the `**Blocked-by:**` tag

`## Blockers / Findings` records code defects that obstruct testing. Hard rules:

- **A discovered defect NEVER drops, weakens, or rescopes a scenario.** Write the scenario for
  the *intended* behavior with the contract's expected result, and tag it `**Blocked-by:** BLK-NN`
  beneath the heading. Do NOT move it to `## Out of harness scope`.
- **Never encode a defect as an expected result.** If current code returns X because of a bug but
  the contract says Y, `**Expected response:**` is Y; the scenario is `**Blocked-by:**` the BLK
  that produces X. A plan whose expectation matches the *bug* is itself defective.
- **Remediation is a human Setup prerequisite, not a runner step.** The runner cannot edit source;
  reverting a defect is surfaced in `## Setup` exactly like "bring the stack up", never as a scenario.
- **Multi-step remediation** (revert → observe → reintroduce → observe → revert) is an ordered list under
  `## Setup`, never scenario steps — see `qa-plan-authoring` Step 3.5.
- **Spelling:** `**Blocked-by:** BLK-NN` is the scenario tag (capital B, inert prose — like
  `**Depends-on:**` in placement, but NOT parsed). `blocked-by` (lowercase) is the Coverage-Matrix
  disposition keyword. Both reference a `BLK-NN` id. `provisioning-blocked` (lowercase) is the
  fourth disposition keyword — CORRECT code + a reachable read interface, but a precondition
  artifact the runner cannot mint; its Pointer cell carries a `**Setup prerequisite:**` and/or
  `hermetic:` pointer, never a BLK id (a genuine defect always routes to `blocked-by`).

---

## Plan Quality Checklist

Before saving the plan, verify:

- [ ] Every scenario has at least 2 edge cases
- [ ] Every BE scenario has an expected status code
- [ ] Every FE scenario has concrete steps (not "test the form")
- [ ] DB Checks use actual table/column names from the codebase
- [ ] API paths match actual routes from the codebase
- [ ] No placeholder text (TBD, TODO, fill in later)
- [ ] `**Depends-on:**` fields, if present, reference existing scenario IDs without cycles
- [ ] Binding format: every `**Bindings:**` entry uses a `QA_BIND_*` name with `(secret|plain)` type, declares `Inputs:` for every `$VAR` referenced by the recipe, sets an `Egress:` host, and the fenced ```bash``` recipe is a single statement using only allowlisted commands
- [ ] `## Blockers / Findings` is present (`None found.` if none); any test-obstructing defect is recorded there (not buried in `## Out of harness scope`), and each blocked scenario keeps its contract-correct expectation + a `**Blocked-by:**` tag
- [ ] If the Changes Summary names ≥2 statuses OR any changed surface is `provisioning-blocked`, `## Coverage Matrix` has one row per status and per changed external surface, each with exactly one disposition (`covered` / `blocked-by` / `out-of-scope` + harness-property reason / `provisioning-blocked` + Setup-prerequisite and/or `hermetic:` pointer)
- [ ] No changed surface with a curl/psql/Playwright interface or effect is dispositioned `out-of-scope` (reachable ⇒ `covered`/`blocked-by`/`provisioning-blocked`)
- [ ] Every scenario carrying `**Seed (psql/sqlite3):**`: `## Setup` carries `**Seeds fixtures:**`, the seed has exactly ONE plan-declared connection reference, and the block is free of BLOCKED-class negative phrasing (Step 4.7 rule (a))
- [ ] Every read-only scenario (no Seed step) keeps its entire block free of bare present-tense write verbs (create/insert/update/write/save/delete/mutate/persist — Step 4.7 rule (c))
