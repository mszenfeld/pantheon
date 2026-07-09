# Pattern-Pack Reflection — Native Harness Design

**Date:** 2026-07-09
**Branch:** `feat/pattern-pack-reflection` (based on `master` @ `b81cd76` — PR #14 merged, provisionable-qa-plans content in HEAD)
**Source pattern:** av-marketplace branch `feat/pattern-pack-skills` (28 commits, 27 files, +507 lines)

---

## §1 Context — what the source branch introduced

The av-marketplace branch establishes a new artifact genre: **pattern-pack doctrine skills** — small, single-concern discipline skills sharing a fixed shape:

- trigger-only frontmatter `description` ("Use when …"),
- a numbered **minimum bar (MUST)**,
- named **anti-patterns**,
- a worked example marked *(Prospective)* when no conforming implementation exists,
- a paste-able **review checklist**,
- explicit **ownership boundaries** between skills ("cite by pointer, never transcribe" — a transcribed enumeration is a second drift site),
- **recorded exemptions** instead of silent non-compliance.

Five skills were added and wired (agent `skills:` frontmatter preload → per-agent output-format extensions → orchestrator transit → challenger spot-check/reinstatement → fix-pipeline policy filter):

| Skill | Plugin | One-line essence |
|---|---|---|
| `finding-falsification` | code-review | Every finding survives a 6-check self-refutation battery; rejected work stays visible (3-bucket disposition) |
| `verdict-protocol` | code-review | Closing contracts: closed verdict vocabulary, computed-not-chosen, exhaustion ≠ success ≠ failure |
| `docs-fact-registry` | code-review | Docs↔code drift as declarative registry; mechanical/decision/dead-reference; `Fix-policy` flows to the fix pipeline |
| `reader-context-hygiene` | qa | Fan-out readers: bulk to disk, signals inline as named fields, fail-closed, idempotent, declared truncation |
| `state-combination-modeling` | frontend-developer | ≥2 independent boolean inputs → enumerate full 2^N, prove "impossible", never collapse axes |

## §2 Goal

Reflect four of the five patterns in Pantheon's **native harness** (Perun / Veles / Triglav / Stribog / Svarog / Zmora + qa-loop + skill-registry + doc-guard tests), each landed in the mechanism its consumer already uses — not as a mechanical copy of the marketplace's delivery format.

## §3 Scope decisions (user-approved)

**In scope:**

1. `state-combination-modeling` → adapted as a **new registry skill** `state-combination-planning`, conditionally loaded by Veles during plan authoring.
2. `verdict-protocol` + `reader-context-hygiene` → adapted into a **doctrine document** `docs/plugins/agent-contracts.md` + doc-guard test + a roster conformance audit with prompt-only fixes + `triglav.md` conformance edits.
3. `finding-falsification` → adapted as a **FAIL refutation battery** woven into `fe-testing` and `be-testing` skills (Zmora's execution path).
4. Depth: **doctrine + wiring** — artifacts are authored AND applied to the agents that consume them. Doc-guard tests pin the sync.

**Out of scope (recorded with rationale):**

- **`docs-fact-registry` natively.** Pantheon's doc-guard vitest suites (`tests/docs/*.test.ts`) are already a checked-in, *executable* fact registry — a stronger mechanism than a per-run prose registry. Reviews of this repo run via the marketplace code-review plugin (≥1.17.0), which now carries the skill itself. Re-deriving it natively would duplicate both.
- **Syncing the package ports** (`packages/code-review`, `packages/frontend-developer`) with the upstream pattern-pack commits. The ports are structurally divergent (marketplace skills became subagents; no `/fix-all`); an upstream sync is a separate, sizeable work item. See §11.
- **TypeScript harness changes.** No schema, hook, or module-code changes. New files under `tests/` are test-only. (Future code-level enforcement was considered and deliberately deferred — see §11.)

## §4 Design principle — form follows consumer

Pantheon has three doctrine mechanisms; each pattern lands in the one its consumer already uses:

| Pattern | Consumer | Mechanism |
|---|---|---|
| state-combination planning | Veles, at plan-authoring time | Registry skill, **conditionally** loaded via `skill(name:)` (mirrors Veles loading `test-plan-format` on demand) |
| verdict protocol + reader contract | Repo development (agent-prompt authoring/review) | Doctrine doc + doc-guard test (mirrors `docs/plugins/qa-loop-engineering.md`) |
| FAIL refutation battery | Zmora, at scenario-execution time | Woven into the skills Zmora already loads (`fe-testing`, `be-testing`) — zero additional loads |

This intentionally rejects two uniform alternatives: all-as-registry-skills (authoring-time doctrine would sit unloadable in the runtime catalog — dead weight), and all-woven (2^N doctrine would tax every plan run through the already-648-line `qa-plan-authoring`).

## §5 Leg 1 — `state-combination-planning` registry skill

### §5.1 Name — why not `state-combination-modeling`

`buildSkillCatalog` (packages/skill-registry) **throws on duplicate skill names across all scanned directories**, which include `packages/frontend-developer/dist/skills`. A future upstream sync of the frontend-developer port will bring in `state-combination-modeling` (added on the source branch). Reusing that name would make the future sync a load-time crash. The native skill is also a genuinely different artifact — test-*design* doctrine, not component-*implementation* doctrine — so it gets its own name: **`state-combination-planning`**.

### §5.2 File and content

`src/skills/qa/state-combination-planning/SKILL.md` (~50 lines, pattern-pack shape). Authoritative draft:

```markdown
---
name: state-combination-planning
description: Use when authoring QA scenarios for behavior driven by two or more independent boolean inputs (feature flags, permissions, connection states) — enumerate the full 2^N product as a scenario matrix, prove any "impossible" combination, never sample just the main paths.
---

# State Combination Planning

## The problem, and when to load this skill

When N independent boolean inputs drive the behavior under test, the state
space is 2^N — but plans written path-by-path silently cover only the
combinations their author pictured. The classic escape: a feature that works
with the flag ON for an admin and OFF for a viewer, and breaks with the flag
ON for a viewer — the combination nobody planned. Load this skill whenever
the change under test is driven by ≥2 independent boolean inputs.

## The minimum bar (MUST)

1. **Enumerate the full 2^N product** of the independent boolean inputs as a
   literal table in the plan (a note above the affected scenarios). The table
   is cheap; the unplanned combination is not.
2. **Classify each combination real / impossible — and prove "impossible".**
   An `impossible` classification must cite a domain invariant (from code or
   docs, with a pointer) or an explicit user/plan confirmation.
   **Unconfirmed → treat as real.**
3. **One scenario per real combination.** A real combination without a
   scenario is an unmodeled state; sampling "the two main ones" from a 2^3
   space is the anti-pattern this skill exists to kill.
4. **Never collapse independent axes in Expected.** A scenario's Expected
   describes what each input governs separately (content vs actions) — an
   Expected written against a synthetic single "status" deletes combinations
   the product can genuinely produce.

## Anti-patterns

- **Sampled coverage** — planning 3 scenarios for a 2^3 space and calling it
  covered.
- **Unilateral "can't happen"** — no invariant cited, no confirmation asked.
- **The synthetic status** — Expected written over `viewing | editing |
  offline` when the real inputs are `isConnected × canEdit`.

## Worked example

Inputs: `isConnected`, `canEdit` → 2^2 = 4:

| isConnected | canEdit | Classification | Scenario |
|---|---|---|---|
| yes | yes | real | FE-xx: live view, edit enabled |
| yes | no | real | FE-xx: live view, read-only |
| no | yes | real (confirmed in plan) | FE-xx: offline banner, edit queued/disabled |
| no | no | real | FE-xx: offline banner, read-only |

Four scenarios, one per row. The tempting three-branch plan (online-edit,
online-view, offline) deletes row 3 — the combination a field user hits first.

## Review checklist

- [ ] 1. All independent boolean inputs identified
- [ ] 2. Full 2^N table present in the plan (literal, not sampled)
- [ ] 3. Every `impossible` cites an invariant or explicit confirmation
- [ ] 4. Unconfirmed combinations treated as real
- [ ] 5. One scenario per real combination
- [ ] 6. No Expected collapses independent axes into one synthetic status
```

### §5.3 Wiring (Veles)

`src/skills/qa/qa-plan-authoring/SKILL.md`, **Step 6: Generate scenarios** — add one trigger rule (exact anchor resolved against the live file at implementation-plan time):

> If the change under test is driven by **two or more independent boolean inputs** (feature flags, permissions, connection/loading states), load `skill(name: "state-combination-planning")` and apply its bar to the scenario matrix before writing the affected scenarios.

Cost is conditional: plans for single-axis changes never load the skill.

### §5.4 Registration and tests

- Registration is automatic: `scripts/copy-root-assets.mjs` copies `src/skills` → `dist/skills` on build; the registry scans `dist/skills/qa`.
- New `tests/skills/state-combination-planning.test.ts` (model: `tests/skills/qa-plan-authoring.test.ts`): frontmatter `name` is `state-combination-planning`; description starts with "Use when"; body contains `2^N`, `impossible`, `invariant`, the 4-row example table marker, and the checklist.
- Extend `tests/skills/qa-plan-authoring.test.ts`: Step 6 contains the literal `state-combination-planning` trigger.

## §6 Leg 2 — `docs/plugins/agent-contracts.md` doctrine + audit + Triglav

### §6.1 The document

`docs/plugins/agent-contracts.md` (~150–200 lines), two sections with explicit ownership, each ending in a paste-able checklist.

**Section A — Verdict protocol (closing contracts).** Adapted bar:

1. **Closed vocabulary** — every reporting agent's definition declares an enumerated verdict/status set; free-text closers are invalid.
2. **Computed, not chosen** — each value declares its deciding predicate; an agent cannot hand-pick a success value while failing conditions stand.
3. **Exhaustion semantics** — budget/round exhaustion is its own outcome, distinct from success and failure. Reference implementation: `RunResult.BudgetExhausted` in `src/modules/qa-loop/types.ts`.
4. **Caveated verdicts route their remainder** — a pass scoped to what was verifiable names the unverified rest. Reference: `RunResult.NotVerified`.
5. **Consumer routing** — for every value, the consumer's (Perun's / the qa-loop's) reaction is defined at authoring time.
6. **Machine-locatable** — the verdict is a fixed-vocabulary token in a structured payload or a fixed-format line, never buried in prose.

The marketplace's Required/Advised/Optional triage-axis rider is recorded as **not adopted**: Pantheon's qa-loop already separates "does this block?" from "how bad?" via `severity_floor` config + `IssueStatus` lifecycle; adding a third axis would duplicate that machinery.

Section A includes a **roster conformance table** (filled by the §6.3 audit): agent × {vocabulary, predicates, exhaustion, routing} with file pointers — Zmora (`PASS/FAIL/SKIP/NEED_INFO`), Svarog (`READY/FAIL/ESCALATE`), Stribog (result + `ESCALATE`), Veles (plan saved / error), Triglav (a reader, not a verdict agent — cross-reference to Section B).

**Section B — Reader contract (context hygiene).** Adapted bar for fan-out readers:

1. **Signals inline as named fields** — every decision-relevant status the orchestrator will act on is a named field in the return message, never buried in an artifact or prose.
2. **Bulk never inline** — no file bodies, no dumps; evidence is referenced by path.
3. **Fail-closed access** — source unreachable/unreadable → STOP with a diagnostic; never synthesize missing content.
4. **Idempotent artifacts** — re-runs overwrite; no timestamped accumulation. Reference implementation: Zmora's ID-embedded artifact filenames (`FE-04-fail.png`), which exist precisely to keep re-runs collision-free.
5. **Declared truncation** — a capped result names the cap and what was skipped; silent truncation reads as full coverage.

**Recorded caveats** (mirroring the marketplace's recorded-exemption practice):

- **Triglav is read-only** — the marketplace's "bulk to disk" bar does not apply; for Triglav, bulk is simply forbidden inline (bar 2) with the cap declared (bar 5).
- **Zmora returns results inline per-scenario** — an aggregation constraint of the QA run contract; the spirit of the bar lives in the evidence rules (artifacts to disk, referenced by path).

**Ownership boundaries:** this document owns closing-contract and reader-contract doctrine only. It cites by pointer — never transcribes — the report file format (`report-format` skill), loop doctrine (`docs/plugins/qa-loop-engineering.md`), and Zmora result templates (`fe-testing`/`be-testing`).

### §6.2 `triglav.md` conformance edits

`src/modules/explore/triglav.md`:

1. Add a named truncation field to the `<results>` skeleton — a `truncation:` line as the **last line inside the `<files>` block**, stating either `none` or `capped at N files — long tail summarized in <answer>`. Today the cap exists but is not surfaced as a named signal (bar B5).
2. Add an explicit fail-closed sentence to the Output section: findings must come from tool observations; if a source cannot be read, say so in `<answer>` — never synthesize what it "probably" contains (bar B3). The existing serena-fallback rule is degradation, not access failure, and stays as-is.

The rest of Triglav's contract already meets the bar (absolute paths, no emojis, 15–20-file cap, no file bodies) and is cited in Section B as partial reference.

### §6.3 Roster conformance audit (this branch, prompt-only)

Run the Section A checklist over: `src/modules/qa/prompt-sections/core.md` + overlays, `src/modules/svarog/svarog.md`, `src/modules/stribog/stribog.md`, `src/modules/plan/veles.md`. Fix gaps **in prompts only** (e.g., a status value whose deciding predicate is implied but never stated). No TS schema changes; if the audit surfaces a gap that would require one, it is recorded in the doctrine doc as a known limitation instead (the doctrine-gap practice from the source pattern). Known tension to resolve during the audit: be-testing's "connection refused → FAIL" vs core.md's `NEED_INFO kind=service` — see §7.2.

### §6.4 Doc-guard test

`tests/docs/agent-contracts-doctrine.test.ts` (model: `tests/docs/loop-engineering-doctrine.test.ts`):

- doc exists;
- contains the roster verdict vocabularies: `PASS`, `FAIL`, `SKIP`, `NEED_INFO`, `READY`, `ESCALATE`, `BudgetExhausted`, `NotVerified`;
- contains the bar-term tokens (case-insensitive matches; each appears verbatim in the §6.1 bar text): `fail-closed`, `truncation`, `named fields`, `computed, not chosen`, `exhaustion`;
- pins triglav sync: `src/modules/explore/triglav.md` contains `truncation:` and a `synthesize` prohibition (the two §6.2 edits), so the doc and the agent prompt cannot drift apart silently.

## §7 Leg 3 — FAIL refutation battery (Zmora)

### §7.1 The battery (marketplace 6 checks → 4, per-scenario)

Added to `fe-testing/SKILL.md` and `be-testing/SKILL.md` as a subsection adjacent to each skill's result-format/error-handling rules. Before returning `FAIL`, run:

1. **Re-verify the observation — once, deterministically.** Take a fresh snapshot / repeat the identical request one time. This targets *observation integrity* (stale DOM read, race between action and assertion), and is explicitly **not** retry-until-pass: one re-check, then disposition. If the two observations disagree, record **both** in the evidence and apply the per-stack rule:
   - *fe-testing:* first read failed, fresh snapshot passes → the initial read was a tester-side race → `PASS` with the discrepancy noted in evidence.
   - *be-testing:* identical requests return different results → non-determinism is itself an application defect → `FAIL` with both responses recorded.
2. **Environment artifact?** If the failure is a missing prerequisite (env var, service, fixture, tool) → `NEED_INFO` with the matching `kind`, not `FAIL`. Liveness distinction: a service that was **never reachable** in this scenario → `NEED_INFO kind=service`; a service that **answered earlier in the scenario and then died** → genuine `FAIL` (the app crashed under test).
3. **Deliberate omission?** If the "failing" behavior is explicitly out of the scenario's scope (its Expected, the plan's `## Setup`, or a recorded plan note) → follow the existing `SKIP`/`NEED_INFO` rules, not `FAIL`.
4. **Harness error?** Tool timeout, Playwright MCP failure, selector unreachable because the tester never completed its own navigation → error result or the skill's own retry guidance, not an application `FAIL`.

**Disposition:** a `FAIL` that survives carries a one-line refutation trace in its evidence/reason (e.g., `re-verified: yes; env: n/a`). A refuted `FAIL` is not returned as `FAIL` — it becomes `PASS`/`SKIP`/`NEED_INFO`/error per what the battery showed. **No Rejected/Doctrine-gap sections** — the per-scenario contract has no place for them (recorded caveat, exactly as the marketplace exempts qa testers from the full 3-bucket contract).

### §7.2 Superseded error-handling lines

The battery **modifies** (not merely supplements) the existing error-handling rules so the skills do not contradict themselves:

- `be-testing/SKILL.md`, the error-handling rules ending "connection refused — is the server running?" — "connection refused → FAIL" becomes the liveness-distinction rule from check 2; timeout keeps `FAIL` only when the service is otherwise alive. (Anchor by quoted text, not line number — the lines shift under every edit.)
- `fe-testing/SKILL.md`, the error-handling rules beginning "If a page doesn't load (timeout)" — page-load timeout / element-not-found route through checks 1–2 (fresh snapshot; never-reachable app → `NEED_INFO kind=service`) before the existing `FAIL` treatment applies.

This also closes the pre-existing inconsistency between be-testing and Zmora core.md's `NEED_INFO kind=service` discipline.

### §7.3 Tests

- Extend `tests/skills/be-testing.test.ts`: battery present (`re-verify`/`refutation` terms), liveness distinction present, `NEED_INFO` routing present.
- New `tests/skills/fe-testing.test.ts` (today missing — added symmetric to be-testing's): frontmatter pin + battery terms + stale-read disposition.

## §8 Risks and failure modes

- **Retry-laundering** — the battery's biggest risk is weakening genuine FAILs. Mitigations are structural: exactly one re-verification, both observations recorded, and the be-testing rule that non-determinism stays `FAIL`.
- **Name collision** — mitigated by §5.1 (distinct native name). The registry's throw-on-duplicate remains the backstop.
- **Doctrine drift** — the doc-guard test (§6.4) pins the doc to the roster vocabularies and to the two triglav.md edits; skill tests (§5.4, §7.3) pin the wiring.
- **Token cost** — leg 1 loads conditionally; leg 3 adds ~15 lines to skills Zmora already loads; leg 2 adds zero runtime cost.

## §9 Verification

Full existing gate: `bun run build` (copies skills to dist), `tsc`, `vitest` (new tests + existing doc-guards), `verify-dist-sync`, `verify-no-review-ids`. No new gate steps.

## §10 File-by-file change set (authoritative)

| # | File | Action | Change |
|---|---|---|---|
| 1 | `src/skills/qa/state-combination-planning/SKILL.md` | create | §5.2 draft |
| 2 | `src/skills/qa/qa-plan-authoring/SKILL.md` | modify | Step 6 trigger rule (§5.3) |
| 3 | `docs/plugins/agent-contracts.md` | create | §6.1 doctrine (two sections + checklists + conformance table) |
| 4 | `src/modules/explore/triglav.md` | modify | truncation field + fail-closed sentence (§6.2) |
| 5 | roster prompts (`qa/prompt-sections/*`, `svarog.md`, `stribog.md`, `veles.md`) | modify (audit-driven) | only gaps found by the Section A checklist (§6.3) |
| 6 | `src/skills/qa/fe-testing/SKILL.md` | modify | battery + superseded error-handling lines (§7) |
| 7 | `src/skills/qa/be-testing/SKILL.md` | modify | battery + liveness distinction (§7) |
| 8 | `tests/docs/agent-contracts-doctrine.test.ts` | create | §6.4 pins |
| 9 | `tests/skills/state-combination-planning.test.ts` | create | §5.4 pins |
| 10 | `tests/skills/fe-testing.test.ts` | create | §7.3 pins |
| 11 | `tests/skills/be-testing.test.ts` | modify | §7.3 battery pins |
| 12 | `tests/skills/qa-plan-authoring.test.ts` | modify | §5.4 trigger pin |
| 13 | `docs/plugins/qa.md`, `docs/plugins/coordinator.md` | modify | mention the new skill + doctrine doc (docs consistency) |
| 14 | `dist/**` | rebuild | via `bun run build` (automatic copy) |

## §11 Non-goals and future work

- **Package-port sync** (`packages/code-review`, `packages/frontend-developer` ← upstream pattern-pack): separate work item; when done, the frontend-developer port brings `state-combination-modeling` into the shared catalog — the §5.1 naming keeps that safe.
- **Code-level enforcement** (e.g., validating a refutation-trace field in ingest, a structured truncation flag for Triglav): deliberately deferred; adopt only if the prompt-level bar proves insufficient in practice.
- **`docs-fact-registry` natively**: revisit only if a native Pantheon review flow (not the marketplace plugin) ever materializes.
