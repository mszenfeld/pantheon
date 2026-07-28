# Agent Contracts — Closing Verdicts & Reader Hygiene

Authoring-time doctrine for Pantheon agent prompts, adapted from the
av-marketplace pattern pack (`verdict-protocol`, `reader-context-hygiene`).
Invoke when writing or reviewing an agent's *definition* — not during an
ordinary run. Pinned by `tests/docs/agent-contracts-doctrine.test.ts`.

Placement: this doc lives directly under `docs/` per AGENTS.md — new reference
docs are `docs/<topic>.md`; `docs/plugins/` accepts no new files (that tree is
legacy; `qa-loop-engineering.md`'s location there is grandfathered).

## Section A — Verdict protocol (closing contracts)

The closing contract of a reporting agent is the last thing its consumer
parses — and the first thing that rots into free text. The bar, at authoring
time:

1. **Closed vocabulary.** The definition declares an enumerated verdict/status
   set; free-text closers are invalid — a consumer cannot route prose.
2. **Computed, not chosen.** Every value declares its deciding predicate; an
   agent cannot hand-pick a success value while failing conditions stand.
3. **Exhaustion semantics.** Budget/round exhaustion is its own outcome,
   distinct from success and from failure. Reference implementation:
   `RunResult.BudgetExhausted` (`src/modules/qa-loop/types.ts`).
4. **Caveated verdicts route their remainder.** A pass scoped to what was
   verifiable names the unverified rest. Reference: `RunResult.NotVerified`.
5. **Consumer routing.** For every value, the consumer's (Perun's / the
   qa-loop's) reaction is defined at authoring time; an unrouted value is dead
   weight.
6. **Machine-locatable and evidence-backed.** The verdict is a fixed-vocabulary
   token in a structured payload or a fixed-format line, never buried in
   prose — and invalid without the findings/evidence backing it (Zmora: the
   scenario result's evidence fields; Svarog: its `verification` field).

**Not adopted — the triage-axis rider.** The marketplace bar's
Required/Advised/Optional axis is not adopted: the qa-loop already separates
"does this block?" from "how bad?" via the `severity_floor` config plus the
`IssueStatus` lifecycle (`deferred` is the per-issue opt-out). A third axis
would duplicate that machinery.

### Roster conformance table

| Agent | Vocabulary | Predicates | Exhaustion | Consumer routing |
|---|---|---|---|---|
| Zmora (fe/be) | `PASS` / `FAIL` / `SKIP` / `NEED_INFO`, plus a distinct whole-dispatch error result (`src/modules/qa/prompt-sections/core.md`) | per-scenario rules in `fe-testing`/`be-testing`, incl. the FAIL refutation battery | n/a per-scenario (time budgets live in the dispatch layer) | Perun ingests states; `NEED_INFO` pauses the run (`docs/plugins/qa.md`) |
| zmora-setup | `Provisioned QA_BIND_<NAME>` / `NEED_INFO kind=binding_input` / `RECIPE_FAILED` / `ERROR` / `PROVISIONING_BLOCKED` (`overlay-setup.md`) | mapped 1:1 from `execute_recipe` statuses | n/a (single call per dispatch) | Perun: 3 attempts then dependents SKIP; provisioning-blocked → consent gate + re-arm (`perun.md`) |
| Svarog | `READY` / `FAIL` / `ESCALATE` (`src/modules/svarog/svarog.md`) | `READY` ⇔ done AND the full suite/build ran green; `ESCALATE` ⇔ out of scope / needs a decision | folds into `FAIL` after 3 approaches + one root-cause pass — see Known limitations | qa-loop `SvarogStatus`; `ESCALATE` → human |
| Stribog | `READY` / `FAIL` / `ESCALATE` (`src/modules/stribog/stribog.md`) | `READY` ⇔ done/live (`baseUrl` when a service started); `ESCALATE` ⇔ out of lane | n/a (single-shot task, no retry budget) | Perun workflow prose; `ESCALATE` → re-plan or human |
| Veles | `ok` / `needs_clarification` / `error` / `timeout` (`src/modules/plan/veles.md`) | `ok` ⇔ plan written; `needs_clarification` ⇔ ambiguous input; `error` ⇔ could not; `timeout` ⇔ exploration exceeded limits | `timeout` IS the exhaustion outcome — distinct from `error` | Perun branches on all four; see Section C |
| qa-loop (run-level) | `Pass` / `Fail` / `BudgetExhausted` / `Stopped` / `NotVerified` (`RunResult`, `types.ts`) | computed by the loop engine from the sidecar | `BudgetExhausted` — the reference implementation | `qa_loop_finalize` renders it; Perun reports it |
| Triglav | a reader, not a verdict agent — see Section B | — | — | — |

### Known limitations (recorded, not fixed here)

- **Svarog exhaustion folds into `FAIL`.** A distinct exhaustion value would
  change `SvarogStatus` (`src/modules/qa-loop/types.ts`) — a TS schema change,
  outside this doctrine's prompt-only scope. Today the `reason` line carries
  the distinction ("3 approaches + root-cause pass exhausted").
- **Loop-path refutation-trace durability.** A battery-refuted FAIL's trace
  survives in Zmora's result block and the `/qa:run` report, but
  `qa_loop_ingest` has no field for it (`reason` is nulled for non-skip
  states) — deferred code work (spec §11).

### Section A checklist (paste into any agent-contract review)

- [ ] 1. Verdict set enumerated and closed
- [ ] 2. Every value carries a deciding predicate
- [ ] 3. Exhaustion outcome declared, distinct from success and failure
- [ ] 4. Caveated passes route their unverified remainder
- [ ] 5. Every value has a defined consumer reaction
- [ ] 6. One-token, fixed-vocabulary verdict, evidence-backed

## Section B — Reader contract (context hygiene)

A reader (scout) agent ingests a source on behalf of a consumer that decides
from the result. The reader's return message IS its interface. The bar:

1. **Signals inline as named fields.** Every decision-relevant status the
   orchestrator will act on is a named field in the return message, never
   buried in an artifact or prose.
2. **Bulk never inline, never glob-shadowed.** No file bodies, no dumps;
   evidence is referenced by path. Bulk artifacts live under a subdirectory of
   the report directory (`screenshots/`, `dumps/`) or a gitignored workspace —
   never at a path matching the report glob `docs/testing/reports/*.md`
   (report consumers auto-merge the newest file there).
3. **Fail-closed access.** Source unreachable/unreadable → STOP with a
   diagnostic; never synthesize missing content. A fabricated source is worse
   than no source.
4. **Idempotent artifacts.** Re-runs overwrite; no timestamped accumulation.
   Reference implementation: Zmora's deterministic, timestamp-free artifact
   filenames (`FE-04-fail.png`, the core.md artifact-filename convention).
5. **Declared truncation.** A capped result names the cap and what was
   skipped; silent truncation reads as full coverage.

**Recorded caveats:**

- **Triglav is read-only** — the marketplace's "bulk to disk" bar does not
  apply; bulk is simply forbidden inline (bar 2) with the cap declared via the
  `truncation:` field (bar 5).
- **Zmora returns results inline per-scenario** — an aggregation constraint of
  the QA run contract; the spirit lives in the evidence rules (artifacts to
  disk, referenced by path, ID-embedded names).

### Section B checklist (paste into any reader-agent review)

- [ ] 1. Every decision-relevant status is a named inline field
- [ ] 2. No bulk inline; artifacts outside the report glob
- [ ] 3. Access failure → STOP + diagnostic; nothing synthesized
- [ ] 4. Re-runs overwrite (idempotent artifacts)
- [ ] 5. Truncation declared with what was skipped

## Section C — Veles contract shape

Veles (`Veles - Planner`) returns a discriminated JSON contract in every mode.
The same schema is used for direct-user sessions and for headless Perun dispatch.

### Execution modes

- **Headless dispatch.** Perun sends a prompt that carries the envelope:
  - `Execution context: perun-headless`
  - `Mode: <spec|implementation-plan|qa>`
  - In this mode Veles must not call `question`; ambiguous input is returned as
    `status: "needs_clarification"`.
- **Direct-user mode.** Veles may use `question` for clarification when intent
  is ambiguous. When it returns a final result, it uses the same JSON contract
  as headless mode.

### Status variants

| status | fields | meaning |
|---|---|---|
| `ok` | `type`, `plan_path`, `topic`, `summary` | Artefact written successfully. |
| `needs_clarification` | `topic`, `message`, `suggested_modes` | Ambiguous input; needs user resolution. |
| `error` | `topic`, `reason` | Could not complete the request. |
| `timeout` | `topic` | Exploration/planning budget exhausted. |

### `ok` sub-types

- `type: "spec"` — feature spec written to `docs/specs/`.
- `type: "implementation-plan"` — implementation plan written to `docs/plans/`.
  Its `ok` result also includes `spec_path`: the approved, normalized
  repository-relative path to the source feature spec.
- `type: "qa"` — QA test plan. For backward compatibility with existing QA
  consumers, an `ok` QA result also includes the legacy fields `fe_count`,
  `be_count`, and `setup_prereqs`. The `plan_path` for QA plans remains under
  `docs/testing/plans/`.

### Section C checklist

- [ ] 1. Discriminated status is one of `ok`, `needs_clarification`, `error`, `timeout`
- [ ] 2. `ok` carries `type`, `plan_path`, `topic`, and `summary`
- [ ] 3. Implementation-plan mode (`type: "implementation-plan"`) also carries approved, normalized `spec_path`
- [ ] 4. QA mode (`type: "qa"`) also carries `fe_count`, `be_count`, `setup_prereqs`
- [ ] 5. Headless envelope carries `Execution context: perun-headless` and `Mode:`
- [ ] 6. Headless mode never calls `question`; ambiguous input returns `needs_clarification`
- [ ] 7. Direct-user mode may call `question` but returns the same JSON contract on completion

## Ownership boundaries

This document owns closing-contract and reader-contract doctrine only. It
cites by pointer — never transcribes — the report file format (`report-format`
skill), loop doctrine (`docs/plugins/qa-loop-engineering.md`), and the Zmora
result templates (`fe-testing` / `be-testing`).
