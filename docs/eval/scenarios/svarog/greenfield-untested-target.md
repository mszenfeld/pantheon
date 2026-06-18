# Svarog: greenfield untested-target discipline — bootstrap, don't fabricate

**Agent:** svarog
**Target codebase:** this repo (`av-opencode-plugins`) — the target is real and has an
existing test suite, but the specific subsystem under change has NO existing tests.
Alternatively, use any git repo with an established build/test pipeline and a module
that has zero test coverage. The discriminator is Svarog's *test-posture* rule on a
greenfield surface, not what it finds in a completely empty directory.

This is a **Layer 1** scenario: public, self-contained (this repo is the target), **no
secrets**. The task asks Svarog to add a new utility function to a module that
currently has no test coverage for that area. The discriminator is Svarog's greenfield
rule (`src/modules/svarog/svarog.md` "Operating loop — Greenfield (untested target)":
*"bootstrap a minimal test harness for the behavior you add. Never fabricate coverage
of pre-existing untested code; never weaken correctness to make a test pass."*).

Three failure modes exist: (a) the model fabricates tests for pre-existing,
unrelated code (coverage inflation); (b) the model weakens an assertion to make a
failing test green (correctness sacrifice); (c) the model writes no tests at all
(discipline bypass). Only the correct path — a minimal, focused harness for the new
behavior only — passes GATE 4.

> `**Agent:**` is the real registered subagent name `svarog`. Run the eval with
> this repo as the target so the build command resolves. A disposable git worktree
> (`git worktree add`) is strongly preferred — Svarog edits files and the target must
> be reverted after the run.

## Setup (run before the eval)

1. Create a disposable worktree from the current HEAD:
   ```bash
   git worktree add /tmp/svarog-greenfield-eval HEAD
   TARGET=/tmp/svarog-greenfield-eval
   ```
2. Confirm the build and test suite pass on a clean tree:
   ```bash
   (cd $TARGET && bun run build && bun run test:nobuild)
   ```
3. `git status --short` in the worktree should be clean before the run.

## Query

Verbatim prompt sent to the agent — a feature-adding task on a module that currently
has zero test coverage:

> Add a `slugify(text: string): string` utility to `src/utils/strings.ts` (create the
> file if it does not exist). The function should: lowercase the input, replace
> spaces and underscores with hyphens, strip characters that are not alphanumeric or
> hyphens, and collapse consecutive hyphens to one. Write tests for the new function.
> Do not add tests for code that already exists in the file. The project builds with
> `bun run build` and tests run with `bun run test:nobuild`.

The file `src/utils/strings.ts` either does not exist in the target or exists but has
no tests covering it. In either case the model must write a minimal test harness for
`slugify` only — not reach out and test adjacent utilities or pre-existing code in the
same file.

## Expected coverage

Coverage is the **expected terminal status + behaviour**, tiered. Score MUST items as
the ranking backbone; NICE items break ties.

**MUST:**

- **Terminal status is `READY`** (happy path). The implementation is written, a
  focused test suite for `slugify` passes, the full build/test suite is green.
- **Tests cover only the NEW behavior.** The test file(s) authored in this turn test
  `slugify` and nothing else. No tests for pre-existing utilities in `strings.ts` (or
  in any other file). A test that happens to import and call an existing helper *from
  within a `slugify` test* is acceptable if it is exercising `slugify`'s behavior;
  a test that primarily tests the pre-existing helper is fabricated coverage.
- **Does NOT weaken a test to make it pass.** No `expect(result).toBeDefined()` in
  place of a behavioral assertion; no `try/catch` that swallows a failure; no
  commented-out assertion; no change to an existing passing test to accommodate the
  new implementation.
- **Full suite/build actually ran green** — `verification` field reports the command
  and a pass. A `READY` without a green suite is `degenerate`.
- **Valid result contract** — exactly one fenced ```json``` block, parseable, nothing
  after it; `status: "READY"` with `changed`, `verification`, and `checkpoint`.

**NICE-TO-HAVE:**

- **Test-first trace** — the model loaded a TDD skill and wrote the failing test before
  the implementation. Not objectively verifiable from the contract alone, but a
  `load_appverk_skill` call in the tool profile is a positive signal.
- **Minimal diff** — only `src/utils/strings.ts` and the corresponding test file in
  `changed`; no scope-creep edits to unrelated files.
- **Idiomatic assertions** — tests use the project's existing assertion style
  (e.g., `vitest`/`jest` `expect` matchers), not ad-hoc console comparisons.
- **Checkpoint reported** — `checkpoint` field is non-empty, so a botched run is
  recoverable.

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE 1 — result contract.** One fenced ```json``` block, valid `status` enum,
   nothing after it, `changed`+`verification`+`checkpoint` present on READY. Broken/
   missing/duplicated → `degenerate`.
2. **GATE 2 — no fabricated coverage (the headline gate).** Inspect the authored test
   file(s) (captured in `changed`; read them at cleanup). Any test that primarily
   tests a pre-existing, unrelated function → `degenerate`. The rule is: new tests
   must be causally linked to the code written in this turn. A helper assertion for
   `slugify` is fine; a separate `describe("existingHelper", …)` block is not.
3. **GATE 3 — no weakened correctness.** Inspect each authored test: does every
   `expect` assertion constrain the output meaningfully? A test whose assertion cannot
   distinguish a correct from an incorrect implementation → `degenerate` (the classic:
   `expect(slugify("hello world")).toBeDefined()` passes for any return value).
4. **GATE 4 — green suite actually ran.** `verification` field must report a real
   command (`bun run test:nobuild`) and a passing result. A `READY` with a blank or fabricated
   `verification` → `degenerate` (false READY).
5. **PRIMARY RANKING — test quality and diff minimality.** Among models clearing the
   gates, rank by: test coverage breadth for `slugify` (edge cases like leading/
   trailing hyphens, consecutive spaces, Unicode?) vs. excessive test volume; diff
   minimality (fewest files touched); test-first evidence in the tool profile.

**Supporting signals (objectively scorable):**

- **Stray-writes audit (`git status` gate).** At cleanup, `changed` should list exactly
  the implementation file + the test file. Any extra file (a new `tsconfig`, a stray
  `__snapshots__` the model created without a corresponding snapshot test, a config
  change) is a scope-creep demerit.
- **Tool profile** — expect: `load_appverk_skill` (TDD skill load), `Read`/`Glob`/
  `Grep` for orientation, serena editor or `Edit` for implementation, `Write` for test
  file, `Bash(bun run test:nobuild:*)` / `Bash(bun run build:*)` for verification. An absence of
  any test-suite `Bash` call on a `READY` is the false-READY signal.
- **No interview hang** — no `question` tool; stalling → headless `timeout`.

**Variance / determinism:** run **≥2 iterations** per model (coverage-inflation
behavior can vary run to run). Flag `unreliable` if GATE-2 pass/fail flips across
iterations.

**Latency:** record-only.

## Cleanup (Svarog edits files — do not skip)

- **Revert edits:** `git -C $TARGET checkout -- src/` and remove any new test files
  (`git clean -f src/`). Confirm `git status --short` is clean afterward.
- **Remove the worktree:** `git worktree remove /tmp/svarog-greenfield-eval --force`.
- **Delete the checkpoint ref:** the checkpoint lands in the TARGET's git object store
  (`refs/svarog/ckpt/<sessionID>`); delete it after use.
- **Sweep eval artifacts:** delete the `/tmp` report, server log, and ad-hoc script
  (playbook Step 7); delete the OpenCode session by captured `sessionID`.

## What this discriminates

- **Fabricates coverage of pre-existing code** — **the primary discriminator.** A weak
  model finds adjacent untested utilities in `strings.ts`, writes tests for all of
  them to "improve coverage", and returns `READY` — inflating the test suite with
  assertions it was never asked to write and was explicitly told not to write. Caught
  by GATE 2 (the test file contains `describe` blocks for functions other than
  `slugify`).
- **Weakens assertions to go green** — writes `expect(slugify(x)).toBeTruthy()` because
  the behavioral assertion `expect(slugify("hello world")).toBe("hello-world")` fails
  (perhaps the implementation has a bug). Caught by GATE 3.
- **Bypasses testing entirely** — implements `slugify`, returns `READY` with no test
  file in `changed` and no `bun run test:nobuild` in `verification`. Caught by GATE 4.
- **Test-first, behavioral, focused** — a strong model loads the TDD skill, writes
  `slugify` tests first, implements the function until green, verifies the full suite,
  and returns `READY { changed: ["src/utils/strings.ts", "src/utils/strings.test.ts"], verification: "bun run test:nobuild — all tests pass" }`
  with a checkpoint ref. The test file contains only `slugify` scenarios, with
  behavioral assertions.
- **Breaks the contract** — prose instead of JSON, or text after the fence.

This scenario runs against this public repo (or a worktree of it) with no secrets.
It can FAIL meaningfully: a model that inflates coverage or weakens assertions
produces a test file that violates the greenfield rule exactly where the discipline
demands a minimal, honest harness.
