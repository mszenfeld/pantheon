---
name: be-testing
description: Backend testing patterns — API request construction, response verification, database state checks, error handling testing, and adaptive tool detection.
activation: Load when testing backend APIs or database state
allowed-tools: Bash(curl:*), Bash(httpie:*), Bash(http:*), Bash(psql:*), Bash(sqlite3:*), Bash(mysql:*), Bash(mongosh:*), Bash(redis-cli:*), Bash(command:*), Bash(echo:*), Bash(jq:*), Bash(grep:*), Bash(cat:./*), Bash(head:./*), Bash(tail:./*), Read, Write, Bash(mkdir:*)
---

# Backend Testing Patterns

## Tool Detection

**ALWAYS run this check first:**

```bash
# HTTP clients
command -v curl >/dev/null 2>&1 && echo "OK: curl available" || echo "UNAVAILABLE: curl"
command -v http >/dev/null 2>&1 && echo "OK: httpie available" || echo "UNAVAILABLE: httpie"

# Database clients
command -v psql >/dev/null 2>&1 && echo "OK: psql available" || echo "UNAVAILABLE: psql"
command -v sqlite3 >/dev/null 2>&1 && echo "OK: sqlite3 available" || echo "UNAVAILABLE: sqlite3"
command -v mysql >/dev/null 2>&1 && echo "OK: mysql available" || echo "UNAVAILABLE: mysql"
command -v mongosh >/dev/null 2>&1 && echo "OK: mongosh available" || echo "UNAVAILABLE: mongosh"
command -v redis-cli >/dev/null 2>&1 && echo "OK: redis-cli available" || echo "UNAVAILABLE: redis-cli"

# JSON processing
command -v jq >/dev/null 2>&1 && echo "OK: jq available" || echo "UNAVAILABLE: jq"
```

Use the first available tool from each category. If no HTTP client is available, route per the core prompt's SKIP-vs-NEED_INFO rule: would-apply scenarios → `NEED_INFO` with `kind: "tool"`, `missing: ["curl"]` (matching the BE overlay's Step 2 probe); SKIP only for scenarios inapplicable to this stack/environment.

### Database Server Access

In addition to CLI database clients, check if database tools are available. In OpenCode, database access may be provided via shell commands.

**Priority order for DB access:**
1. Configured database CLI (psql, sqlite3, mysql — most common in OpenCode)
2. Direct shell access to database (e.g., docker exec into a DB container)
3. SKIP (no access available)

Note: OpenCode provides database access through CLI tools installed in the environment. Always prefer CLI clients when available.

---

## Execution Workflow

For each BE scenario from the test plan:

1. **Read the scenario** — understand method, endpoint, payload, expected response, DB checks
2. **Execute the Seed FIRST** (only if the scenario carries `**Seed (psql/sqlite3):**`) — run the fenced SQL as a single statement via the step's ONE plan-declared connection reference, e.g. `psql "$DATABASE_URL" -c '<SQL>'` (the `$VAR`/DSN declared under the plan's `## Setup`). A Seed step with any other/undeclared connection target, or whose `$VAR` is unset in the environment, is `NEED_INFO` — never guess a connection. A failed seed reports as *seed-missing*, not as a code defect.
3. **Execute the request** — send HTTP request with proper method, headers, body
4. **Verify response** — check status code, response body structure, specific values
5. **Verify DB state** (if DB Check specified) — run query, compare against expected
6. **Execute edge cases** — run each edge case as a sub-test
7. **Record result** — pass/fail with response details (include the seed outcome when present)

**Teardown blocks.** A `**Teardown (psql/sqlite3):**` block executes exactly like a Seed — the fenced SQL via the step's ONE plan-declared connection reference (`psql "$DATABASE_URL" -c '<SQL>'`) — but it UN-SEEDS what the Seed created. When Perun dispatches a task that is ONLY a teardown (the finalize teardown wave, run after all scenarios), run its SQL and report the un-seed outcome. A failed teardown is surfaced (so the operator can finish it by hand) but NEVER changes a scenario's pass/fail — it is cleanup, not a test.

---

## Tag handling (plan grounding tags)

Expected-result text may carry these author tags — handle them, do not match on
the tag text itself:

- `(unverified — confirm at run time)` — the author could not ground this. A
  mismatch here is reported as **LOW** (not HIGH), with a note that the
  expectation was author-flagged as unverified.
- `(exact text — brittle)` — match the quoted message as **substring/contains,
  not equality**.
- `(file:line)` — a source citation for humans/`momus`; **ignore** it when matching.

---

## API Testing Patterns

### Request Construction (curl)

**GET request:**

```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/resources"
```

**POST request:**

```bash
curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test", "email": "test@example.com"}' \
  "http://localhost:8000/api/resources"
```

**PUT request:**

```bash
curl -s -w "\n%{http_code}" \
  -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "updated"}' \
  "http://localhost:8000/api/resources/1"
```

**DELETE request:**

```bash
curl -s -w "\n%{http_code}" \
  -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/resources/1"
```

**PATCH request:**

```bash
curl -s -w "\n%{http_code}" \
  -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}' \
  "http://localhost:8000/api/resources/1"
```

The `-w "\n%{http_code}"` flag appends the status code on a new line after the response body. Parse the last line as the status code.

### Request Construction (httpie)

**GET request:**

```bash
http GET http://localhost:8000/api/resources \
  Authorization:"Bearer $TOKEN" \
  --print=hb
```

**POST request:**

```bash
http POST http://localhost:8000/api/resources \
  Authorization:"Bearer $TOKEN" \
  name=test email=test@example.com \
  --print=hb
```

Use `--print=hb` to show headers and body (useful for debugging). Use `--print=b` for body only.

### Response Verification

**Check status code:**

```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "http://localhost:8000/api/resources")
if [ "$STATUS" = "200" ]; then echo "PASS: status 200"; else echo "FAIL: expected 200, got $STATUS"; fi
```

**Check response body with jq:**

```bash
RESPONSE=$(curl -s -H "Content-Type: application/json" "http://localhost:8000/api/resources")

# Check field exists and has value
echo "$RESPONSE" | jq -e '.id' > /dev/null 2>&1 && echo "PASS: id exists" || echo "FAIL: id missing"

# Check specific value
echo "$RESPONSE" | jq -e '.status == "active"' > /dev/null 2>&1 && echo "PASS: status is active" || echo "FAIL: status mismatch"

# Check array length
echo "$RESPONSE" | jq -e '.items | length > 0' > /dev/null 2>&1 && echo "PASS: items not empty" || echo "FAIL: items empty"
```

**Without jq (fallback with grep):**

```bash
RESPONSE=$(curl -s "http://localhost:8000/api/resources")
echo "$RESPONSE" | grep -q '"status":"active"' && echo "PASS" || echo "FAIL"
```

---

## Credential Safety Rules

- NEVER log full DATABASE_URL, DB_PASSWORD, or connection strings in reports.
- Mask passwords: `postgres://USER:***@HOST:5432/DB`
- Prefer test/local DB connections. If production credentials detected, abort and mark SKIP.

---

## Database Verification Patterns

### PostgreSQL (psql)

```bash
# Check record exists
psql -h localhost -U user -d dbname -t -A -c "SELECT COUNT(*) FROM resources WHERE name = 'test';"
# Expected: 1

# Check field value
psql -h localhost -U user -d dbname -t -A -c "SELECT status FROM resources WHERE id = 1;"
# Expected: active

# Check record was deleted
psql -h localhost -U user -d dbname -t -A -c "SELECT COUNT(*) FROM resources WHERE id = 1;"
# Expected: 0

# Check with multiple conditions
psql -h localhost -U user -d dbname -t -A -c "SELECT COUNT(*) FROM orders WHERE user_id = 1 AND status = 'completed';"
```

Flags: `-t` (tuples only, no headers), `-A` (unaligned output, no padding).

### SQLite

```bash
# Check record exists
sqlite3 db.sqlite3 "SELECT COUNT(*) FROM resources WHERE name = 'test';"

# Check field value
sqlite3 db.sqlite3 "SELECT status FROM resources WHERE id = 1;"
```

### MySQL

```bash
# Check record exists
mysql -h localhost -u user -p$DB_PASS dbname -N -e "SELECT COUNT(*) FROM resources WHERE name = 'test';"
```

Flag: `-N` (skip column names).

### Connection String Detection

If the test plan doesn't specify DB connection details, look for them in:

1. `.env` or `.env.local` files
2. `docker-compose.yml` (service ports, credentials)
3. Framework config files (`settings.py`, `database.yml`, `config/database.php`)
4. Environment variables: `DATABASE_URL`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

---

## Error Handling Test Patterns

### Missing required field

```bash
# Send request without required field
curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}' \
  "http://localhost:8000/api/resources"
# Expected: 422 with validation error in body
```

### Unauthenticated request

```bash
# Send request without auth token
curl -s -w "\n%{http_code}" -X GET \
  "http://localhost:8000/api/resources"
# Expected: 401
```

### Insufficient permissions

```bash
# Send request with regular user token to admin endpoint
curl -s -w "\n%{http_code}" -X DELETE \
  -H "Authorization: Bearer $REGULAR_USER_TOKEN" \
  "http://localhost:8000/api/admin/users/1"
# Expected: 403
```

### Resource not found

```bash
curl -s -w "\n%{http_code}" -X GET \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/resources/99999"
# Expected: 404
```

### Duplicate creation

```bash
# Create resource
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}' \
  "http://localhost:8000/api/users"

# Try to create duplicate
curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}' \
  "http://localhost:8000/api/users"
# Expected: 409
```

---

## Result Format

For each scenario, return results in this format:

```
### BE-XX: <scenario name>
- **Status:** PASS / FAIL / SKIP / NEED_INFO
- **Request:** <METHOD> <URL>
- **Response status:** <actual status code>
- **Response body:** <relevant excerpt or full body if short>
- **DB check:** <PASS/FAIL/SKIP — actual value vs expected>
- **Details:** <what was verified / what went wrong; battery refutation trace when a FAIL was re-verified>
- **Edge cases:**
  - <edge case 1>: PASS / FAIL / SKIP — <details>
  - <edge case 2>: PASS / FAIL / SKIP — <details>
```

---

## FAIL refutation battery (before returning any FAIL)

A FAIL is a claim — refute it before you report it. Run these four checks
before returning ANY `FAIL` the result carries: the scenario-level
`**Status:**`, each edge-case sub-result line, and the `**DB check:**` field
(an edge-case FAIL under a passing main flow still mints its own QA-XXX issue
in the report).

1. **Re-verify the observation — once, deterministically, observation-only.**
   For a non-mutating step (GET/HEAD, a read-only `psql` check): repeat the
   identical request exactly once. For a mutating step (POST/PUT/PATCH/DELETE,
   an INSERT/seed): never re-fire the request — re-firing double-applies the
   side effect outside the teardown accounting (one recorded reversal per
   scenario) — re-verify by re-READING the resulting state once instead
   (repeat the scenario's DB check, or GET the created resource). One re-check,
   then disposition — this is not retry-until-pass. If the two observations
   disagree, record BOTH in Details: identical READ requests returning
   different results → non-determinism is itself an application defect →
   `FAIL` with both responses recorded (this diagnosis applies to read re-fires
   only — a re-fired write legitimately differs, e.g. 201→409 on a duplicate
   POST, which is why writes are never re-fired).
2. **Environment artifact?** A missing prerequisite discovered at execution
   time (env var, service, fixture, tool) → `NEED_INFO` with the matching
   `kind` (the Zmora core prompt's kind table), not `FAIL`. Liveness
   distinction for the app under test at the plan's base-url: never reachable
   in this scenario → `NEED_INFO kind=service`;
   answered earlier in the scenario and then died → genuine `FAIL` (the app
   crashed under test).
   Dependency hosts (the DB behind a DB check, third-party services) stay on
   the unconditional NEED_INFO service routing — a flaky dependency is an
   environment problem, not this scenario's app defect. Tool routing follows
   the core prompt's SKIP-vs-NEED_INFO rule: scenario inapplicable to this
   stack/environment → `SKIP`; scenario would apply but the tool is missing →
   `NEED_INFO` with `kind: "tool"` (the missing-DB-client case stays a
   DB-check-level `SKIP` — partial execution: one sub-check blocked, not the
   scenario).
3. **Deliberate omission / scope mismatch?** An observed defect OUTSIDE the
   scenario's Expected, with the Expected itself met → `PASS` with the
   out-of-scope observation noted in Details (a follow-up scenario is the
   coordinator's call — it is not this scenario's FAIL); an omission recorded
   in the plan (`## Setup`, a plan note) that makes the scenario inapplicable
   here → `SKIP` per the core prompt's inapplicability rule; a missing
   declared prerequisite → `NEED_INFO` via check 2.
4. **Harness error?** Tool timeout, a client crash, a query that never
   executed → re-attempt the failed harness step at most ONCE; if it fails
   again, return an error result naming the tool failure (core prompt's
   error-result shape) — never an application `FAIL`. No open-ended retries.

**Disposition:** a `FAIL` that survives carries a one-line refutation trace in
Details (e.g. `re-verified: yes; env: n/a`). A refuted FAIL becomes
`PASS`/`SKIP`/`NEED_INFO`/error per what the battery showed. Sub-verdicts: a
refuted edge-case or DB-check FAIL flips that line to `PASS`/`SKIP` with its
trace in the line's details clause; a prerequisite-class edge failure escalates
to scenario-level `NEED_INFO` (exception: the upfront missing-DB-client case
stays a DB-check-level `SKIP`); a harness-refuted edge failure (second attempt
also failed) flips that line to `SKIP — <tool failure>` (the scenario-level
error result is reserved for main-flow harness errors).

---

## Error Handling

- If no HTTP client is available and the scenarios would apply here: return `NEED_INFO` with `kind: "tool"`, `missing: ["curl"]` (core prompt SKIP-vs-NEED_INFO rule; SKIP only for stack/environment inapplicability)
- If DB client is unavailable: execute API scenarios but mark DB Checks as SKIP (partial execution — a missing DB client blocks one sub-check, not the scenario)
- If a request times out (>30s): battery check 2 — the app answered earlier in this scenario → FAIL with "timeout" note; never reachable at all → `NEED_INFO kind=service`
- If a connection is refused: liveness distinction (battery check 2) — the app under test answered earlier in this scenario and then died → FAIL with "connection refused mid-scenario — app crashed under test"; never reachable in this scenario → `NEED_INFO kind=service` with the base URL in `missing` (this is the connection-failure branch the BE overlay's DB-check rule cross-references)
- If response is not valid JSON when expected: mark as FAIL, include raw response body
