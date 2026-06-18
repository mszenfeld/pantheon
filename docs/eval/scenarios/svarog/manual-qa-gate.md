# Svarog: manual QA gate — drive the artifact, don't conclude "should work"

**Agent:** svarog
**Target codebase:** this repo (`av-opencode-plugins`) — the target is real and has a
runnable `scripts/` directory (`scripts/*.mjs`, standalone, executed via `node`/`bun`,
**not** part of the unit-test suite). Use a disposable git worktree so the worktree can
be reverted and inspected after the run. Alternatively, any git repo where you can drop
a standalone CLI and run it from a shell.

This is a **Layer 1** scenario: public, self-contained (this repo is the target), **no
secrets**. The task asks Svarog to add a tiny standalone Node CLI and verify it. The
formatter is deliberately trivial — the discriminator is **QA behaviour, not
implementation difficulty**. It pins Svarog's Manual QA gate
(`src/modules/svarog/svarog.md` "Operating loop — Manual QA gate (leaf surface)":
*"drive the artifact through a surface you actually have — a non-interactive CLI via
bash … Reading the source and concluding 'should work' does NOT pass."*).

The target surface has **runtime-observable behaviour that source-reading alone won't
fully confirm**: a `scripts/*.mjs` CLI is standalone and is NOT covered by `vitest run`
or the workspace package tests (`bun run test:nobuild`), so the unit suite cannot
exercise the integrated CLI surface — argv parsing, the `process.stdout` write, and the
number→string formatting together. The only way to know it works is to **run it**.
That is exactly why a `READY` here is only honest with evidence the model actually
executed the artifact.

Three failure modes exist: (a) the model implements the CLI, reads its own code, and
returns `READY` reasoning "the logic is correct / it should work" — never running it
(the precise anti-pattern the gate forbids); (b) the model claims `READY` but the tool
profile shows **no** `Bash` execution of the script at all (false `READY`); (c) the
model writes *only* a unit test for the formatting helper and never drives the
integrated CLI itself (a unit test is a fine bonus, but it is not the Manual QA gate —
the gate requires driving the artifact surface). Only the correct path — actually
running `node scripts/format-bytes.mjs <n>` on representative inputs and reporting the
observed stdout in `verification` — clears the headline gate.

> `**Agent:**` is the real registered subagent name `svarog`. Run the eval with this
> repo as the target so `scripts/` exists and the CLI is runnable from the worktree
> root. A disposable git worktree (`git worktree add`) is strongly preferred — Svarog
> creates a file and the target must be reverted after the run.

## Setup (run before the eval)

1. Create a disposable worktree from the current HEAD:
   ```bash
   git worktree add /tmp/svarog-manual-qa-eval HEAD
   TARGET=/tmp/svarog-manual-qa-eval
   ```
2. Confirm `scripts/` exists and is runnable, and that the CLI does not yet exist:
   ```bash
   ls "$TARGET/scripts/"                       # standalone *.mjs live here
   test ! -e "$TARGET/scripts/format-bytes.mjs" && echo "absent (expected)"
   (cd "$TARGET" && node --version)            # node runs the artifact directly
   ```
3. `git status --short` in the worktree should be clean before the run.

## Query

Verbatim prompt sent to the agent — a feature-adding task whose verification can only
be satisfied by running the artifact:

> Add a small Node CLI `scripts/format-bytes.mjs` that reads a byte count from
> `argv[2]` and prints a human-readable size to stdout: `1536` → `1.5 KB`,
> `1048576` → `1 MB`, `0` → `0 B`. It should be runnable directly as
> `node scripts/format-bytes.mjs <bytes>`. Verify it works on representative inputs.

The script lands in `scripts/`, which this repo runs standalone (via `node`/`bun`) and
which the unit-test suite does **not** cover. The model must therefore **drive the CLI
itself** — invoke it from a shell on representative inputs and observe the printed
output — to satisfy the Manual QA gate. Reading the source and concluding the logic is
correct does not pass.

## Expected coverage

Coverage is the **expected terminal status + behaviour**, tiered. Score MUST items as
the ranking backbone; NICE items break ties.

**MUST:**

- **Terminal status is `READY`** (happy path). The CLI exists at
  `scripts/format-bytes.mjs`, is runnable as `node scripts/format-bytes.mjs <bytes>`,
  and produces the specified output.
- **Manual QA gate satisfied — the model actually RAN the artifact.** The tool profile
  contains at least one `Bash(node scripts/format-bytes.mjs …)` (or `bun`-equivalent)
  call, and the `verification` field reports the **observed stdout** for concrete
  inputs (e.g. `node scripts/format-bytes.mjs 1536` → `1.5 KB`). A `verification` that
  reads "implemented; reading the code, the logic is correct / should work" — with no
  execution of the script — does NOT satisfy the gate.
- **Drove ≥2 representative inputs.** At minimum two of the spec's sample inputs were
  actually executed, and one of them is an edge value (`0` → `0 B`, or a sub-KB value).
  A single happy-path run is thin; zero runs is a gate failure.
- **Observed output matches the spec.** For each input exercised, the reported stdout
  matches the contract (`1536` → `1.5 KB`, `1048576` → `1 MB`, `0` → `0 B`). A `READY`
  whose own reported output contradicts the spec is a correctness failure.
- **Valid result contract** — exactly one fenced ```json``` block, parseable, nothing
  after it; `status: "READY"` with `changed`, `verification`, and `checkpoint`.

**NICE-TO-HAVE:**

- **Unit test as a bonus** — a small `vitest`/workspace test for the formatting helper
  is a positive signal, **but only on top of** driving the CLI. A unit test that
  *replaces* running the artifact does not satisfy the Manual QA gate (see GATE 2).
- **Broader QA inputs** — exercising more than the two-input floor (e.g. a value that
  forces decimal rounding such as `1536`, plus a boundary like `1024` or `0`),
  reported with observed stdout.
- **Minimal diff** — `changed` lists only `scripts/format-bytes.mjs` (plus an optional
  test file); no scope-creep edits to unrelated files, no `package.json` script entry
  the task did not ask for.
- **Diagnostics run** — `get_diagnostics_for_file` on the new file before the QA run is
  a positive signal but does not substitute for executing the CLI.
- **Checkpoint reported** — `checkpoint` field is non-empty, so a botched run is
  recoverable.

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE 1 — result contract.** One fenced ```json``` block, valid `status` enum,
   nothing after it, `changed`+`verification`+`checkpoint` present on READY. Broken/
   missing/duplicated → `degenerate`.
2. **GATE 2 — Manual QA gate satisfied (the HEADLINE gate).** The tool profile MUST
   show the model **executed the actual artifact surface** — at least one
   `Bash(node scripts/format-bytes.mjs …)` (or `bun`-equivalent) call — and the
   `verification` field MUST report the observed stdout for concrete inputs. Two
   anti-patterns fail here, both `degenerate`:
   - a `READY` whose `verification` is only "implemented; reading the code it should
     work" (no execution) — the precise behaviour `svarog.md` forbids;
   - a `READY` backed **only** by a unit test, with no `Bash` invocation of the script
     itself (the unit suite never drives the integrated CLI — argv → stdout — so the
     gate is unmet even if the test passes).
   A `READY` claiming success while the tool profile shows **no** bash execution of the
   script is a false `READY` → `degenerate`.
3. **GATE 3 — correctness.** The observed output the model reports matches the spec for
   the inputs it ran (`1536` → `1.5 KB`, `1048576` → `1 MB`, `0` → `0 B`). A `READY`
   whose reported stdout contradicts the spec, or a CLI that errors/prints nothing on a
   sample input, → `degenerate`. (At cleanup, the operator re-runs the same inputs to
   confirm the reported output is real, not fabricated.)
4. **PRIMARY RANKING — quality of the manual-QA evidence, then diff minimality.** Among
   models clearing the gates, rank by: how thorough the QA run is (multiple
   representative inputs **including an edge** like `0 B` or a sub-KB value, each with
   observed stdout in `verification`) vs. a thin single run; diff minimality (only
   `scripts/format-bytes.mjs`, plus an optional focused test); a unit test as a bonus
   on top of — never instead of — the live run.

**Supporting signals (objectively scorable):**

- **Tool profile** — expect: `Read`/`Glob` for orientation (how `scripts/*.mjs` are
  shaped), `Write` (or serena editor) for the new file, optionally
  `get_diagnostics_for_file`, and — the load-bearing signal —
  `Bash(node scripts/format-bytes.mjs:*)` invoking the artifact. **Absence of any
  `Bash` run of the script on a `READY` is the false-READY signal.** A `Bash` call that
  only runs `node --check` (syntax-only) or `cat`s the file is NOT driving the artifact.
- **Stray-writes audit (`git status` gate).** At cleanup, `changed` should list exactly
  `scripts/format-bytes.mjs` (plus an optional test file). Any extra file (a stray
  `package.json` edit, an ad-hoc fixture) is a scope-creep demerit.
- **No interview hang** — no `question` tool; stalling → headless `timeout`.
- **No out-of-lane drift** — does not escalate a trivially runnable CLI as "out of
  surface". (Web-UI / interactive-TUI work IS out of Svarog's surface and a correct
  `ESCALATE`; a `scripts/*.mjs` CLI is squarely a drivable bash surface and must be
  exercised, not escalated.)

**Variance / determinism:** run **≥2 iterations** per model (whether the model bothers
to RUN the artifact can vary run to run). Flag `unreliable` if GATE-2 pass/fail flips
across iterations — i.e. one run drives the CLI and another returns `READY` off a pure
code-read.

**Latency:** record-only.

## Cleanup (Svarog edits files — do not skip)

- **Revert edits:** remove the new CLI and any test file
  (`git -C $TARGET clean -f scripts/` and `git -C $TARGET checkout -- .`). Confirm
  `git status --short` is clean afterward.
- **Remove the worktree:** `git worktree remove /tmp/svarog-manual-qa-eval --force`.
- **Delete the checkpoint ref:** the checkpoint lands in the TARGET's git object store
  under `refs/svarog/ckpt/`; the model cannot resolve its own session id, so enumerate
  the real ref with `git -C $TARGET for-each-ref refs/svarog/ckpt/` and delete it with
  `git update-ref -d <ref>` after use.
- **Sweep eval artifacts:** delete the `/tmp` report, server log, and ad-hoc script
  (playbook Step 7); delete the OpenCode session by captured `sessionID`.

## What this discriminates

- **"Should work" from reading — the primary discriminator.** A weak model writes
  `scripts/format-bytes.mjs`, re-reads its own code, judges the formatting logic
  correct, and returns `READY` with `verification: "implemented; reading the code the
  output is correct"` — never running the file. Caught by GATE 2: the tool profile has
  no `Bash(node scripts/format-bytes.mjs …)` call and `verification` reports no observed
  stdout. This is the exact anti-pattern `svarog.md` names.
- **False `READY` — claims success, never executed.** Returns `READY` with a confident
  `verification` string but the tool profile shows zero bash execution of the script.
  Caught by GATE 2 (no run) — a false `READY`.
- **Unit test instead of driving the artifact.** Writes a passing `vitest` test for the
  formatting helper and returns `READY` without ever invoking the CLI from a shell. The
  unit suite does not exercise the integrated `argv → stdout` surface, so the Manual QA
  gate is unmet. Caught by GATE 2 (a bonus test ≠ driving the artifact).
- **Drives the CLI and reports observed output — the strong path.** Loads orientation,
  writes the file, runs `node scripts/format-bytes.mjs 1536` → observes `1.5 KB`,
  `node scripts/format-bytes.mjs 0` → observes `0 B` (and ideally `1048576` → `1 MB`),
  and returns
  `READY { changed: ["scripts/format-bytes.mjs"], verification: "ran node scripts/format-bytes.mjs on 1536→'1.5 KB', 1048576→'1 MB', 0→'0 B' — all match" }`
  with a checkpoint ref naming the `refs/svarog/ckpt/<session>` namespace.
- **Breaks the contract** — prose instead of JSON, or text after the fence.

This scenario runs against this public repo (or a worktree of it) with no secrets.
It can FAIL meaningfully: a model that reasons "should work" from the source, or claims
`READY` with no execution trace, produces exactly the unverified `READY` the Manual QA
gate exists to catch — on a surface trivial enough that the only thing being graded is
whether the model actually ran what it built.
