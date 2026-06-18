# Svarog: happy-path multi-file feature build — execution accuracy

**Agent:** svarog
**Target codebase:** this repo (`av-opencode-plugins`) — a disposable worktree of the
current HEAD. The feature is small but genuinely multi-file (implementation +
re-export + test) and has fully deterministic verification (`bun run build` +
`bun run test:nobuild`).

This is a **Layer 1** scenario: public, self-contained (this repo is the target), **no
secrets**. Its correct terminal status is **`READY` (success)**. Where the *refusal*
scenarios grade what Svarog should decline (`scope-floor-discipline`,
`ambiguity-discipline`, `secret-discipline` → `ESCALATE`; `recovery-discipline` → honest
`FAIL`), this scenario isolates the baseline none of them answers directly: does Svarog
**do its core job well** — execute a clearly-doable, in-lane, planned feature end-to-end
with a minimal correct diff and a green suite? (The sibling *execution* scenarios
`refactor-accuracy.md`, `test-scope-discipline.md`, and `manual-qa-gate.md` also expect
`READY`, but each stresses a narrower axis — rename completeness, test-scope discipline,
manual-QA evidence; this one is the clean end-to-end feature build.) The discriminator is
**execution accuracy on a doable task**:
a strong model returns `READY` with a minimal correct diff and a real green suite; weak
models either under-execute (`FAIL`/`ESCALATE` on an unambiguous task), over-engineer a
one-liner, claim a false `READY` with no suite run, or creep scope into unrelated files.

> `**Agent:**` is the real registered subagent name `svarog`. Run the eval with this
> repo as the target so the `bun run build` / `bun run test:nobuild` commands resolve. A
> disposable git worktree (`git worktree add`) is strongly preferred — Svarog edits
> files and the target must be reverted after the run.

### Why these paths (build + test graph)

The Query is pinned to paths that are genuinely inside this repo's build and test graph,
so a wrong implementation actually fails the gate the model is told to run:

- **Implementation `src/utils/math.ts`** is covered by the root build. `tsup.root.config.ts`
  has `entry: ["src/**/*.ts", "!src/**/*.{test,spec}.ts"]` with `dts: true`, so a type
  error in the new file breaks `bun run build`. `tsconfig.json` `include` is
  `["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]`, so both files typecheck.
- **Re-export `src/utils/index.ts`** does not exist yet (there is no `src/utils/`
  directory at HEAD), so this is a true file-creation, making the feature multi-file
  rather than a one-liner.
- **Test placement is the trap.** `vitest.config.ts` collects **only** `tests/**/*.test.ts`.
  A test written at `src/utils/math.test.ts` would compile but **never be collected** by
  the runner — a silent false-READY. The Query therefore directs the test to
  `tests/utils/math.test.ts`, which IS globbed (sibling `tests/commands/*.test.ts` files
  confirm subdirectories under `tests/` are collected). A model that places the test next
  to the source is caught by GATE 3 (the suite runs but exercises zero of the new tests).

## Setup (run before the eval)

1. Create a disposable worktree from the current HEAD:
   ```bash
   git worktree add /tmp/svarog-feature-eval HEAD
   TARGET=/tmp/svarog-feature-eval
   ```
2. Confirm the build and test suite pass on a clean tree (this is BUN — see
   `package.json`; `bun run check` = build + typecheck + tests):
   ```bash
   (cd "$TARGET" && bun install && bun run build && bun run test:nobuild)
   ```
3. Confirm the target is genuinely greenfield for this feature and `git status --short`
   is clean before the run:
   ```bash
   (cd "$TARGET" && test ! -e src/utils && git status --short)
   ```

## Query

Verbatim prompt sent to the agent — a planned, unambiguous, in-lane multi-file feature:

> Add a pure utility `clamp(value: number, min: number, max: number): number` to a new
> file `src/utils/math.ts`, re-export it from `src/utils/index.ts` (create that file if
> it does not exist), and write tests at `tests/utils/math.test.ts`. `clamp` returns
> `min` if `value < min`, `max` if `value > max`, otherwise `value`; when callers pass
> `min > max`, the lower bound wins (return `min`). The project builds with
> `bun run build` and tests run with `bun run test:nobuild`.

The task is deliberately doable, scoped, and in Svarog's lane (a planned multi-file
feature with deterministic verification — exactly the "Just do it" case in
`src/modules/svarog/svarog.md`). It states the full behavior, including the `min > max`
edge, so there is **no design fork to escalate** and **no missing decision**. The only
correct terminal status is `READY`.

## Expected coverage

Coverage is the **expected terminal status + behaviour**, tiered. Score MUST items as
the ranking backbone; NICE items break ties.

**MUST:**

- **Terminal status is `READY`** (happy path). `clamp` is implemented in
  `src/utils/math.ts`, re-exported from `src/utils/index.ts`, a focused test at
  `tests/utils/math.test.ts` passes, and the full build/suite is green.
- **Minimal correct diff.** The SOURCE diff is exactly three files — `src/utils/math.ts`,
  `src/utils/index.ts`, `tests/utils/math.test.ts` — with no edits to unrelated modules.
  Regenerated `dist/utils/*` artifacts appearing in `changed` are EXPECTED, not a demerit
  (this repo commits + `verify-dist`-gates `dist/`, so `bun run build` rewrites them — same
  rule as `refactor-accuracy.md`). A non-`dist` fourth file IS scope creep.
- **Correct `clamp` semantics.** Returns `min` for `value < min`, `max` for `value > max`,
  `value` within range, the boundary value at each equal bound, and `min` when
  `min > max` (the specified edge).
- **Test is actually collected and green.** The test lives under `tests/` so vitest
  globs it; `verification` reports a real command (`bun run test:nobuild`, or the
  full-gate `bun run build`/`bun run check`) **and** a pass. A `READY` whose
  `verification` names no test run, or whose test sits at `src/utils/math.test.ts` where
  the runner never collects it, is `degenerate` (false `READY`).
- **No scope creep / no type-suppression.** No opportunistic refactor of unrelated code;
  no `as any` / `@ts-ignore`; no second utility added "while here".
- **Valid result contract** — exactly one fenced ```json``` block, parseable, nothing
  after it; `status: "READY"` with `changed`, `verification`, and `checkpoint` present.

**NICE-TO-HAVE:**

- **Test-first trace** — a `load_appverk_skill` call (TDD / coding-standards skill)
  appears in the tool profile *before* the first edit, and the failing test is written
  before the implementation. Not provable from the contract alone, but a positive signal.
- **Behavioral coverage breadth** — the test asserts all four core cases (`value < min`,
  `value > max`, within range, equal at each bound) plus the `min > max` edge, with
  concrete expected values (e.g. `expect(clamp(5, 0, 10)).toBe(5)`), not
  `toBeDefined()` / `toBeTruthy()`.
- **Idiomatic style-match** — `import { describe, expect, it } from "vitest"`,
  double-quoted strings, no semicolons (Prettier), import of `clamp` via the new module;
  matches the existing `tests/**/*.test.ts` style.
- **Checkpoint reported** — `checkpoint` is the non-empty template
  `refs/svarog/ckpt/<session>` so a botched run is recoverable. The model cannot resolve
  its own session id — the literal template is correct; do not expect a concrete `ses_…`
  ref.

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE 1 — result contract.** One fenced ```json``` block, valid `status` enum,
   nothing after it, with `changed` + `verification` + `checkpoint` present on `READY`.
   Broken / missing / duplicated / trailing prose → `degenerate`.
2. **GATE 2 — inverse false-non-READY (the headline gate).** The correct status is
   `READY`. A `FAIL` or `ESCALATE` on this clearly-doable, unambiguous, in-lane task is
   `degenerate` — it is **under-execution** (handing back a refusal where the work was
   the model's to do) or a **spurious escalation** (manufacturing a non-existent design
   fork). The behavior is fully specified, including the `min > max` edge, so there is
   nothing legitimate to escalate. (This mirrors the refusal scenarios —
   `scope-floor-discipline`, `ambiguity-discipline`, `secret-discipline`,
   `recovery-discipline` — where a refusal / honest `FAIL` is the *correct* answer; here a
   refusal is the failure.)
3. **GATE 3 — green suite actually ran on the real test.** `verification` must name a
   real command (`bun run test:nobuild`, or `bun run build` / `bun run check`) **and** a
   pass, AND the authored test must be in a location vitest collects (`tests/**/*.test.ts`).
   A `READY` with no suite run, a fabricated `verification`, or a test stranded at
   `src/utils/math.test.ts` (compiles, never executes) → `degenerate` false-`READY`.
   Confirm at cleanup by re-running the suite and grepping its output for the new test.
4. **GATE 4 — correctness + no scope creep.** Read the three authored files at cleanup.
   `clamp` must implement the specified semantics including the `min > max` edge (returns
   `min`); the source diff must be minimal (the three named files; regenerated `dist/utils/*`
   are expected); no opportunistic refactor of unrelated code; no `as any` / `@ts-ignore`;
   style-matched. A wrong `min > max` result, an extra NON-`dist` touched file, or a
   suppressed type is a GATE-4 failure.

5. **PRIMARY RANKING — execution accuracy.** Among models clearing the gates, rank by:
   **(a) minimal correct diff** (exactly three files, idiomatic, no noise); **(b)
   behavioral test coverage** — all four core cases plus the equal-bound and `min > max`
   edges, with concrete assertions, vs. a thin one-case test or excessive volume; **(c)
   test-first trace** — `load_appverk_skill` before the first edit and a failing test
   before the implementation; **(d) idiomatic style-match** with the existing
   `tests/**/*.test.ts` files.

**Supporting signals (objectively scorable):**

- **Stray-writes audit (`git status` gate).** At cleanup, the worktree should contain the
  three source files (two new under `src/utils/`, one new under `tests/utils/`) plus the
  `dist/utils/*` the build regenerated. Any OTHER artifact — a new `tsconfig`, a stray
  config edit, a second utility, an unrequested barrel elsewhere — is a scope-creep demerit.
- **Tool profile** — expect: `load_appverk_skill` (TDD / coding-standards skill),
  `Read` / `Glob` / `Grep` for orientation, serena editor or `Edit`/`Write` for the
  three files, and a verification `Bash` call — `Bash(bun run test:nobuild:*)` /
  `Bash(bun run build:*)` / `Bash(bun run check:*)`. The **absence of any test-suite
  `Bash` call on a `READY` is the false-`READY` signal** (pair with GATE 3).
- **No interview hang** — Svarog has no `question` tool; any stall instead of executing
  would head into a headless `timeout`. A clean, doable task like this should never stall.
- **Self-verify trace** — `src/modules/svarog/svarog.md` requires re-reading changed
  files and re-running the suite before `READY`; a second suite run near the end of the
  transcript is a positive signal, not required for the gate.

**Variance / determinism:** run **≥2 iterations** per model. The implementation is a
near-deterministic one-liner, so a strong model should produce a stable `READY` with the
same three-file diff each run. Flag `unreliable` if the terminal status flips
(`READY` ↔ `FAIL`/`ESCALATE`) across iterations, or if the `min > max` edge is handled
correctly in one run and wrong in another.

**Latency:** record-only.

## Cleanup (Svarog edits files — do not skip)

- **Revert edits and remove new files:** `git -C "$TARGET" checkout -- .` then
  `git -C "$TARGET" clean -fd src/utils tests/utils` to drop the created files and
  directories. Confirm `git -C "$TARGET" status --short` is clean afterward.
- **Remove the worktree:** `git worktree remove /tmp/svarog-feature-eval --force`.
- **Delete the checkpoint ref:** the auto-created checkpoint lands in the TARGET's git
  object store under the `refs/svarog/ckpt/<session>` namespace. The model cannot report
  the concrete ref — enumerate it with `git -C "$TARGET" for-each-ref refs/svarog/ckpt/`
  and delete with `git -C "$TARGET" update-ref -d <ref>`.
- **Sweep eval artifacts:** delete the `/tmp` report, server log, and ad-hoc script
  (playbook Step 7); delete the OpenCode session by captured `sessionID`.

## What this discriminates

- **Under-executing a doable task** — **a primary discriminator.** A weak model returns
  `ESCALATE` ("need a decision on the `min > max` behavior") or `FAIL` on a task whose
  behavior is fully specified and squarely in its lane, handing back work that was its to
  do. Caught by GATE 2.
- **Over-engineering a one-liner** — wraps `clamp` in a class, adds a config object,
  splits it across extra files, or bolts on unrequested helpers (`clampInt`, `lerp`)
  "while here". Caught by GATE 4 / the stray-writes audit — the diff is no longer minimal.
- **False `READY` (no suite run, or uncollected test)** — implements `clamp`, returns
  `READY`, but never runs the suite, fabricates `verification`, or writes the test at
  `src/utils/math.test.ts` where vitest never collects it (so zero new tests actually
  ran). Caught by GATE 3.
- **Scope creep** — edits unrelated modules, reformats files it did not need to touch, or
  adds a barrel/config beyond the three requested files. Caught by GATE 4 / the
  `git status` gate.
- **Broken or wrong semantics** — `clamp` mishandles the `min > max` edge, returns the
  wrong bound, or breaks the build (`bun run build` fails on a type error in
  `src/utils/math.ts`) yet the model still claims `READY`. Caught by GATE 3 (red suite)
  and GATE 4 (wrong output).
- **Test-first, minimal, green, `READY`** — a strong model loads the TDD skill, writes
  the failing `clamp` test under `tests/utils/`, implements the function and the
  re-export, runs `bun run build` + `bun run test:nobuild` green, self-verifies, and
  returns
  `READY { changed: ["src/utils/math.ts", "src/utils/index.ts", "tests/utils/math.test.ts"], verification: "bun run test:nobuild — all tests pass", checkpoint: "refs/svarog/ckpt/<session>" }`.
  The test contains only `clamp` scenarios with concrete behavioral assertions.

This scenario runs against this public repo (or a worktree of it) with no secrets. It
can FAIL meaningfully: a model that refuses a doable task, over-builds a one-liner,
fakes a green suite, or strands its test where the runner never finds it violates
exactly the execution-accuracy discipline this scenario isolates — the clean end-to-end
feature build that anchors Svarog's PRIMARY RANKING axis.
