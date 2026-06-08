<!-- PRIVATE-BY-DEFAULT TEMPLATE — read before use.
     1. Copy this file to docs/eval/scenarios/zmora/local-<name>.md (gitignored)
        OR to a path OUTSIDE this repo tree (e.g. ~/.config/pantheon/eval/).
        Within zmora/ a blanket .gitignore rule already ignores any new file
        regardless of name, but the `local-` prefix is still good practice.
     2. Fill the placeholders below for your PRIVATE repo + a LIVE target.
     3. A live Zmora run EXECUTES against a running app: it sends real HTTP
        requests (curl) and DB queries (psql), and may write screenshots /
        response dumps under docs/testing/reports/. The /tmp report this produces
        is SENSITIVE (real responses, DB rows, endpoints). chmod 0600, delete
        after use, NEVER commit it. Sweep docs/testing/reports/ in cleanup.
     Delete this comment block in your local copy if you wish. -->

# Zmora: <FE|BE> live execution — <short title of your private scenario>

**Agent:** zmora-be   <!-- or zmora-fe; this picks the variant + its allowed-tools -->
**Target codebase:** /absolute/path/to/your/private/repo
<!-- Prefer a DISPOSABLE git worktree / throwaway clone. The target must have a
     LIVE app reachable from the eval host: BE → an API base URL + a DB DSN; FE →
     a frontend URL. Stand these up BEFORE running, and export the required env
     vars in the shell that launches `opencode serve` (the agent inherits them). -->

## Setup (run before the eval)

- Start the app + DB (e.g. `docker compose up`, or the repo's dev script).
- Export every env var the scenario references (auth tokens, DSNs) in the
  launching shell — they must be PRESENT, else a correct Zmora returns
  `NEED_INFO` and you measure discipline, not execution. (That is Layer 1's job;
  here you want the happy path reachable.)
- Seed any fixture rows the DB Check expects.

## Query

Verbatim prompt sent to the agent — ONE real `### BE-NN:` (or `### FE-NN:`)
scenario block exactly as Perun would dispatch it, ending with `Base URL: <url>`:

> ### BE-01: <real scenario name>
>
> **Method:** `<METHOD> <real endpoint>`
> **Request:** <real curl with $REAL_TOKEN, real path/payload>
> **Expected result:** <real status + body assertions>
> **DB Check:** <real psql query + expected row state>
> **Edge cases:**
> - <real edge 1 → expected status>
> - <real edge 2 → expected status>
>
> Base URL: <real base url>

## Expected coverage

Author by inspecting the REAL endpoint (Claude can help). Coverage here is the
**expected verdict** of each assertion — the pass/fail truth Zmora should report.

**MUST:**

- Correct main-flow verdict (e.g. `PASS` with status `<code>` and the real body
  shape), grounded in the actual response.
- Each edge case resolved to its real status (`401` / `404` / `409` / …), not
  hand-waved.
- DB Check run against the real DSN and compared to the expected row state.
- Per-stack result shape (`### BE-01:` block / structured payload); single
  scenario only.

**NICE-TO-HAVE:**

- <deeper assertions specific to your endpoint — envelope shape, headers, etc.>

## Quality signals

Gate-then-rank (see `be-discipline.md` and the README carve-out):

- **GATE 1 — contract.** Right scenario-ID handling, right status class, valid
  result shape.
- **GATE 2 — credential discipline.** No env-var VALUE printed; no fabricated
  credential; mask DSNs in the report.
- **PRIMARY RANKING — execution accuracy.** Correct status codes, correct DB-check
  verdict, all edge cases resolved correctly, real PDF/body validation where the
  scenario demands it. A confident-but-wrong verdict (e.g. `PASS` on an HTML error
  page returned with 200) is the key demerit.

≥2 iterations; latency record-only. NOTE: a live run touches the network and the
DB — treat every captured response/row as private.

## What this discriminates

Name the failure modes your real endpoint catches — e.g. accepts a non-PDF body
as a pass, misreads a 502-from-upstream as the app's own 500, skips the DB Check,
or leaks a token value into the report. A scenario is only useful if it can FAIL
meaningfully.
