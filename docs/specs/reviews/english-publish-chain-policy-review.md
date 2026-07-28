# Spec-review loop report — english-publish-chain-policy.md

**Run:** 1 · **Mode:** default (interactive, batch-approve gated) · **Budgets used:** 3/3 iterations, 27/60 dispatches, ~3950 s active (default 1800 s exhausted after the round-2 quorum; the operator explicitly extended the time budget at an AskUserQuestion gate to finish the round-2 fixes and the final round-3 panel) · **Terminal status:** **CONVERGED** · **Verdict label:** Re-reviewed (advisory)

Every verdict is advisory: the oracle is panel verdict + challenger survival, which cannot
verify user intent, external facts, or unstated requirements.

## Round 1 — panel: internal-consistency, ambiguity-testability, completeness, feasibility, contracts

Units: the spec's nine `##` sections. Panel rationale: cores always on; completeness (9
sections); feasibility (plugin feature verified against the repo); contracts (module API +
normative error templates + schema copy are agent-facing interfaces). Excluded:
doctrine-compliance (no closed-loop design), ux (no UI surface).

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-001 doctrine sentence overstates gate scope | major | IC | applied (challenger upheld 1/1) |
| SR-002 listed tokens `stare`/`dane` violate collision rule | critical | IC+FE+CO | applied (upheld 2/2; both challengers graded the `dane` half weaker but endorsed removal) |
| SR-003 AC-3 reference collides with local AC-3 | minor | IC+AT | applied |
| SR-004 AC-1 cites §4 for vectors located in §7 | minor | IC+AT | applied (its single AC-1 pair also landed SR-005's AC-1 half) |
| SR-005 av_commit zero-spawn claim false at pinned hook | major | AT+FE | applied (upheld 1/1 — charitable reading rescues §4 but not AC-1) |
| SR-006 collision corpus underspecified | minor | AT+CP | applied (its §7 fixture pair also satisfied SR-002's seed extension) |
| SR-007 no criterion verifies module set matches §3.2 | minor | AT | applied — **re-found in round 2** |
| SR-008 ticket ids and quoted artifacts gated on subject/title | major (needs-decision) | CP | **refuted** (taskId/`id` are the exempt identifier channels; `COMMIT_HEADER` already rejects `Revert "…"`/`Merge …` subjects; commit.md routes ids via id/taskId) |
| SR-009 diacritics premise false on commit/PR surfaces | major (needs-decision) | FE | applied — **operator decision:** variant (a), diacritic folding (`ł`→`l` + NFD + combining-mark strip) |
| SR-010 AGENTS.md anchor missing, commit.md copy stale | minor | FE | applied |
| SR-011 av_commit schema copy unscoped to subject | minor | CO | applied |

Operator decisions this round: SR-009 → accepted variant (a); fix batch (8 groups, 19 edit
pairs) approved in full at the diff gate.

## Round 2 — same panel, fresh instances

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-012 id-exemption scope inconsistent across sections | major (needs-decision) | AT | **refuted** (§1 enumerates ungated *fields*; §6's "never translated" is a writing directive to the agent, not gate behavior; an id-skipping build would be an unforced invention against three normative sections) |
| SR-007 *(re-found)* literal count absent → self-referential size check | major | AT+CO | applied (upheld 1/1; fixed with literals 221 = 76 + 113 + 32, verified twice: orchestrator script + fixer re-count) |
| SR-013 `ł`→`l` fold must pin the global flag | major | FE | applied (upheld 1/1 — challenger traced both §7 folding vectors passing under a broken non-global build; discriminating vector added) |
| SR-014 commit.md error-contract sentence untouched by reconciliation | minor | FE | applied |
| SR-015 out-of-tool branch creation bypass undisclosed | minor | FE | applied (§8 disclosure bullet) |
| SR-016 collision fixture seed missing `testy` | minor | IC+CP+CO | applied |
| SR-017 rule 3 contradicts function-words group | minor | IC | applied |

Fix batch (6 groups, 13 edit pairs) approved in full at the diff gate. The default 1800 s time
budget was exhausted after this round's quorum; the operator extended it rather than stopping.

## Round 3 — same panel, fresh instances (final permitted round)

| SR | severity | lenses | outcome |
|---|---|---|---|
| SR-018 per-group counts unobservable through flat set export | major | AT+CO | **refuted** (§3.2's normative sentence pins a singular literal count + spot-checks; the parenthetical is the derivation of 221; group knowledge already normatively lives in the test file — no API delta follows. Two other panel lenses had independently self-falsified the same candidate.) |
| SR-019 AC-3 omits the commit.md reconciliation edits | minor | IC | reported-only |
| SR-020 §1 scope line undercounts the §7 vector set | nit | IC | reported-only |
| SR-021 body-exemption vector carries no listed token | minor | AT | reported-only |
| SR-022 §6 reconciliation mis-anchors S9 to the create_pr bullet | minor | FE | reported-only |
| SR-023 folded-token error contract implicit in §4 | minor | CO | reported-only |
| SR-024 collision fixture format unspecified | minor | CO | reported-only |

The completeness lens returned **zero** findings. Significant set empty after the SR-018
refutation; zero unlanded fixes; zero unconfirmed entries → **CONVERGED** before the fix phase
(the spec is byte-identical to what this panel reviewed, sha256 `bbad931a…`).

### Reported-only backlog (minor/nit — for the implementation plan to pick up)

1. **SR-019:** extend AC-3 to cover every §6 `commit.md` reconciliation edit.
2. **SR-020:** reword the §1 test-scope bullet to "at least one reject + one accept vector per
   surface (plus the `create_branch` id-exemption vector)".
3. **SR-021:** make the av_commit body-exemption vector carry a listed token in the body (e.g.
   body containing `naprawa`) so the test actually discriminates.
4. **SR-022:** re-anchor the §6 reconciliation: the "offending value is JSON-encoded" sentence
   belongs to the `create_pr` bullet (T4 note there); the `create_branch` bullet needs its own
   S9 note in the per-segment enumeration.
5. **SR-023:** state in §4 that `<token>` is the *folded, lowercased* form (may differ from the
   caller's spelling), and pin the token in the create_pr vector.
6. **SR-024:** give the collision fixture a normative format (one lowercase folded token per
   line, `#` comments, entries validated against `/^[a-z0-9]{3,}$/` before intersecting).

## Coverage

- Catalog lenses not selected this run: doctrine-compliance (the spec designs no closed loop,
  agent, or marketplace-plugin *orchestration* — the loop-engineering bar's items address loop
  design), ux (no UI surface).
- Not returned (failures): none — all 15 reviewer dispatches, 10 challenger dispatches, and 2
  fixer dispatches returned valid output on the first attempt. No shallow-coverage warning.
- Standing oracle blind spots: user intent, external facts, unstated requirements. Specifically
  unverifiable here: whether the curated 221-token list matches the operator team's actual
  vocabulary leakage, and whether the English-word judgments behind the collision rule are
  complete (both are curation judgments, not derivable from the spec).
- Recording deviation (disclosed): round-1 rejected candidates are verbatim in the sidecar;
  rounds 2–3 are summarized there (per-lens counts + representative notes) with the full
  verbatim lists preserved in the review-loop conversation transcript. Nothing was dropped from
  adjudication; every reviewer's rejected list was read and screened for candidates other
  lenses upheld (one such case — the per-group-count candidate — was AT/CO-upheld, merged as
  SR-018, and challenger-refuted).

## Rejected by the panel (self-falsification, highlights)

Sixty-plus candidates were self-falsified across the three rounds (round 1: 59, round 2: 80,
round 3: 84 — per-lens counts in the sidecar). Recurring ghost classes, so future reviewers
recognize them:

- [multiple] token-casing of the reported `<token>` — settled by §3's lowercase-then-match
  pipeline and §7's pinned `obsluga`/`bledu` vectors.
- [multiple] "subject" scope (whole first line vs post-`type(scope):`) — settled by §4's "first
  line of the trimmed message".
- [multiple] fixture file format / doc placement / test-file layout — implementation-plan
  detail by mandate.
- [feasibility, repo-verified] rule-id continuations free (S9, T4); AGENTS.md anchor exists
  (`## Plugin-tool enforcement model`, :369); commit.md reconciliation strings present
  verbatim; spawn ordering verified line-level (validateTitle:116 < runGit:135;
  normalizeCommitMessage:91 after 63/77/85); NFD decomposes every Polish diacritic except `ł`;
  the 221 tokens grep-clean over existing tests; no test pins `describe()` strings.
- [multiple] camelCase / non-Latin-script evasion and CC-type-keyword false positives —
  accepted residual risk (§8) or empirically absent from the list.
- [round 3, all lenses] the literal counts re-verified independently: 76 + 113 + 32 = 221, no
  duplicates, empty intersection with the fixture seed, all ten rule-2 exclusions present in
  the seed.

## Accepted risks (user-decided)

None (no keep-as-is decisions were taken).

## Declined (user-decided)

None (both fix batches were approved in full).

## Residual risks

- The oracle is soft: panel + challenger verdicts are LLM judgments; a systematic blind spot
  shared by all lenses survives the loop (verifier gaming / stochasticity / lens drift).
- No token ceiling was enforced; the time budget required one operator extension.
- Registry matching is semantic (orchestrator-judged equivalence), so a re-found defect could
  in principle be mis-linked; every equivalence verdict is logged in the sidecar.
- Headless-interactivity detection is best-effort (this run was interactive throughout).
- The spec's own accepted limitations (§8): the stoplist is an incomplete heuristic; other
  languages pass; out-of-tool branch creation bypasses the gate.

## Recovery

- Loop-touched files (all uncommitted, per contract): `docs/specs/english-publish-chain-policy.md`
  (revised through two approved fix batches), this report, and the sidecar
  `docs/specs/reviews/english-publish-chain-policy-review.state.json`.
- Pre-loop snapshot: `docs/specs/reviews/english-publish-chain-policy.pre-loop.bak` (kept
  untracked, never committed). To roll back, copy the snapshot over the spec — never
  `git restore` on the spec (the pre-loop commit `e3eadff` predates the loop's fixes).
