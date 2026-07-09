# Pattern-Pack Reflection — Native Harness Design

**Date:** 2026-07-09
**Branch:** `feat/pattern-pack-reflection` (based on `master` @ `b81cd76` — PR #14 merged, provisionable-qa-plans content in HEAD)
**Source pattern:** av-marketplace branch `feat/pattern-pack-skills` (27 commits, 27 files, +507 lines)

---

## §1 Context — what the source branch introduced

The av-marketplace branch establishes a new artifact genre: **pattern-pack doctrine skills** — small, single-concern discipline skills sharing a fixed shape:

- trigger-only frontmatter `description` ("Use when …"),
- a numbered **minimum bar (MUST)**,
- named **anti-patterns**,
- a worked example marked *(Prospective)* when no conforming implementation exists,
- a paste-able **review checklist**,
- explicit **ownership boundaries** between skills, where a skill touches a sibling contract ("cite by pointer, never transcribe" — a transcribed enumeration is a second drift site),
- **recorded exemptions** instead of silent non-compliance, where full compliance is impossible. (The last two elements appear only where they apply — `state-combination-modeling` carries neither.)

Five skills were added and wired, each into its consumer — the code-review skills through the full pipeline (agent `skills:` frontmatter preload → per-agent output-format extensions → orchestrator transit → challenger spot-check/reinstatement → fix-pipeline policy filter); the authoring-time skills (`verdict-protocol`, `reader-context-hygiene`) via contributor-doc pointers and evidence-rule cross-references:

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
2. `verdict-protocol` + `reader-context-hygiene` → adapted into a **doctrine document** `docs/agent-contracts.md` + doc-guard test + a roster conformance audit with prompt-only fixes + `triglav.md` conformance edits.
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

`src/skills/qa/state-combination-planning/SKILL.md` (~65 lines, pattern-pack shape). Authoritative draft:

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

Scope: boolean inputs, mirroring the source pattern. A small non-boolean
enum axis (e.g. role = admin|editor|viewer) follows the same discipline
with the full cartesian product (|A|×|B| rows) in place of 2^N.

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

## Worked example *(Prospective)*

*(Prospective: no conforming Pantheon plan exists yet; genericized from the
source pattern.)* Inputs: `isConnected`, `canEdit` → 2^2 = 4:

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

The bar also gets a **gate hook** in the repo's existing self-check machinery (the repo's demonstrated posture: Step 6 MUSTs get a Step 6.7 anchor). Add one conditional bullet to **Step 6.7: Self-check before finishing**:

> When the change under test is driven by ≥2 independent boolean inputs (re-evaluate the Step 6 trigger here, from the plan artifact — not from memory of what was loaded): `state-combination-planning` was loaded, the full 2^N table is present in the plan, every combination classified `real` has a scenario, and every `impossible` cites its invariant or confirmation.

### §5.4 Registration and tests

- Registration is automatic: `scripts/copy-root-assets.mjs` copies `src/skills` → `dist/skills` on build; the registry scans `dist/skills/qa`.
- New `tests/skills/state-combination-planning.test.ts` (model: `tests/skills/qa-plan-authoring.test.ts`): frontmatter `name` is `state-combination-planning`; description starts with "Use when"; body contains `2^N`, `impossible`, `invariant`, the 4-row example table marker, and the checklist.
- Extend `tests/skills/qa-plan-authoring.test.ts`: Step 6 contains the literal `state-combination-planning` trigger, and Step 6.7 contains the conditional self-check bullet (§5.3).

## §6 Leg 2 — `docs/agent-contracts.md` doctrine + audit + Triglav

### §6.1 The document

`docs/agent-contracts.md` (~150–200 lines), two sections with explicit ownership, each ending in a paste-able checklist. Placement: directly under `docs/` — AGENTS.md forbids new files under the legacy `docs/plugins/` tree and routes new reference docs to `docs/<topic>.md` (the `docs/configuring-agents.md` pattern); `qa-loop-engineering.md`'s location under `docs/plugins/` is a grandfathered violation of that rule, not a license to repeat it.

**Section A — Verdict protocol (closing contracts).** Adapted bar:

1. **Closed vocabulary** — every reporting agent's definition declares an enumerated verdict/status set; free-text closers are invalid.
2. **Computed, not chosen** — each value declares its deciding predicate; an agent cannot hand-pick a success value while failing conditions stand.
3. **Exhaustion semantics** — budget/round exhaustion is its own outcome, distinct from success and failure. Reference implementation: `RunResult.BudgetExhausted` in `src/modules/qa-loop/types.ts`.
4. **Caveated verdicts route their remainder** — a pass scoped to what was verifiable names the unverified rest. Reference: `RunResult.NotVerified`.
5. **Consumer routing** — for every value, the consumer's (Perun's / the qa-loop's) reaction is defined at authoring time.
6. **Machine-locatable and evidence-backed** — the verdict is a fixed-vocabulary token in a structured payload or a fixed-format line, never buried in prose; a verdict without the findings/evidence backing it is invalid (Zmora: the scenario result's evidence fields; Svarog: its verification evidence).

The marketplace's Required/Advised/Optional triage-axis rider is recorded as **not adopted**: Pantheon's qa-loop already separates "does this block?" from "how bad?" via `severity_floor` config + `IssueStatus` lifecycle; adding a third axis would duplicate that machinery.

Section A includes a **roster conformance table** (filled by the §6.3 audit): agent × {vocabulary, predicates, exhaustion, routing} with file pointers — Zmora (`PASS/FAIL/SKIP/NEED_INFO`, plus its distinct error-result channel), zmora-setup (its own closed set: `Provisioned QA_BIND_<NAME>` / `NEED_INFO kind=binding_input` / `RECIPE_FAILED` / `ERROR`, with Perun's 3-attempt/SKIP-dependents routing already defined — plus one pre-identified gap the §6.3 audit closes: `execute_recipe` can also return `provisioning_blocked`, which the overlay never maps to a reporting branch), Svarog (`READY/FAIL/ESCALATE`), Stribog (`READY/FAIL/ESCALATE`), Veles (`ok`/`error`/`timeout` — `timeout` is its exhaustion outcome; the coordinator branches on all three), Triglav (a reader, not a verdict agent — cross-reference to Section B).

**Section B — Reader contract (context hygiene).** Adapted bar for fan-out readers:

1. **Signals inline as named fields** — every decision-relevant status the orchestrator will act on is a named field in the return message, never buried in an artifact or prose.
2. **Bulk never inline, never glob-shadowed** — no file bodies, no dumps; evidence is referenced by path. Bulk artifacts live under a subdirectory of the report directory (`screenshots/`, `dumps/`) or a gitignored workspace — never at a path matching the report glob `docs/testing/reports/*.md` (report consumers auto-merge the newest file there).
3. **Fail-closed access** — source unreachable/unreadable → STOP with a diagnostic; never synthesize missing content.
4. **Idempotent artifacts** — re-runs overwrite; no timestamped accumulation. Reference implementation: Zmora's deterministic, timestamp-free artifact filenames (`FE-04-fail.png`, the core.md artifact-filename convention) — re-runs overwrite instead of accumulating.
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

Run the Section A checklist over: `src/modules/qa/prompt-sections/core.md` + overlays, `src/modules/svarog/svarog.md`, `src/modules/stribog/stribog.md`, `src/modules/plan/veles.md`. Fix gaps **in prompts only** (e.g., a status value whose deciding predicate is implied but never stated). No TS schema changes; if the audit surfaces a gap whose fix would require one — or whose fix lives outside the audited prompts (in `perun.md` or qa-loop code, e.g. a consumer-routing gap for a verdict value) — it is recorded in the doctrine doc as a known limitation instead (the doctrine-gap practice from the source pattern), not fixed on this branch. Known tension in this roster's orbit — be-testing's "connection refused → FAIL" vs core.md's `NEED_INFO kind=service` — is already resolved by the Leg 3 be-testing edit (§7.2); the audit treats core.md's `kind=service` bullet as correct as-is and neither fixes nor records anything for it. One pre-identified audit fix (prompt-only, in scope): `overlay-setup.md` maps four `execute_recipe` responses but not `provisioning_blocked` (returned by dispatched-pre-consent SETUP scenarios, per `perun.md`) — the audit adds the fifth reporting branch so the setup vocabulary stays closed instead of forcing an improvised free-text closer (the bar-A1 violation).

### §6.4 Doc-guard test

`tests/docs/agent-contracts-doctrine.test.ts` (model: `tests/docs/loop-engineering-doctrine.test.ts`):

- doc exists;
- contains the roster verdict vocabularies: `PASS`, `FAIL`, `SKIP`, `NEED_INFO`, `READY`, `ESCALATE`, `timeout` (the distinctive member of Veles's `ok`/`error`/`timeout` trio), `RECIPE_FAILED` (the distinctive member of the zmora-setup set), `BudgetExhausted`, `NotVerified`;
- contains the bar-term tokens (case-insensitive matches; each appears verbatim in the §6.1 bar text): `fail-closed`, `truncation`, `named fields`, `computed, not chosen`, `exhaustion`;
- pins triglav sync: `src/modules/explore/triglav.md` contains `truncation:` and the negated phrase `never synthesize` (a bare `synthesize` token is direction-blind — it would pass equally on an instruction *to* synthesize), so the doc and the agent prompt cannot drift apart silently.

## §7 Leg 3 — FAIL refutation battery (Zmora)

### §7.1 The battery (marketplace 6 checks → 4, per-scenario)

Added to `fe-testing/SKILL.md` and `be-testing/SKILL.md` as a subsection adjacent to each skill's result-format/error-handling rules. Provenance map (source battery → this one): deliberate-omission → check 3 (direct); evidence-elsewhere and verifiability-class → folded into checks 1–3's routing; toolchain, backing, and citation are review-domain-only and dropped (a scenario's Expected is a FAIL's backing and its citation); checks 1 and 4 are QA-native additions. Before returning `FAIL`, run:

1. **Re-verify the observation — once, deterministically, observation-only.** Re-verification re-READS state; it never re-performs the scenario's action. *fe-testing:* take a fresh snapshot / `wait_for` and re-read — never re-submit a form or re-click through the flow. *be-testing:* for a non-mutating step (GET/HEAD, a read-only check) repeat the identical request once; for a **mutating** step (POST/PUT/PATCH/DELETE, an INSERT/seed) never re-fire the request — re-firing double-applies the side effect outside the teardown accounting (one recorded reversal per scenario; compounding is the exact hazard the loop doctrine's mutation-guard sections name — `docs/plugins/qa-loop-engineering.md`, the §7 strip / §8 seed-then-revert default) — re-verify by re-reading the resulting state once (repeat the scenario's DB check, or GET the created resource). This targets *observation integrity* (stale DOM read, race between action and assertion) and is explicitly **not** retry-until-pass: one re-check, then disposition. If the two observations disagree, record **both** in the evidence and apply the per-stack rule:
   - *fe-testing:* first read failed, fresh snapshot passes → the initial read was a tester-side race → `PASS` with the discrepancy recorded per the disposition below. **Carve-out:** when the scenario's Expected is explicitly timing/immediacy-sensitive ("appears immediately", "without reload"), or the mismatch recurs on any edge-case interaction, the discrepancy stays `FAIL` — there the timing flake IS the defect, not an observation artifact.
   - *be-testing:* identical **read** requests return different results → non-determinism is itself an application defect → `FAIL` with both responses recorded. (This diagnosis applies to read re-fires only — a re-fired write legitimately differs, e.g. 201→409 on a duplicate POST, which is why writes are never re-fired.)
2. **Environment artifact?** If the failure is a missing prerequisite **discovered at execution time** (env var, service, fixture, tool) → `NEED_INFO` with the matching `kind`, not `FAIL`. Three scope rules:
   - **The application under test** (the plan's base-url): never reachable in this scenario → `NEED_INFO kind=service`; **answered earlier in the scenario and then died** → genuine `FAIL` (the app crashed under test). The died-mid-scenario→FAIL rule applies to the app under test *only*.
   - **Dependency hosts** (the DB in overlay-be's DB-check branch, third-party services): stay on the existing unconditional `NEED_INFO kind=service` routing — a flaky dependency is an environment problem, not this scenario's app defect.
   - **Tool routing follows core.md's SKIP-vs-NEED_INFO rule** (cite by pointer): scenario doesn't apply to this stack/environment at all → `SKIP`; scenario would apply but the tool is missing → `NEED_INFO kind=tool`. The overlays already implement this upfront (overlay-fe/overlay-be Step 2); the skills' bare "→ SKIP" tool-detection lines are aligned to it in §7.2. Coverage is unaffected either way: `NEED_INFO` is treated as `SKIP` for the report (`docs/plugins/qa.md`), and `routeSkip`'s reason regex buckets tool reasons into `tool-unavailable` (`src/modules/qa-loop/coverage.ts`).
3. **Deliberate omission / scope mismatch?** Name the referent, route to its outcome: an observed defect **outside the scenario's Expected**, with the Expected itself met → `PASS` with the out-of-scope observation noted in the result's Details (a follow-up scenario is Perun's/the user's call — it is not this scenario's `FAIL`); an omission **recorded in the plan** (`## Setup`, a plan note) that makes the scenario inapplicable in this environment → `SKIP` per core.md's stack/environment-inapplicability rule (cite by pointer); a missing **declared prerequisite** → `NEED_INFO` via check 2.
4. **Harness error?** Tool timeout, Playwright MCP failure, selector unreachable because the tester never completed its own navigation → re-attempt the failed harness step **at most once**; if it fails again, return an **error result** naming the tool failure (core.md's error-result shape) — never an application `FAIL`. (No open-ended retries: an unbounded harness-retry loop is the same laundering vector §8 names.)

**Scope — every FAIL the result carries:** the battery gates not only the scenario-level `**Status:**` but each edge-case sub-result line and be-testing's `**DB check:**` field — report-format mints a QA-ID for an edge-case FAIL under a passing main flow, so an ungated sub-FAIL is an ungated issue. Sub-verdict disposition: a refuted edge-case/DB-check `FAIL` flips that line to `PASS`/`SKIP` with its one-line trace appended to the line's details clause; a prerequisite-class edge failure (check 2) escalates to scenario-level `NEED_INFO` (exception, decided in §7.2: the upfront missing-DB-client case stays a DB-check-level `SKIP` — partial execution per overlay-be Step 2); a harness-refuted edge failure (check 4, second attempt also failed) flips that line to `SKIP — <tool failure>` — the scenario-level error result is reserved for harness errors in the main flow.

**Disposition:** a `FAIL` that survives carries a one-line refutation trace in its evidence/reason (e.g., `re-verified: yes; env: n/a`). A refuted `FAIL` is not returned as `FAIL` — it becomes `PASS`/`SKIP`/`NEED_INFO`/error per what the battery showed. An FE stale-read `PASS` carries its one-line refutation trace twice: inline in the report's Pass-line parenthetical — report-format's Pass line gains that allowance (mirroring its Skip parenthetical), e.g. `### Pass: FE-04: name (re-verified: first read stale)` — and in full in the scenario result's `**Details:**` field (the fe/be-testing result templates), which reaches Perun in the wave message. **Durability caveat (recorded limitation):** this holds on the `/qa:run` path; in qa-loop runs `qa_loop_ingest` has no field for it (`reason` is nulled for non-skip states) and the loop report is a sidecar render that never consults report-format — there the trace survives only in Zmora's result block and Perun's transcript. The code-level fix (an ingest field) is deliberately deferred (§11). **No Rejected/Doctrine-gap sections** — the per-scenario contract has no place for them (recorded caveat, exactly as the marketplace exempts qa testers from the full 3-bucket contract). **SETUP dispatches are out of the battery's reach by construction** — the setup variant loads no fe/be skill and has no `FAIL` in its vocabulary — recorded, not accidental.

### §7.2 Superseded error-handling lines

The battery **modifies** (not merely supplements) the existing error-handling rules so the skills do not contradict themselves:

- `be-testing/SKILL.md`, the error-handling rules ending "connection refused — is the server running?" — "connection refused → FAIL" becomes the liveness-distinction rule from check 2; timeout keeps `FAIL` only when the service is otherwise alive. (Anchor by quoted text, not line number — the lines shift under every edit.)
- `fe-testing/SKILL.md`, the error-handling rules beginning "If a page doesn't load (timeout)" — page-load timeout / element-not-found route through checks 1–2 (fresh snapshot; never-reachable app → `NEED_INFO kind=service`) before the existing `FAIL` treatment applies.
- Both skills' Result Format templates: the `**Status:** PASS / FAIL / SKIP` line gains `NEED_INFO` (core.md already defines it as a first-class status; the templates omit it today), and the edge-case sub-result lines gain `SKIP` (`<edge case 1>: PASS / FAIL / SKIP — <details>`) to match the sub-verdict disposition (§7.1).
- Both skills' whole-scenario tool-detection lines ("no HTTP client → SKIP", "Playwright unavailable → SKIP") — aligned to core.md's SKIP-vs-NEED_INFO rule by pointer (scenario-inapplicable → `SKIP`; applies-but-tool-missing → `NEED_INFO kind=tool`), matching what overlay-fe/overlay-be Step 2 already instruct. This removes a live skills-vs-overlays contradiction in the assembled Zmora context — the same class of short-circuit the overlay-fe battery gate fixes. Two carve-outs, decided here: the **SKIP-DB-checks variant keeps its sub-check-level `SKIP`** (partial execution per overlay-be Step 2, the untouched reference — a missing DB client blocks one sub-check, not the scenario, and is not a check-2 prerequisite escalation); **allowlist-unavailability stays on core.md's error-result channel** (a harness-config problem, distinct from a PATH/probe gap → `NEED_INFO kind=tool`).
- `src/modules/qa/prompt-sections/overlay-fe.md`, the step instructing "If not met → take screenshot …, return FAIL" — gains the battery gate ("run the fe-testing FAIL refutation battery before returning FAIL"); without it, prompt-level text short-circuits the skill-level battery. This is the only prompt-section edit belonging to Leg 3 (listed in §10 row 5).

**Deliberately NOT touched:** (a) the overlays' upfront `NEED_INFO kind=tool` steps (overlay-fe/overlay-be Step 2) — they already implement core.md's SKIP-vs-NEED_INFO rule and are the reference the skills' tool lines are aligned to; (b) `core.md`'s `kind=service` bullet — it governs dependency hosts and the never-reachable app, which stays consistent with the battery once check 2 scopes died-mid-scenario→FAIL to the app under test; (c) `overlay-be.md`'s DB connection-failure → `NEED_INFO kind=service` branch — dependency-host routing per check 2's second scope rule (and its dangling cross-reference to be-testing's connection-failure branch is healed by the be-testing edit above).

This also closes the pre-existing inconsistency between be-testing and Zmora core.md's `NEED_INFO kind=service` discipline (overlay-be already cross-references be-testing's connection-failure branch expecting NEED_INFO routing; today that branch says FAIL).

### §7.3 Tests

- Extend `tests/skills/be-testing.test.ts`: battery present (`re-verify`/`refutation` terms), never-re-fire-a-mutating-request rule present, liveness distinction present, `NEED_INFO` routing present, sub-verdict scope present (edge-case lines and the DB-check field gated).
- New `tests/skills/fe-testing.test.ts` (today missing — added symmetric to be-testing's): frontmatter pin + battery terms + observation-only re-verification (never re-submit) + stale-read disposition + the timing-sensitive carve-out + sub-verdict scope (edge-case lines gated) + `NEED_INFO` routing present.
- New `tests/skills/report-format.test.ts` (minimal): skill exists + the Pass-line refutation-trace allowance (the parenthetical carries the trace inline — no Details field exists in the report, so the allowance must be self-contained).

## §8 Risks and failure modes

- **Retry-laundering** — the battery's biggest risk is weakening genuine FAILs, and the FE stale-read→`PASS` conversion is the one place a verdict actually flips. Mitigations are structural: exactly one re-verification, observation-only (no re-performed actions), both observations recorded in Details and the Pass-line parenthetical (durable on the `/qa:run` path; see §7.1's recorded limitation for loop runs), the timing-sensitive carve-out keeps flaky-by-Expectation scenarios `FAIL`, the be-testing rule keeps read non-determinism `FAIL`, and harness-error re-attempts are capped at one.
- **Mutation safety** — the battery never re-fires a write: a double-applied mutation lands outside the loop's teardown accounting (one recorded reversal per scenario) and compounds side effects — the loop doctrine's §7-strip / §8-seed-then-revert hazard (`docs/plugins/qa-loop-engineering.md`). Re-verification of mutating steps is read-only by construction (check 1).
- **Name collision** — mitigated by §5.1 (distinct native name). The registry's throw-on-duplicate remains the backstop.
- **Doctrine drift** — the doc-guard test (§6.4) pins the doc to the roster vocabularies and to the two triglav.md edits; skill tests (§5.4, §7.3) pin the wiring.
- **Token cost** — leg 1 loads conditionally; leg 3 adds a ~30-line subsection to each of the two skills Zmora already loads; leg 2 adds zero runtime cost.

## §9 Verification

Full existing gate: `bun run build` (copies skills to dist), `tsc`, `vitest` (new tests + existing doc-guards), `verify-dist-sync`, `verify-no-review-ids`. No new gate steps.

## §10 File-by-file change set (authoritative)

| # | File | Action | Change |
|---|---|---|---|
| 1 | `src/skills/qa/state-combination-planning/SKILL.md` | create | §5.2 draft |
| 2 | `src/skills/qa/qa-plan-authoring/SKILL.md` | modify | Step 6 trigger rule + Step 6.7 conditional self-check bullet (§5.3) |
| 3 | `docs/agent-contracts.md` | create | §6.1 doctrine (two sections + checklists + conformance table) |
| 4 | `src/modules/explore/triglav.md` | modify | truncation field + fail-closed sentence (§6.2) |
| 5 | roster prompts (`qa/prompt-sections/*`, `svarog.md`, `stribog.md`, `veles.md`) | modify | Section A audit gaps (§6.3) + the overlay-fe battery-gate line (§7.2) |
| 6 | `src/skills/qa/fe-testing/SKILL.md` | modify | battery + superseded error-handling lines + template/tool-line alignment (§7) |
| 7 | `src/skills/qa/be-testing/SKILL.md` | modify | battery + liveness distinction + superseded error-handling lines + template/tool-line alignment (§7) |
| 8 | `tests/docs/agent-contracts-doctrine.test.ts` | create | §6.4 pins |
| 9 | `tests/skills/state-combination-planning.test.ts` | create | §5.4 pins |
| 10 | `tests/skills/fe-testing.test.ts` | create | §7.3 pins |
| 11 | `tests/skills/be-testing.test.ts` | modify | §7.3 battery pins |
| 12 | `tests/skills/qa-plan-authoring.test.ts` | modify | §5.4 trigger + Step 6.7 bullet pins |
| 13 | `docs/plugins/qa.md`, `docs/plugins/coordinator.md` | modify | mention the new skill + doctrine doc (docs consistency; modifying existing `docs/plugins/` files is allowed — only new files are forbidden) |
| 14 | `src/skills/qa/report-format/SKILL.md` | modify | Pass-line refutation-trace allowance (§7.1 disposition) |
| 15 | `tests/skills/report-format.test.ts` | create | §7.3 pins |
| 16 | `docs/eval/scenarios/zmora/be-discipline.md`, `docs/eval/scenarios/zmora/README.md` | modify | re-tier GATE 1 (require `kind=credentials` and/or the no-request-sent signal, not bare NEED_INFO), rewrite the connection-refused-FAIL diagnostic narrative and the `unreliable` flip criterion for the liveness-routed semantics (§7.2) |
| 17 | `dist/**` | rebuild | via `bun run build` (automatic copy) |

## §11 Non-goals and future work

- **Package-port sync** (`packages/code-review`, `packages/frontend-developer` ← upstream pattern-pack): separate work item; when done, the frontend-developer port brings `state-combination-modeling` into the shared catalog — the §5.1 naming keeps that safe.
- **Code-level enforcement** (e.g., validating a refutation-trace field in ingest, a structured truncation flag for Triglav): deliberately deferred; adopt only if the prompt-level bar proves insufficient in practice.
- **`docs-fact-registry` natively**: revisit only if a native Pantheon review flow (not the marketplace plugin) ever materializes.
