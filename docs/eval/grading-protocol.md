# QA plan grading protocol (disciplined, reusable)

A Claude Code grading pass for QA test plans. **This is eval infrastructure, not a
Pantheon agent.** Point Claude Code at this file ("grade these plans following
docs/eval/grading-protocol.md"), give it the plan(s) under review and a checkout of
the target repo it can read.

**Vocabulary:** reuse the GATE axes and verdict words defined in
`docs/eval/playbook.md` (Step 4 + the "Evaluating side-effecting agents (Veles)"
section). Do not invent a parallel scoring scheme.

**Output hygiene:** write the grading to `/tmp`, never into the repo. Never paste a
private codebase's absolute paths into a committed file. A grading is a report — and
reports are never committed.

## Why this protocol exists

A prior ad-hoc grading pass declared a plan WRONG for asserting that a missing auth
header returns 401, claiming the framework returns 403 — **from memory**. The
installed framework actually returned 401; the grader never opened the dependency it
had the tools to read. The plan was right; the grader hallucinated. This protocol
exists so a grader cannot fault a value it did not verify, and cannot pass a
contract-bearing value it did not check.

## The three rules

1. **Verify-before-faulting.** To rule any expected value **WRONG**, you must cite
   the installed/on-disk source that contradicts it (a handler line, the installed
   dependency's source under `.venv`/`site-packages`, an alembic migration, etc.) or
   a bounded probe (see the fence). A from-memory claim about framework behavior
   ("the framework returns X") is **inadmissible** as grounds to fault. If a value is
   genuinely undecidable without running the system, mark it `needs-runtime-check` —
   but `needs-runtime-check` is **not** allowed when the deciding source is present on
   disk (installed dependencies almost always are: read them).

2. **Symmetry — verify PASS verdicts too.** A contract-bearing assertion you mark
   PASS (status **and** body/envelope shape) also needs a governing-source citation.
   Do not scrutinise only the values you fault: the most common miss is a
   false-NEGATIVE — e.g. a plan asserts a `{"error":{"code":"..."}}` envelope while
   the path actually returns the framework's `{"detail":"..."}`. A status-only test
   does not prove a body claim.

3. **External findings are hypotheses.** Treat any marketplace/external comparison
   report's claims as hypotheses to verify against source — never as a verdict to
   adopt.

## Re-read pass (mandatory, before emitting)

Re-read every **WRONG** verdict you drafted and ask: *"did I read source for this, or
did I assert from memory? Does my cited line actually contradict the plan's value, on
the branch that fires for this input?"* Downgrade any verdict that fails this to
`needs-runtime-check` or retract it.

## Execution fence

"Run it" means a **single read-only probe** — one REPL/`TestClient` call or one
`curl` against an already-running instance — to read a value off the live system.
**Never** stand up e2e infrastructure, never run a full test suite as the grading
method, never mutate state. Grading reads; it does not become an e2e run.

## Output

For each plan, independently (do not compare until both are scored):
- A per-plan **rubric score** on the GATE axes: grounding correctness · coverage ·
  executability/logistics · Blockers & Findings · contract adherence.
- A **findings list**, each finding tagged `confirmed` / `needs-runtime-check` /
  `refuted-on-verification`, each with a `(file:line)` citation for confirmed/refuted.

Only after both plans are independently scored: a short comparison and verdict.
