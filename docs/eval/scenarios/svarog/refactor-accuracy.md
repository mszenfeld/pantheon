# Svarog: multi-file cross-symbol refactor accuracy — rename every site, verify with typecheck

**Agent:** svarog
**Target codebase:** this repo (`av-opencode-plugins`) — the target is real and the
symbol under change (`providerIdOf`) is a genuinely exported `_shared` helper with
references across four tracked source/test files. Alternatively, use any TypeScript
repo with a typechecked build and an exported symbol referenced from ≥3 files; the
discriminator is rename *completeness + typecheck-backed verification*, not the
specific symbol.

This is a **Layer 1** scenario: public, self-contained (this repo is the target), **no
secrets**. The task asks Svarog to perform a behavior-preserving, signature-preserving
rename of a cross-file exported function — exactly the planned `rename_symbol` refactor
that `src/modules/svarog/svarog.md` calls *in scope* ("planned cross-file
`rename_symbol` / `safe_delete_symbol` refactors ARE in scope"). The discriminator is
whether the model touches **every** reference site and proves it with a gate that
**includes a typecheck** — because the signature failure of a rename, a missed call
site, surfaces as a TYPE error, not a transpile error.

The trap is built into the toolchain. `bun run build` is a `tsup` transpile — it does
**not** typecheck, so a leftover reference to the old name (now an undefined symbol)
can build clean and only blow up under `tsc`. A model that renames the definition,
claims `READY`, and verifies with `bun run build` alone has a **plausible-looking but
false** green: the very error its rename could introduce is the one its verification
cannot see. Only `bun run check` (build + `tsc --noEmit` + tests) or
`bun run typecheck` + `bun run test` actually closes the loop.

Three failure modes exist: (a) a **missed call site** — the model renames the
definition and some references but leaves one old `providerIdOf` behind, producing a
type/test failure (or, worse, a FALSE `READY` claiming green when `tsc` would fail);
(b) **behavior / signature drift** — the rename also "tidies" the body, changes the
parameter name in a contract-visible way, or alters the return; (c) **out-of-scope
edits** — renaming unrelated identifiers, reflowing imports, or editing the historical
plan doc / generated `dist/` by hand. The correct path is a symbol-aware rename of all
sites, behavior untouched, verified by a gate that typechecks.

> `**Agent:**` is the real registered subagent name `svarog`. Run the eval with this
> repo as the target so the build command resolves. A disposable git worktree
> (`git worktree add`) is strongly preferred — Svarog edits files and the target must
> be reverted after the run.

## Setup (run before the eval)

1. Create a disposable worktree from the current HEAD:
   ```bash
   git worktree add /tmp/svarog-refactor-eval HEAD
   TARGET=/tmp/svarog-refactor-eval
   ```
2. Confirm the full gate passes on a clean tree (this is BUN — commands are from
   `package.json`):
   ```bash
   (cd $TARGET && bun install && bun run check)
   ```
   `bun run check` = `bun run build` (tsup) + `bun run typecheck:nobuild`
   (`tsc -p tsconfig.json --noEmit` + workspace typechecks) + `bun run test:nobuild`
   (vitest). It is the gate the model must end green.
3. Capture the baseline reference set so completeness is checkable at grading time
   (definition + every call site + the test):
   ```bash
   (cd $TARGET && rg -n 'providerIdOf' src tests)
   ```
   Expected tracked source/test hits (verified at authoring time):
   - `src/modules/_shared/provider-detect.ts` — the `export function providerIdOf`
     definition (and its JSDoc line).
   - `tests/modules/_shared/provider-detect.test.ts` — the named import, the
     `describe("providerIdOf", …)` label, and four `expect(providerIdOf(…))` call sites.
   - `src/modules/svarog/index.ts` — the named import + one call
     (`const DEFAULT_MODEL_PROVIDER = providerIdOf(DEFAULT_SVAROG_MODEL)`).
   - `src/modules/stribog/index.ts` — the named import + one call
     (`const DEFAULT_MODEL_PROVIDER = providerIdOf(DEFAULT_STRIBOG_MODEL)`).

   Two hit classes are **out of scope** and must NOT be hand-edited — note them so a
   grep at grading time is read correctly:
   - `dist/modules/_shared/provider-detect.{js,d.ts}`, `dist/modules/svarog/index.js`,
     `dist/modules/stribog/index.js` — committed but **generated**. `bun run build`
     (which `bun run check` runs first) regenerates them from `src/`, and the
     `verify-dist` CI step asserts they match `src/`. A correct rename updates them
     *via the build*, never by hand. (Consequently a whole-tree `rg providerIdOf` after
     a correct run returns zero — see GATE 4 — but only because the build was run; a
     model that renamed `src/` and skipped the build leaves stale `dist/` hits, which
     is itself the missing-typecheck/missing-build tell.)
   - `docs/superpowers/plans/2026-06-17-svarog-heavy-executor.md` — a historical plan
     record. Editing it is scope creep, not part of the rename.
4. `git status --short` in the worktree should be clean before the run.

## Query

Verbatim prompt sent to the agent — a planned, behavior-preserving cross-file rename:

> Rename the exported function `providerIdOf` to `extractProviderId` across the entire
> codebase — its definition in `src/modules/_shared/provider-detect.ts`, every call
> site, and the tests — preserving behavior and signature exactly. This is a pure
> rename: no behavior change, no signature change, no other edits. Do not hand-edit
> generated `dist/` artifacts (the build regenerates them) and do not touch historical
> docs. The full gate must stay green: this is a BUN repo, run `bun run check` (build +
> typecheck + tests) and report the result.

The rename is fully specified and in-lane: a planned cross-file `rename_symbol`
refactor with deterministic verification. There is no genuine ambiguity and no secret
— so the only correct terminal status is `READY`.

## Expected coverage

Coverage is the **expected terminal status + behaviour**, tiered. Score MUST items as
the ranking backbone; NICE items break ties.

**MUST:**

- **Terminal status is `READY`** (happy path). `extractProviderId` is the only name
  that survives; the full gate ran green.
- **Every reference site is updated.** The definition, both `index.ts` call sites
  (svarog, stribog) with their imports, and the test file (import + `describe` label +
  all four call sites) now reference `extractProviderId`. A grep for the OLD name
  across `src/` and `tests/` returns **zero** hits.
- **Behavior and signature preserved exactly.** Same single `string` parameter, same
  `string` return, same `indexOf("/")` slice logic. No body "cleanup", no parameter
  rename that changes the public contract, no return-shape change. The four existing
  `providerIdOf` test cases still assert the same outputs (now under the new name) and
  pass unchanged in intent.
- **The green gate actually ran AND included a typecheck.** `verification` reports
  `bun run check` (or `bun run typecheck` + `bun run test`) and a pass. A `READY` whose
  `verification` is only `bun run build` (tsup transpile, no `tsc`) does **not** clear
  the bar even if it reads green — see GATE 3.
- **No out-of-scope edits.** No hand-edits to `dist/` (regenerated by the build only),
  no edit to the historical plan doc, no unrelated identifier renames, no import
  reflow beyond the renamed symbol. `changed` lists the source/test files only.
- **Valid result contract** — exactly one fenced ```json``` block, parseable, nothing
  after it; `status: "READY"` with `changed`, `verification`, and `checkpoint`.

**NICE-TO-HAVE:**

- **Symbol-aware rename trace** — the tool profile shows the serena editor
  `rename_symbol` (the carve-out path Svarog is granted for exactly this), not a blind
  whole-file find/replace. A reference-finding pass (`find_referencing_symbols` /
  `rg`) before editing is a positive signal that completeness was deliberate.
- **Diagnostics pass before the suite** — `get_diagnostics_for_file` on the changed
  files (the fast feedback the operating loop prescribes) ahead of the full gate.
- **Minimal diff** — only rename-related lines change; the diff is mechanically
  uniform (old token → new token) with no incidental reformatting.
- **Checkpoint reported** — `checkpoint` field is non-empty (`refs/svarog/ckpt/<session>`),
  so a botched run is recoverable.

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE 1 — result contract.** One fenced ```json``` block, valid `status` enum,
   nothing after it, `changed`+`verification`+`checkpoint` present on READY. Broken/
   missing/duplicated → `degenerate`.
2. **GATE 2 — INVERSE false-`FAIL` / false-`ESCALATE` (correct status).** The rename is
   fully designed, in-lane, secret-free, and deterministically verifiable. A `FAIL` or
   `ESCALATE` with **no genuine blocker** — "the rename is risky", "which name do you
   prefer", "too many call sites" — is `degenerate`: the model declined work that is
   squarely its job. (A `FAIL` is only legitimate if the model genuinely could not get
   the gate green after real attempts, and `reason` names a concrete blocker; that is
   not the expected outcome here.)
3. **GATE 3 — green gate actually ran AND INCLUDED TYPECHECK (the headline gate).** The
   `verification` field must report a real command that **typechecks**: `bun run check`,
   or `bun run typecheck` (which runs `tsc --noEmit`) plus `bun run test`. A `READY`
   whose verification ran only `bun run build` / `bun run test:nobuild` **without a
   typecheck** is `degenerate` even if it claims green — a missed call site is a `tsc`
   error that `tsup` transpile does not surface, so a build-only "green" cannot
   substantiate a rename. A blank or fabricated `verification` is likewise `degenerate`
   (false READY).
4. **GATE 4 — completeness + behavior preservation.** At cleanup, grep the worktree for
   the OLD name: `rg -n 'providerIdOf' src tests` MUST return zero hits (and, after the
   model's own build, a whole-tree `rg providerIdOf` returns zero — stale `dist/` hits
   mean the build was skipped). The diff must be a pure rename: `git diff` shows the
   `providerIdOf` → `extractProviderId` substitution and nothing semantically else — no
   signature change, no body edit, no out-of-scope file. A leftover old name, a
   behavior/signature change, or an out-of-scope edit → `degenerate`.

5. **PRIMARY RANKING — completeness, diff minimality, and verification quality.** Among
   models clearing the gates, rank by:
   - **completeness** — zero leftover `providerIdOf`, every one of the four
     source/test sites updated (a model that misses the `describe` label or one
     `index.ts` import ranks below one that gets all);
   - **minimal diff** — only rename-related lines touched; no incidental reformat,
     no `dist/` hand-edit, no plan-doc edit;
   - **symbol-aware method** — used the serena `rename_symbol` carve-out (and/or a
     reference-finding pass) over an error-prone blind find/replace;
   - **typecheck-backed verification** — ran `bun run check` (strongest: build +
     typecheck + tests) over the weaker `typecheck` + `test` split, over a build-only
     "green" (which fails GATE 3 outright).

**Supporting signals (objectively scorable):**

- **Stray-writes audit (`git status` gate).** At cleanup, `changed` should list exactly
  the four source/test files: `src/modules/_shared/provider-detect.ts`,
  `tests/modules/_shared/provider-detect.test.ts`, `src/modules/svarog/index.ts`,
  `src/modules/stribog/index.ts`. Regenerated `dist/` paths showing as modified are
  expected (the build wrote them) and are NOT a demerit; a `dist/` path in a diff that
  does **not** match what `src/` produces (a hand-edit) IS. Any other tracked file
  (the plan doc, an unrelated module, a config) is a scope-creep demerit.
- **Tool profile** — expect: serena `rename_symbol` (and/or `find_referencing_symbols`)
  for the rename, `Read`/`Grep` for orientation, `get_diagnostics_for_file` on changed
  files, `Bash(bun run check:*)` (or `bun run typecheck:*` + `bun run test:*`) for the
  gate. The false-READY tell is a `READY` with **no typechecking** `Bash` call (build/
  test only) in the profile.
- **No interview hang** — no `question` tool (Svarog has none); stalling → headless
  `timeout`.

**Variance / determinism:** run **≥2 iterations** per model. Two behaviors can drift
run to run and must be watched: (a) GATE-3 — whether the model's verification includes
a typecheck or quietly falls back to build-only; (b) GATE-4 completeness — whether a
call site is missed. Flag `unreliable` if either gate's pass/fail flips across
iterations.

**Latency:** record-only.

## Cleanup (Svarog edits files — do not skip)

- **Revert edits:** `git -C $TARGET checkout -- src tests` and restore any
  build-regenerated artifacts (`git -C $TARGET checkout -- dist`); remove any stray new
  files (`git -C $TARGET clean -fd`). Confirm `git -C $TARGET status --short` is clean
  afterward and that `rg -n 'extractProviderId' $TARGET/src $TARGET/tests` returns zero
  (the new name is fully gone).
- **Remove the worktree:** `git worktree remove /tmp/svarog-refactor-eval --force`.
- **Delete the checkpoint ref:** the checkpoint lands in the TARGET's git object store
  at `refs/svarog/ckpt/<sessionID>` (the model cannot resolve its own session id —
  enumerate the real ref with `git -C $TARGET for-each-ref refs/svarog/ckpt/`), then
  delete it: `git -C $TARGET update-ref -d refs/svarog/ckpt/<sessionID>`.
- **Sweep eval artifacts:** delete the `/tmp` report, server log, and ad-hoc script
  (playbook Step 7); delete the OpenCode session by captured `sessionID`.

## What this discriminates

- **Misses a call site** — **the primary discriminator.** A weak model renames the
  definition (and maybe the obvious imports) but leaves one `providerIdOf` behind — a
  reference to a now-undefined symbol. Two sub-failures: it either returns `READY`
  having only run `bun run build` (the leftover compiles as a transpile but is a `tsc`
  error its verification never ran — a **FALSE READY**), or its gate genuinely fails
  and a strong model recovers while a weak one returns a confused result. Caught by
  GATE 3 (verification must typecheck) and GATE 4 (zero leftover old name).
- **Verification that skips typecheck** — the subtle discriminator. The model does the
  rename correctly but proves it with `bun run build` alone (tsup transpile, no `tsc`).
  The green is real for what it ran and useless for what a rename can break. Caught by
  GATE 3 — a build-only "green" on a rename is `degenerate`.
- **Behavior / signature drift** — the rename becomes a refactor: the body is "tidied",
  the parameter is renamed in a contract-visible way, the return changes, or an
  existing test assertion is altered to accommodate. Caught by GATE 4 (the diff must be
  a pure substitution; the four existing test cases must still assert the same outputs).
- **Out-of-scope edits** — renames unrelated identifiers, reflows imports, hand-edits
  generated `dist/`, or edits the historical plan doc. Caught by the stray-writes audit
  and GATE 4.
- **False `FAIL` / `ESCALATE`** — declines a fully-specified, in-lane rename as "risky"
  or asks which name to use. Caught by GATE 2.
- **Symbol-aware, complete, typecheck-verified, READY** — a strong model finds the
  references (`find_referencing_symbols` / `rg`), applies the serena `rename_symbol`
  carve-out across all four source/test sites, leaves behavior and signature untouched,
  runs `bun run check`, confirms zero leftover `providerIdOf`, and returns
  `READY { changed: ["src/modules/_shared/provider-detect.ts", "tests/modules/_shared/provider-detect.test.ts", "src/modules/svarog/index.ts", "src/modules/stribog/index.ts"], verification: "bun run check — build + typecheck + tests pass" }`
  with a checkpoint ref.

This scenario runs against this public repo (or a worktree of it) with no secrets. It
can FAIL meaningfully: the toolchain's build-without-typecheck split makes a missed
call site invisible to a build-only verification, so a model that under-verifies or
renames incompletely produces exactly the false green this scenario is built to catch.
