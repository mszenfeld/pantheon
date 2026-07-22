# Spec-review loop report — create-branch-tool-2.md

**Run:** 1 · **Mode:** default (interactive, batch-approve gated) · **Budgets used:** 2/3 iterations, 18/60 dispatches, ~1330s/1800s active · **Terminal status:** CONVERGED · **Verdict:** Re-reviewed (advisory)

**Scope note (operator-approved deviation, per the create-pr-tool precedent):** the target spec lives in `docs/specs/` (repo convention), not the command's default `docs/superpowers/specs/`; loop artifacts live in `docs/specs/reviews/`. The spec was untracked in git at loop start; the operator confirmed proceeding past the working-tree gate (the pre-loop snapshot is the sole recovery path).

## Round 1 — panel: internal-consistency, ambiguity-testability, completeness, feasibility, doctrine-compliance, contracts

Units: all nine `##` sections. Panel rationale: two core lenses; completeness (9 sections > 3); feasibility + doctrine-compliance (marketplace-plugin tool trigger, doctrine calibrated for a non-loop tool); contracts (tool arg schema + result contract). `ux` omitted (no UI surface). Cap 6.

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-001 | major | internal-consistency, ambiguity-testability, contracts | applied |
| SR-002 | major | ambiguity-testability, contracts | applied |
| SR-003 | nit | ambiguity-testability | applied |
| SR-004 | minor | feasibility | applied |
| SR-005 | minor | contracts | applied |

SR-001 (the §5.2.5 composed-name vector `-feature/INC-212` labeled "3 (also 2)" although §5.2.4's first-failed-rule order makes N2 fire first — N3 is provably unreachable as a first failure for any valid `expectedType`) was found independently by three lenses and challenger-upheld on all five refutation avenues. SR-002 (§5.2.2 pinned neither intra-segment first-failed-rule reporting nor cross-segment evaluation order, leaving NFR-4/AC-1 uncheckable — e.g. empty `description` fails both S2 and S3; no vector covers bad-type-AND-bad-id) was challenger-upheld: "numbered in the order listed" fixes numbering, not evaluation. The batch of 21 pairs (SR-001/SR-003 sharing the vector-table hunk; SR-004 including a fixer follow-up pair for a §9 citation the original batch scope missed — the fixer itself flagged it in its notes and the orchestrator requested the extra pair before the gate) was approved in full and applied cleanly: 21/21 unique matches, zero fix-failures.

## Round 2 — same panel (fresh dispatch)

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-006 | minor | internal-consistency | reported-only |
| SR-007 | minor | ambiguity-testability, contracts | reported-only |
| SR-008 | nit | ambiguity-testability | reported-only |

Zero significant findings, zero unlanded fixes, zero unconfirmed entries → **CONVERGED** (terminated before any fix phase; the round's minors/nit are reported-only per contract). Feasibility re-verified every line number refreshed by SR-004 as accurate on the current tree, and confirmed the sibling `create_pr` family as a live precedent for every proposed mechanism (hook carve-out shape, string-schema-with-TS-allow-list, partial-success result, argv-only runner).

**Reported-only residue (not fixed by the loop; all three applied manually by the operator session after the loop terminated — outside the loop's accounting, so the outcome enum stays `reported-only`):**

- **SR-006 (minor):** §5.1 declares `CreateBranchInput.cwd` required (no `?`), but AC-2/AC-3/AC-5/AC-6 call `createBranch` without `cwd` while explicitly passing the *optional* `runGit`. Fix: add `cwd` to those AC calls (matching AC-7), or mark `cwd?` with a stated default.
- **SR-007 (minor):** `checkoutError`'s content is unpinned when `git checkout` fails with empty stderr — FR-4 and the sibling `create-pr.ts` use a stderr→stdout→default fallback; FR-7/AC-6 say bare "\<git stderr\>". An empty `checkoutError` would also blur the FR-6 skip vs FR-7 fail distinction. Fix: mirror the FR-4/create_pr fallback in FR-7 and AC-6. (This was a thrice-rejected round-1 ghost that graduated to a two-lens finding in round 2.)
- **SR-008 (nit):** the §5.2.5 `fix<NUL>alert` vector embeds an invisible NUL byte and the legend's fourth escape spelling renders as an empty backtick — a verbatim copy of the input column builds a *valid* input. Fix: render the NUL visibly (`"fix\u0000alert"`) and give the legend a concrete spelling.

## Coverage

- Catalog lenses not selected this run: `ux` (no UI surface in the spec).
- Not returned (failures, with reasons): none — all six lenses returned valid JSON in both rounds; no reviewer, challenger, or fixer retries were needed. (One fixer continuation was requested for a scope-missed SR-004 pair; it returned normally.)
- Standing oracle blind spots: user intent, external facts (git/opencode behavior was reviewer-verified against the repo, not executed), unstated requirements.

## Rejected by the panel (self-falsification)

Across both rounds the panel self-refuted **~120 candidates**; every one is recorded verbatim in the sidecar (`rounds[].rejected`). Recurring ghosts a future reader may re-derive (all refuted): the D8 `GIT_DENIED` message edit vs C-2 (message-only, behavior byte-identical, deferrable SHOULD); the checkout default's location (wrapper vs `createBranch` — both default, observably identical); `created` being always-true (create failure throws, so the field is pinnable); the 240-byte boundary arithmetic (8 + 232 = 240, exact); NBSP/whitespace vector reproducibility (rule-column annotations disambiguate); the bash `git checkout` denial blocking the tool's own checkout (the hook intercepts `bash` only — `create_pr` already runs `git push` past `block-push` via `execFile`); C-4 test pins breaking (plugin-map registration touches neither `CORE_BUILTINS` nor `STRIBOG_TOOLS`); and all eleven doctrine-bar items (deterministic single-invocation tool: triggered items treated, loop-only items N/A with per-trigger justification). Note the asymmetry rule: a rejected candidate is not immune — SR-006 and SR-007 both graduated from round-1 rejected ghosts when round 2 found sharper evidence (the `runGit`-but-not-`cwd` asymmetry; the FR-4/sibling fallback divergence).

## Accepted risks (user-decided)

None (no keep-as-is decisions were made).

## Declined (user-decided)

None (the single fix batch was approved in full).

## Residual risks

- Verifier gaming: reviewers and challengers are LLMs; a plausible-but-wrong refutation can retire a real defect. All verdicts are advisory.
- Stochasticity: a re-run panel may find different candidates; convergence is relative to this run's panels.
- Lens drift: reviewers may drift from their mandate despite single-lens prompts.
- No token ceiling: dispatch/time budgets bound the run, not token spend.
- Soft registry matching: SR identity uses orchestrator equivalence judgment; a false non-match can double-report, a false match can merge distinct defects.
- Best-effort headless detection: interactivity was model-judged (interactive session confirmed by live gates in this run).
- Line-number citations (SR-004's fix) re-stale on any future hook edit; they were accurate as of the round-2 verification against the `feature/create-pr-tool` tree.
- Domain residuals recorded in the spec itself (§5.3/§6): TOCTOU on branch existence, orphaned branch on checkout failure (FR-7 manual recovery), unvalidated `id` semantics (D9).

## Recovery

- Loop-touched files: `docs/specs/create-branch-tool-2.md` (one approved fix batch applied; **the file is untracked in git — changes are uncommitted and the snapshot is the only rollback path**), `docs/specs/reviews/create-branch-tool-2-review.state.json`, `docs/specs/reviews/create-branch-tool-2-review.md`. Post-loop, the operator session additionally applied the SR-006/SR-007/SR-008 fixes (outside loop accounting; the SR-008 fix also repaired a NUL byte that was physically missing from the `fix\u0000alert` vector — as committed, the row had asserted a valid ASCII input to be S3-invalid).
- Pre-loop snapshot: `docs/specs/reviews/create-branch-tool-2.pre-loop.bak`. To roll back, copy the snapshot over the spec — never `git restore` on the spec.
- Nothing was committed by the loop.
