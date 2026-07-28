# Spec-review loop report — 2026-07-28-zmora-timeout-budget-design.md

**Run:** 1 · **Mode:** default (interactive) · **Budgets used:** 3/3 iterations, 22/60 dispatches, ~65 min active
**Terminal status:** CONVERGED · **Verdict:** Re-reviewed (advisory)

## Round 1 — panel: internal-consistency, ambiguity-testability, completeness, feasibility

Units: Problem · Decision · Companion surfaces (same commit) · Testing · Non-goals.
Panel rationale: two core lenses; completeness (5 `##` sections); feasibility (spec
rests on many "already exists in repo" claims). doctrine-compliance excluded (the
spec tunes dispatch budgets, it does not design a closed loop); ux/contracts: no
surface.

| SR | severity | lenses | outcome |
|----|----------|--------|---------|
| SR-001 | major | internal-consistency, ambiguity-testability | applied |
| SR-002 | minor | ambiguity-testability | applied |
| SR-003 | major | completeness | applied |
| SR-004 | major | feasibility | applied |
| SR-005 | major (needs-decision) | feasibility | applied (user decision: document the risk) |
| SR-006 | minor | feasibility | applied |

All four majors survived their challengers (4× uphold). SR-005 (bindings-TTL ×
30-min ceiling interaction) went through the needs-decision gate; the user chose
"document the risk" over raising/refreshing the TTL or a bare Non-goals entry.
The full 6-entry batch was user-approved and applied.

## Round 2 — fresh panel, same lenses

| SR | severity | lenses | outcome |
|----|----------|--------|---------|
| SR-007 | major | internal-consistency, feasibility | applied |
| SR-008 | minor | internal-consistency | applied |
| SR-009 | nit | internal-consistency | applied |
| SR-010 | major | ambiguity-testability | refuted |
| SR-011 | minor | completeness | applied |
| SR-012 | minor | feasibility | applied |
| SR-013 | minor | feasibility | applied |

No round-1 entry was re-found (all six fixes held). SR-007 (silent-hang
"unchanged, as today" slot-hold falsehood) upheld by its challenger; SR-010
(task.name lookup-key ambiguity) refuted — the spec pins the key twice and a
scenario-label task name throws `Unknown agent` at dispatch, so the posited
silent no-op is structurally impossible. The 6-entry batch (5 groups) was
user-approved in full and applied.

## Round 3 — fresh panel, same lenses (final permitted round)

| SR | severity | lenses | outcome |
|----|----------|--------|---------|
| SR-014 | minor | internal-consistency, feasibility | reported-only |
| SR-015 | nit | internal-consistency | reported-only |
| SR-016 | minor | ambiguity-testability | reported-only |
| SR-017 | minor | ambiguity-testability | reported-only |
| SR-018 | nit | ambiguity-testability | reported-only |
| SR-019 | minor | feasibility | reported-only |

Zero majors; completeness returned zero findings. No round-1/2 entry re-found.
Convergence conditions all met — zero significant findings, zero unlanded
fixes, zero unconfirmed entries — so the loop terminated before a round-3 fix
phase. The six reported-only residuals, for a future editing pass:

- **SR-014** (minor): "no agent prompt can set a per-call timeout" is over-broad —
  `wait_background.timeoutMs` is prompt-settable on the background path; and
  `wait_background`/`dispatch_background` *default to* (not "hard-code")
  `DEFAULT_TASK_TIMEOUT_MS`. Scope the claim to `dispatch_parallel`.
- **SR-015** (nit): "### Unchanged semantics" now contains two accepted-risk
  *changes*; rename or split the subsection.
- **SR-016** (minor): Testing bullets don't pin assertion form — assert literal
  ms values (not the exported constants) and require "no `idleMs` key" for the
  `zmora-setup`/unknown-name default.
- **SR-017** (minor): "detection latency after activity stops is unchanged" is
  readable two ways; state that the inactivity window is unchanged but now runs
  from last sign of life (today: ≤5 min from dispatch, shorter the later the
  session dies).
- **SR-018** (nit): companion item 2's third pin should quote the current
  coordinator.md ~line 215 sentence verbatim with a full replacement sentence.
- **SR-019** (minor): companion item 1's quoted target clause is a parenthetical
  in the real `index.ts:170` string — a literal replace yields nested parens;
  re-quote the true source text and give the complete post-edit bullet.

## Coverage

- Catalog lenses not selected this run: doctrine-compliance (spec does not
  design a closed loop/agent — it tunes dispatch budgets), ux (no user-facing
  flow surface), contracts (no external API/schema).
- Not returned (failures): none — all four lenses returned valid JSON in all
  three rounds; no retries were needed.
- Standing oracle blind spots: user intent, external facts, unstated
  requirements.

## Rejected by the panel (self-falsification)

Round 1:
- [internal-consistency] "No mechanical changes anywhere else" vs index.ts edit — sentence scopes "mechanical" to mechanism; the edit is a description string.
- [internal-consistency] "Every place that pins" vs a possible 4th test pin site — test pins mirror doc strings, updated same commit.
- [internal-consistency] discarded-partial-result pain vs no-preservation Non-goal — explicit scope decision.
- [internal-consistency] "same shape as Veles" vs 30-vs-45-min backstop — shape vs values, derivation given.
- [internal-consistency] "must not start passing it" vs no perun.md edit — "Nothing passes it today" means no edit needed.
- [internal-consistency] 30-min ceiling vs 10–20-min observation — 20 + 50% headroom, consistent.
- [internal-consistency] Non-goals "no other agent's budget" vs two new overrides — "other" excludes zmora-fe/be.
- [internal-consistency] flat-5-min default vs 5-min idle constant — distinct bounds.
- [internal-consistency] "~5 min after going idle" vs busy-forever hang — folded into SR-001, same parenthetical.
- [completeness] poller idle-path selection undecided — Veles path stated; repo-fact question owned by feasibility.
- [completeness] exact vs normalized name matching — Veles precedent arbitrates; names asserted with citation.
- [completeness] no wave budget for 6× longer slots — qa-loop records state only; consequence booked in qa.md item.
- [completeness] no escape for >30-min scenarios — configurability deferred; timeout→SKIP fixed.
- [completeness] no partial-work preservation — Non-goals states it.
- [completeness] doctrine-test pin updates unspecified — delegated to planning.
- [completeness] BE backstop without BE data — decided explicitly; same cliff recorded.
- [completeness] keep-alive output decision missing — Sized values decides (busy probe).
- [completeness] no poller-uses-idle-path test — implementation detail; Veles path unchanged.
- [completeness] zmora-setup budget/variants undecided — enumerated and decided twice.
- [completeness] global ceiling clamp — Veles already runs 45 min.
- [completeness] ZMORA_* naming covers two variants — wording only.
- [completeness] idle-clock start for hung-from-dispatch — Behavioral result covers it.
- [ambiguity-testability] behavioral claims lack tests — delta under test is the lookup table only.
- [ambiguity-testability] success vs inert no-op indistinguishable — name match asserted with citation; qa-loop records state only.
- [ambiguity-testability] "must not start passing it" two readings — status quo compliant (pre-fix state).
- [ambiguity-testability] ~5/30-min tolerances unstated — constants fix exact values.
- [ambiguity-testability] backstop start point unstated — existing semantics govern.
- [ambiguity-testability] Zmora row vs zmora-setup — setup decided; overrides has two keys.
- [ambiguity-testability] no verbatim prose for items 2–3 — checkable acceptance criteria.
- [ambiguity-testability] no verification for doc edits — doctrine-pin check + full gate.
- [ambiguity-testability] "same shape" two-way — values-sized clause explains.
- [ambiguity-testability] timeoutMs–idleMs interaction — stated as pure wall-clock override.
- [ambiguity-testability] idleMs absent-vs-undefined — nit-level shape detail.
- [feasibility] qa-loop 1800-s budget exhaustion — elapsed_s never incremented; stop inert.
- [feasibility] dispatch_background path exposure — perun.md background-dispatches only triglav.
- [feasibility] busy probe may not cover Playwright calls — busy set at every step; Veles relies on it.
- [feasibility] ~5-min kill false for in-tool-call hangs — claim qualified "no sign of life".
- [feasibility] no drift pin for zmora keys — names match today; test hardening, not capability.
- [feasibility] 30-min call exceeds harness ceiling — identical path blocks 45 min for Veles.
- [feasibility] 1-s polling load — same load accepted for Veles.
- [feasibility] overrides break exhaustiveness assertion — only VELES_AGENT_KEY asserted.
- [feasibility] companion anchors may not exist — all verified at cited lines.
- [feasibility] SKIP-without-cascade stale — perun.md:305/:547 state it.

Round 2:
- [internal-consistency] Behavioral result omits busy-hang regression — Sized values names the busy-forever case.
- [internal-consistency] busy probe praised vs called regression — benefit for healthy calls, cost for stuck ones.
- [internal-consistency] Non-goals vs changing zmora-fe/be — "other" excludes the two changed.
- [internal-consistency] no-partial-results vs Problem pain — declared out of scope.
- [internal-consistency] TTL under "Unchanged semantics" — TTL semantics unchanged; only exposure grows.
- [internal-consistency] Core-change heading vs dispatch.ts re-exports — body names second file.
- [internal-consistency] "No changes to mechanism" vs edits — re-exports and strings are not mechanism.
- [internal-consistency] "Every place that pins" vs two further pins — enumerated in same section.
- [internal-consistency] taskTimeoutMs vs "override covers both" — nothing passes it.
- [internal-consistency] "no new configuration surface" vs escape hatch — pre-existing, TypeScript-only.
- [internal-consistency] no-bold note redundant — anti-regression note.
- [internal-consistency] Veles/Zmora "longer backstop" — no equality claim.
- [internal-consistency] run-qa.md vs "agent prompts need no edit" — command prompt is not an agent prompt.
- [internal-consistency] Testing shape vs constants — match exactly.
- [internal-consistency] backstop arithmetic — consistent.
- [ambiguity-testability] items 2/4 lack verbatim text — checkable acceptance bars.
- [ambiguity-testability] hung-session vs busy-hang — class defined; carve-out explicit.
- [ambiguity-testability] flat-default shape unspecified — unchanged code, same behavior.
- [ambiguity-testability] no criterion for verbatim string — doctrine-pin check covers.
- [ambiguity-testability] backstop reset-on-activity — "backstop" + Veles shape fix it.
- [ambiguity-testability] surface 3 lead sentence omittable — colon introduces full content.
- [ambiguity-testability] "the Zmora row" one vs two — singular arbitrates.
- [ambiguity-testability] re-export justification vs citation — names mechanism.
- [ambiguity-testability] "no edit" vs run-qa.md edit — scoped by citation.
- [ambiguity-testability] schema prohibition unverifiable — negative requirement.
- [ambiguity-testability] tuple syntax vs Map — mechanical translation.
- [ambiguity-testability] no end-to-end criterion — residual gap reported as the round's major (SR-010).
- [ambiguity-testability] headroom imprecise — 20 × 1.5 = 30 exactly.
- [completeness] task names vs override keys — design stated; factual check owned by feasibility.
- [completeness] no real-dispatch idleMs proof — test depth is plan detail.
- [completeness] items 2/4 verbatim — semantic content specified.
- [completeness] pool size unrevisited — scope fixed; documentation response decided.
- [completeness] no wave-level budget analysis — Non-goals records it.
- [completeness] background-dispatched zmora — all zmora flows through dispatch_parallel.
- [completeness] TTL mitigation missing — DECISION recorded; deferred.
- [completeness] doctrine pins unresolved — delegated.
- [completeness] BE data missing — decided.
- [completeness] setup not in docs row — derivable.
- [completeness] constant alias choice — no behavioral consequence.
- [completeness] hours-long-run guidance — figure updated; rest ux/deferred.
- [completeness] no rollback plan — two-constant override needs none.
- [feasibility] qa-loop budget collision — elapsed_s never incremented.
- [feasibility] background zmora keeps flat cap — no such path in repo.
- [feasibility] silent-hang is really busy-hang — separated and disclosed.
- [feasibility] 30-min call ceiling — Veles blocks 45 min in production.
- [feasibility] keys vs registered names — registration and Step 5f verified.
- [feasibility] no drift-pin test — out of lens.
- [feasibility] "hard-code" loose — load-bearing claim verified (noted again in R3 as SR-014).
- [feasibility] broken status endpoint kills silent step — pre-existing Veles behavior.
- [feasibility] taskTimeoutMs from prompt — schema verified.
- [feasibility] description-string pin breaks gate — nothing pins it.
- [feasibility] setup default kills long recipes — run-bash caps steps at 30 s.
- [feasibility] "since last write" vs "from mint" — both accurate for minted entries.

Round 3:
- [internal-consistency] "Every place that pins" vs wait_background describe — enumerated as verified-untouched.
- [internal-consistency] comparability vs slot-hold regression — scoped to hung-from-start.
- [internal-consistency] busy probe rationale vs risk — one mechanism, both effects recorded.
- [internal-consistency] shape vs values — anticipated divergence.
- [internal-consistency] mechanism claim vs edits — not mechanism.
- [internal-consistency] heading vs second file — body explicit.
- [internal-consistency] Non-goals vs overrides — "other" excludes targets.
- [internal-consistency] scenario-per-task vs name resolution — internally consistent.
- [internal-consistency] override coverage vs background — dispatch_parallel only.
- [internal-consistency] no-bold note — redundant, not contradictory.
- [internal-consistency] cross-reference to surface 3 — verified correct.
- [internal-consistency] sizing arithmetic — agrees everywhere.
- [internal-consistency] "longer backstop" lumping — no equality claim.
- [ambiguity-testability] idle-constant reuse — code block declares it.
- [ambiguity-testability] row coverage of setup — stated twice.
- [ambiguity-testability] hard-wrapped verbatim sentence — reflow convention; markup preempted.
- [ambiguity-testability] exact vs prefix matching — stated; repo check is feasibility's.
- [ambiguity-testability] no behavioral tests — unchanged mechanism.
- [ambiguity-testability] schema invariant not automated — checkable by inspection.
- [ambiguity-testability] outcome-level rewrites — load-bearing content pinned.
- [ambiguity-testability] pin check self-fulfilling — guards future drift.
- [ambiguity-testability] escape hatch vs idleMs — settled.
- [ambiguity-testability] artifacts not precisely located — identifiable lookup.
- [ambiguity-testability] re-export unasserted — exercised by construction.
- [ambiguity-testability] BE sizing — stated decision.
- [ambiguity-testability] latency contradiction — filed once, in ambiguity form (SR-017).
- [completeness] key coupling — stated; Veles precedent.
- [completeness] backstop start point — delegated to unchanged mechanics.
- [completeness] enclosing budget — no new decision.
- [completeness] row scope — derivable.
- [completeness] non-verbatim surfaces — plan detail.
- [completeness] prompt awareness / keep-alive — rationale + recorded no-op.
- [completeness] pool size — accepted risk; concurrency untouched.
- [completeness] busy-hang escape hatch — explicit accepted risk.
- [completeness] TTL recovery — recorded accepted risk.
- [completeness] mis-sizing telemetry — PollerTimeoutError.reason.
- [completeness] taskTimeoutMs precedence — stated.
- [completeness] >30-min healthy scenario — semantics stated.
- [completeness] missed qa-loop pin — implementation work.
- [completeness] doctrine pins — delegated.
- [feasibility] qa-loop budget — stop inert.
- [feasibility] harness ceiling — 45-min precedent + 20-min test.
- [feasibility] key drift pin — test-design gap, not capability.
- [feasibility] "output growth" vs byte-change test — realistic direction; same wording shipped.
- [feasibility] busy-answering dead Playwright — separated accepted risk.
- [feasibility] sdk-specialist.ts:78 comment — internal, not doctrine surface.
- [feasibility] post-sweep paste acceptance — verified true, supports spec text.
- [feasibility] run-scoped pins — wave-scoped verified (finally release).
- [feasibility] "since last write" vs "from mint" — both hold for minted entries.
- [feasibility] taskTimeoutMs via dispatch_parallel — args verified.
- [feasibility] residual 5-minute figure in prompts — greps return none.
- [feasibility] barrel re-export — verified true.

## Accepted risks (user-decided)

None (no keep-as-is decisions). Note: the spec itself now records two accepted
risks as content — the bindings-TTL constraint (SR-005, user decision
"document the risk") and the busy-hang slot hold (SR-011) — both with explicit
DECISION lines and Non-goals entries.

## Declined (user-decided)

None — both fix batches were approved in full.

## Residual risks

- Verifier gaming: reviewers and challengers are LLMs; a plausible-but-wrong
  refutation can kill a real finding (SR-010's refutation rests on repo facts
  that were independently verified, but the pattern stands).
- Stochasticity: a different panel draw could surface different findings; three
  rounds of fresh panels mitigate but do not eliminate this.
- Lens drift: reviewers may grade slightly off their mandate despite the
  self-falsification pass.
- No token ceiling: dispatch and iteration caps bound the loop, not token
  spend per agent.
- Soft registry matching: cross-round identity is an orchestrator judgment;
  merge decisions are logged but not independently verified.
- Best-effort headless detection: interactivity was model-judged.
- Six reported-only residuals (SR-014…SR-019, all minor/nit) remain unfixed by
  design — the loop converged before a round-3 fix phase.

## Recovery

- Loop-touched files: `docs/superpowers/specs/2026-07-28-zmora-timeout-budget-design.md`
  (two applied fix batches), this report, and the sidecar
  `2026-07-28-zmora-timeout-budget-design-review.state.json`.
- Pre-loop snapshot: `docs/superpowers/specs/reviews/2026-07-28-zmora-timeout-budget-design.pre-loop.bak`
  — restore by copying it back; never `git restore` on the spec (it was
  uncommitted when the loop started).
- Nothing was committed by the loop.
