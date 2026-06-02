---
name: qa-plan-authoring
description: Author a QA test plan from a code diff — resolve diff source, classify FE/BE, gather context, detect tools, infer Setup, generate scenarios, save the plan.
activation: Load when generating a QA test plan from code changes (used by /create-qa-plan and by the Veles planner).
allowed-tools: Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), Read, Write, Glob, Grep
---

# QA Plan Authoring

Produce a comprehensive QA test plan from a set of code changes. The caller
decides what to do with the saved plan (the `/create-qa-plan` command tells the
user to review and run `/run-qa`; the Veles planner returns a JSON summary to
Perun). This skill covers ONLY authoring + saving.

## Step 0: Grounding precondition — the target source must be on disk

A `(file:line)` citation may be emitted **only** for a file actually present and
read in the working tree. When the changed source is NOT on disk (a foreign-repo
PR reference, a pasted diff, or an embedded-diff eval), do **not** invent a
citation — tag the assertion `(unverified — confirm at run time)` instead. A
well-formed citation to absent/unread source manufactures false confidence and is
worse than the honest tag. Likewise Step 4.6's config-file detection only "reads"
files that are in the tree; from a diff-embedded config block you may read the
*diff text* but must not claim to have read an on-disk file.

## Step 1: Resolve the diff source

Parse the caller's argument to choose the diff:

| Argument | Diff |
|----------|------|
| (empty) | open PR on current branch, else branch diff vs main |
| `#123` / `PR #123` | `gh pr diff 123` |
| `feature/xyz` | `git diff <main>...feature/xyz` |
| `this branch` / `current branch` / `ten branch` | `git diff <main>...HEAD` |
| `last N commits` / `ostatnie N commitów` | `git diff HEAD~N...HEAD` |
| `staged` | `git diff --staged` |

Default (no argument):

```bash
gh pr view --json number,title,headRefName,baseRefName 2>/dev/null
# if a PR exists:
gh pr diff <number>
# else, branch diff:
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff $MAIN_BRANCH...HEAD
```

Also collect the changed file list (`gh pr diff <n> --name-only`, or `git diff --name-only <range>`).

## Step 2: Classify each changed file FE vs BE

- **Frontend:** `.tsx/.jsx/.vue/.svelte/.css/.scss/.html`; paths with `app/ components/ pages/ views/ layouts/ styles/ public/ assets/ frontend/ client/ web/`.
- **Backend:** `.py/.php/.go/.java/.rb/.rs`; paths with `api/ controllers/ models/ migrations/ serializers/ services/ repositories/ backend/ server/`; `urls.py routes.py routes.php router.go`.
- **Ambiguous** (`.ts/.js`): inspect imports/path context.

For each file note: what changed, change kind (new/modify/delete/refactor), what behavior to test.

## Step 3: Gather context

Read related files: routers/URL configs, serializers/schemas, models for changed endpoints; parent components, stores, API calls for changed components; endpoints using changed models/migrations. Look for `docs/`, OpenAPI/Swagger (`openapi.{json,yaml}`, `swagger.{json,yaml}`), READMEs, and existing tests (what is already covered vs missing).

## Step 4: Detect available tools

```bash
command -v curl >/dev/null 2>&1 && echo "curl: available" || echo "curl: unavailable"
command -v http >/dev/null 2>&1 && echo "httpie: available" || echo "httpie: unavailable"
command -v psql >/dev/null 2>&1 && echo "psql: available" || echo "psql: unavailable"
command -v sqlite3 >/dev/null 2>&1 && echo "sqlite3: available" || echo "sqlite3: unavailable"
command -v mysql >/dev/null 2>&1 && echo "mysql: available" || echo "mysql: unavailable"
command -v playwright >/dev/null 2>&1 && echo "Playwright CLI: available" || echo "Playwright CLI: unavailable"
```

## Step 4.5: Harness execution scope — plan only what the runner can execute

The QA runner (the `zmora` executor Perun dispatches to) can ONLY:

- **FE:** drive a browser via Playwright (navigate, click, fill, assert, screenshot).
- **BE:** make HTTP requests with `curl`, and query a database with `psql` / `sqlite3`.

It **cannot** run `docker`, `docker compose`, `make`, build / deploy / install commands, image or network inspection, or `docker exec` — Perun's sanitiser rejects every such step. It also does **not** stand up or tear down the application; it tests an **already-running** instance reachable at the `base-url`.

Consequences for the plan you write:

- **Every scenario step must be a Playwright action, a `curl` request, or a `psql`/`sqlite3` query** against the running app. A step like `docker compose build`, `make up`, `docker image inspect`, `docker network inspect`, or `docker exec …` is NOT executable — never emit it as a scenario step.
- **Infrastructure changes are tested by their *effect* on the running stack, not by their build/up/inspect commands.** Examples:
  - reverse-proxy / TLS / headers → `curl -kI https://host/` and assert the security headers, the HTTP→HTTPS redirect, the status code.
  - SPA serving / client-side routing → `curl` the root and a deep route; assert `index.html` is returned and asset cache headers.
  - health / DB reachability → `curl /healthz`; `psql` a `SELECT 1` against the declared DSN.
  - `/api` routing through the proxy → `curl https://host/api/openapi.json`.
  - Things checkable ONLY with `docker`/`make` (image size, non-root UID, layer secrets, network `Internal: true`, `make smoke`) are **out of harness scope** — omit them, or list them under a short `## Out of harness scope` note for the human to check manually. Do NOT pad the plan with un-runnable scenarios.
- **Bringing the stack up is a human Setup prerequisite, not a scenario.** If the scenarios need a running stack, declare it under `## Setup → **Required services:**` AND name the command the human runs to start it (free text after the backtick), e.g. ``- `https://localhost` — prod stack; start with `make prod.up` before running QA``. Perun asks the user to run it; the runner never starts it.
- **`detected-tools` lists only harness-executable tools** (`curl`, `httpie`, `psql`, `sqlite3`, `mysql`, `playwright`). Never put `docker` / `docker-compose` / `make` there — listing them falsely signals the runner can use them.
- If, after excluding non-observable steps, an infrastructure change has **nothing** observable over Playwright / HTTP / DB, say so honestly: emit few or zero scenarios and let `fe_count` / `be_count` reflect reality. A small honest plan beats a large un-runnable one.

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

## Step 5: Output format + Setup section

Load the format skill: `skill(name: "test-plan-format")`. Follow it for frontmatter (`source`, `branch`, `base-url`, `detected-tools`) and overall structure.

Generate the `## Setup` section (placed after frontmatter, before `## FE Test Scenarios` / `## BE Test Scenarios`) by inferring from the diff:

- New `process.env.X` / `os.environ["X"]` / `getenv("X")` / `ENV["X"]` → add `X` to `**Required environment variables:**` (name must match `^[A-Z_][A-Z0-9_]*$`).
- New service URL (`https?://localhost:\d+`, `redis://`, `postgres://`, `mongodb://`) → `**Required services:**` (if the user must start it, name the start command after the backtick — see Step 4.5).
- New DB connection string → `**Required databases:**` with an explicit scheme (`postgresql://…`, `mysql://…`, `redis://…`, `sqlite:///…`).

Rules: one backtick group per item; free text after it is for humans; ≤50 items; omit the whole `## Setup` section if nothing is needed. Mark items as best-effort inferences for the user to review.

## Step 6: Generate scenarios

Every scenario step MUST be executable by the runner (see Step 4.5): a Playwright action, a `curl` request, or a `psql`/`sqlite3` query against the **running** app. Do not emit `docker` / `make` / build / inspect steps — model "bring the stack up" as a Setup prerequisite instead.

- **FE** (if FE changes): one scenario per changed component/page/feature, concrete UI element names from the code, ≥2 edge cases each.
- **BE** (if BE changes): one scenario per changed endpoint, real paths/methods/payloads, DB checks with real table/column names, ≥2 edge cases each (error handling, auth, validation).
- **Grounding (every scenario):** each behavioral assertion (status code,
  rate-limit semantics, auth/authz outcome, error-envelope shape, derived
  filename) carries a visible `(file:line)` citation to code you actually read,
  or the `(unverified — confirm at run time)` tag (see Step 0 and the
  `test-plan-format` "Grounding tags & assertion style" section). Citations go on
  the single most load-bearing line per assertion.

## Step 6.5: Binding completeness check

Every `$QA_BIND_*` token you reference in ANY scenario (auth headers, payloads, DB connection strings) MUST have a matching declaration in the Setup `**Bindings:**` subsection. A `$QA_BIND_*` with no declaration can never be provisioned — `execute_recipe` returns `unknown_binding` and every scenario using it stalls on `NEED_INFO`.

This bites hardest with **multi-principal** scenarios. When a scenario exercises a SECOND authenticated user (e.g. "user B exports user A's resource → 404", or RLS-isolation tests that reference `$QA_BIND_JWT_FOR_USER_B`), you MUST declare a SEPARATE binding for that principal — it cannot share the first user's token:

- Give it a distinct name (e.g. `QA_BIND_JWT_FOR_USER_B`).
- Give it its own `Inputs:` for the second principal (e.g. `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD`) — and add those names to `**Required environment variables:**` so preflight verifies them.
- Reuse the same `Egress:` and `Recipe:` shape as the first binding, substituting the second principal's input names.

Before saving, scan every scenario for `$QA_BIND_*` tokens and confirm each one is declared. If you cannot construct a recipe for a referenced principal, drop or rewrite the scenario rather than emit a dangling binding reference.

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

## Step 7: Save

```bash
mkdir -p docs/testing/plans
date +%Y-%m-%d
```

Write with the `Write` tool to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`, where `<topic>` is a slug (lowercase, hyphens) summarizing the changes. Return the saved path to the caller.
