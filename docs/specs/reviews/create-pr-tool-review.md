# Spec-review loop report — create-pr-tool.md

**Run:** 1 · **Mode:** default (interactive, batch-approve gated) · **Budgets used:** 4/4 iterations (operator-extended from 3), 33/60 dispatches, ~2720s/3000s active (operator-extended from 1800s at the round-3 challenger boundary) · **Terminal status:** CONVERGED · **Verdict:** Re-reviewed (advisory)

**Scope note (operator-approved deviation):** the target spec lives in `docs/specs/` (repo convention), not the command's default `docs/superpowers/specs/`; loop artifacts live in `docs/specs/reviews/`.

## Round 1 — panel: internal-consistency, ambiguity-testability, completeness, feasibility, contracts, doctrine-compliance

Units: all nine `##` sections. Panel rationale: two core lenses; completeness (>3 sections); feasibility + doctrine-compliance (marketplace-plugin trigger, doctrine calibrated for a non-loop tool); contracts (tool/provider schemas). Cap 6.

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-001 | minor | internal-consistency | applied |
| SR-002 | minor | internal-consistency | applied |
| SR-003 | minor | ambiguity-testability | applied |
| SR-004 | minor | ambiguity-testability | applied |
| SR-005 | major | contracts | applied |

SR-005 (resolved head never trimmed — raw `--show-current` stdout would fail R1 on every real call) was challenger-upheld with repo evidence (`defaultGitRunner` returns untrimmed stdout; call sites trim). Batch of 12 pairs approved in full at the gate.

## Round 2 — same panel (fresh dispatch)

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-006 | nit | internal-consistency | applied |
| SR-007 | major (needs-decision) | ambiguity-testability | applied |
| SR-008 | minor | ambiguity-testability | applied |
| SR-009 | critical | contracts | applied |

SR-009 (NFR-6 asserted title/body in the returned JSON, contradicting FR-10's closed contract pinned by AC-3's "exactly") — upheld by both challengers. SR-007 (empty-after-trim `base`: provided vs omitted) — upheld; **user decision:** empty-after-trim counts as omitted → auto-resolve (mirrors the taskId/create_branch family precedent). Batch of 7 pairs approved in full.

## Round 3 — same panel (fresh dispatch)

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-010 | major | feasibility | applied |
| SR-011 | nit | ambiguity-testability | applied |
| SR-012 | major | contracts | applied |

Both majors challenger-upheld: SR-010 (a `defaultGhRunner` mirroring `defaultGitRunner` verbatim converts spawn-ENOENT to `exitCode: NaN` with empty stderr, making FR-9's install message unreachable in production while AC-8 stays green against a throwing double — C-1's citation of the exact lossy block invited the verbatim mirror) and SR-012 (origin URL from `remote get-url` reached `detectProvider` untrimmed; an anchored §5.4 implementation fails G4 on every real GitHub origin, and neither unit nor integration tests could catch it). The time budget expired at this round's challenger boundary; the operator extended it (3000s) and raised the iteration cap to 4 rather than stopping. Batch of 5 pairs approved in full.

## Round 4 — same panel (fresh dispatch, final permitted round)

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-013 | minor | ambiguity-testability | reported-only |

Zero significant findings, zero unlanded fixes, zero unconfirmed entries → **CONVERGED** (terminated before any fix phase; the round's minor is reported-only per contract).

**SR-013 (reported-only in the loop, fixed post-loop):** AC-2 claimed "Every §5.4 vector produces the stated result from `detectProvider` directly", but the raw-trailing-newline vector added by the SR-012 fix is annotated as a caller-path row (FR-5 trims first). A literal AC-2 test on that row fails or tempts the implementer to move trimming into `detectProvider`. The panel's proposed fix (scope AC-2 to direct inputs; assert the newline row at the FR-5 caller level, with `detectProvider` on the untrimmed string returning `undefined`) was **applied manually by the operator session after the loop terminated** — outside the loop's accounting, so its outcome enum stays `reported-only`.

## Coverage

- Catalog lenses not selected this run: `ux` (no UI surface in the spec).
- Not returned (failures, with reasons): none — all six lenses returned valid JSON in all four rounds; no reviewer, challenger, or fixer retries were needed.
- Standing oracle blind spots: user intent, external facts (live `gh`/GitHub behavior was reviewer-verified, not executed), unstated requirements.

## Rejected by the panel (self-falsification)

Across the four rounds the panel self-refuted **~150 candidates**; every one is recorded verbatim in the sidecar (`rounds[].rejected`). Recurring ghosts a future reader may re-derive (all refuted): `pushed` being always-true in returned results (type width, not a contradiction); AC-7's "throws / returns failure" phrasing (the `Promise<{url}>` type pins rejection as the only failure channel); the auto-resolved base not being R-validated (deliberate, injection-safe via single-token `--base=`); `PrProvider.name` having no consumer (inert descriptor); AC-16 omitting `runGh` (the "exposes exactly" clause governs); the §5.4 table order vs execution order (table keyed by id); loop-engineering bar items 3/4/6/7/9/10 (N/A for a single-invocation tool, each with a per-trigger justification).

## Accepted risks (user-decided)

None (no keep-as-is decisions were made).

## Declined (user-decided)

None (all three fix batches were approved in full).

## Residual risks

- Verifier gaming: reviewers and challengers are LLMs; a plausible-but-wrong refutation can retire a real defect. All verdicts are advisory.
- Stochasticity: a re-run panel may find different candidates; convergence is relative to this run's panels.
- Lens drift: reviewers may drift from their mandate despite single-lens prompts.
- No token ceiling: dispatch/time budgets bound the run, not token spend.
- Soft registry matching: SR identity uses orchestrator equivalence judgment; a false non-match can double-report, a false match can merge distinct defects.
- Best-effort headless detection: interactivity was model-judged (interactive session confirmed by live gates in this run).
- Domain residuals recorded in the spec itself (§6): ready-by-default PR notifications, fork/redirect targeting (`gh repo set-default`), gh-absent degradation.

## Recovery

- Loop-touched files: `docs/specs/create-pr-tool.md` (three approved fix batches applied; **changes are uncommitted**), `docs/specs/reviews/create-pr-tool-review.state.json`, `docs/specs/reviews/create-pr-tool-review.md`.
- Pre-loop snapshot: `docs/specs/reviews/create-pr-tool.pre-loop.bak` (spec as of commit `bd3594f`) — an uncommitted local working file, never checked into git; it exists only in the originating working tree, not in the repository's tracked tree. Where it is present, roll back by copying the snapshot over the spec — never `git restore` on the spec.
- Nothing was committed by the loop.
