---
name: qa-plan-authoring
description: Author a QA test plan from a code diff — resolve diff source, classify FE/BE, gather context, detect tools, infer Setup, generate scenarios, save the plan.
activation: Load when generating a QA test plan from code changes (used by /qa:create-plan and by the Veles planner).
allowed-tools: Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), Read, Write, Glob, Grep
---

# QA Plan Authoring

Produce a comprehensive QA test plan from a set of code changes. The caller
decides what to do with the saved plan (the `/qa:create-plan` command tells the
user to review and run `/qa:run`; the Veles planner returns a JSON summary to
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

**The converse is equally binding — when the source IS on disk, read it.** On the
normal `/qa:create-plan` and Veles real-repo path, `(unverified — confirm at run time)`
is a **defect** on any assertion you could resolve by reading. Status codes, auth/authz
outcomes, rate-limit semantics, error-envelope shapes, and derived values are almost
always readable from the changed code and its immediate dependencies (the security
dependency, the limiter config, the exception handler) — open them and cite
`(file:line)`. Reserve `(unverified)` for facts that genuinely cannot be read: true
runtime/deploy-time values (the live server's actual rate-limit reset instant; a value
fixed only by deploy config). *"I didn't open the file" is never a reason to tag
`(unverified)` when the file is on disk.*

**Framework defaults are the most common confident-wrong trap — verify them against the
version in the tree by reading (or briefly probing) the dependency, never from memory.**
Even widely-repeated "facts" drift between releases: the status a FastAPI `HTTPBearer()`
raises on a missing/non-bearer `Authorization` header **changed from 403 to 401** across
versions — so confirm it against the installed version, not from lore. Unambiguous
examples: a SlowAPI `Limiter()` with no `strategy=` is **fixed-window**, not sliding;
`get_remote_address` keys on the request host (IPv4 *or* IPv6). These are illustrative,
not a checklist — the rule is: when a change touches auth, rate-limiting, or
error-to-status mapping, open the dependency (and probe it when a default is genuinely
uncertain) before asserting.
**A failed or inconclusive probe is not a license to guess:** if a runtime probe errors, returns nothing, or cannot run in the environment, ground the assertion by reading the installed dependency's source in the tree, or tag it `(unverified — confirm at run time)` — never fall back to memory.

**Tests corroborate; they are not the oracle** — a test proves *only what it
asserts*. A passing test on a **non-overridden** fixture (no `dependency_overrides`
shadowing the tested path) is admissible evidence and
**keeps an assertion at full confidence** — never downgrade what such a test
confirms. A status-only test (`assert status == 401`) does NOT ground a
body/envelope claim — cite the producing code for the body. A test that
contradicts the implementation, or runs under an overriding fixture, is a
**suspected defective test** → Blocker/Finding. Never transcribe a test as a
manual scenario; that re-runs CI and adds nothing.
**EXCEPTION (verification pointer, not a scenario):** when a recorded Blocker makes a contract row unobservable on the *live* path and a hermetic test in the repo (surfaced via Step 4.6's test-infra detection) observes it, record a `**Hermetic observation:** <path>::<test>` note on the Blocker and a `hermetic: <path>::<test>` note in that row's matrix Pointer cell — a pointer the runner never executes, not a transcribed scenario.

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

## Step 1.5: Pin the intended contract (before observing runtime behavior)

From the SPEC sources only — PR/issue text, docstrings, the changed code's *declared* error
types and route decorators (`raise XError`, `@router`, `@limiter.limit(...)`), linked design docs —
list the intended behaviors with the status each *should* return by design. Enumerate the success
path AND every declared error path. Derive expectations from what the code is *trying* to express,
NOT from what a live call currently returns.

If the surface has ≥2 status/behavior classes, draft the `## Coverage Matrix` skeleton
(`test-plan-format`) now — rows + the contract status, disposition column blank. **Commit to these
rows.** When observed code or runtime later *contradicts* a row (e.g. a debug delay forces every
call to 504, or a commented-out guard makes a 402 path return 200), that is a **delta to log as a
Blocker (Step 3.5)** — never a reason to delete or rewrite the row. The contract is the spec; the
runtime is the system under test; QA tests the system *against* the spec. (Scale to surface:
a one-behavior change needs no matrix.)

## Step 2: Classify each changed file FE vs BE

- **Frontend:** `.tsx/.jsx/.vue/.svelte/.css/.scss/.html`; paths with `app/ components/ pages/ views/ layouts/ styles/ public/ assets/ frontend/ client/ web/`.
- **Backend:** `.py/.php/.go/.java/.rb/.rs`; paths with `api/ controllers/ models/ migrations/ serializers/ services/ repositories/ backend/ server/`; `urls.py routes.py routes.php router.go`.
- **Ambiguous** (`.ts/.js`): inspect imports/path context.

For each file note: what changed, change kind (new/modify/delete/refactor), what behavior to test.

## Step 3: Gather context

Read related files: routers/URL configs, serializers/schemas, models for changed endpoints; parent components, stores, API calls for changed components; endpoints using changed models/migrations. Look for `docs/`, OpenAPI/Swagger (`openapi.{json,yaml}`, `swagger.{json,yaml}`), READMEs, and existing tests (what is already covered vs missing).

## Step 3.5: Scan for blockers and emit `## Blockers / Findings`

Having read the changed code + dependencies, scan for things that make the running system unable to
honor its own contract (Step 1.5):

- **Debug / test artifacts:** unconditional delays (`asyncio.sleep`, `time.sleep`), `if True:`
  short-circuits, hardcoded returns, `# TEMPORARY`/`# TODO`/`# DEBUG`/`# HACK`/`# FIXME`/`# XXX` markers.
- **Disabled / commented-out guards:** a commented-out auth/entitlement/ownership check (even with NO
  marker word) is a blocker — it makes the gated status (401/402/403) unobservable. Markerless defects
  are the easiest to miss and the most dangerous.
- **Contract contradictions:** any code path whose observable effect contradicts a Step-1.5 row.
- **Shippability hazards:** a scenario/ticket ID baked into a source comment (identifier policy),
  a leaked secret, a disabled auth check.

Emit `## Blockers / Findings` (after `## Changes Summary`). **Mandatory — if none, write `None found.`**
A reversible blocker becomes a human Setup prerequisite + a `**Blocked-by:** BLK-NN` tag on the affected
scenarios, which stay in the plan in contract-correct form. **Never scope a contract row out merely
because a blocker prevents observing it.** Ask: *"does any path's current behavior contradict what the
docstring / declared errors promise?"* — that contradiction is a blocker, marker or no marker.

When fully exercising the contract needs more than one human action (e.g. remove a debug delay to observe `200`/`502`, then transiently reintroduce it to observe a genuine `504`), express it as an `ordered list of human Setup prerequisites` (revert → run path A → reintroduce → run path B → revert) — never as scenario steps; the runner cannot edit source.

## Step 4: Detect available tools

**BE / shell tools** — detected on `PATH` (the runner shells out to these):

```bash
command -v curl >/dev/null 2>&1 && echo "curl: available" || echo "curl: unavailable"
command -v http >/dev/null 2>&1 && echo "httpie: available" || echo "httpie: unavailable"
command -v psql >/dev/null 2>&1 && echo "psql: available" || echo "psql: unavailable"
command -v sqlite3 >/dev/null 2>&1 && echo "sqlite3: available" || echo "sqlite3: unavailable"
command -v mysql >/dev/null 2>&1 && echo "mysql: available" || echo "mysql: unavailable"
# Optional Playwright *CLI fallback* only — NOT how FE testing runs (see the note below):
command -v playwright >/dev/null 2>&1 && echo "Playwright CLI fallback: available" || echo "Playwright CLI fallback: unavailable"
```

**Playwright is a harness capability, not a `PATH` binary — never gate it on `command -v playwright`.** The runner (`zmora`) is *always* granted the native `playwright_browser_*` MCP tools (`src/modules/qa/allowed-tools.ts`), and `overlay-fe.md` has it verify Playwright by *attempting `playwright_browser_navigate`*, using the CLI only as a fallback. So **treat Playwright (browser automation) as available by default and include `playwright` in `detected-tools`** regardless of the `command -v playwright` result — that probe finds only an optional CLI fallback and must **never** flip Playwright to unavailable. (If the MCP server is genuinely absent at run time, the runner's own `overlay-fe.md` check returns `NEED_INFO`; the planner does not predict that.)

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
- **The runner dispatches scenarios in parallel, not in document order.** Perun runs scenarios 4-wide (`dispatch_parallel`); with no `**Depends-on:**` every scenario lands in one parallel wave (`src/agents/perun.md`). Two consequences: (1) **scenarios must be independent** — do not rely on BE-01 running before BE-02 unless you declare it; (2) **siblings share the target's global state and the runner's source IP** — a scenario that exhausts a global per-IP quota (a rate-limit 429 sweep) or holds a global lock will affect whatever runs concurrently. Sequence such scenarios with `**Depends-on:**` (Step 6.9) — "putting it last in the document" does nothing, because document order is not execution order.

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

**Reachability litmus — earn the punt.** Before writing any behavior class under
`## Out of harness scope`, prove it cannot be triggered over Playwright / curl / psql
against the running app. Each out-of-scope line MUST carry a one-clause reason it is
unreachable (e.g. "needs `docker image inspect` — no HTTP surface"). Punting without
that reason is a defect, not honesty.

**The reason must be a property of the HARNESS, not of the code under test.** A valid out-of-scope
reason is "no HTTP/DB/Playwright surface can observe this" or "requires stopping a process the harness
cannot stop". A reason that is itself **a code defect, leftover test instrumentation, or a fixable
config** is NOT a valid punt — it is a **Blocker** (Step 3.5): write the contract scenario, tag it
`**Blocked-by:**`, record remediation as a human Setup prerequisite. *"The current build always
returns 504 / the worker has a sleep / a guard is commented out / a debug flag is on" describes a
defect — reclassify, do not punt.* **A defect or "the runner can't" is rejected as a 429 punt** — exhaust
the limiter over the FAST path (fire 11× the cheap 402/404 request; error responses still count toward the
slowapi bucket).
Firing a request class rejected *before* the limiter — unauthenticated requests at a post-auth limiter whose auth `Depends` resolves before the limiter decorator — never increments the bucket and is a coverage defect, not a 429 recipe.
That is the *trigger recipe*; because the runner is 4-wide parallel, sequence the 429
scenario per **Step 6.9** so its sweep does not contaminate siblings. (409 contention is already covered by
the "background the first curl" guidance in the in-scope-by-default list below — a defect is never its punt
reason either.)

The following look infrastructural but are
reachable over the HTTP surface — **in scope by default, never punt them.** Each is a CLASS — apply its
predicate to ANY matching surface, not just the export endpoint (a foreign 404 on any resource; a user
value in any header/body; a lock on any guarded op; any read-only op):

- **IDOR / cross-tenant** (user B requests user A's resource): mint a SECOND principal binding (Step 6.5)
  and `curl` with its token. Assert no-oracle equality — the foreign-resource response must be `indistinguishable from not-found` (same status AND body shape), and the ownership check must fire *before* any state-revealing gate (entitlement/payment/`402`). A bare "→ 404" without the equality assertion is shallow.
- **Reflected-input injection** — any user-controlled value echoed into a response header or body (a filename in `Content-Disposition`, a username in a login error body, an uploaded filename in a `Location` header). For a value `reflected into a response header`, test with metacharacters (`"`, `;`, newline, `/`, `..`) and assert it is sanitized and the header stays well-formed (no header splitting); for a body, assert no quote-break / HTML injection.
- **Upstream-dependency failure → 5xx** (a bad upstream key makes the dependency return
  401/500, which the caller maps to **502**): `curl` with the dependency misconfigured,
  or against a stopped dependency declared in Setup. Also verify the `lock releases on the error path` — after the 5xx/timeout an immediate retry of the same resource must NOT return `409` (the lock frees on exception, not only on success).
- **Lock / concurrency contention → 409** (two in-flight requests for one resource):
  fire concurrent `curl`s (background the first); tag `(timing-dependent)` if the
  window is narrow. Do NOT add `**Depends-on:**` here — this scenario needs genuine overlap (Step 6.9).
- **Boundary conditions** (`valid_to == now`, one-expired-one-active): seed the
  boundary row via `psql` / the dev tool and `curl` across it.
- **No-mutation invariant** — a read-only / export / idempotent operation `mutates no persistent state`: assert `psql` row counts (or a checksum) of the affected tables are unchanged before vs after, INCLUDING on the error path (a failed export/upload must consume/write nothing).
- **Schema validation → 422** (any surface with a typed request body or typed params): send a payload that violates the declared schema (missing required field, wrong type) and assert the framework validation status (`422` for FastAPI/Pydantic) AND the envelope the framework's validation handler actually produces — a `RequestValidationError` envelope differs from a domain handler (re-read per Step 6.8).

Genuinely out of scope is the residue *after* this filter — e.g. DB-down → 503 (the
harness cannot stop the DB), or image/UID/layer-secret checks that need `docker`. List
those, each with its reason; everything unreachable only *because of a defect* goes to
`## Blockers / Findings`, not here; cover everything else.

## Step 6.7: Self-check before finishing — complete the coverage matrix

The Coverage Matrix is the *emitted form* of the Step 6.6 reachability sweep — do the litmus once,
record its verdict per row. When the surface has ≥2 status/behavior classes, complete the
`## Coverage Matrix` drafted in Step 1.5: **every status named in your own `## Changes Summary` is a
row** (this is the decidable anchor — row set == the statuses you declared).
**And every external surface named in your own `## Changes Summary` is also a row** —
same self-referential closure: row set == the surfaces you declared. The Step 6.6 behavior-class sweep
finds the classes; this anchor only checks each named surface owns a disposition — a new/changed HTTP
route, CLI/dev script, worker-or-public API contract, or DB-observable schema (an internal collaborator
such as an error mapper, use-case, port, lock, or adapter is exercised *through* a surface, not its own
row). Each row has exactly one
disposition:

1. `covered` → cite the scenario ID AND a `(file:line)` for the asserted status.
2. `blocked-by: BLK-NN` → reference an existing `## Blockers / Findings` entry AND keep the
   contract-correct scenario (tagged `**Blocked-by:**`).
3. `out-of-scope: <reason>` → a **harness-property** reason (Step 6.6). An `out-of-scope` whose
   reason is a code defect is INVALID — it must be `blocked-by`.
   A changed surface with a harness-observable interface (a curl-able route, a `psql`-observable DB effect, or a Playwright surface) cannot be `out-of-scope` — only `covered` or `blocked-by`; `out-of-scope` survives only for a changed surface with no such interface at all.

Also confirm: every behavioral assertion carries a visible `(file:line)` OR `(unverified — confirm
at run time)` tag; no `**Expected response:**` equals a value produced only by a recorded Blocker
(recorded in Step 3.5 — see Step 6.8); the filename carries the `-test-plan` suffix (Step 7). A
Changes-Summary status OR named surface with no row, or an invalid disposition, is a defect — fix
before saving. Finally, re-scan the changed files for the Step 3.5 hazard classes (debug/test
artifacts, disabled guards, an identifier-policy QA/ticket ID in a comment, a leaked secret) and
confirm each distinct hazard is its own `## Blockers / Findings` entry,
not folded into another blocker.
(Veles hard-stops on this matrix before emitting its result JSON — see `veles.md`. The
`/qa:create-plan` command inherits this as guidance, without a hard gate.)

## Step 6.8: Targeted refute pass (high-risk assertions)

After the Step 6.7 form-check, re-read the cited source for the **high-risk** assertion
classes with the intent to *refute*, not confirm — and fix any mismatch in the draft
before saving. Confident-wrong claims cluster in these classes:

- auth / authz outcomes and **status codes** (401 vs 403 vs 404),
- rate-limit semantics (window strategy, key function),
- error-to-status mapping (which exception → which HTTP code / envelope shape),
- framework defaults (Step 0 — verify against the *installed version*, not lore),
- derived values (generated filenames, slugs) — never assert a hand-computed encoding/hash/slug literal;
  assert the producing rule + `(file:line)`, or cite the fixture/test that pins the exact bytes,
- **reflected-input safety and no-oracle responses** — a user-derived value that lands in a header/body must
  be sanitized; a not-found-vs-forbidden pair must not leak existence. Re-read the producing code and the
  ownership-check ordering with intent to refute.
- **out-of-scope surface dispositions** — an `out-of-scope` reason for a changed surface (the Step 6.7
  surface anchor) is high-risk: re-read it to confirm the reason is a property of the HARNESS (no
  HTTP/DB/Playwright surface can observe it; the runner cannot run the required tool), not a code
  defect or a reachable surface rationalized away. A defect is `blocked-by`; a reachable surface is
  `covered`. Only a true harness limit survives.
  Decidable test: if the changed surface has a curl/psql/Playwright interface or effect, `out-of-scope` is invalid — reclassify to `covered` (reachable) or `blocked-by` (a defect obstructs it).
- **claim-specific, branch-governing citation** — a `(file:line)` must support the
  *specific* claim (status AND body/envelope) and point at the branch that fires for
  *this* scenario's input, not merely a real line near the topic. A status-only test
  cited as grounding for a body is a refute failure.
  For an error **body/envelope** claim, cite the *pair* — the raise-site AND the handler that catches that exception type — or state the path raises a framework `HTTPException` with no domain handler so the body is the framework default; a handler that does not catch the path's exception type is a refute failure.
- **order-gated assertions** — when an outcome depends on which layer fires first (auth `Depends` vs rate-limit decorator vs middleware vs exception handler), name the resolution order you rely on and ground it; a `429` scenario must fire the request class that passes every gate preceding the limiter, never one rejected before it.
- **contract-vs-runtime (expectations follow the spec, not incidental runtime).** For every
  `**Expected response:**`, ask *"is this the contract, or just what the current (possibly defective)
  build returns?"* Decision table:

  | You read / observe | Contract? | Expected you write | Disposition |
  |---|---|---|---|
  | Code maps `TimeoutException → 504`, spec wants 504 | yes | 504 `(file:line)` | covered |
  | A leftover `sleep(65)` / disabled guard forces a status the spec doesn't want | NO — a defect | the spec'd status | `blocked-by: BLK-NN`, not out-of-scope |
  | Behavior genuinely unobservable over HTTP/DB/Playwright (DB-down → 503) | n/a | the spec'd result | `out-of-scope` + harness reason |

  If any expectation matches a value produced only by a recorded Blocker, rewrite it to the contract
  value and add `**Blocked-by:**`. One contradiction silently encoded as an expectation fails the plan.

For each, re-open the cited `file:line` and ask "what does the code *actually* do?" —
default to **WRONG** when the code disagrees at all; when a default is genuinely
uncertain, a quick probe beats a guess. Skip low-risk assertions already nailed by a
direct citation (a happy-path 200, an exit code read straight off a `raise
SystemExit(n)`) — this pass is targeted, not exhaustive. Re-reading cited code to
confirm a claim is *verification, not exploration* — the scoped exception to "do not
redo a delegated search."

**Momus seam:** when the adversarial reviewer `momus` is available *(reserved)*, this
pass delegates per-claim refutation to it unchanged; until then the author performs it.
A same-session self-refute is weaker than an independent reviewer — so be genuinely
adversarial: the goal is to *break* your own assertions, not wave them through.
(Validated by the round-2 re-read efficacy experiment: 3/3 seeded errors caught + 2
unplanted, 0 false positives.)

## Step 6.9: Sequence scenarios that share global state (parallel-runner safety)

The runner is 4-wide parallel (Step 4.5). A scenario is **contaminating** when its effect is visible to
concurrent siblings: it exhausts a **global per-IP quota** (a `429` rate-limit sweep), **holds a global
lock**, or **depends on ordered state** a sibling sets. For each contaminating scenario:

- **Isolate it into a terminal wave** by adding `**Depends-on:** <comma-separated peer IDs>` beneath its
  heading, so it runs after — with no concurrent siblings to poison. This is the ONLY ordering control;
  document position is irrelevant (Step 4.5).
- **Add a one-line note** when the shared resource is a per-IP limiter: under parallel dispatch the bucket
  is shared across workers, so even isolated the operator should expect possible `429` cross-contamination
  from earlier waves. (An honest harness limitation, not something the plan can fully remove.)
- **Do NOT serialize contention scenarios.** A `409` concurrency test *wants* genuine overlap — parallel
  dispatch helps it; leave it dependency-free (or `(timing-dependent)`-tagged).
- **"Ordered state" is narrow.** It means **one scenario WRITES a row a sibling READS in the same run** —
  NOT "these read logically sequential." If each scenario provisions its own data via its own binding, the
  scenarios are independent: do NOT add `**Depends-on:**`. Over-serializing kills the 4-wide speedup.

Litmus: *"if this scenario and another run at the same second, does one corrupt the other's result?"* — yes ⇒
`**Depends-on:**`; per-IP-limiter ⇒ also the contamination note.

## Step 7: Save

```bash
mkdir -p docs/testing/plans
date +%Y-%m-%d
```

Write with the `Write` tool to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`, where `<topic>` is a slug (lowercase, hyphens) summarizing the changes. Return the saved path to the caller.
