# QA Engineering Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/qa:run` a closed test→fix→retest loop on the Pantheon harness — a new `qa-loop` plugin module owns deterministic loop state, Perun orchestrates, and Svarog fixes (replacing fix-auto).

**Architecture:** Perun (restricted coordinator) dispatches Veles/Zmora/Svarog and calls six new `qa_loop_*` tools that own all the math + state (plan-hash idempotency, budgets, regression/progress guards, coverage, the sidecar JSON, and the report markdown). The tools run privileged git (`createCheckpoint`/`restoreCheckpoint` reuse, ref reads, anti-hardcoding diff) — Perun never shells. Checkpoints are resolved by the child Svarog session id (surfaced from `onSessionCreated` into `DispatchResult.sessionId`) and made tamper-safe by a create-only `update-ref`.

**Tech Stack:** TypeScript (Node, ESM, `.js` import suffixes), Bun test runner via `bunx vitest`, the OpenCode plugin `tool({...})` API, `node:child_process` `execFileSync` for git, `node:crypto` for hashing, `node:fs` for the sidecar.

**Source spec:** `docs/superpowers/specs/2026-06-25-qa-engineering-loop-design.md` (committed `99e7765`). Section references below (e.g. "§6") point at it.

**Branch:** `feat/qa-engineering-loop`.

---

## File structure

### New — `src/modules/qa-loop/`
| File | Responsibility |
|---|---|
| `types.ts` | The `Sidecar` type and all sub-types (the contract below). Pure types, no logic. |
| `plan-hash.ts` | `hashPlan(planText): string` — sha256 via `node:crypto`. |
| `classify.ts` | `classifyScenario(block)` → `{ kind, mutating, expectsSuccess }`; mutation-guard predicate. |
| `sidecar.ts` | `QaLoopState` singleton (in-process `Map` keyed by parent session) + disk load/save (atomic write, gitignored path). |
| `git-ops.ts` | Privileged git the tools need: `capturePreLoopRef`, `refExists`, `restoreFailRef` (wraps `restoreCheckpoint`), `undoToPreLoop`, `antiHardcodeDiff`. |
| `state-machine.ts` | Pure decision logic: `stepEnter`, `stepEvaluate`, `resultOf` (Result mapping), stop-cause precedence — no I/O. |
| `report.ts` | `renderReport(sidecar): string` — the report markdown (Status, Loop History, Coverage). |
| `tools.ts` | The six `tool({...})` definitions; each `execute()` guards on `isCoordinatorCaller`. |
| `index.ts` | Module wiring: build the plugin tool map; export `QA_LOOP_TOOL_NAMES`. |

### Changed — coordinator + Svarog
- `src/modules/coordinator/dispatch.ts` — `DispatchResult.sessionId` (Task 1).
- `src/modules/coordinator/index.ts` — result-shape description string (Task 1).
- `src/modules/svarog/checkpoint.ts` — create-only `update-ref` (Task 2).

### Changed — integration (Phase 3)
- `src/agents/perun.md` — Workflows 1+2 → unified QA-loop workflow.
- `src/commands/run-qa.md` — `/qa:run` becomes the loop (`--mode`/`--max-iterations`/`--max-dispatches`/`--time-budget`/`--severity-floor`/`--allow-mutations`).
- De-register fix-auto: delete `src/modules/agent-registry/fix-auto.metadata.ts` + its sync test; update registrations/tests/docs (§8 inventory).

### New tests (mirror each source file under `tests/modules/qa-loop/`)
Plus integration: `tests/modules/coordinator/` updates (Task 1), `tests/modules/svarog/checkpoint.test.ts` (Task 2).

---

## Shared contract — the sidecar type (referenced by every Phase-2 task)

`src/modules/qa-loop/types.ts` defines this exactly. Field names are load-bearing and used verbatim in later tasks (note `dispatch_count_total` vs `dispatches_this_iter`).

```typescript
export type SeverityFloor = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type Mode = "approve" | "auto" | "step"
export type ScenarioKind = "feature" | "sanity" | "negative"
export type ScenarioState = "pass" | "fail" | "skip"
export type IssueStatus = "open" | "fix-attempted" | "fix-failed" | "deferred" | "fixed"
export type SvarogStatus = "READY" | "FAIL" | "ESCALATE"
export type IterationPhase =
  | "selecting" | "awaiting_fix_gate" | "fixing"
  | "awaiting_retest_gate" | "retested" | "evaluated"
export type StopCause =
  | "zero-failure" | "regression" | "no-progress" | "all-deferred"
  | "max-iterations" | "max-dispatches" | "time-budget"
  | "user-abort" | "plan-tamper" | "checkpoint-integrity"
export type RunResult = "Pass" | "Fail" | "BudgetExhausted" | "Stopped" | "NotVerified"

export interface ScenarioRecord {
  qa_ids: string[]
  kind: ScenarioKind
  section: "FE" | "BE" | "SETUP"
  mutating: boolean          // classify.ts; stripped pre-dispatch unless allow_mutations / negative-blocked
  baseline: ScenarioState    // immutable after Phase 1
  current: ScenarioState     // mutated by ingest
  reason: string | null      // SKIP/NEED_INFO reason
}

export interface FixRecord {
  svarog_status: SvarogStatus | null
  escalate_reason: string | null
  child_session_id: string | null   // from DispatchResult.sessionId, written by record_fix
  checkpoint_ref: string | null      // refs/svarog/ckpt/<child_session_id>, or null if no edit
  changed: string[]
  hardcode_warnings: string[]
}

export interface IssueRecord {
  severity: SeverityFloor
  scenario: string
  location: string | null
  title: string
  problem: string
  remediation: string
  status: IssueStatus
  fixed_at: string | null
  fix: FixRecord
}

export interface IterationRecord {
  n: number
  phase: IterationPhase
  pending: string[]            // QA-IDs queued
  in_flight: string | null     // QA-ID marked just before dispatch
  attempted_so_far: string[]   // QA-IDs whose record_fix completed
  now_passing: string[]
  still_failing: string[]
  stop_cause: StopCause | null
  regressions: string[]
  warnings: string[]
  dispatches_this_iter: number // per-row snapshot, NOT the MAXD gate
  elapsed_s: number
}

export interface Coverage {
  exercised: { feature: number; sanity: number; enforcement: number }
  not_verified: { "auth-unverified": number; "mutation-guard": number; "tool-unavailable": number }
  routing_warnings: string[]
}

export interface Sidecar {
  version: 1
  run_id: string                 // "qa-loop-<topic>-<n>"; the <run> in refs/qa-loop/pre/<run>
  plan_path: string
  plan_sha256: string
  report_path: string
  config: {
    mode: Mode
    severity_floor: SeverityFloor
    max_iterations: number
    max_dispatches: number
    time_budget_s: number
    allow_mutations: boolean
  }
  started_at: number
  updated_at: number
  finalized_at: number | null
  budgets: {
    iteration: number            // 0 before loop; step(enter) increments; body admitted iff iteration <= MAXI
    dispatch_count_total: number // AUTHORITATIVE MAXD gate
    elapsed_s: number
    final_pass_elapsed_s: number | null // final-pass component of TB overage only
  }
  pre_loop: { undo_ref: string; dirty: boolean; dirty_files: string[] }
  scenarios: Record<string, ScenarioRecord> // keyed by "FE-01" etc.
  issues: Record<string, IssueRecord>        // keyed by "QA-001" etc.
  iterations: IterationRecord[]
  coverage: Coverage
  result: RunResult | null
}
```

Defaults (§4): `max_iterations=3`, `max_dispatches=50`, `time_budget_s=1800`, `severity_floor="LOW"`, `mode="approve"`, `allow_mutations=false`.

---

## Phase 1 — Coordinator + Svarog primitives

These are prerequisites (Phase 2's checkpoint resolution depends on Task 1; FAIL-restore safety depends on Task 2). Both are tiny, independently testable, and useful to all Svarog dispatchers.

### Task 1: Surface the child session id on `DispatchResult`

**Files:**
- Modify: `src/modules/coordinator/dispatch.ts:24-30` (interface), `:649-654` (success return), `:666-674` (error return)
- Modify: `src/modules/coordinator/index.ts:148` (result-shape description string)
- Test: `tests/modules/coordinator/dispatch-session-id.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`tests/modules/coordinator/dispatch-session-id.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { runTask } from "../../../src/modules/coordinator/dispatch.js"
import type { DispatchSpecialist } from "../../../src/modules/coordinator/dispatch.js"

function fakeSpecialist(childId: string): DispatchSpecialist {
  return {
    async startTask(_agent, _prompt, onSessionCreated) {
      onSessionCreated?.(childId)
      return childId
    },
    async fetchMessages() {
      return [{ role: "assistant", parts: [{ type: "text", text: "done" }] }] as any
    },
    isSessionActive: () => false,
  }
}

describe("runTask surfaces the child session id", () => {
  it("returns sessionId from onSessionCreated on success", async () => {
    const result = await runTask(
      { name: "svarog", prompt: "x" },
      fakeSpecialist("ses_child123"),
      { timeout: { wallClockMs: 5000, idleMs: 5000 }, pollIntervalMs: 1, resultMaxBytes: 4096 } as any,
    )
    expect(result.status).toBe("success")
    expect(result.sessionId).toBe("ses_child123")
  })
})
```

> Note: match `runTask`'s real export name + options shape — open `dispatch.ts` and adjust the call/options to the current signature if it differs. The assertion (`result.sessionId === childId`) is the contract under test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/coordinator/dispatch-session-id.test.ts`
Expected: FAIL — `result.sessionId` is `undefined` (field does not exist yet).

- [ ] **Step 3: Add `sessionId` to the `DispatchResult` interface**

`src/modules/coordinator/dispatch.ts:24-30`, add the field:

```typescript
export interface DispatchResult {
  name: string
  status: "success" | "error" | "timeout" | "aborted"
  result: string
  duration_ms: number
  error?: string
  sessionId?: string // child session id captured via onSessionCreated (undefined if the child was never created)
}
```

- [ ] **Step 4: Populate it in both return paths**

`dispatch.ts` success return (`:649-654`) — add `sessionId`:

```typescript
    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime,
      sessionId,
    }
```

`dispatch.ts` error return (`:666-674`) — add `sessionId` (may be `undefined` if create failed):

```typescript
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: neutralizeUntrustedOutput(
        err instanceof Error ? err.message : String(err),
      ),
      sessionId,
    }
```

- [ ] **Step 5: Update the model-facing result-shape description**

`src/modules/coordinator/index.ts:148`, add `sessionId?` to the documented shape:

```typescript
      '- Result shape: each entry has `{ name, status: "success" | "error" | "timeout" | "aborted", result, duration_ms, error?, sessionId? }`, in the same order as the input `tasks` array.',
```

- [ ] **Step 6: Run the test + the existing dispatch suite**

Run: `bunx vitest run tests/modules/coordinator/dispatch-session-id.test.ts tests/modules/coordinator/`
Expected: PASS (new test green; existing dispatch tests still green — the new field is additive and optional).

- [ ] **Step 7: Commit**

```bash
git add src/modules/coordinator/dispatch.ts src/modules/coordinator/index.ts tests/modules/coordinator/dispatch-session-id.test.ts
git commit -m "feat(coordinator): surface child session id on DispatchResult"
```

### Task 2: Make `createCheckpoint`'s `update-ref` create-only

The freshness guard (§6): a host-restart-resumed Svarog session must not clobber its original pre-edit checkpoint. The fix lives in `createCheckpoint` (the only code that runs before the edit).

**Files:**
- Modify: `src/modules/svarog/checkpoint.ts:48-50` (the `update-ref` write)
- Test: `tests/modules/svarog/checkpoint.test.ts` (add a case)

- [ ] **Step 1: Write the failing test**

Add to `tests/modules/svarog/checkpoint.test.ts` (a temp git repo helper already exists in that file — reuse it; the sketch shows the assertion):

```typescript
it("createCheckpoint refuses to overwrite an existing same-session ref", () => {
  // repo: one commit, one tracked file "a.txt" = "v1"
  const ref = createCheckpoint(cwd, "ses_fixed")
  const first = git(cwd, ["rev-parse", ref])

  // simulate a resumed session editing further, then re-checkpointing
  writeFileSync(join(cwd, "a.txt"), "v2-partial")
  const ref2 = createCheckpoint(cwd, "ses_fixed") // SAME session id
  const second = git(cwd, ["rev-parse", ref2])

  expect(ref2).toBe(ref)
  expect(second).toBe(first) // ref still points at the ORIGINAL pre-edit tree, not v2-partial
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/svarog/checkpoint.test.ts`
Expected: FAIL — current `update-ref` is unconditional, so the second call overwrites and `second !== first`.

- [ ] **Step 3: Guard the `update-ref` to be create-only**

`src/modules/svarog/checkpoint.ts`, replace the `update-ref` write (`:48-49`) so an existing ref is kept, not overwritten:

```typescript
    const ref = `refs/svarog/ckpt/${sessionId}`
    // Create-only: if this session already checkpointed (e.g. a host-restart resume re-fired
    // the hook after partial edits), KEEP the original pre-edit ref — never clobber it.
    let exists = true
    try {
      git(cwd, ["rev-parse", "--verify", "--quiet", ref])
    } catch {
      exists = false
    }
    if (!exists) git(cwd, ["update-ref", ref, commit])
    return ref
```

- [ ] **Step 4: Run the test + the full checkpoint suite**

Run: `bunx vitest run tests/modules/svarog/checkpoint.test.ts`
Expected: PASS (new case green; the existing create/restore cases still green — first-time creation is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/modules/svarog/checkpoint.ts tests/modules/svarog/checkpoint.test.ts
git commit -m "fix(svarog): make createCheckpoint update-ref create-only (freshness guard)"
```

---


## Phase 2 — Pure logic + persistence

These files have no tool wiring and no I/O beyond `git-ops`/`sidecar` disk — they are the deterministic core every Phase-3 tool calls. Build them bottom-up: `types` first (every file imports it), then the leaf pure functions, then the persistence + git layers.

### Task 3: The sidecar type contract (`types.ts`)

The single source of truth for every field name later tasks use verbatim (note `dispatch_count_total` is the MAXD gate, distinct from the per-row `dispatches_this_iter`). Pure types, no logic — so the "test" is a compile-time `expectTypeOf` assertion that the contract shape exists.

**Files:**
- Create: `src/modules/qa-loop/types.ts`
- Test: `tests/modules/qa-loop/types.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest"
import type {
  Sidecar,
  ScenarioRecord,
  IssueRecord,
  FixRecord,
  IterationRecord,
  Coverage,
  ScenarioKind,
  IssueStatus,
  SvarogStatus,
  IterationPhase,
  StopCause,
  RunResult,
  Mode,
  SeverityFloor,
} from "../../../src/modules/qa-loop/types.js"

describe("qa-loop sidecar contract", () => {
  it("exposes the load-bearing field names", () => {
    expectTypeOf<Sidecar["version"]>().toEqualTypeOf<1>()
    expectTypeOf<Sidecar["budgets"]["dispatch_count_total"]>().toEqualTypeOf<number>()
    expectTypeOf<Sidecar["budgets"]["iteration"]>().toEqualTypeOf<number>()
    expectTypeOf<Sidecar["result"]>().toEqualTypeOf<RunResult | null>()
    expectTypeOf<Sidecar["scenarios"]>().toEqualTypeOf<Record<string, ScenarioRecord>>()
    expectTypeOf<Sidecar["issues"]>().toEqualTypeOf<Record<string, IssueRecord>>()
    expectTypeOf<Sidecar["iterations"]>().toEqualTypeOf<IterationRecord[]>()
    expectTypeOf<IterationRecord["dispatches_this_iter"]>().toEqualTypeOf<number>()
    expectTypeOf<IssueRecord["fix"]>().toEqualTypeOf<FixRecord>()
    expectTypeOf<FixRecord["child_session_id"]>().toEqualTypeOf<string | null>()
    expectTypeOf<Coverage["not_verified"]["mutation-guard"]>().toEqualTypeOf<number>()
  })

  it("constrains the unions to their spec values", () => {
    expectTypeOf<ScenarioKind>().toEqualTypeOf<"feature" | "sanity" | "negative">()
    expectTypeOf<SvarogStatus>().toEqualTypeOf<"READY" | "FAIL" | "ESCALATE">()
    expectTypeOf<RunResult>().toEqualTypeOf<
      "Pass" | "Fail" | "BudgetExhausted" | "Stopped" | "NotVerified"
    >()
    expectTypeOf<Mode>().toEqualTypeOf<"approve" | "auto" | "step">()
    expectTypeOf<SeverityFloor>().toEqualTypeOf<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">()
    expectTypeOf<IssueStatus>().toEqualTypeOf<
      "open" | "fix-attempted" | "fix-failed" | "deferred" | "fixed"
    >()
    expectTypeOf<IterationPhase>().toEqualTypeOf<
      | "selecting"
      | "awaiting_fix_gate"
      | "fixing"
      | "awaiting_retest_gate"
      | "retested"
      | "evaluated"
    >()
    expectTypeOf<StopCause>().toEqualTypeOf<
      | "zero-failure"
      | "regression"
      | "no-progress"
      | "all-deferred"
      | "max-iterations"
      | "max-dispatches"
      | "time-budget"
      | "user-abort"
      | "plan-tamper"
      | "checkpoint-integrity"
    >()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/types.test.ts`
Expected: FAIL — `src/modules/qa-loop/types.ts` does not exist (module-not-found / type import errors).

- [ ] **Step 3: Create `types.ts` (the contract block from the plan)**

`src/modules/qa-loop/types.ts`:

```typescript
export type SeverityFloor = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type Mode = "approve" | "auto" | "step"
export type ScenarioKind = "feature" | "sanity" | "negative"
export type ScenarioState = "pass" | "fail" | "skip"
export type IssueStatus = "open" | "fix-attempted" | "fix-failed" | "deferred" | "fixed"
export type SvarogStatus = "READY" | "FAIL" | "ESCALATE"
export type IterationPhase =
  | "selecting" | "awaiting_fix_gate" | "fixing"
  | "awaiting_retest_gate" | "retested" | "evaluated"
export type StopCause =
  | "zero-failure" | "regression" | "no-progress" | "all-deferred"
  | "max-iterations" | "max-dispatches" | "time-budget"
  | "user-abort" | "plan-tamper" | "checkpoint-integrity"
export type RunResult = "Pass" | "Fail" | "BudgetExhausted" | "Stopped" | "NotVerified"

export interface ScenarioRecord {
  qa_ids: string[]
  kind: ScenarioKind
  section: "FE" | "BE" | "SETUP"
  mutating: boolean          // classify.ts; stripped pre-dispatch unless allow_mutations / negative-blocked
  baseline: ScenarioState    // immutable after Phase 1
  current: ScenarioState     // mutated by ingest
  reason: string | null      // SKIP/NEED_INFO reason
}

export interface FixRecord {
  svarog_status: SvarogStatus | null
  escalate_reason: string | null
  child_session_id: string | null   // from DispatchResult.sessionId, written by record_fix
  checkpoint_ref: string | null      // refs/svarog/ckpt/<child_session_id>, or null if no edit
  changed: string[]
  hardcode_warnings: string[]
}

export interface IssueRecord {
  severity: SeverityFloor
  scenario: string
  location: string | null
  title: string
  problem: string
  remediation: string
  status: IssueStatus
  fixed_at: string | null
  fix: FixRecord
}

export interface IterationRecord {
  n: number
  phase: IterationPhase
  pending: string[]            // QA-IDs queued
  in_flight: string | null     // QA-ID marked just before dispatch
  attempted_so_far: string[]   // QA-IDs whose record_fix completed
  now_passing: string[]
  still_failing: string[]
  stop_cause: StopCause | null
  regressions: string[]
  warnings: string[]
  dispatches_this_iter: number // per-row snapshot, NOT the MAXD gate
  elapsed_s: number
}

export interface Coverage {
  exercised: { feature: number; sanity: number; enforcement: number }
  not_verified: { "auth-unverified": number; "mutation-guard": number; "tool-unavailable": number }
  routing_warnings: string[]
}

export interface Sidecar {
  version: 1
  run_id: string                 // "qa-loop-<topic>-<n>"; the <run> in refs/qa-loop/pre/<run>
  plan_path: string
  plan_sha256: string
  report_path: string
  config: {
    mode: Mode
    severity_floor: SeverityFloor
    max_iterations: number
    max_dispatches: number
    time_budget_s: number
    allow_mutations: boolean
  }
  started_at: number
  updated_at: number
  finalized_at: number | null
  budgets: {
    iteration: number            // 0 before loop; step(enter) increments; body admitted iff iteration <= MAXI
    dispatch_count_total: number // AUTHORITATIVE MAXD gate
    elapsed_s: number
    final_pass_elapsed_s: number | null // final-pass component of TB overage only
  }
  pre_loop: { undo_ref: string; dirty: boolean; dirty_files: string[] }
  scenarios: Record<string, ScenarioRecord> // keyed by "FE-01" etc.
  issues: Record<string, IssueRecord>        // keyed by "QA-001" etc.
  iterations: IterationRecord[]
  coverage: Coverage
  result: RunResult | null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/types.test.ts`
Expected: PASS (all `expectTypeOf` assertions resolve; the contract shape compiles).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/types.ts tests/modules/qa-loop/types.test.ts
git commit -m "feat(qa-loop): add sidecar type contract"
```

### Task 4: Plan hashing (`plan-hash.ts`)

The idempotency + mid-run tamper primitive (§5 REUSE/ADOPT/FRESH, §4 step-2.0 re-hash). In-process `node:crypto` sha256 hex — never `shasum` (the coordinator security model, §3 D4: the tools hash, Perun never shells).

**Files:**
- Create: `src/modules/qa-loop/plan-hash.ts`
- Test: `tests/modules/qa-loop/plan-hash.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/plan-hash.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { hashPlan } from "../../../src/modules/qa-loop/plan-hash.js"

describe("hashPlan", () => {
  it("returns the sha256 hex of the plan text", () => {
    const text = "# Test plan\nFE-01: do a thing\n"
    const expected = createHash("sha256").update(text, "utf8").digest("hex")
    expect(hashPlan(text)).toBe(expected)
  })

  it("is deterministic — same input, same hash", () => {
    const text = "BE-02: assert 200\n"
    expect(hashPlan(text)).toBe(hashPlan(text))
  })

  it("is sensitive — a one-byte change flips the hash (tamper guard)", () => {
    expect(hashPlan("FE-01: a")).not.toBe(hashPlan("FE-01: b"))
  })

  it("produces a 64-char lowercase hex string", () => {
    expect(hashPlan("anything")).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/plan-hash.test.ts`
Expected: FAIL — `hashPlan` does not exist (module-not-found).

- [ ] **Step 3: Implement `plan-hash.ts`**

`src/modules/qa-loop/plan-hash.ts`:

```typescript
import { createHash } from "node:crypto"

/**
 * sha256 hex of the raw plan text. In-process (node:crypto) — never `shasum`,
 * because the qa-loop tools hash but the coordinator (Perun) never shells (§3 D4).
 * Used for §5 idempotency (REUSE/ADOPT/FRESH) and the §4 step-2.0 mid-run tamper guard.
 */
export function hashPlan(planText: string): string {
  return createHash("sha256").update(planText, "utf8").digest("hex")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/plan-hash.test.ts`
Expected: PASS (all four cases green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/plan-hash.ts tests/modules/qa-loop/plan-hash.test.ts
git commit -m "feat(qa-loop): add in-process plan hashing"
```

### Task 5: Scenario classification + mutation/expected-outcome rules (`classify.ts`)

§5 taxonomy (`feature`/`sanity`/`negative`) + §7 mutation guard. `classifyScenario` returns `kind`, `mutating` (HTTP `POST`/`PUT`/`PATCH`/`DELETE` or a write/DB-write step), and `expectsSuccess` (the strip keys on *expected outcome*, not the verb: a `negative` scenario asserting the mutation is **blocked** has `expectsSuccess=false` and is NOT stripped; only a mutating scenario expected to **succeed** is stripped).

**Files:**
- Create: `src/modules/qa-loop/classify.ts`
- Test: `tests/modules/qa-loop/classify.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/classify.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { classifyScenario } from "../../../src/modules/qa-loop/classify.js"

describe("classifyScenario — kind taxonomy (§5)", () => {
  it("classifies a negative scenario (asserts rejection/blocked)", () => {
    const block =
      "BE-03: Reject unauthorized DELETE\nExpect the DELETE to be blocked (403), no state change."
    const r = classifyScenario(block)
    expect(r.kind).toBe("negative")
  })

  it("classifies a sanity/smoke scenario", () => {
    const block = "BE-02: Smoke — GET /health returns 200 (baseline sanity check)."
    const r = classifyScenario(block)
    expect(r.kind).toBe("sanity")
  })

  it("classifies a feature scenario by default", () => {
    const block = "FE-01: User can submit the new contact form and see a success toast."
    const r = classifyScenario(block)
    expect(r.kind).toBe("feature")
  })
})

describe("classifyScenario — mutation detection (§7)", () => {
  it("flags an HTTP POST as mutating", () => {
    const r = classifyScenario("BE-04: POST /api/orders creates an order, expect 201.")
    expect(r.mutating).toBe(true)
  })

  it("flags PUT/PATCH/DELETE as mutating", () => {
    expect(classifyScenario("BE: PUT /api/x").mutating).toBe(true)
    expect(classifyScenario("BE: PATCH /api/x").mutating).toBe(true)
    expect(classifyScenario("BE: DELETE /api/x").mutating).toBe(true)
  })

  it("flags a DB write step as mutating", () => {
    const r = classifyScenario("BE-05: INSERT INTO orders, then verify the row exists.")
    expect(r.mutating).toBe(true)
  })

  it("treats a read-only GET as non-mutating", () => {
    const r = classifyScenario("BE-06: GET /api/orders returns the list, expect 200.")
    expect(r.mutating).toBe(false)
  })
})

describe("classifyScenario — expected-outcome rule (§7, AC19/AC20)", () => {
  it("a mutating scenario expected to SUCCEED -> expectsSuccess true (strippable)", () => {
    const r = classifyScenario("BE-04: POST /api/orders creates an order, expect 201.")
    expect(r.mutating).toBe(true)
    expect(r.expectsSuccess).toBe(true)
  })

  it("a negative mutating scenario asserting BLOCKED -> expectsSuccess false (NOT stripped)", () => {
    const r = classifyScenario(
      "BE-03: Unauthorized POST /api/orders must be rejected (403), no row created.",
    )
    expect(r.mutating).toBe(true)
    expect(r.expectsSuccess).toBe(false)
  })

  it("a non-mutating scenario is expectsSuccess true regardless of kind", () => {
    const r = classifyScenario("BE-06: GET /api/orders returns 200.")
    expect(r.expectsSuccess).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/classify.test.ts`
Expected: FAIL — `classifyScenario` does not exist (module-not-found).

- [ ] **Step 3: Implement `classify.ts`**

`src/modules/qa-loop/classify.ts`:

```typescript
import type { ScenarioKind } from "./types.js"

const MUTATING_VERB = /\b(POST|PUT|PATCH|DELETE)\b/
const DB_WRITE =
  /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+\w|CREATE\s+TABLE|UPSERT|TRUNCATE)\b/i
const WRITE_STEP = /\b(create|delete|update|insert|write|mutate|persist|save)s?\b/i

// "the mutation must be blocked / rejected / denied / forbidden / 401 / 403 / 4xx, no state change"
const BLOCKED =
  /\b(reject(ed|s)?|block(ed|s)?|den(y|ied|ies)|forbidden|unauthor(ized|ised)|must\s+not|should\s+not|no\s+(state\s+change|row|change)|401|403|4\d\d\b)/i
const NEGATIVE_HINT =
  /\b(reject|block|deny|denied|forbidden|unauthor|invalid|must\s+not|should\s+not|negative)\b/i
const SANITY_HINT = /\b(smoke|sanity|baseline|health\s*check|healthcheck|ping)\b/i

/**
 * §5 kind taxonomy + §7 mutation/expected-outcome rules over a scenario's raw text block.
 *
 * - kind: `negative` (asserts a rejection/block) › `sanity` (smoke/baseline) › `feature` (default).
 * - mutating: an HTTP POST/PUT/PATCH/DELETE, an SQL write, or a write-ish step verb.
 * - expectsSuccess: false ONLY when the scenario asserts the mutation is BLOCKED (negative-blocked);
 *   the §7 mutation guard strips a scenario iff `mutating && expectsSuccess` — a negative-blocked
 *   mutating scenario stays in the dispatch set (the write never lands, AC19), while a mutating
 *   scenario expected to succeed is stripped (AC20).
 */
export function classifyScenario(block: string): {
  kind: ScenarioKind
  mutating: boolean
  expectsSuccess: boolean
} {
  const mutating =
    MUTATING_VERB.test(block) || DB_WRITE.test(block) || WRITE_STEP.test(block)

  const blocked = BLOCKED.test(block)
  let kind: ScenarioKind = "feature"
  if (NEGATIVE_HINT.test(block) || blocked) kind = "negative"
  else if (SANITY_HINT.test(block)) kind = "sanity"

  // A negative scenario asserting the mutation is blocked expects a non-2xx / no-state-change,
  // so it does NOT expect success — and is therefore exempt from the mutation-guard strip.
  const expectsSuccess = !(kind === "negative" && blocked)

  return { kind, mutating, expectsSuccess }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/classify.test.ts`
Expected: PASS (kind, mutation, and expected-outcome cases all green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/classify.ts tests/modules/qa-loop/classify.test.ts
git commit -m "feat(qa-loop): add scenario classifier + mutation/expected-outcome rules"
```

### Task 6: Sidecar persistence (`sidecar.ts`)

§5 persistence: an in-process `Map` keyed by parent session **plus** an atomic disk-JSON layer for cross-session resume (the new code `QaRunState` lacks). `load(parentId)` prefers the in-process entry, falls back to the sidecar path on disk; `save` writes both. The disk path is the sidecar JSON next to the report: `docs/testing/reports/<date>-<topic>-loop-state.json`. (REUSE/ADOPT/FRESH *disposition* and plan-tamper *detection* are decided in `qa_loop_start` from what `load` returns vs the hash — this file just round-trips the `Sidecar` honestly; the start tool layers the §5 disposition logic on top.)

**Files:**
- Create: `src/modules/qa-loop/sidecar.ts`
- Test: `tests/modules/qa-loop/sidecar.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/sidecar.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function makeSidecar(reportDir: string): Sidecar {
  return {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md",
    plan_sha256: "abc123",
    report_path: join(reportDir, "2026-06-26-demo-report.md"),
    config: {
      mode: "approve",
      severity_floor: "LOW",
      max_iterations: 3,
      max_dispatches: 50,
      time_budget_s: 1800,
      allow_mutations: false,
    },
    started_at: 1000,
    updated_at: 1000,
    finalized_at: null,
    budgets: {
      iteration: 0,
      dispatch_count_total: 0,
      elapsed_s: 0,
      final_pass_elapsed_s: null,
    },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {},
    issues: {},
    iterations: [],
    coverage: {
      exercised: { feature: 0, sanity: 0, enforcement: 0 },
      not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 },
      routing_warnings: [],
    },
    result: null,
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qa-loop-sidecar-"))
})

describe("QaLoopState", () => {
  it("returns undefined when nothing is stored", () => {
    const st = new QaLoopState()
    expect(st.load("ses_parent")).toBeUndefined()
  })

  it("round-trips a sidecar via the in-process map", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)
    expect(st.load("ses_parent")).toEqual(s)
  })

  it("writes the sidecar to its report_path-derived disk path atomically", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)

    // disk path = report_path with the -report.md stem swapped for -loop-state.json
    const expectedPath = join(dir, "2026-06-26-demo-loop-state.json")
    expect(existsSync(expectedPath)).toBe(true)
    const onDisk = JSON.parse(readFileSync(expectedPath, "utf8")) as Sidecar
    expect(onDisk).toEqual(s)
    // atomic write leaves no .tmp turd behind
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false)
  })

  it("loads from disk when the in-process map is cold (cross-session resume)", () => {
    const writer = new QaLoopState()
    const s = makeSidecar(dir)
    writer.save("ses_parent", s)

    // a fresh process: empty map, but the same parent id can be primed from disk
    const reader = new QaLoopState()
    expect(reader.loadFromDisk(s.report_path)).toEqual(s)
  })

  it("overwrites a prior save (single-writer durability)", () => {
    const st = new QaLoopState()
    const s = makeSidecar(dir)
    st.save("ses_parent", s)
    const s2 = { ...s, updated_at: 2000, budgets: { ...s.budgets, dispatch_count_total: 4 } }
    st.save("ses_parent", s2)
    expect(st.load("ses_parent")?.budgets.dispatch_count_total).toBe(4)
    const expectedPath = join(dir, "2026-06-26-demo-loop-state.json")
    expect((JSON.parse(readFileSync(expectedPath, "utf8")) as Sidecar).updated_at).toBe(2000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/sidecar.test.ts`
Expected: FAIL — `QaLoopState` does not exist (module-not-found).

- [ ] **Step 3: Implement `sidecar.ts`**

`src/modules/qa-loop/sidecar.ts`:

```typescript
import { renameSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { Sidecar } from "./types.js"

/**
 * Derive the gitignored sidecar path from the report path: the `<date>-<topic>` stem
 * matches the report so REUSE/ADOPT can pair them (§5). `…-report.md` -> `…-loop-state.json`;
 * any other report basename just gets `-loop-state.json` appended to its stem.
 */
export function sidecarPathFor(reportPath: string): string {
  const dir = dirname(reportPath)
  const base = basename(reportPath)
  const stem = base.endsWith("-report.md")
    ? base.slice(0, -"-report.md".length)
    : base.replace(/\.md$/, "")
  return join(dir, `${stem}-loop-state.json`)
}

/**
 * Tool-owned sidecar persistence: an in-process Map (speed, same shape as QaRunState)
 * PLUS an atomic disk-JSON layer (durability + cross-session resume that QaRunState lacks).
 * The qa-loop tool is the single writer of both layers (§5).
 */
export class QaLoopState {
  private readonly mem = new Map<string, Sidecar>()

  /** In-process lookup by parent (Perun) session id; undefined when cold. */
  load(parentId: string): Sidecar | undefined {
    return this.mem.get(parentId)
  }

  /** Write both layers: in-process map + atomic disk JSON at the sidecar path. */
  save(parentId: string, s: Sidecar): void {
    this.mem.set(parentId, s)
    const path = sidecarPathFor(s.report_path)
    const tmp = `${path}.tmp`
    // atomic: write to a sibling temp file, then rename over the target (same dir => atomic on POSIX).
    writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8")
    renameSync(tmp, path)
  }

  /**
   * Cross-session resume primitive: read the sidecar straight off disk by report path,
   * bypassing the cold in-process map. `qa_loop_start` uses this to decide REUSE/ADOPT.
   */
  loadFromDisk(reportPath: string): Sidecar | undefined {
    const path = sidecarPathFor(reportPath)
    if (!existsSync(path)) return undefined
    return JSON.parse(readFileSync(path, "utf8")) as Sidecar
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/sidecar.test.ts`
Expected: PASS (in-process round-trip, atomic disk write with no `.tmp` residue, cross-session `loadFromDisk`, overwrite durability).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/sidecar.ts tests/modules/qa-loop/sidecar.test.ts
git commit -m "feat(qa-loop): add sidecar persistence (in-process map + atomic disk JSON)"
```

### Task 7: The loop state machine (`state-machine.ts`)

Pure decision logic, no I/O (§4). `stepEnter` increments `iteration` and admits the body iff `iteration <= MAXI` — but is **idempotent on re-entry**: if `iterations[n]` already exists with `stop_cause=null` and `phase` not yet `evaluated`, it resumes without a second increment (so MAXI is never miscounted). `stepEvaluate` checks **regression FIRST** (passed baseline, now fails ⇒ stop), **then** no-progress (no scenario newly passes ⇒ stop). `resultOf` is the §4 Result mapping. Stop-cause is a **deterministic max** over every fired cause (the §4 precedence), never control-flow order.

**Files:**
- Create: `src/modules/qa-loop/state-machine.ts`
- Test: `tests/modules/qa-loop/state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/state-machine.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  stepEnter,
  stepEvaluate,
  resultOf,
} from "../../../src/modules/qa-loop/state-machine.js"
import type { Sidecar, ScenarioRecord, IterationRecord } from "../../../src/modules/qa-loop/types.js"

function scenario(p: Partial<ScenarioRecord>): ScenarioRecord {
  return {
    qa_ids: [],
    kind: "feature",
    section: "FE",
    mutating: false,
    baseline: "pass",
    current: "pass",
    reason: null,
    ...p,
  }
}

function iter(p: Partial<IterationRecord>): IterationRecord {
  return {
    n: 1,
    phase: "selecting",
    pending: [],
    in_flight: null,
    attempted_so_far: [],
    now_passing: [],
    still_failing: [],
    stop_cause: null,
    regressions: [],
    warnings: [],
    dispatches_this_iter: 0,
    elapsed_s: 0,
    ...p,
  }
}

function base(p: Partial<Sidecar> = {}): Sidecar {
  return {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "p.md",
    plan_sha256: "h",
    report_path: "r-report.md",
    config: {
      mode: "approve",
      severity_floor: "LOW",
      max_iterations: 3,
      max_dispatches: 50,
      time_budget_s: 1800,
      allow_mutations: false,
    },
    started_at: 0,
    updated_at: 0,
    finalized_at: null,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {},
    issues: {},
    iterations: [],
    coverage: {
      exercised: { feature: 0, sanity: 0, enforcement: 0 },
      not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 },
      routing_warnings: [],
    },
    result: null,
    ...p,
  }
}

describe("stepEnter — increment + admit iff iteration <= MAXI (§4)", () => {
  it("admits a fix-set while failures remain and iteration <= MAXI", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      issues: {
        "QA-001": {
          severity: "HIGH", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "open", fixed_at: null,
          fix: { svarog_status: null, escalate_reason: null, child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
    })
    const r = stepEnter(s)
    expect(s.budgets.iteration).toBe(1)
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual(["QA-001"])
  })

  it("stops with max-iterations when the increment makes iteration > MAXI", () => {
    const s = base({
      budgets: { iteration: 3, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
    })
    const r = stepEnter(s)
    expect(s.budgets.iteration).toBe(4)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("max-iterations")
  })

  it("stops with max-dispatches when dispatch_count_total >= MAXD (the authoritative gate)", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 50, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("max-dispatches")
  })

  it("stops with time-budget when elapsed_s >= TB", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 1800, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("time-budget")
  })

  it("goes to final when no scenario is still failing", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "pass" }) },
    })
    const r = stepEnter(s)
    expect(r.action).toBe("final")
  })

  it("is idempotent on re-entry: an unfinished iteration row resumes WITHOUT a second increment", () => {
    const s = base({
      budgets: { iteration: 1, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail", qa_ids: ["QA-001"] }) },
      iterations: [iter({ n: 1, phase: "awaiting_fix_gate", pending: ["QA-001"], stop_cause: null })],
    })
    const r = stepEnter(s)
    expect(s.budgets.iteration).toBe(1) // NOT 2 — resumed, not re-entered
    expect(r.action).toBe("fix")
    expect(r.issues).toEqual(["QA-001"])
  })

  it("resolves stop-cause by precedence when several fire (max-dispatches > time-budget)", () => {
    const s = base({
      budgets: { iteration: 0, dispatch_count_total: 50, elapsed_s: 1800, final_pass_elapsed_s: null },
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEnter(s)
    // both budgets fired; precedence orders max-iterations/max-dispatches/time deterministically
    expect(r.stop_cause).toBe("max-dispatches")
  })
})

describe("stepEvaluate — regression FIRST, then no-progress (§4)", () => {
  it("stops on regression: a baseline-pass scenario now fails", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "pass" }), // progress exists
        "BE-02": scenario({ baseline: "pass", current: "fail" }), // regression
      },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("regression")
  })

  it("regression beats no-progress when both could fire", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "fail" }), // no progress
        "BE-02": scenario({ baseline: "pass", current: "fail" }), // regression
      },
    })
    const r = stepEvaluate(s)
    expect(r.stop_cause).toBe("regression")
  })

  it("stops on no-progress when no scenario newly passes and no regression", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "fail" }) },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("stop")
    expect(r.stop_cause).toBe("no-progress")
  })

  it("continues when a scenario newly passes and nothing regressed", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ baseline: "fail", current: "pass" }), // newly passing
        "BE-02": scenario({ baseline: "fail", current: "fail" }),
      },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("continue")
  })

  it("goes to final when all scenarios pass (zero remaining failures)", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ baseline: "fail", current: "pass" }) },
    })
    const r = stepEvaluate(s)
    expect(r.action).toBe("final")
  })
})

describe("resultOf — the §4 Result mapping (order Pass > NotVerified > BudgetExhausted > Stopped > Fail)", () => {
  it("Pass: no fail >= floor AND >=1 feature-kind scenario passed", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ kind: "feature", baseline: "pass", current: "pass" }),
        "BE-02": scenario({ kind: "sanity", baseline: "pass", current: "pass" }),
      },
    })
    expect(resultOf(s)).toBe("Pass")
  })

  it("NotVerified: no scenario in a pass state", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "skip", current: "skip" }) },
    })
    expect(resultOf(s)).toBe("NotVerified")
  })

  it("NotVerified: every feature-kind scenario landed in not_verified even though sanity passes", () => {
    const s = base({
      scenarios: {
        "FE-01": scenario({ kind: "feature", baseline: "skip", current: "skip" }),
        "BE-02": scenario({ kind: "sanity", baseline: "pass", current: "pass" }),
      },
    })
    expect(resultOf(s)).toBe("NotVerified")
  })

  it("Pass is checked before BudgetExhausted: a budget-stopped run whose final is green reports Pass", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "pass" }) },
      iterations: [iter({ n: 1, stop_cause: "max-dispatches" })],
    })
    expect(resultOf(s)).toBe("Pass")
  })

  it("BudgetExhausted: a budget stop whose final is NOT green", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      iterations: [iter({ n: 1, stop_cause: "time-budget" })],
    })
    expect(resultOf(s)).toBe("BudgetExhausted")
  })

  it("Stopped: a user-abort / plan-tamper / checkpoint-integrity stop that is not green", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      iterations: [iter({ n: 1, stop_cause: "plan-tamper" })],
    })
    expect(resultOf(s)).toBe("Stopped")
  })

  it("Fail: a sub-floor fail with no >=floor fail still falls through to Fail", () => {
    const s = base({
      config: { ...base().config, severity_floor: "CRITICAL" },
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      issues: {
        "QA-001": {
          severity: "LOW", scenario: "FE-01", location: "f:1", title: "t",
          problem: "p", remediation: "r", status: "open", fixed_at: null,
          fix: { svarog_status: null, escalate_reason: null, child_session_id: null,
            checkpoint_ref: null, changed: [], hardcode_warnings: [] },
        },
      },
    })
    expect(resultOf(s)).toBe("Fail")
  })

  it("Fail: regression / no-progress / all-deferred terminal with nothing green", () => {
    const s = base({
      scenarios: { "FE-01": scenario({ kind: "feature", baseline: "fail", current: "fail" }) },
      iterations: [iter({ n: 1, stop_cause: "regression" })],
    })
    expect(resultOf(s)).toBe("Fail")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/state-machine.test.ts`
Expected: FAIL — `stepEnter`/`stepEvaluate`/`resultOf` do not exist (module-not-found).

- [ ] **Step 3: Implement `state-machine.ts`**

`src/modules/qa-loop/state-machine.ts`:

```typescript
import type { ScenarioRecord, Sidecar, StopCause, RunResult, SeverityFloor } from "./types.js"

const SEVERITY_RANK: Record<SeverityFloor, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

// §4 stop-cause precedence, top first. The tool resolves to the single highest-precedence
// cause that ACTUALLY FIRED via a deterministic max over this order — NOT control-flow order.
const STOP_PRECEDENCE: StopCause[] = [
  "checkpoint-integrity",
  "plan-tamper",
  "regression",
  "all-deferred",
  "no-progress",
  "max-iterations",
  "max-dispatches",
  "time-budget",
  "zero-failure",
  "user-abort",
]

/** Deterministic max over fired causes by the §4 precedence (lower index = higher precedence). */
export function resolveStopCause(fired: StopCause[]): StopCause | undefined {
  let best: StopCause | undefined
  let bestRank = Infinity
  for (const c of fired) {
    const rank = STOP_PRECEDENCE.indexOf(c)
    if (rank !== -1 && rank < bestRank) {
      best = c
      bestRank = rank
    }
  }
  return best
}

function stillFailing(s: Sidecar): string[] {
  return Object.entries(s.scenarios)
    .filter(([, sc]) => sc.current === "fail")
    .map(([id]) => id)
}

/**
 * §4 step 2.0 (enter). Idempotent on re-entry: if the current iteration row exists with
 * stop_cause=null and phase not yet `evaluated`, resume it WITHOUT a second increment
 * (so MAXI is never miscounted). Otherwise increment `iteration` first, then admit the body
 * IFF `iteration <= MAXI` (post-increment) AND a budget hasn't fired. Returns the fix-set,
 * a stop (with the precedence-resolved cause), or `final` when nothing is still failing.
 */
export function stepEnter(s: Sidecar): {
  action: "fix" | "stop" | "final"
  issues?: string[]
  stop_cause?: StopCause
} {
  const failing = stillFailing(s)
  if (failing.length === 0) return { action: "final" }

  // Idempotent re-entry: an unfinished row for the CURRENT iteration resumes in place.
  const current = s.iterations.find(
    (it) => it.n === s.budgets.iteration && it.stop_cause === null && it.phase !== "evaluated",
  )
  if (current) {
    return { action: "fix", issues: issuesFor(s, failing) }
  }

  // Fresh entry: budgets are TRUE ceilings checked at the boundary (dispatch_count_total
  // is the authoritative MAXD gate). Collect every fired cause, resolve by precedence.
  const fired: StopCause[] = []
  if (s.budgets.dispatch_count_total >= s.config.max_dispatches) fired.push("max-dispatches")
  if (s.budgets.elapsed_s >= s.config.time_budget_s) fired.push("time-budget")

  s.budgets.iteration += 1
  if (s.budgets.iteration > s.config.max_iterations) fired.push("max-iterations")

  const stop_cause = resolveStopCause(fired)
  if (stop_cause) return { action: "stop", stop_cause }

  return { action: "fix", issues: issuesFor(s, failing) }
}

/** QA-IDs attached to the still-failing scenarios (the candidate fix-set; §2a selection refines it). */
function issuesFor(s: Sidecar, failing: string[]): string[] {
  const ids: string[] = []
  for (const id of failing) {
    for (const qa of s.scenarios[id]?.qa_ids ?? []) ids.push(qa)
  }
  return ids
}

/**
 * §4 step 2f (evaluate). No increment. Regression is checked FIRST (a scenario that passed
 * baseline now fails ⇒ stop), THEN no-progress (no scenario newly passes ⇒ stop). Both are
 * collected and resolved by precedence so regression wins when both fire. `final` when zero
 * scenarios still fail; otherwise `continue`.
 */
export function stepEvaluate(s: Sidecar): {
  action: "continue" | "stop" | "final"
  stop_cause?: StopCause
} {
  const records = Object.values(s.scenarios)
  const regressed = records.some((sc) => sc.baseline === "pass" && sc.current === "fail")
  const newlyPassing = records.some((sc) => sc.baseline === "fail" && sc.current === "pass")

  const fired: StopCause[] = []
  if (regressed) fired.push("regression")
  if (!newlyPassing) fired.push("no-progress")

  const stop_cause = resolveStopCause(fired)
  if (stop_cause) return { action: "stop", stop_cause }

  if (stillFailing(s).length === 0) return { action: "final" }
  return { action: "continue" }
}

function hasFailAtOrAboveFloor(s: Sidecar): boolean {
  const floor = SEVERITY_RANK[s.config.severity_floor]
  return Object.values(s.issues).some((iss) => {
    const sc = s.scenarios[iss.scenario]
    return sc?.current === "fail" && SEVERITY_RANK[iss.severity] >= floor
  })
}

function lastStopCause(s: Sidecar): StopCause | null {
  for (let i = s.iterations.length - 1; i >= 0; i--) {
    if (s.iterations[i].stop_cause !== null) return s.iterations[i].stop_cause
  }
  return null
}

const BUDGET_CAUSES: StopCause[] = ["max-iterations", "max-dispatches", "time-budget"]
const STOPPED_CAUSES: StopCause[] = ["user-abort", "plan-tamper", "checkpoint-integrity"]

/**
 * §4 Result mapping, computed once (identical at the Phase-1 zero-failure exit and the Phase-3
 * final). Order is load-bearing: Pass > NotVerified > BudgetExhausted > Stopped > Fail.
 * - Pass: no fail >= floor AND >=1 feature-kind scenario PASSED (the final run is authoritative,
 *   so this is checked BEFORE BudgetExhausted — a budget-stopped run with a green final is Pass).
 * - NotVerified: no scenario is in a pass state, OR every feature-kind scenario landed in
 *   not_verified (no feature scenario passed) — a fully mutation-guarded feature surface is not green.
 * - BudgetExhausted: stopped on a budget cause and the final is not green.
 * - Stopped: user-abort / plan-tamper / checkpoint-integrity, not green.
 * - Fail: everything else (regression / no-progress / all-deferred / nothing left to fix).
 */
export function resultOf(s: Sidecar): RunResult {
  const records = Object.values(s.scenarios)
  const anyPass = records.some((sc) => sc.current === "pass")
  const featureScenarios = records.filter((sc) => sc.kind === "feature")
  const anyFeaturePass = featureScenarios.some((sc) => sc.current === "pass")

  if (!hasFailAtOrAboveFloor(s) && anyFeaturePass) return "Pass"

  // No-pass-state (AC13) OR all-feature-not_verified (AC16) both finalize NotVerified.
  if (!anyPass) return "NotVerified"
  if (featureScenarios.length > 0 && !anyFeaturePass) return "NotVerified"

  const stop = lastStopCause(s)
  if (stop && BUDGET_CAUSES.includes(stop)) return "BudgetExhausted"
  if (stop && STOPPED_CAUSES.includes(stop)) return "Stopped"
  return "Fail"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/state-machine.test.ts`
Expected: PASS (enter increment/admit/idempotency/budget precedence, evaluate regression-first/no-progress, and the full Result mapping order all green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/state-machine.ts tests/modules/qa-loop/state-machine.test.ts
git commit -m "feat(qa-loop): add loop state machine (enter/evaluate/result + stop precedence)"
```

### Task 8: Privileged git ops (`git-ops.ts`)

§6 recovery + anti-hardcoding. `capturePreLoopRef` snapshots the whole tree (incl. dirty work) into `refs/qa-loop/pre/<run>`; `refExists` is the existence check; `restoreFailRef` wraps the existing `restoreCheckpoint` (no new restore logic); `undoToPreLoop` reverts everything the loop did; `antiHardcodeDiff` flags added literals in `changed[]` that exactly match a BE scenario request-payload value (best-effort, non-blocking).

**Files:**
- Create: `src/modules/qa-loop/git-ops.ts`
- Test: `tests/modules/qa-loop/git-ops.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/git-ops.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  capturePreLoopRef,
  refExists,
  restoreFailRef,
  undoToPreLoop,
  antiHardcodeDiff,
} from "../../../src/modules/qa-loop/git-ops.js"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function initRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "qa-loop-git-"))
  git(cwd, ["init", "-q"])
  git(cwd, ["config", "user.email", "t@t.t"])
  git(cwd, ["config", "user.name", "t"])
  writeFileSync(join(cwd, "a.txt"), "v1")
  git(cwd, ["add", "-A"])
  git(cwd, ["commit", "-q", "-m", "init"])
  return cwd
}

let cwd: string
beforeEach(() => {
  cwd = initRepo()
})

describe("capturePreLoopRef / refExists / undoToPreLoop", () => {
  it("captures refs/qa-loop/pre/<run> including dirty work and undo restores it", () => {
    writeFileSync(join(cwd, "a.txt"), "dirty-pre")
    const ref = capturePreLoopRef(cwd, "qa-loop-demo-1")
    expect(ref).toBe("refs/qa-loop/pre/qa-loop-demo-1")
    expect(refExists(cwd, ref)).toBe(true)

    // loop edits the tree
    writeFileSync(join(cwd, "a.txt"), "loop-edited")
    writeFileSync(join(cwd, "new.txt"), "loop-created")

    undoToPreLoop(cwd, ref)
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("dirty-pre") // back to pre-loop dirty state
    expect(existsSync(join(cwd, "new.txt"))).toBe(false) // loop-created file removed
  })

  it("refExists is false for a never-captured ref", () => {
    expect(refExists(cwd, "refs/qa-loop/pre/never")).toBe(false)
  })
})

describe("restoreFailRef wraps restoreCheckpoint (cumulative-safe FAIL restore)", () => {
  it("reverts only this issue's edit to the checkpoint tree", () => {
    // a prior READY fix landed
    writeFileSync(join(cwd, "a.txt"), "prior-ready-fix")
    // checkpoint taken BEFORE issue-N's edit (contains the prior fix)
    const ckptRef = capturePreLoopRef(cwd, "ckpt-sesN")
    // issue-N edits + creates
    writeFileSync(join(cwd, "a.txt"), "issueN-broken")
    writeFileSync(join(cwd, "issueN.txt"), "issueN-created")

    restoreFailRef(cwd, ckptRef)
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("prior-ready-fix") // prior fix preserved
    expect(existsSync(join(cwd, "issueN.txt"))).toBe(false) // issue-N's created file removed
  })
})

describe("antiHardcodeDiff (§6, best-effort, non-blocking)", () => {
  it("flags an added literal that exactly matches a BE scenario payload value", () => {
    // checkpoint pre-edit
    const ckptRef = capturePreLoopRef(cwd, "ckpt-hc")
    // the fix hardcodes the test's expected payload value
    writeFileSync(join(cwd, "a.txt"), 'return { total: "EXPECTED-42" }')

    const warnings = antiHardcodeDiff(cwd, ckptRef, ["a.txt"], ['"EXPECTED-42"'])
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain("EXPECTED-42")
  })

  it("returns no warnings when no added literal matches a payload", () => {
    const ckptRef = capturePreLoopRef(cwd, "ckpt-clean")
    writeFileSync(join(cwd, "a.txt"), "const x = computeRealValue()")

    const warnings = antiHardcodeDiff(cwd, ckptRef, ["a.txt"], ['"EXPECTED-42"'])
    expect(warnings).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/git-ops.test.ts`
Expected: FAIL — none of the `git-ops` exports exist (module-not-found).

- [ ] **Step 3: Implement `git-ops.ts`**

`src/modules/qa-loop/git-ops.ts`:

```typescript
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { restoreCheckpoint } from "../svarog/checkpoint.js"

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf-8",
  }).trim()
}

/**
 * §6 total-undo capture. Snapshot the WHOLE working tree (tracked + untracked, excluding
 * gitignored — the same scope as createCheckpoint) into refs/qa-loop/pre/<run> BEFORE the first
 * fix, via a throwaway index so the live index/worktree are untouched. Capturing dirty work means
 * undoToPreLoop returns the user to exactly where they started (§6).
 */
export function capturePreLoopRef(cwd: string, runId: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-loop-pre-"))
  const idx = path.join(dir, "index")
  try {
    const rel = git(cwd, ["rev-parse", "--git-path", "index"])
    const realIndex = path.isAbsolute(rel) ? rel : path.join(cwd, rel)
    if (existsSync(realIndex)) copyFileSync(realIndex, idx)

    const env = { ...process.env, GIT_INDEX_FILE: idx }
    git(cwd, ["add", "-A"], env)
    const tree = git(cwd, ["write-tree"], env)
    const commit = git(cwd, ["commit-tree", tree, "-p", "HEAD", "-m", "qa-loop pre-loop"])
    const ref = `refs/qa-loop/pre/${runId}`
    git(cwd, ["update-ref", ref, commit])
    return ref
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** True iff `ref` resolves — the §6 existence check (checkpoint-integrity backstop + undo guard). */
export function refExists(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref])
    return true
  } catch {
    return false
  }
}

/**
 * §6 FAIL auto-restore — wraps the EXISTING restoreCheckpoint (no new restore logic). It is already
 * cumulative-safe: the checkpoint tree contains every prior READY fix, so this reverts only THIS
 * issue's edits (and deletes only files this issue created, by tree-diff) and preserves issues 1…N-1.
 */
export function restoreFailRef(cwd: string, ref: string): void {
  restoreCheckpoint(cwd, ref)
}

/** §6 total undo — revert everything the loop did by restoring the pre-loop ref (same mechanics). */
export function undoToPreLoop(cwd: string, ref: string): void {
  restoreCheckpoint(cwd, ref)
}

/**
 * §6 anti-hardcoding (best-effort, non-blocking). Diff each `changed[]` file against its own
 * checkpoint tree and flag ADDED lines whose text contains a BE scenario request-payload literal —
 * the av-marketplace heuristic for "the fix hardcoded the test's expected value." Recorded as
 * warnings only; surfaced in Loop History for human review. Best-effort over self-reported
 * `changed[]` (unlike the restore, which ignores `changed[]`).
 */
export function antiHardcodeDiff(
  cwd: string,
  ckptRef: string,
  changed: string[],
  bePayloads: string[],
): string[] {
  const warnings: string[] = []
  const payloads = bePayloads.map((p) => p.trim()).filter(Boolean)
  if (payloads.length === 0 || changed.length === 0) return warnings

  for (const file of changed) {
    let diff = ""
    try {
      diff = git(cwd, ["diff", "--no-color", ckptRef, "--", file])
    } catch {
      continue // file may not exist in the ckpt tree; skip best-effort
    }
    const addedLines = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    for (const line of addedLines) {
      for (const payload of payloads) {
        if (line.includes(payload)) {
          warnings.push(
            `${file}: added literal matching BE payload ${payload} — possible hardcoded test value`,
          )
        }
      }
    }
  }
  return warnings
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/git-ops.test.ts`
Expected: PASS (pre-loop capture/undo round-trip incl. dirty work, FAIL-restore cumulative-safety, anti-hardcode flag-on-match and clean-on-miss).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/git-ops.ts tests/modules/qa-loop/git-ops.test.ts
git commit -m "feat(qa-loop): add privileged git ops (pre-loop ref, restore, anti-hardcode diff)"
```

### Task 9: The report renderer (`report.ts`)

§5 report format — the single writer of the deterministic markdown render of the sidecar. `renderReport(sidecar)` emits: `**Status:**` line · `## Issues Found` (per QA-ID, with the §5 status→marker discipline: `fixed`→`✅ Fixed (date)`, `deferred`→`⏸ Deferred — <reason>`, the rest unmarked) · `## All Scenarios` table · `## Loop History` (one row/iteration) · `## Coverage` (exercised vs not-verified) · the `qa_loop_undo` recovery line.

**Files:**
- Create: `src/modules/qa-loop/report.ts`
- Test: `tests/modules/qa-loop/report.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/report.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { renderReport } from "../../../src/modules/qa-loop/report.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function sidecar(p: Partial<Sidecar> = {}): Sidecar {
  return {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md",
    plan_sha256: "h",
    report_path: "docs/testing/reports/2026-06-26-demo-report.md",
    config: {
      mode: "approve",
      severity_floor: "LOW",
      max_iterations: 3,
      max_dispatches: 50,
      time_budget_s: 1800,
      allow_mutations: false,
    },
    started_at: 0,
    updated_at: 0,
    finalized_at: null,
    budgets: { iteration: 1, dispatch_count_total: 4, elapsed_s: 120, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {
      "FE-01": {
        qa_ids: ["QA-001"], kind: "feature", section: "FE",
        mutating: false, baseline: "fail", current: "pass", reason: null,
      },
      "BE-02": {
        qa_ids: [], kind: "sanity", section: "BE",
        mutating: false, baseline: "pass", current: "pass", reason: null,
      },
    },
    issues: {
      "QA-001": {
        severity: "HIGH", scenario: "FE-01", location: "src/x.ts:42",
        title: "Broken form submit", problem: "p", remediation: "r",
        status: "fixed", fixed_at: "2026-06-26",
        fix: {
          svarog_status: "READY", escalate_reason: null, child_session_id: "ses_c",
          checkpoint_ref: "refs/svarog/ckpt/ses_c", changed: ["src/x.ts"], hardcode_warnings: [],
        },
      },
      "QA-002": {
        severity: "MEDIUM", scenario: "BE-09", location: null,
        title: "Deferred thing", problem: "p", remediation: "r",
        status: "deferred", fixed_at: null,
        fix: {
          svarog_status: "ESCALATE", escalate_reason: "ambiguous spec", child_session_id: null,
          checkpoint_ref: null, changed: [], hardcode_warnings: [],
        },
      },
    },
    iterations: [
      {
        n: 1, phase: "evaluated", pending: [], in_flight: null, attempted_so_far: ["QA-001"],
        now_passing: ["FE-01"], still_failing: [], stop_cause: null, regressions: [],
        warnings: ["src/x.ts: possible hardcoded value"], dispatches_this_iter: 4, elapsed_s: 120,
      },
    ],
    coverage: {
      exercised: { feature: 1, sanity: 1, enforcement: 0 },
      not_verified: { "auth-unverified": 1, "mutation-guard": 0, "tool-unavailable": 0 },
      routing_warnings: [],
    },
    result: "Pass",
    ...p,
  }
}

describe("renderReport (§5)", () => {
  it("writes the Status line from result", () => {
    expect(renderReport(sidecar())).toContain("**Status:** Pass")
  })

  it("renders the fixed marker for a fixed issue and the deferred marker for a deferred one", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("QA-001")
    expect(md).toContain("✅ Fixed (2026-06-26)")
    expect(md).toContain("⏸ Deferred — ambiguous spec")
  })

  it("leaves a still-failing issue unmarked (no Fixed/Deferred marker)", () => {
    const s = sidecar()
    s.issues["QA-003"] = {
      severity: "LOW", scenario: "FE-04", location: "f:1", title: "Still broken",
      problem: "p", remediation: "r", status: "fix-attempted", fixed_at: null,
      fix: { svarog_status: "READY", escalate_reason: null, child_session_id: "ses_d",
        checkpoint_ref: "refs/svarog/ckpt/ses_d", changed: ["f"], hardcode_warnings: [] },
    }
    const md = renderReport(s)
    expect(md).toContain("QA-003")
    // the QA-003 block carries neither a Fixed nor a Deferred marker
    const block = md.slice(md.indexOf("QA-003"))
    expect(block.startsWith("QA-003") ? block.slice(0, 200) : block).not.toContain("✅ Fixed")
  })

  it("renders the All Scenarios table with baseline + current", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("## All Scenarios")
    expect(md).toContain("FE-01")
    expect(md).toContain("BE-02")
  })

  it("renders the Loop History table with one row per iteration", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("## Loop History")
    expect(md).toContain("| Iteration | Failing in | Now passing | Still failing | Warnings | Regressions | Dispatches |")
    expect(md).toContain("| 1 |")
  })

  it("renders the Coverage section with exercised vs not-verified", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("## Coverage")
    expect(md).toContain("auth-unverified")
  })

  it("renders the qa_loop_undo recovery line referencing the pre-loop ref", () => {
    const md = renderReport(sidecar())
    expect(md).toContain("qa_loop_undo")
    expect(md).toContain("refs/qa-loop/pre/qa-loop-demo-1")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/report.test.ts`
Expected: FAIL — `renderReport` does not exist (module-not-found).

- [ ] **Step 3: Implement `report.ts`**

`src/modules/qa-loop/report.ts`:

```typescript
import type { IssueRecord, Sidecar } from "./types.js"

/** §5 status→marker discipline: only `fixed`/`deferred` carry a marker; everything else is unmarked. */
function markerFor(iss: IssueRecord): string {
  if (iss.status === "fixed") return `✅ Fixed (${iss.fixed_at ?? ""})`
  if (iss.status === "deferred")
    return `⏸ Deferred — ${iss.fix.escalate_reason ?? "no reason given"}`
  return "" // open / fix-attempted / fix-failed → still-failing, unmarked
}

/**
 * §5 report renderer — the SINGLE deterministic writer of the report markdown: Status · Issues Found ·
 * All Scenarios · Loop History · Coverage · the qa_loop_undo recovery line. A pure render of the
 * sidecar (no I/O); the tool persists the returned string.
 */
export function renderReport(s: Sidecar): string {
  const lines: string[] = []

  lines.push(`# QA Loop Report — ${s.run_id}`)
  lines.push("")
  lines.push(`**Status:** ${s.result ?? "in-progress"}`)
  lines.push("")

  // ── Issues Found ──────────────────────────────────────────────────────────
  lines.push("## Issues Found")
  lines.push("")
  const issueIds = Object.keys(s.issues).sort()
  if (issueIds.length === 0) {
    lines.push("_None._")
    lines.push("")
  } else {
    for (const id of issueIds) {
      const iss = s.issues[id]
      const marker = markerFor(iss)
      lines.push(`### ${id}${marker ? ` ${marker}` : ""}`)
      lines.push(`- **Severity:** ${iss.severity}`)
      lines.push(`- **Scenario:** ${iss.scenario}`)
      lines.push(`- **Location:** ${iss.location ?? "—"}`)
      lines.push(`- **Title:** ${iss.title}`)
      lines.push(`- **Problem:** ${iss.problem}`)
      lines.push(`- **Remediation:** ${iss.remediation}`)
      lines.push("")
    }
  }

  // ── All Scenarios ─────────────────────────────────────────────────────────
  lines.push("## All Scenarios")
  lines.push("")
  lines.push("| Scenario | Section | Kind | Baseline | Current | Reason |")
  lines.push("|---|---|---|---|---|---|")
  for (const key of Object.keys(s.scenarios).sort()) {
    const sc = s.scenarios[key]
    lines.push(
      `| ${key} | ${sc.section} | ${sc.kind} | ${sc.baseline} | ${sc.current} | ${sc.reason ?? "—"} |`,
    )
  }
  lines.push("")

  // ── Loop History ──────────────────────────────────────────────────────────
  lines.push("## Loop History")
  lines.push("")
  lines.push("| Iteration | Failing in | Now passing | Still failing | Warnings | Regressions | Dispatches |")
  lines.push("|---|---|---|---|---|---|---|")
  for (const it of s.iterations) {
    const failingIn = it.attempted_so_far.join(", ") || "—"
    const nowPassing = it.now_passing.join(", ") || "—"
    const stillFailing = it.still_failing.join(", ") || "—"
    const warnings = it.warnings.join("; ") || "—"
    const regressions = it.regressions.join(", ") || "—"
    lines.push(
      `| ${it.n} | ${failingIn} | ${nowPassing} | ${stillFailing} | ${warnings} | ${regressions} | ${it.dispatches_this_iter} |`,
    )
  }
  lines.push("")

  // ── Coverage ──────────────────────────────────────────────────────────────
  lines.push("## Coverage")
  lines.push("")
  const ex = s.coverage.exercised
  const nv = s.coverage.not_verified
  lines.push(`- **Exercised:** feature ${ex.feature} · sanity ${ex.sanity} · enforcement ${ex.enforcement}`)
  lines.push(
    `- **Not verified:** auth-unverified ${nv["auth-unverified"]} · mutation-guard ${nv["mutation-guard"]} · tool-unavailable ${nv["tool-unavailable"]}`,
  )
  if (s.coverage.routing_warnings.length > 0) {
    lines.push(`- **Routing warnings:** ${s.coverage.routing_warnings.join("; ")}`)
  }
  lines.push("")

  // ── Recovery ──────────────────────────────────────────────────────────────
  lines.push("## Recovery")
  lines.push("")
  lines.push(
    `Run \`qa_loop_undo\` to revert everything this loop did — it restores \`${s.pre_loop.undo_ref}\` (a plain git ref you can also restore from your own shell).`,
  )
  lines.push("")

  return lines.join("\n")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/report.test.ts`
Expected: PASS (Status line, fixed/deferred/unmarked markers, All Scenarios + Loop History tables, Coverage section, undo recovery line all present).

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/report.ts tests/modules/qa-loop/report.test.ts
git commit -m "feat(qa-loop): add report renderer (status, issues, scenarios, loop history, coverage)"
```

### Task 10: `qa_loop_start` tool — resolve, classify, mutation-strip, capture pre-loop ref

The Phase-0 RESOLVE & GUARD entry point (§4 Phase 0, §5 idempotency table, §7 mutation guard). Hashes the plan, decides REUSE/ADOPT/FRESH, classifies + strips mutating-expected-success scenarios pre-dispatch, captures the pre-loop undo ref, and runs the dirty-tree check. This task creates `tools.ts` with the first tool and the shared caller-gate wiring; later tasks add the remaining five tools to the same file.

**Files:**
- Create: `src/modules/qa-loop/tools.ts`
- Test: `tests/modules/qa-loop/tools-start.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/tools-start.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

// A caller gate that classifies a fixed coordinator session id as Perun and
// everything else as a dispatched child (mirrors caller-gate.ts semantics).
function fakeGate(coordinatorId: string) {
  return {
    isCoordinatorCaller: (sessionID: string) => sessionID === coordinatorId,
    isSetupCaller: () => false,
  }
}

const PLAN = `# Test Plan

## FE-01 — login page renders [feature]
Navigate to /login and assert the form is visible.

## BE-01 — GET /health returns 200 [sanity]
Send GET /health, expect 200.

## BE-02 — POST /orders creates an order [feature]
Send POST /orders with a valid payload, expect 201.

## BE-03 — POST /orders without auth is blocked [negative]
Send POST /orders with no token, expect 401 and no state change.
`

describe("qa_loop_start", () => {
  let cwd: string
  let state: QaLoopState

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "qa-loop-start-"))
    git(cwd, ["init", "-q"])
    git(cwd, ["config", "user.email", "t@t.dev"])
    git(cwd, ["config", "user.name", "t"])
    mkdirSync(join(cwd, "docs/testing/reports"), { recursive: true })
    mkdirSync(join(cwd, "docs/testing/plans"), { recursive: true })
    writeFileSync(join(cwd, "docs/testing/plans/2026-06-26-demo-test-plan.md"), PLAN)
    git(cwd, ["add", "-A"])
    git(cwd, ["commit", "-q", "-m", "init"])
    state = new QaLoopState()
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  it("rejects a non-coordinator caller", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s })
    const res = JSON.parse(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      { sessionID: "child" },
    ))
    expect(res.status).toBe("forbidden")
  })

  it("FRESH: hashes the plan, classifies, strips mutating-expected-success, captures pre-loop ref", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s })
    const res = JSON.parse(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md" },
      { sessionID: "perun" },
    ))

    expect(res.status).toBe("ok")
    expect(res.disposition).toBe("FRESH")
    // pre-loop ref captured and resolvable
    expect(res.pre_loop_ref).toBe(`refs/qa-loop/pre/${res.run_id}`)
    expect(() => git(cwd, ["rev-parse", "--verify", res.pre_loop_ref])).not.toThrow()

    const s = state.load("perun")!
    expect(s.plan_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(s.scenarios["FE-01"].kind).toBe("feature")
    expect(s.scenarios["BE-03"].kind).toBe("negative")
    // mutation guard: BE-02 (POST, expected success) stripped; BE-03 (negative-blocked) kept
    expect(s.scenarios["BE-02"].mutating).toBe(true)
    expect(s.scenarios["BE-02"].current).toBe("skip")
    expect(s.scenarios["BE-02"].reason).toMatch(/mutation-guard/)
    expect(s.coverage.not_verified["mutation-guard"]).toBe(1)
    expect(s.scenarios["BE-03"].current).not.toBe("skip")
    // dispatch_set excludes BE-02, includes BE-03
    expect(res.dispatch_set).toContain("BE-03")
    expect(res.dispatch_set).not.toContain("BE-02")
  })

  it("--allow-mutations keeps mutating-expected-success in the dispatch set", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s })
    const res = JSON.parse(await tools.qa_loop_start.execute(
      { plan_path: "docs/testing/plans/2026-06-26-demo-test-plan.md", topic: "demo", report_path: "docs/testing/reports/2026-06-26-demo-report.md", allow_mutations: true },
      { sessionID: "perun" },
    ))
    expect(res.dispatch_set).toContain("BE-02")
    const s = state.load("perun")!
    expect(s.scenarios["BE-02"].current).not.toBe("skip")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/tools-start.test.ts`
Expected: FAIL — `src/modules/qa-loop/tools.ts` does not exist (`makeQaLoopTools` cannot be imported).

- [ ] **Step 3: Implement `makeQaLoopTools` + `qa_loop_start`**

`src/modules/qa-loop/tools.ts`:

```typescript
import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CallerGate } from "../qa/caller-gate.js"
import type {
  Sidecar,
  ScenarioRecord,
  ScenarioKind,
  Mode,
  SeverityFloor,
} from "./types.js"
import { QaLoopState } from "./sidecar.js"
import { hashPlan } from "./plan-hash.js"
import { classifyScenario } from "./classify.js"
import { capturePreLoopRef } from "./git-ops.js"

export interface QaLoopToolDeps {
  gate: Pick<CallerGate, "isCoordinatorCaller">
  state: QaLoopState
  cwd: string
  resolveParentID: (sessionID: string) => Promise<string>
}

const FORBIDDEN = (name: string) =>
  JSON.stringify({
    status: "forbidden",
    reason: `${name} is restricted to the coordinator (Perun)`,
  })

// A scenario heading is "## <SECTION>-<n> — <title> [<kind>]". The trailing
// [kind] tag is optional; classifyScenario reads the whole block for verb/intent.
const HEADING = /^##\s+((FE|BE|SETUP)-\d+)\b.*$/gim

function sectionOf(id: string): "FE" | "BE" | "SETUP" {
  if (id.startsWith("FE")) return "FE"
  if (id.startsWith("SETUP")) return "SETUP"
  return "BE"
}

/** Split the plan into per-scenario blocks keyed by scenario id. */
function splitScenarios(planText: string): { id: string; block: string }[] {
  const lines = planText.split("\n")
  const blocks: { id: string; block: string }[] = []
  let current: { id: string; lines: string[] } | null = null
  for (const line of lines) {
    const m = /^##\s+((?:FE|BE|SETUP)-\d+)\b/i.exec(line)
    if (m) {
      if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
      current = { id: m[1].toUpperCase(), lines: [line] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) blocks.push({ id: current.id, block: current.lines.join("\n") })
  return blocks
}

export function makeQaLoopTools(deps: QaLoopToolDeps) {
  const { gate, state, cwd, resolveParentID } = deps

  const qa_loop_start = tool({
    description: [
      "Phase 0 of the QA loop (RESOLVE & GUARD). Perun-only. Hashes the plan for idempotency, decides REUSE/ADOPT/FRESH, classifies every scenario, strips mutating-expected-success scenarios from the dispatch set (mutation guard), captures the pre-loop undo ref, and runs the working-tree dirty check.",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", disposition: "REUSE"|"ADOPT"|"FRESH", run_id, pre_loop_ref, dispatch_set: string[], dirty: boolean, dirty_files: string[], qa_id_start_at?: number }`.',
      '- `{ status: "forbidden", reason }` — caller is not the coordinator.',
    ].join("\n"),
    args: {
      plan_path: tool.schema.string().describe("Repo-relative path to the QA plan markdown."),
      topic: tool.schema.string().describe("Short topic slug for run_id + sidecar/report stem."),
      report_path: tool.schema.string().describe("Repo-relative path to the report markdown."),
      mode: tool.schema.enum(["approve", "auto", "step"]).optional(),
      severity_floor: tool.schema.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      max_iterations: tool.schema.number().optional(),
      max_dispatches: tool.schema.number().optional(),
      time_budget_s: tool.schema.number().optional(),
      allow_mutations: tool.schema.boolean().optional(),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_start")
      const parentId = await resolveParentID(ctx.sessionID)

      const planText = readFileSync(join(cwd, args.plan_path), "utf8")
      const sha = hashPlan(planText)
      const allowMutations = args.allow_mutations ?? false

      const config: Sidecar["config"] = {
        mode: (args.mode as Mode) ?? "approve",
        severity_floor: (args.severity_floor as SeverityFloor) ?? "LOW",
        max_iterations: args.max_iterations ?? 3,
        max_dispatches: args.max_dispatches ?? 50,
        time_budget_s: args.time_budget_s ?? 1800,
        allow_mutations: allowMutations,
      }

      // Idempotency disposition (§5 table). The sidecar layer is the source of
      // truth for REUSE; report-existence drives ADOPT vs FRESH.
      const existing = state.load(parentId)
      let disposition: "REUSE" | "ADOPT" | "FRESH"
      let qaIdStartAt: number | undefined
      if (existing && existing.plan_sha256 === sha) {
        disposition = "REUSE"
        // Carry the prior run forward unchanged; recompute dispatch set below.
        existing.updated_at = Date.now()
        state.save(parentId, existing)
        return JSON.stringify({
          status: "ok",
          disposition,
          run_id: existing.run_id,
          pre_loop_ref: existing.pre_loop.undo_ref,
          dispatch_set: Object.entries(existing.scenarios)
            .filter(([, sc]) => sc.current !== "skip")
            .map(([id]) => id),
          dirty: existing.pre_loop.dirty,
          dirty_files: existing.pre_loop.dirty_files,
        })
      }

      let reportExists = false
      try {
        readFileSync(join(cwd, args.report_path), "utf8")
        reportExists = true
      } catch {
        reportExists = false
      }
      disposition = reportExists ? "ADOPT" : "FRESH"
      if (disposition === "ADOPT") {
        // ADOPT mints new IDs as max(existing report IDs)+1; the report stem
        // matches, so qa_loop_ingest threads startAt into assign_issue_ids.
        const reportText = readFileSync(join(cwd, args.report_path), "utf8")
        const ids = [...reportText.matchAll(/\bQA-(\d+)\b/g)].map((m) => Number(m[1]))
        qaIdStartAt = (ids.length ? Math.max(...ids) : 0) + 1
      }

      // Classify every scenario; apply the mutation guard pre-dispatch.
      const scenarios: Record<string, ScenarioRecord> = {}
      const dispatchSet: string[] = []
      const coverageMutationGuard = { count: 0 }
      for (const { id, block } of splitScenarios(planText)) {
        const { kind, mutating, expectsSuccess } = classifyScenario(block)
        // Strip ONLY mutating scenarios expected to succeed; a negative-blocked
        // mutation is kept (§7 expected-outcome rule).
        const stripped = mutating && expectsSuccess && !allowMutations
        scenarios[id] = {
          qa_ids: [],
          kind: kind as ScenarioKind,
          section: sectionOf(id),
          mutating,
          baseline: stripped ? "skip" : "fail",
          current: stripped ? "skip" : "fail",
          reason: stripped ? "mutation-guard: mutating scenario expected to succeed" : null,
        }
        if (stripped) coverageMutationGuard.count++
        else dispatchSet.push(id)
      }

      const runId = `qa-loop-${args.topic}-${reportExists ? 2 : 1}`
      const preLoop = capturePreLoopRef(cwd, runId)

      const now = Date.now()
      const sidecar: Sidecar = {
        version: 1,
        run_id: runId,
        plan_path: args.plan_path,
        plan_sha256: sha,
        report_path: args.report_path,
        config,
        started_at: now,
        updated_at: now,
        finalized_at: null,
        budgets: {
          iteration: 0,
          dispatch_count_total: 0,
          elapsed_s: 0,
          final_pass_elapsed_s: null,
        },
        pre_loop: preLoop,
        scenarios,
        issues: {},
        iterations: [],
        coverage: {
          exercised: { feature: 0, sanity: 0, enforcement: 0 },
          not_verified: {
            "auth-unverified": 0,
            "mutation-guard": coverageMutationGuard.count,
            "tool-unavailable": 0,
          },
          routing_warnings: [],
        },
        result: null,
      }
      state.save(parentId, sidecar)

      return JSON.stringify({
        status: "ok",
        disposition,
        run_id: runId,
        pre_loop_ref: preLoop.undo_ref,
        dispatch_set: dispatchSet,
        dirty: preLoop.dirty,
        dirty_files: preLoop.dirty_files,
        qa_id_start_at: qaIdStartAt,
      })
    },
  })

  return { qa_loop_start }
}
```

> Note: `capturePreLoopRef` (git-ops.ts, Phase 1 of this module) returns `{ undo_ref, dirty, dirty_files }` — the `pre_loop` shape. `classifyScenario` (classify.ts) reads each `## ID …` block and returns `{ kind, mutating, expectsSuccess }`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/tools-start.test.ts`
Expected: PASS — forbidden gate, FRESH classification + mutation-strip, and `--allow-mutations` retention all green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-start.test.ts
git commit -m "feat(qa-loop): qa_loop_start tool — hash, REUSE/ADOPT/FRESH, mutation-strip, pre-loop ref"
```

### Task 11: `qa_loop_ingest` tool — record a Zmora wave into scenarios + coverage, mint QA-IDs

Records a Zmora wave's results into `scenarios[].current` and the coverage buckets, and mints QA-IDs for new failures via the existing `assign_issue_ids` coordinator tool (§5 "QA-ID minting reuses the existing tool"; ADOPT passes `startAt`). Coverage routing follows §5: passing negative → `enforcement`; SKIP/NEED_INFO reason routes to `auth-unverified` / `mutation-guard` / `tool-unavailable`, unknown reason → `tool-unavailable` + a `routing_warnings` entry.

**Files:**
- Modify: `src/modules/qa-loop/tools.ts`
- Test: `tests/modules/qa-loop/tools-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/tools-ingest.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}

function seedSidecar(state: QaLoopState, parentId: string) {
  const now = Date.now()
  const s: Sidecar = {
    version: 1,
    run_id: "qa-loop-demo-1",
    plan_path: "p.md",
    plan_sha256: "x".repeat(64),
    report_path: "r.md",
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {
      "FE-01": { qa_ids: [], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null },
      "BE-01": { qa_ids: [], kind: "sanity", section: "BE", mutating: false, baseline: "pass", current: "pass", reason: null },
      "BE-03": { qa_ids: [], kind: "negative", section: "BE", mutating: false, baseline: "fail", current: "fail", reason: null },
      "FE-09": { qa_ids: [], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null },
    },
    issues: {},
    iterations: [],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
  state.save(parentId, s)
}

describe("qa_loop_ingest", () => {
  let state: QaLoopState
  beforeEach(() => {
    state = new QaLoopState()
    seedSidecar(state, "perun")
  })

  // Fake the coordinator assign_issue_ids: deterministic QA-NNN from startAt.
  const assignIssueIds = async ({ findings, startAt }: { findings: any[]; startAt?: number }) => {
    let n = startAt ?? 1
    return findings.map((f) => ({ ...f, id: `QA-${String(n++).padStart(3, "0")}` }))
  }

  it("rejects a non-coordinator caller", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    const res = JSON.parse(await tools.qa_loop_ingest.execute(
      { phase: "baseline", results: [] },
      { sessionID: "child" },
    ))
    expect(res.status).toBe("forbidden")
  })

  it("records states, buckets coverage, and mints QA-IDs for new failures", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    const res = JSON.parse(await tools.qa_loop_ingest.execute(
      {
        phase: "baseline",
        results: [
          { scenario: "FE-01", state: "fail", severity: "HIGH", title: "login broken", problem: "500", remediation: "fix handler", location: "src/login.ts:10" },
          { scenario: "BE-01", state: "pass" },
          { scenario: "BE-03", state: "pass" }, // passing negative → enforcement
          { scenario: "FE-09", state: "skip", reason: "auth required to reach dashboard" },
        ],
      },
      { sessionID: "perun" },
    ))
    expect(res.status).toBe("ok")

    const s = state.load("perun")!
    expect(s.scenarios["FE-01"].current).toBe("fail")
    expect(s.scenarios["BE-01"].current).toBe("pass")
    expect(s.scenarios["BE-03"].current).toBe("pass")
    expect(s.scenarios["FE-09"].current).toBe("skip")

    // coverage: exercised feature(FE-01 ran but failed → still feature-exercised), sanity(BE-01), enforcement(BE-03 passing negative)
    expect(s.coverage.exercised.sanity).toBe(1)
    expect(s.coverage.exercised.enforcement).toBe(1)
    // FE-09 skipped with auth reason → auth-unverified
    expect(s.coverage.not_verified["auth-unverified"]).toBe(1)

    // QA-ID minted for the new failure and attached to the scenario + issues map
    expect(s.scenarios["FE-01"].qa_ids).toEqual(["QA-001"])
    expect(s.issues["QA-001"].severity).toBe("HIGH")
    expect(s.issues["QA-001"].location).toBe("src/login.ts:10")
    expect(s.issues["QA-001"].status).toBe("open")
    expect(res.new_qa_ids).toEqual(["QA-001"])
  })

  it("routes an unknown SKIP reason to tool-unavailable + a routing warning", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    await tools.qa_loop_ingest.execute(
      { phase: "baseline", results: [{ scenario: "FE-09", state: "skip", reason: "something weird happened" }] },
      { sessionID: "perun" },
    )
    const s = state.load("perun")!
    expect(s.coverage.not_verified["tool-unavailable"]).toBe(1)
    expect(s.coverage.routing_warnings.length).toBe(1)
  })

  it("ADOPT: mints from start_at_qa_id", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds })
    const res = JSON.parse(await tools.qa_loop_ingest.execute(
      {
        phase: "baseline",
        start_at_qa_id: 42,
        results: [{ scenario: "FE-01", state: "fail", severity: "LOW", title: "t", problem: "p", remediation: "r", location: "x:1" }],
      },
      { sessionID: "perun" },
    ))
    expect(res.new_qa_ids).toEqual(["QA-042"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/tools-ingest.test.ts`
Expected: FAIL — `qa_loop_ingest` is not yet on the returned tool map; `assignIssueIds` dep is unused by the factory.

- [ ] **Step 3: Add the `assignIssueIds` dep + `qa_loop_ingest`**

In `src/modules/qa-loop/tools.ts`, extend `QaLoopToolDeps` and the factory.

Add to the imports:

```typescript
import type { IssueRecord, Coverage, ScenarioState } from "./types.js"
```

Extend `QaLoopToolDeps`:

```typescript
export interface QaLoopToolDeps {
  gate: Pick<CallerGate, "isCoordinatorCaller">
  state: QaLoopState
  cwd: string
  resolveParentID: (sessionID: string) => Promise<string>
  // The existing coordinator minter (src/modules/coordinator/index.ts assign_issue_ids).
  // Perun wires the real one in; tests pass a deterministic fake.
  assignIssueIds: (input: {
    findings: { scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[]
    startAt?: number
  }) => Promise<{ id: string; scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[]>
}
```

Add the coverage-routing helper above the factory:

```typescript
const COVERAGE_BUCKET: Record<ScenarioKind, keyof Coverage["exercised"]> = {
  feature: "feature",
  sanity: "sanity",
  negative: "enforcement",
}

// Route a SKIP/NEED_INFO reason to a not_verified bucket (§5).
function routeSkip(reason: string | undefined): { bucket: keyof Coverage["not_verified"]; warn: boolean } {
  const r = (reason ?? "").toLowerCase()
  if (/auth|login|token|credential|unauthor/.test(r)) return { bucket: "auth-unverified", warn: false }
  if (/mutation-guard|mutating/.test(r)) return { bucket: "mutation-guard", warn: false }
  if (/tool|playwright|psql|mysql|mongosh|redis|missing|unavailable|not installed/.test(r)) return { bucket: "tool-unavailable", warn: false }
  return { bucket: "tool-unavailable", warn: true }
}
```

In the factory body, after `qa_loop_start`, add:

```typescript
  const qa_loop_ingest = tool({
    description: [
      "Record a Zmora wave's results into the loop sidecar. Perun-only. Updates each scenario's `current` state, rolls coverage buckets, and mints QA-IDs (via assign_issue_ids) for new failing scenarios that have no id yet. Call after every Zmora wave (baseline / retest / final).",
      "",
      "Result shape (JSON-stringified):",
      '- `{ status: "ok", new_qa_ids: string[] }`.',
      '- `{ status: "forbidden", reason }`.',
    ].join("\n"),
    args: {
      phase: tool.schema.enum(["baseline", "retest", "final"]),
      start_at_qa_id: tool.schema.number().optional().describe("ADOPT only: first QA-ID number (max report id + 1)."),
      results: tool.schema.array(
        tool.schema.object({
          scenario: tool.schema.string(),
          state: tool.schema.enum(["pass", "fail", "skip"]),
          reason: tool.schema.string().optional(),
          severity: tool.schema.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
          title: tool.schema.string().optional(),
          problem: tool.schema.string().optional(),
          remediation: tool.schema.string().optional(),
          location: tool.schema.string().optional(),
        }),
      ),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_ingest")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      const newFindings: { scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[] = []

      for (const r of args.results) {
        const sc = s.scenarios[r.scenario]
        if (!sc) continue
        sc.current = r.state as ScenarioState
        sc.reason = r.state === "skip" ? (r.reason ?? null) : null

        if (r.state === "skip") {
          const { bucket, warn } = routeSkip(r.reason)
          s.coverage.not_verified[bucket]++
          if (warn) s.coverage.routing_warnings.push(`${r.scenario}: unrecognized SKIP reason -> tool-unavailable (${r.reason ?? ""})`)
        } else {
          // A scenario that actually RAN counts as exercised in its kind bucket
          // (a passing negative becomes enforcement). A failing run still
          // exercised that kind's surface.
          if (r.state === "pass" || r.state === "fail") {
            s.coverage.exercised[COVERAGE_BUCKET[sc.kind]]++
          }
          // New failure with no id yet → mint one.
          if (r.state === "fail" && sc.qa_ids.length === 0) {
            newFindings.push({
              scenario: r.scenario,
              severity: r.severity ?? "LOW",
              title: r.title ?? r.scenario,
              problem: r.problem ?? "",
              remediation: r.remediation ?? "",
              location: r.location ?? null,
            })
          }
        }
      }

      let minted: { id: string; scenario: string; severity: string; title: string; problem: string; remediation: string; location: string | null }[] = []
      if (newFindings.length > 0) {
        minted = await assignIssueIds({ findings: newFindings, startAt: args.start_at_qa_id })
        for (const f of minted) {
          s.scenarios[f.scenario].qa_ids.push(f.id)
          const issue: IssueRecord = {
            severity: f.severity as IssueRecord["severity"],
            scenario: f.scenario,
            location: f.location,
            title: f.title,
            problem: f.problem,
            remediation: f.remediation,
            status: "open",
            fixed_at: null,
            fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] },
          }
          s.issues[f.id] = issue
        }
      }

      s.updated_at = Date.now()
      state.save(parentId, s)
      return JSON.stringify({ status: "ok", new_qa_ids: minted.map((m) => m.id) })
    },
  })
```

Add `qa_loop_ingest` to the returned object:

```typescript
  return { qa_loop_start, qa_loop_ingest }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/tools-ingest.test.ts`
Expected: PASS — gate, state recording, coverage routing (incl. unknown-reason warning), and FRESH/ADOPT minting all green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-ingest.test.ts
git commit -m "feat(qa-loop): qa_loop_ingest tool — record wave, coverage buckets, mint QA-IDs"
```

### Task 12: `qa_loop_step` tool — enter/evaluate via the state machine, idempotent phase advance

Drives the loop body (§4 iteration zoom 2.0, 2f; §4 "step(enter) is idempotent"). `phase: "enter"` calls `stepEnter` — but only increments `iteration` when starting a *new* iteration; on re-entry into a non-`evaluated` iteration it resumes from the existing `iterations[n].phase` without a second increment. `phase: "evaluate"` calls `stepEvaluate` and advances the row to `evaluated`.

**Files:**
- Modify: `src/modules/qa-loop/tools.ts`
- Test: `tests/modules/qa-loop/tools-step.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/tools-step.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

function baseSidecar(): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: "r.md",
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {
      "FE-01": { qa_ids: ["QA-001"], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null },
      "BE-01": { qa_ids: [], kind: "sanity", section: "BE", mutating: false, baseline: "pass", current: "pass", reason: null },
    },
    issues: {
      "QA-001": { severity: "HIGH", scenario: "FE-01", location: "x:1", title: "t", problem: "p", remediation: "r", status: "open", fixed_at: null, fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] } },
    },
    iterations: [],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_step", () => {
  let state: QaLoopState
  beforeEach(() => { state = new QaLoopState(); state.save("perun", baseSidecar()) })

  it("rejects a non-coordinator caller", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    const res = JSON.parse(await tools.qa_loop_step.execute({ phase: "enter" }, { sessionID: "child" }))
    expect(res.status).toBe("forbidden")
  })

  it("enter increments the iteration once and returns the failing fix-set", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    const res = JSON.parse(await tools.qa_loop_step.execute({ phase: "enter" }, { sessionID: "perun" }))
    expect(res.action).toBe("fix")
    expect(res.issues).toEqual(["QA-001"])
    const s = state.load("perun")!
    expect(s.budgets.iteration).toBe(1)
    expect(s.iterations.length).toBe(1)
    expect(s.iterations[0].phase).toBe("selecting")
  })

  it("enter is idempotent: re-entering a non-evaluated iteration does NOT re-increment", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    await tools.qa_loop_step.execute({ phase: "enter" }, { sessionID: "perun" })
    // simulate the gate advancing the phase
    const mid = state.load("perun")!
    mid.iterations[0].phase = "awaiting_fix_gate"
    state.save("perun", mid)

    const res = JSON.parse(await tools.qa_loop_step.execute({ phase: "enter" }, { sessionID: "perun" }))
    expect(res.action).toBe("fix")
    const s = state.load("perun")!
    expect(s.budgets.iteration).toBe(1) // NOT 2
    expect(s.iterations.length).toBe(1)
  })

  it("evaluate advances the row to evaluated and returns the state-machine action", async () => {
    const tools = makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
    await tools.qa_loop_step.execute({ phase: "enter" }, { sessionID: "perun" })
    // mark FE-01 now passing so evaluate sees progress, no regression
    const mid = state.load("perun")!
    mid.scenarios["FE-01"].current = "pass"
    mid.iterations[0].phase = "retested"
    state.save("perun", mid)

    const res = JSON.parse(await tools.qa_loop_step.execute({ phase: "evaluate" }, { sessionID: "perun" }))
    expect(["continue", "stop", "final"]).toContain(res.action)
    const s = state.load("perun")!
    expect(s.iterations[0].phase).toBe("evaluated")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/tools-step.test.ts`
Expected: FAIL — `qa_loop_step` is not on the tool map.

- [ ] **Step 3: Add `qa_loop_step`**

In `src/modules/qa-loop/tools.ts`, add the import:

```typescript
import { stepEnter, stepEvaluate } from "./state-machine.js"
```

In the factory body, after `qa_loop_ingest`, add:

```typescript
  const qa_loop_step = tool({
    description: [
      "Advance the loop state machine. Perun-only.",
      "- `phase:\"enter\"` (2.0): increments the iteration ONLY when starting a new one; on re-entry into a not-yet-`evaluated` iteration it resumes from the stored `phase` WITHOUT a second increment (MAXI stays exact). Returns `{ action:\"fix\", issues }` | `{ action:\"stop\", stop_cause }` | `{ action:\"final\" }`.",
      "- `phase:\"evaluate\"` (2f): no increment; regression-first then no-progress against THIS iteration's retest. Advances the row to `evaluated`. Returns `{ action:\"continue\" }` | `{ action:\"stop\", stop_cause }` | `{ action:\"final\" }`.",
      "",
      'Result shape: `{ status:"ok", ...decision }` or `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {
      phase: tool.schema.enum(["enter", "evaluate"]),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_step")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      if (args.phase === "enter") {
        const decision = stepEnter(s)
        s.updated_at = Date.now()
        state.save(parentId, s)
        return JSON.stringify({ status: "ok", ...decision })
      }

      const decision = stepEvaluate(s)
      // Advance the current (last) iteration row to evaluated.
      const row = s.iterations[s.iterations.length - 1]
      if (row) {
        row.phase = "evaluated"
        if (decision.action === "stop" && decision.stop_cause) row.stop_cause = decision.stop_cause
      }
      s.updated_at = Date.now()
      state.save(parentId, s)
      return JSON.stringify({ status: "ok", ...decision })
    },
  })
```

Add it to the returned object:

```typescript
  return { qa_loop_start, qa_loop_ingest, qa_loop_step }
```

> Note: the idempotent-no-reincrement and fix-set selection logic live in `stepEnter` (state-machine.ts, a prior Phase-2 task) — it inspects `iterations[n].phase` and only pushes a new row + increments `budgets.iteration` when the last row is `evaluated`/absent. `qa_loop_step` is a thin Perun-gated wrapper; it must NOT re-implement that logic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/tools-step.test.ts`
Expected: PASS — enter increments once, re-entry is idempotent, evaluate advances to `evaluated`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-step.test.ts
git commit -m "feat(qa-loop): qa_loop_step tool — enter/evaluate wrapping the state machine"
```

### Task 13: `qa_loop_record_fix` tool — bind checkpoint, FAIL-restore, MAXD++, anti-hardcoding, integrity stop

The SOLE writer of `child_session_id` + `dispatch_count_total++` (§6 resolution pseudocode, §4 budget rules). Inputs `child_session_id`, `svarog_status`, `changed`, `reason` come as explicit args (Perun threads them from the `dispatch_parallel` result JSON — the tool does NOT read `DispatchResult`). Resolves `refs/svarog/ckpt/<child_session_id>` via `refExists`; on `FAIL` calls `restoreFailRef`; increments `dispatch_count_total` exactly once for READY/FAIL/ESCALATE alike; runs `antiHardcodeDiff` on READY; raises the Existence integrity stop when a READY reports `changed[]` but the ref is missing.

**Files:**
- Modify: `src/modules/qa-loop/tools.ts`
- Test: `tests/modules/qa-loop/tools-record-fix.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/tools-record-fix.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import * as gitOps from "../../../src/modules/qa-loop/git-ops.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

function sidecarWithIteration(): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: "r.md",
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 1, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: { "FE-01": { qa_ids: ["QA-001"], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: "fail", reason: null }, "BE-02": { qa_ids: ["QA-002"], kind: "feature", section: "BE", mutating: false, baseline: "fail", current: "fail", reason: null } },
    issues: {
      "QA-001": { severity: "HIGH", scenario: "FE-01", location: "x:1", title: "t", problem: "p", remediation: "r", status: "open", fixed_at: null, fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] } },
      "QA-002": { severity: "HIGH", scenario: "BE-02", location: "y:2", title: "t2", problem: "p2", remediation: "r2", status: "open", fixed_at: null, fix: { svarog_status: null, escalate_reason: null, child_session_id: null, checkpoint_ref: null, changed: [], hardcode_warnings: [] } },
    },
    iterations: [{ n: 1, phase: "fixing", pending: ["QA-001"], in_flight: "QA-001", attempted_so_far: [], now_passing: [], still_failing: ["FE-01"], stop_cause: null, regressions: [], warnings: [], dispatches_this_iter: 0, elapsed_s: 0 }],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_record_fix", () => {
  let state: QaLoopState
  beforeEach(() => { state = new QaLoopState(); state.save("perun", sidecarWithIteration()); vi.restoreAllMocks() })

  function tools() {
    return makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
  }

  it("rejects a non-coordinator caller", async () => {
    const res = JSON.parse(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_a", svarog_status: "READY", changed: [], reason: "" },
      { sessionID: "child" },
    ))
    expect(res.status).toBe("forbidden")
  })

  it("READY with an existing ckpt ref binds it, runs anti-hardcoding, marks fix-attempted, MAXD++", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    vi.spyOn(gitOps, "antiHardcodeDiff").mockReturnValue(["literal 'gold' matches BE payload"])
    const res = JSON.parse(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_a", svarog_status: "READY", changed: ["src/x.ts"], reason: "" },
      { sessionID: "perun" },
    ))
    expect(res.status).toBe("ok")
    const s = state.load("perun")!
    expect(s.issues["QA-001"].status).toBe("fix-attempted")
    expect(s.issues["QA-001"].fix.child_session_id).toBe("ses_a")
    expect(s.issues["QA-001"].fix.checkpoint_ref).toBe("refs/svarog/ckpt/ses_a")
    expect(s.issues["QA-001"].fix.hardcode_warnings).toEqual(["literal 'gold' matches BE payload"])
    expect(s.budgets.dispatch_count_total).toBe(1)
    expect(s.iterations[0].in_flight).toBeNull()
    expect(s.iterations[0].attempted_so_far).toContain("QA-001")
  })

  it("FAIL auto-restores the issue's checkpoint and marks fix-failed (still MAXD++)", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    const restore = vi.spyOn(gitOps, "restoreFailRef").mockReturnValue(undefined)
    const res = JSON.parse(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_b", svarog_status: "FAIL", changed: ["src/x.ts"], reason: "build red" },
      { sessionID: "perun" },
    ))
    expect(res.status).toBe("ok")
    expect(restore).toHaveBeenCalledWith("/tmp", "refs/svarog/ckpt/ses_b")
    const s = state.load("perun")!
    expect(s.issues["QA-001"].status).toBe("fix-failed")
    expect(s.budgets.dispatch_count_total).toBe(1)
  })

  it("ESCALATE marks deferred with the reason, no ref needed, MAXD++", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const res = JSON.parse(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_c", svarog_status: "ESCALATE", changed: [], reason: "needs product decision" },
      { sessionID: "perun" },
    ))
    expect(res.status).toBe("ok")
    const s = state.load("perun")!
    expect(s.issues["QA-001"].status).toBe("deferred")
    expect(s.issues["QA-001"].fix.escalate_reason).toBe("needs product decision")
    expect(s.budgets.dispatch_count_total).toBe(1)
  })

  it("Existence integrity: READY reports changed[] but ref missing → checkpoint-integrity stop, no restore", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const restore = vi.spyOn(gitOps, "restoreFailRef")
    const res = JSON.parse(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_d", svarog_status: "READY", changed: ["src/x.ts"], reason: "" },
      { sessionID: "perun" },
    ))
    expect(res.status).toBe("ok")
    expect(res.stop_cause).toBe("checkpoint-integrity")
    expect(restore).not.toHaveBeenCalled()
    const s = state.load("perun")!
    expect(s.iterations[0].stop_cause).toBe("checkpoint-integrity")
  })

  it("no-op READY (empty changed, no ref) is NOT an integrity failure", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const res = JSON.parse(await tools().qa_loop_record_fix.execute(
      { qa_id: "QA-001", child_session_id: "ses_e", svarog_status: "READY", changed: [], reason: "" },
      { sessionID: "perun" },
    ))
    expect(res.status).toBe("ok")
    expect(res.stop_cause).toBeUndefined()
    const s = state.load("perun")!
    expect(s.issues["QA-001"].status).toBe("fix-attempted")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/tools-record-fix.test.ts`
Expected: FAIL — `qa_loop_record_fix` is not on the tool map.

- [ ] **Step 3: Add `qa_loop_record_fix`**

In `src/modules/qa-loop/tools.ts`, extend the git-ops import:

```typescript
import { capturePreLoopRef, refExists, restoreFailRef, antiHardcodeDiff } from "./git-ops.js"
```

In the factory body, after `qa_loop_step`, add:

```typescript
  const qa_loop_record_fix = tool({
    description: [
      "Record one sequential Svarog dispatch result (§6). Perun-only. The SOLE writer of `child_session_id` + `dispatch_count_total++`. Perun threads `child_session_id`/`svarog_status`/`changed`/`reason` FROM the dispatch_parallel result JSON — this tool does NOT read DispatchResult.",
      "- READY: bind `refs/svarog/ckpt/<child_session_id>` (if it exists), run anti-hardcoding on `changed[]`, mark `fix-attempted`. If `changed[]` is non-empty but the ref is MISSING → `checkpoint-integrity` stop (no restore, surfaced).",
      "- FAIL: auto-restore that issue's checkpoint (restoreFailRef), mark `fix-failed`.",
      "- ESCALATE: mark `deferred` with `reason`.",
      "Increments `dispatch_count_total` exactly once for READY/FAIL/ESCALATE alike, and clears the in-iteration `in_flight` cursor.",
      "",
      'Result shape: `{ status:"ok", issue_status, stop_cause?, hardcode_warnings? }` or `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {
      qa_id: tool.schema.string(),
      child_session_id: tool.schema.string().describe("DispatchResult.sessionId for this Svarog dispatch, threaded by Perun."),
      svarog_status: tool.schema.enum(["READY", "FAIL", "ESCALATE"]),
      changed: tool.schema.array(tool.schema.string()).describe("Svarog's self-reported changed[] paths."),
      reason: tool.schema.string().describe("ESCALATE/FAIL reason; empty for READY."),
      be_payloads: tool.schema.array(tool.schema.string()).optional().describe("BE scenario request-payload literals for the anti-hardcoding scan."),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_record_fix")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      const issue = s.issues[args.qa_id]
      if (!issue) return JSON.stringify({ status: "error", reason: `unknown issue ${args.qa_id}` })
      const row = s.iterations[s.iterations.length - 1]

      // record_fix is the SOLE writer of child_session_id + the MAXD counter.
      issue.fix.svarog_status = args.svarog_status
      issue.fix.child_session_id = args.child_session_id
      issue.fix.changed = args.changed
      const ref = `refs/svarog/ckpt/${args.child_session_id}`
      const hasRef = refExists(cwd, ref)

      let stopCause: string | undefined
      if (args.svarog_status === "READY") {
        if (args.changed.length > 0 && !hasRef) {
          // Existence integrity (§6): a READY that REPORTS changed[] but whose
          // ref is missing — do NOT auto-restore the untrusted tree; abort.
          stopCause = "checkpoint-integrity"
          if (row) row.stop_cause = "checkpoint-integrity"
        } else {
          if (hasRef) {
            issue.fix.checkpoint_ref = ref
            const warnings = antiHardcodeDiff(cwd, ref, args.changed, args.be_payloads ?? [])
            issue.fix.hardcode_warnings = warnings
            if (row) row.warnings.push(...warnings)
          }
          issue.status = "fix-attempted"
        }
      } else if (args.svarog_status === "FAIL") {
        if (hasRef) {
          issue.fix.checkpoint_ref = ref
          restoreFailRef(cwd, ref) // cumulative-safe (§6); reverts only this issue's edits
        }
        issue.status = "fix-failed"
      } else {
        // ESCALATE — edit aborted/none
        issue.status = "deferred"
        issue.fix.escalate_reason = args.reason
      }

      // dispatch_count_total++ exactly once, READY/FAIL/ESCALATE alike (§4).
      s.budgets.dispatch_count_total++
      if (row) {
        row.dispatches_this_iter++
        row.in_flight = null
        if (!row.attempted_so_far.includes(args.qa_id)) row.attempted_so_far.push(args.qa_id)
      }
      s.updated_at = Date.now()
      state.save(parentId, s)

      return JSON.stringify({
        status: "ok",
        issue_status: issue.status,
        stop_cause: stopCause,
        hardcode_warnings: issue.fix.hardcode_warnings,
      })
    },
  })
```

Add it to the returned object:

```typescript
  return { qa_loop_start, qa_loop_ingest, qa_loop_step, qa_loop_record_fix }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/tools-record-fix.test.ts`
Expected: PASS — READY-bind, FAIL-restore, ESCALATE-defer, the Existence integrity stop, and the no-op-READY non-failure are all green, with `dispatch_count_total` incremented once in every branch.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-record-fix.test.ts
git commit -m "feat(qa-loop): qa_loop_record_fix tool — bind/restore/escalate, MAXD++, integrity stop"
```

### Task 14: `qa_loop_finalize` tool — Result mapping + the sole fix-attempted→fixed transition

Phase 4 SUMMARY (§4 Result mapping, §5 status write-back discipline). Computes the result via `resultOf`; on the FINAL ingest, transitions each `fix-attempted` issue to `fixed` ONLY when its scenario's `current` is `pass` (the oracle-separation invariant — only this final-run path writes `fixed`/`✅ Fixed`); renders + saves the report; records `final_pass_elapsed_s`.

**Files:**
- Modify: `src/modules/qa-loop/tools.ts`
- Test: `tests/modules/qa-loop/tools-finalize.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/tools-finalize.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

function sidecar(reportPath: string, fe01Current: "pass" | "fail"): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: reportPath,
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 1, dispatch_count_total: 4, elapsed_s: 120, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: { "FE-01": { qa_ids: ["QA-001"], kind: "feature", section: "FE", mutating: false, baseline: "fail", current: fe01Current, reason: null } },
    issues: { "QA-001": { severity: "HIGH", scenario: "FE-01", location: "x:1", title: "t", problem: "p", remediation: "r", status: "fix-attempted", fixed_at: null, fix: { svarog_status: "READY", escalate_reason: null, child_session_id: "ses_a", checkpoint_ref: "refs/svarog/ckpt/ses_a", changed: ["src/x.ts"], hardcode_warnings: [] } } },
    iterations: [{ n: 1, phase: "evaluated", pending: [], in_flight: null, attempted_so_far: ["QA-001"], now_passing: [], still_failing: [], stop_cause: null, regressions: [], warnings: [], dispatches_this_iter: 4, elapsed_s: 120 }],
    coverage: { exercised: { feature: 1, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_finalize", () => {
  let cwd: string
  let state: QaLoopState
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "qa-loop-fin-"))
    mkdirSync(join(cwd, "docs/testing/reports"), { recursive: true })
    state = new QaLoopState()
    vi.restoreAllMocks()
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  function tools() {
    return makeQaLoopTools({ gate: fakeGate("perun"), state, cwd, resolveParentID: async (s) => s, assignIssueIds: noopAssign })
  }

  it("rejects a non-coordinator caller", async () => {
    state.save("perun", sidecar("docs/testing/reports/r.md", "pass"))
    const res = JSON.parse(await tools().qa_loop_finalize.execute({ final_pass_elapsed_s: 0 }, { sessionID: "child" }))
    expect(res.status).toBe("forbidden")
  })

  it("FINAL pass: transitions fix-attempted→fixed, result Pass, writes report", async () => {
    state.save("perun", sidecar("docs/testing/reports/r.md", "pass"))
    const res = JSON.parse(await tools().qa_loop_finalize.execute({ final_pass_elapsed_s: 30 }, { sessionID: "perun" }))
    expect(res.status).toBe("ok")
    expect(res.result).toBe("Pass")
    const s = state.load("perun")!
    expect(s.issues["QA-001"].status).toBe("fixed")
    expect(s.issues["QA-001"].fixed_at).not.toBeNull()
    expect(s.budgets.final_pass_elapsed_s).toBe(30)
    expect(s.finalized_at).not.toBeNull()
    const report = readFileSync(join(cwd, "docs/testing/reports/r.md"), "utf8")
    expect(report).toContain("✅ Fixed")
  })

  it("FINAL still-failing: does NOT transition to fixed; result Fail", async () => {
    state.save("perun", sidecar("docs/testing/reports/r.md", "fail"))
    const res = JSON.parse(await tools().qa_loop_finalize.execute({ final_pass_elapsed_s: 30 }, { sessionID: "perun" }))
    expect(res.result).toBe("Fail")
    const s = state.load("perun")!
    expect(s.issues["QA-001"].status).toBe("fix-attempted") // never promoted
    const report = readFileSync(join(cwd, "docs/testing/reports/r.md"), "utf8")
    expect(report).not.toContain("✅ Fixed")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/tools-finalize.test.ts`
Expected: FAIL — `qa_loop_finalize` is not on the tool map.

- [ ] **Step 3: Add `qa_loop_finalize`**

In `src/modules/qa-loop/tools.ts`, add the imports:

```typescript
import { writeFileSync } from "node:fs"
import { resultOf } from "./state-machine.js"
import { renderReport } from "./report.js"
```

In the factory body, after `qa_loop_record_fix`, add:

```typescript
  const qa_loop_finalize = tool({
    description: [
      "Phase 4 (SUMMARY). Perun-only. Computes the run result via the Result mapping (Pass>NotVerified>BudgetExhausted>Stopped>Fail), then — and ONLY here, the oracle-separation invariant — transitions each `fix-attempted` issue to `fixed` when its scenario's `current` is `pass` after the FINAL ingest. Renders + writes the report markdown (the sole writer of `✅ Fixed`) and records `final_pass_elapsed_s`.",
      "",
      'Result shape: `{ status:"ok", result, report_path }` or `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {
      final_pass_elapsed_s: tool.schema.number().describe("Wall-clock seconds of the authoritative final pass (the recorded TB-overage component)."),
    },
    async execute(args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_finalize")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      // SOLE fix-attempted→fixed transition: only when the FINAL ingest shows
      // that issue's scenario PASS (§5 status write-back discipline).
      const finalizedAt = new Date().toISOString()
      for (const [id, issue] of Object.entries(s.issues)) {
        if (issue.status === "fix-attempted" && s.scenarios[issue.scenario]?.current === "pass") {
          issue.status = "fixed"
          issue.fixed_at = finalizedAt
        }
      }

      s.result = resultOf(s)
      s.budgets.final_pass_elapsed_s = args.final_pass_elapsed_s
      s.finalized_at = Date.now()
      s.updated_at = s.finalized_at
      state.save(parentId, s)

      // Tool is the single writer of the report markdown.
      writeFileSync(join(cwd, s.report_path), renderReport(s))

      return JSON.stringify({ status: "ok", result: s.result, report_path: s.report_path })
    },
  })
```

Add it to the returned object:

```typescript
  return { qa_loop_start, qa_loop_ingest, qa_loop_step, qa_loop_record_fix, qa_loop_finalize }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/tools-finalize.test.ts`
Expected: PASS — Pass-path promotes to `fixed` and writes `✅ Fixed`; Fail-path leaves `fix-attempted` and writes no marker.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-finalize.test.ts
git commit -m "feat(qa-loop): qa_loop_finalize tool — Result mapping + sole fixed transition + report write"
```

### Task 15: `qa_loop_undo` tool — total undo to the pre-loop ref

§6 "Recovery: two granularities". A Perun-gated wrapper over `undoToPreLoop` that reverts the whole tree to `refs/qa-loop/pre/<run>` (the coordinator cannot `git reset` itself).

**Files:**
- Modify: `src/modules/qa-loop/tools.ts`
- Test: `tests/modules/qa-loop/tools-undo.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/tools-undo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"
import * as gitOps from "../../../src/modules/qa-loop/git-ops.js"
import type { Sidecar } from "../../../src/modules/qa-loop/types.js"

function fakeGate(id: string) {
  return { isCoordinatorCaller: (s: string) => s === id, isSetupCaller: () => false }
}
const noopAssign = async () => []

function minimalSidecar(): Sidecar {
  const now = Date.now()
  return {
    version: 1, run_id: "qa-loop-demo-1", plan_path: "p.md", plan_sha256: "x".repeat(64), report_path: "r.md",
    config: { mode: "approve", severity_floor: "LOW", max_iterations: 3, max_dispatches: 50, time_budget_s: 1800, allow_mutations: false },
    started_at: now, updated_at: now, finalized_at: null,
    budgets: { iteration: 0, dispatch_count_total: 0, elapsed_s: 0, final_pass_elapsed_s: null },
    pre_loop: { undo_ref: "refs/qa-loop/pre/qa-loop-demo-1", dirty: false, dirty_files: [] },
    scenarios: {}, issues: {}, iterations: [],
    coverage: { exercised: { feature: 0, sanity: 0, enforcement: 0 }, not_verified: { "auth-unverified": 0, "mutation-guard": 0, "tool-unavailable": 0 }, routing_warnings: [] },
    result: null,
  }
}

describe("qa_loop_undo", () => {
  let state: QaLoopState
  beforeEach(() => { state = new QaLoopState(); state.save("perun", minimalSidecar()); vi.restoreAllMocks() })

  function tools() {
    return makeQaLoopTools({ gate: fakeGate("perun"), state, cwd: "/tmp", resolveParentID: async (s) => s, assignIssueIds: noopAssign })
  }

  it("rejects a non-coordinator caller", async () => {
    const res = JSON.parse(await tools().qa_loop_undo.execute({}, { sessionID: "child" }))
    expect(res.status).toBe("forbidden")
  })

  it("reverts the tree to the pre-loop ref", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(true)
    const undo = vi.spyOn(gitOps, "undoToPreLoop").mockReturnValue(undefined)
    const res = JSON.parse(await tools().qa_loop_undo.execute({}, { sessionID: "perun" }))
    expect(res.status).toBe("ok")
    expect(undo).toHaveBeenCalledWith("/tmp", "refs/qa-loop/pre/qa-loop-demo-1")
    expect(res.restored_ref).toBe("refs/qa-loop/pre/qa-loop-demo-1")
  })

  it("errors when the pre-loop ref is missing", async () => {
    vi.spyOn(gitOps, "refExists").mockReturnValue(false)
    const undo = vi.spyOn(gitOps, "undoToPreLoop")
    const res = JSON.parse(await tools().qa_loop_undo.execute({}, { sessionID: "perun" }))
    expect(res.status).toBe("error")
    expect(undo).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/tools-undo.test.ts`
Expected: FAIL — `qa_loop_undo` is not on the tool map.

- [ ] **Step 3: Add `qa_loop_undo`**

In `src/modules/qa-loop/tools.ts`, extend the git-ops import:

```typescript
import { capturePreLoopRef, refExists, restoreFailRef, antiHardcodeDiff, undoToPreLoop } from "./git-ops.js"
```

In the factory body, after `qa_loop_finalize`, add:

```typescript
  const qa_loop_undo = tool({
    description: [
      "Total undo (§6): revert the whole working tree to `refs/qa-loop/pre/<run>`, returning the user to exactly the pre-loop state (including any pre-existing dirty work). Perun-only — the coordinator cannot `git reset` itself, so it invokes this tool on request.",
      "",
      'Result shape: `{ status:"ok", restored_ref }` | `{ status:"error", reason }` | `{ status:"forbidden", reason }`.',
    ].join("\n"),
    args: {},
    async execute(_args, ctx) {
      if (!gate.isCoordinatorCaller(ctx.sessionID)) return FORBIDDEN("qa_loop_undo")
      const parentId = await resolveParentID(ctx.sessionID)
      const s = state.load(parentId)
      if (!s) return JSON.stringify({ status: "error", reason: "no active loop run" })

      const ref = s.pre_loop.undo_ref
      if (!refExists(cwd, ref)) {
        return JSON.stringify({ status: "error", reason: `pre-loop ref ${ref} is missing` })
      }
      undoToPreLoop(cwd, ref)
      return JSON.stringify({ status: "ok", restored_ref: ref })
    },
  })
```

Replace the return statement with the full six-tool map:

```typescript
  return {
    qa_loop_start,
    qa_loop_ingest,
    qa_loop_step,
    qa_loop_record_fix,
    qa_loop_finalize,
    qa_loop_undo,
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/tools-undo.test.ts`
Expected: PASS — gate, revert-with-ref, and missing-ref error are all green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/tools.ts tests/modules/qa-loop/tools-undo.test.ts
git commit -m "feat(qa-loop): qa_loop_undo tool — total undo to the pre-loop ref"
```

### Task 16: `index.ts` — module plugin tool map + `QA_LOOP_TOOL_NAMES`

Wire the six tools into the module's own plugin tool map (the `qa/index.ts` pattern, NOT the coordinator map — §3/§8), build the caller gate + `QaLoopState` singletons, register `assign_issue_ids` passthrough, and export the canonical name list for the Perun sync test.

**Files:**
- Create: `src/modules/qa-loop/index.ts`
- Test: `tests/modules/qa-loop/index.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modules/qa-loop/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { QA_LOOP_TOOL_NAMES } from "../../../src/modules/qa-loop/index.js"

describe("qa-loop module wiring", () => {
  it("exports the six tool names in a stable order", () => {
    expect(QA_LOOP_TOOL_NAMES).toEqual([
      "qa_loop_start",
      "qa_loop_ingest",
      "qa_loop_step",
      "qa_loop_record_fix",
      "qa_loop_finalize",
      "qa_loop_undo",
    ])
  })

  it("the tool map keys match QA_LOOP_TOOL_NAMES exactly", async () => {
    // Re-build the tool map the same way the plugin does, with stub deps, and
    // assert the keys line up 1:1 with the exported names.
    const { makeQaLoopTools } = await import("../../../src/modules/qa-loop/tools.js")
    const tools = makeQaLoopTools({
      gate: { isCoordinatorCaller: () => true },
      state: new (await import("../../../src/modules/qa-loop/sidecar.js")).QaLoopState(),
      cwd: "/tmp",
      resolveParentID: async (s) => s,
      assignIssueIds: async () => [],
    })
    expect(Object.keys(tools).sort()).toEqual([...QA_LOOP_TOOL_NAMES].sort())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/qa-loop/index.test.ts`
Expected: FAIL — `src/modules/qa-loop/index.ts` does not exist.

- [ ] **Step 3: Implement `index.ts`**

`src/modules/qa-loop/index.ts`:

```typescript
import { type Plugin } from "@opencode-ai/plugin"
import { makeCallerGate, SETUP_AGENT_KEY } from "../qa/caller-gate.js"
import { SessionAgentRegistry } from "../qa/shell-env-hook.js"
import { makeQaLoopTools, type QaLoopToolDeps } from "./tools.js"
import { QaLoopState } from "./sidecar.js"

export { QaLoopState } from "./sidecar.js"
export { makeQaLoopTools } from "./tools.js"

// Canonical name list — the single source of truth mirrored into Perun's
// allowed-tools frontmatter + PERUN_TOOLS + perun-tools-sync.test.ts (Task 17).
export const QA_LOOP_TOOL_NAMES = [
  "qa_loop_start",
  "qa_loop_ingest",
  "qa_loop_step",
  "qa_loop_record_fix",
  "qa_loop_finalize",
  "qa_loop_undo",
] as const

export const AppVerkQaLoopPlugin: Plugin = async ({ client }) => {
  const state = new QaLoopState()
  // The qa-loop tools are Perun-only. Reuse the QA module's caller gate
  // semantics: a registry MISS means the coordinator (Perun is never a
  // dispatched child). A fresh registry here is fine — these tools never need
  // to recognise a specific specialist, only "is the caller a dispatched child".
  const registry = new SessionAgentRegistry()
  const gate = makeCallerGate({ registry, setupAgentKey: SETUP_AGENT_KEY })

  const parentIDCache = new Map<string, string>()
  async function resolveParentID(sessionID: string): Promise<string> {
    const cached = parentIDCache.get(sessionID)
    if (cached !== undefined) return cached
    try {
      const result = await client.session.get({ path: { id: sessionID } })
      const parentID = result.data?.parentID
      if (typeof parentID === "string" && parentID.length > 0) {
        parentIDCache.set(sessionID, parentID)
        return parentID
      }
    } catch {
      // fall through
    }
    return sessionID
  }

  // assign_issue_ids passthrough: the qa-loop tools mint QA-IDs via the existing
  // coordinator minter. The coordinator owns the canonical implementation; here
  // we thread a thin call through the SDK tool surface so qa_loop_ingest reuses
  // it rather than minting a second time (§5 "reuses the existing tool").
  const assignIssueIds: QaLoopToolDeps["assignIssueIds"] = async ({ findings, startAt }) => {
    // Deterministic local fan-out matching assign_issue_ids' QA-NNN contract.
    // (Wired to the coordinator tool at integration time; kept self-contained
    // so the module has no coordinator import cycle.)
    let n = startAt ?? 1
    return findings.map((f) => ({ ...f, id: `QA-${String(n++).padStart(3, "0")}` }))
  }

  const tools = makeQaLoopTools({
    gate,
    state,
    cwd: process.cwd(),
    resolveParentID,
    assignIssueIds,
  })

  return {
    tool: tools,
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const deletedID = event.properties?.info?.id
      if (typeof deletedID !== "string" || deletedID.length === 0) return
      registry.unregister(deletedID)
      state.clearRun(deletedID)
      parentIDCache.delete(deletedID)
      for (const [childID, parentID] of parentIDCache.entries()) {
        if (parentID === deletedID) parentIDCache.delete(childID)
      }
    },
  }
}

export default AppVerkQaLoopPlugin
```

> Note: confirm the real export name of `SessionAgentRegistry` in `src/modules/qa/shell-env-hook.js` (it is re-exported there) and `QaLoopState.clearRun`'s signature (sidecar.ts, a prior Phase-2 task) — adjust the import/cleanup to the actual shapes. The `assignIssueIds` body is the module-local QA-NNN fan-out; the integration task (Phase 3) rebinds it to the coordinator's `assign_issue_ids` if a live wiring is required, but the contract (`{ findings, startAt } → {…, id}[]`) is fixed here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/qa-loop/index.test.ts`
Expected: PASS — `QA_LOOP_TOOL_NAMES` ordering and the tool-map key parity both green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/qa-loop/index.ts tests/modules/qa-loop/index.test.ts
git commit -m "feat(qa-loop): module plugin tool map + QA_LOOP_TOOL_NAMES export"
```

### Task 17: Wire the six tools into Perun's allowlist + the sync test

§3/§8 manual link: add the six names to `src/agents/perun.md` `allowed-tools` frontmatter, the `PERUN_TOOLS` constant, and `tests/modules/coordinator/perun-tools-sync.test.ts` (no programmatic link, `coordinator/index.ts:507-510`). Also assert in code that each of the six `execute()`s guards on `isCoordinatorCaller` (mirroring `preflight`/`parse_plan`).

**Files:**
- Modify: `src/agents/perun.md` (frontmatter `allowed-tools`)
- Modify: `src/modules/coordinator/index.ts` (the `PERUN_TOOLS` constant near `:507-510`)
- Modify: `tests/modules/coordinator/perun-tools-sync.test.ts`
- Test: `tests/modules/qa-loop/caller-gate-coverage.test.ts` (create)

- [ ] **Step 1: Write the failing test — sync expectation + execute-gate coverage**

Append the six names to the existing sync test's expected set (open `tests/modules/coordinator/perun-tools-sync.test.ts` and add them to the array/set it compares — match its existing style). Then create `tests/modules/qa-loop/caller-gate-coverage.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { QA_LOOP_TOOL_NAMES } from "../../../src/modules/qa-loop/index.js"
import { makeQaLoopTools } from "../../../src/modules/qa-loop/tools.js"
import { QaLoopState } from "../../../src/modules/qa-loop/sidecar.js"

describe("every qa-loop tool guards on isCoordinatorCaller", () => {
  it("a non-coordinator caller is rejected by all six tools", async () => {
    const tools = makeQaLoopTools({
      gate: { isCoordinatorCaller: (s: string) => s === "perun" },
      state: new QaLoopState(),
      cwd: "/tmp",
      resolveParentID: async (s) => s,
      assignIssueIds: async () => [],
    })
    // Minimal arg stubs per tool; the gate check runs FIRST, before arg use.
    const stubs: Record<string, unknown> = {
      qa_loop_start: { plan_path: "p", topic: "t", report_path: "r" },
      qa_loop_ingest: { phase: "baseline", results: [] },
      qa_loop_step: { phase: "enter" },
      qa_loop_record_fix: { qa_id: "QA-001", child_session_id: "s", svarog_status: "READY", changed: [], reason: "" },
      qa_loop_finalize: { final_pass_elapsed_s: 0 },
      qa_loop_undo: {},
    }
    for (const name of QA_LOOP_TOOL_NAMES) {
      const res = JSON.parse(await (tools as any)[name].execute(stubs[name], { sessionID: "child" }))
      expect(res.status, `${name} must reject non-coordinator`).toBe("forbidden")
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run tests/modules/coordinator/perun-tools-sync.test.ts tests/modules/qa-loop/caller-gate-coverage.test.ts`
Expected: FAIL — the sync test fails because `PERUN_TOOLS` / frontmatter lack the six names; the gate-coverage test is the regression guard (it passes once the gates from Tasks 9-14 are in place, but is run here to confirm all six reject — if any tool used args before the gate it would throw instead of returning `forbidden`).

- [ ] **Step 3: Add the six names to `PERUN_TOOLS` and Perun's frontmatter**

In `src/modules/coordinator/index.ts`, extend the `PERUN_TOOLS` constant (near `:507-510`) with the six qa-loop names — append them after the existing QA tools (`preflight`, `parse_plan`, …), keeping the array's existing formatting:

```typescript
  "qa_loop_start",
  "qa_loop_ingest",
  "qa_loop_step",
  "qa_loop_record_fix",
  "qa_loop_finalize",
  "qa_loop_undo",
```

In `src/agents/perun.md`, add the same six names to the `allowed-tools:` frontmatter list, after the existing QA tools — match the existing one-name-per-line YAML style.

- [ ] **Step 4: Run the full coordinator + qa-loop suites**

Run: `bunx vitest run tests/modules/coordinator/perun-tools-sync.test.ts tests/modules/qa-loop/`
Expected: PASS — the sync test sees frontmatter + `PERUN_TOOLS` + the exported names agree; the gate-coverage test confirms all six reject a non-coordinator caller.

- [ ] **Step 5: Commit**

```bash
git add src/agents/perun.md src/modules/coordinator/index.ts tests/modules/coordinator/perun-tools-sync.test.ts tests/modules/qa-loop/caller-gate-coverage.test.ts
git commit -m "feat(qa-loop): wire qa_loop_* tools into Perun allowlist + sync/gate tests"
```

## Phase 3 — Integration: Perun workflow, command surface, fix-auto de-registration, docs, eval

These tasks wire the `qa-loop` module (Phase 2) into the running harness. They are prose/prompt edits, a delete-and-rewire sweep, a doctrine port, and new eval scenarios — no new module code. The de-registration sweep follows the §8 inventory (the 18 real paths from `grep -rl fix-auto src/ tests/ docs/`, minus the two spec/plan files). Each editing task ends with a grep-or-test verification; each test/de-reg task ends by running the affected suite.

### Task 18: Restructure Perun Workflows 1+2 into the unified QA-loop workflow

Collapse Workflow 1 (QA Run) + Workflow 2 (Issue Fix) into one **"QA Loop"** workflow that drives the §4 phase pipeline (Phase 0 RESOLVE & GUARD → Phase 1 BASELINE → Phase 2 LOOP → Phase 3 FINAL → Phase 4 SUMMARY) via the `qa_loop_*` tools. Reuse the existing step text **verbatim** inside it (§8 "Changed — Perun": Veles plan, sanitize, preflight 3.5, Stribog bring-up 3.55, parse bindings 3.6, fixture mutation 3.8, wave dispatch Step 5, NEED_INFO backstop Step 6) — the new material is the `qa_loop_*` calls + the gate + the iterate/final phases wrapped around them. This is a prompt edit anchored on the spec's §4 pipeline; do NOT invent control logic — the math lives in the tools.

**Files:**
- Modify: `src/agents/perun.md` (Workflow 1 region `:74-523`, Workflow 2 region `:525-566`)

- [ ] **Step 1: Write the failing prompt-content test**

`tests/agents/perun-qa-loop-workflow.test.ts` (create):

```typescript
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const perun = readFileSync(
  join(__dirname, "../../src/agents/perun.md"),
  "utf8",
)

describe("Perun unified QA-loop workflow", () => {
  it("has a single QA Loop workflow, not separate Workflow 1 + Workflow 2", () => {
    expect(perun).toMatch(/###\s+Workflow 1:\s*QA Loop/)
    expect(perun).not.toMatch(/###\s+Workflow 2:\s*Issue Fix/)
  })

  it("drives the §4 phase pipeline by name", () => {
    expect(perun).toContain("Phase 0")
    expect(perun).toContain("Phase 1")
    expect(perun).toContain("Phase 2")
    expect(perun).toContain("Phase 3")
    expect(perun).toContain("Phase 4")
  })

  it("calls every qa_loop_* tool in the workflow body", () => {
    for (const t of [
      "qa_loop_start",
      "qa_loop_ingest",
      "qa_loop_step",
      "qa_loop_record_fix",
      "qa_loop_finalize",
      "qa_loop_undo",
    ]) {
      expect(perun).toContain(t)
    }
  })

  it("dispatches Svarog (not fix-auto) as the in-loop fixer", () => {
    // the loop body dispatches svarog one issue at a time
    expect(perun).toMatch(/agent:\s*"svarog"/)
    // no fix-auto dispatch survives anywhere in the workflow
    expect(perun).not.toContain("fix-auto")
  })

  it("preserves the reused-verbatim steps inside the loop", () => {
    expect(perun).toContain("Preflight prerequisites")
    expect(perun).toContain("Service bring-up (auto, via Stribog)")
    expect(perun).toContain("Parse bindings")
    expect(perun).toContain("Compute waves")
    expect(perun).toContain("NEED_INFO")
  })

  it("stops authoring the report itself — the tool is the single writer", () => {
    // the hand-Edit of Status: ✅ Fixed lines is gone
    expect(perun).not.toMatch(/Edit.*Status:.*✅ Fixed/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/agents/perun-qa-loop-workflow.test.ts`
Expected: FAIL — `Workflow 2: Issue Fix` still present, `qa_loop_*` tools absent, `fix-auto` still dispatched, the `Edit … Status: ✅ Fixed` rule still present.

- [ ] **Step 3: Rename the Workflow 1 header and add the Phase-0 RESOLVE & GUARD preamble**

In `src/agents/perun.md`, change the header at `:74` from `### Workflow 1: QA Run` to `### Workflow 1: QA Loop`, and insert a Phase-0 block immediately after the **Trigger** / **Steps:** preamble (before the existing Step 1), per §4 Phase 0:

```markdown
**This is a closed test→fix→retest loop.** You orchestrate; the `qa_loop_*` tools own all math + state + git + the report. You NEVER shell, hash, or hand-edit the report. The pipeline runs Phase 0 → Phase 4 below.

#### Phase 0 — RESOLVE & GUARD

After you have a `plan_path` (author via Veles per Step 1 if none), call `qa_loop_start` ONCE to resolve idempotency, init the sidecar, and capture the pre-loop undo ref:

```
qa_loop_start({
  plan_path: "<resolved plan path>",
  mode: "<approve|auto|step, default approve>",
  severity_floor: "<LOW|MEDIUM|HIGH|CRITICAL, default LOW>",
  max_iterations: 3, max_dispatches: 50, time_budget_s: 1800,
  allow_mutations: false
})
```

It returns `{ disposition: "REUSE"|"ADOPT"|"FRESH"|"TAMPER", run_id, dispatch_set, base_url, dirty }`:
- The `dispatch_set` is the plan's scenarios **with mutating-expected-success scenarios already stripped** (the mutation guard, §7) — dispatch exactly that set to Zmora, never the raw plan. Negative-blocked scenarios stay in.
- `REUSE` → resume mid-loop from the sidecar cursor (§4); `ADOPT` → fresh budget, QA-IDs re-imported from the report, warn the plan changed; `FRESH` → new run; `TAMPER` → stop, the tool flushes a partial report.
- `dirty: true` → surface a heads-up that uncommitted work is in the tree (the pre-loop ref captures it, so undo restores it).
```

- [ ] **Step 4: Wrap the reused Phase-1 steps and add the BASELINE ingest**

Keep Steps 2–3.8 (parse, sanitize, preflight, Stribog bring-up, bindings, waves, fixture mutation) and Step 5 (wave dispatch) **verbatim** under a `#### Phase 1 — BASELINE (authoritative, once)` sub-header. After the Phase-1 wave dispatch returns Zmora results, add the baseline ingest + the Phase-1 exit, per §4:

```markdown
After every baseline wave completes, ingest the merged Zmora results ONCE:

```
qa_loop_ingest({ run_id, phase: "baseline", results: <merged zmora result JSON> })
```

The tool mints QA-IDs (via `assign_issue_ids`), records baseline scenario states + kinds + coverage, and persists. It returns `{ failing: [...], result_if_terminal: "Pass"|"NotVerified"|"Fail"|null }`.

**Phase-1 exit (§4):** if `result_if_terminal` is non-null (no scenario fails ≥ severity), the baseline is terminal — call `qa_loop_finalize` NOW (Phase 4) and STOP; skip Phases 2–3 and emit no gate. Otherwise (failures exist) enter Phase 2.
```

- [ ] **Step 5: Replace Workflow 2 with the Phase-2 LOOP body (Svarog fixer + gate)**

Delete the entire `### Workflow 2: Issue Fix (Continuation)` region (`:525-566`) and add a `#### Phase 2 — LOOP` sub-section inside Workflow 1, implementing the §4 iteration zoom (2.0 `step(enter)` → 2b gate → 2c sequential Svarog fix + `record_fix` → 2e re-test ingest → 2f `step(evaluate)`):

```markdown
#### Phase 2 — LOOP

Repeat until a `qa_loop_step` result tells you to stop. Each iteration:

**2.0 — Enter.** Call `qa_loop_step({ run_id, op: "enter" })`. It increments the iteration (idempotent on resume — see §4: a still-open `iterations[n]` resumes from its `phase` without a second increment), re-hashes the plan (tamper guard), and checks budgets. It returns one of:
- `{ action: "fix", issues: [QA-IDs] }` → proceed to the gate.
- `{ action: "stop", stop_cause }` → go to Phase 3 FINAL (the loop is done; the final still runs).
- `{ action: "final" }` → go to Phase 3 FINAL.

**2b — GATE (per `config.mode`).** If `mode` is `approve` (default) or `step`, emit the fix-set `question` (one prompt for the whole set — see "QA loop gate" below). `auto` skips the gate. On **Abort** / an unanswerable gate, go straight to Phase 3 with the partial state (fail-safe Abort).

**2c — FIX (sequential, one issue at a time).** For each QA-ID the step returned, in order:
- Before dispatching, the tool's `dispatch_count_total` is the MAXD ceiling — if `step(enter)` already signalled a budget stop, you will have gone to FINAL instead; you never dispatch past MAXD.
- Dispatch Svarog for that ONE issue (see "Svarog fix dispatch" below). Then thread the result into:

```
qa_loop_record_fix({
  run_id,
  qa_id: "<QA-NNN>",
  child_session_id: "<DispatchResult.sessionId>",
  svarog_status: "<READY|FAIL|ESCALATE>",
  changed: <changed[] from Svarog's result>,
  reason: "<Svarog reason / escalate reason, or null>"
})
```

`record_fix` is the SOLE writer of the child session id, binds/validates the checkpoint ref, does `dispatch_count_total++` exactly once (READY/FAIL/ESCALATE alike), and on FAIL auto-restores that issue's checkpoint. It returns `{ status, integrity_abort?: true }` — if `integrity_abort` is set (a READY whose ckpt ref is missing/stale, §6), STOP the loop and go to Phase 3 without auto-restoring; surface it.

**2e — RE-TEST.** Dispatch Zmora for the sections holding still-failing scenarios, then:

```
qa_loop_ingest({ run_id, phase: "retest", results: <merged zmora result JSON> })
```

**2f — EVALUATE.** Call `qa_loop_step({ run_id, op: "evaluate" })`. It checks regression FIRST, then progress, and returns `{ action: "continue" }` (loop again from 2.0) or `{ action: "stop"|"final", stop_cause? }` (go to Phase 3). It appends the iteration's Loop-History row — you write NO Status lines.
```

- [ ] **Step 6: Add the Svarog fix dispatch shape and the QA-loop gate prompt**

Add, inside Phase 2 (referenced by 2c / 2b), the §6 Svarog dispatch and the §7 gate. Replace the old Workflow-2 `fix-auto` dispatch block entirely:

```markdown
**Svarog fix dispatch (per issue, sequential):**

```
dispatch_parallel({
  agent: "svarog",
  summary: "fix QA-NNN <short title ≤40 chars>",
  tasks: [{ name: "svarog", prompt:
    "Fix this QA finding. Anchor on its Location.\n<issue block: ID, severity, location, problem, remediation, scenario>\n\n" +
    "Constraints:\n" +
    "• Source-only: fix the code under test. Do NOT touch the QA plan or QA scenario files — they are the oracle.\n" +
    "• You MAY add/adjust unit/integration tests as part of your test-first fix (hardens the fix; NOT the QA oracle).\n" +
    "• Never commit. Your checkpoint + the loop handle recovery." }]
})
```

Read `DispatchResult.sessionId` from the result and thread it into `record_fix` as `child_session_id`.

**QA loop gate (`approve` / `step` fix-set gate):**

```
question({
  header:   "QA loop — iteration <n>/<MAXI>",
  question: "<F> scenarios failing · <K> Svarog fixes queued · <S> skipped (no location) · <D>/<MAXD> dispatches used. Proceed?",
  options: [
    "Approve all — dispatch the fixes, then re-test",
    "Skip to final — no fixes; run the authoritative final pass + report",
    "Abort — stop now, write the partial report"
  ]
})
```

In `step` mode, emit a second gate before each re-test with options **Re-test now / Skip re-test → final / Abort**. In `auto` mode, emit the one-time scope banner instead of any gate (`will run ≤<MAXI> iterations / ≤<MAXD> dispatches, edits source under test, leaves changes uncommitted`).
```

- [ ] **Step 7: Add Phase 3 FINAL + Phase 4 SUMMARY and drop the report-authoring rules**

Add the authoritative final + summary per §4 Phases 3–4, and remove the old "Perun authors the report" / "Edit only for Status lines" rules (§8 "Perun stops authoring the report"):

```markdown
#### Phase 3 — FINAL (authoritative, once)

Re-run the ENTIRE plan via Zmora (the full `dispatch_set`), then ingest with `phase: "final"`:

```
qa_loop_ingest({ run_id, phase: "final", results: <merged zmora result JSON> })
```

This is the ONLY ingest that lets a `fix-attempted` issue become `fixed` (the oracle-separation invariant — only `qa_loop_finalize` writes `✅ Fixed`, and only when this final shows the scenario PASS). New regressions surface as new QA-IDs.

#### Phase 4 — SUMMARY

```
qa_loop_finalize({ run_id })
```

It computes the Result (Pass / Fail / BudgetExhausted / Stopped / NotVerified — Pass is checked before BudgetExhausted, §4), writes the final report (Status, Loop History, Coverage, recovery line), and returns the summary. Surface it to the user, including the recovery hint that `qa_loop_undo({ run_id })` restores `refs/qa-loop/pre/<run>`.
```

Then delete the report-authoring + `Edit … Status: ✅ Fixed` rules wherever they appear in the Tool Usage Rules / per-workflow notes (the tool is the single writer now), and delete the `### Workflow 2: Issue Fix (Continuation)` section header and body in full.

- [ ] **Step 8: Run the prompt-content test + the existing perun-prompt suite**

Run: `bunx vitest run tests/agents/perun-qa-loop-workflow.test.ts tests/modules/agent-registry/`
Expected: PASS (new workflow assertions green). If the agent-registry prompt-builder/integration tests fail on the surviving `fix-auto` row, that is expected — they are repaired in Tasks 22–26; for now re-run only the new test to confirm Step 1's assertions pass:
Run: `bunx vitest run tests/agents/perun-qa-loop-workflow.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/agents/perun.md tests/agents/perun-qa-loop-workflow.test.ts
git commit -m "feat(perun): collapse Workflows 1+2 into the unified QA-loop workflow"
```

### Task 19: Re-point Workflow 0 routing to the loop

Workflow 0's "test it" classification and worked example still describe the old one-pass Workflow-1 QA run; re-point them at the loop (§8 "Workflow 0 routing re-points to the loop").

**Files:**
- Modify: `src/agents/perun.md` (Workflow 0 region `:45-72`)

- [ ] **Step 1: Write the failing test**

Add to `tests/agents/perun-qa-loop-workflow.test.ts`:

```typescript
describe("Perun Workflow 0 routing points at the QA loop", () => {
  it("the test-it branch routes into the QA loop, not a one-pass run", () => {
    const wf0 = perun.slice(
      perun.indexOf("### Workflow 0"),
      perun.indexOf("### Workflow 1"),
    )
    expect(wf0).toMatch(/QA loop|Workflow 1.*QA Loop/)
    expect(wf0).not.toMatch(/per Workflow 1\b(?!.*Loop)/)
  })
})
```

> Note: the slice bounds rely on the Task-18 header rename (`### Workflow 1: QA Loop`). The assertion is that the WF0 "test it" branch names the loop, not a one-pass run.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/agents/perun-qa-loop-workflow.test.ts -t "Workflow 0 routing"`
Expected: FAIL — WF0 still says "run it via `zmora` per Workflow 1" with no loop reference.

- [ ] **Step 3: Re-point the WF0 "test it" branch + worked example**

In `src/agents/perun.md` Workflow 0 (`:67` and `:72`), update the "Also test it" bullet and the worked example so both route into the QA loop:

```markdown
   - **Also "test it"** → this is plan-then-execute. Enter **Workflow 1 (QA Loop)**: dispatch `Veles - Planner` to author a QA plan for the changed surface, then run the closed test→fix→retest loop via the `qa_loop_*` tools (baseline via `zmora`, Svarog fixes, re-test, authoritative final). NEVER hand a free-form "test this branch" to `svarog`/`stribog` as an ad-hoc tester — inside the loop, Svarog is the *fixer*, dispatched one issue at a time by the loop, never a manual-test executor.
```

And the worked example (`:72`): replace "then run it via `zmora` per Workflow 1" with "then run the QA loop per Workflow 1 (baseline → gated Svarog fixes → re-test → final report)".

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/agents/perun-qa-loop-workflow.test.ts -t "Workflow 0 routing"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/perun.md tests/agents/perun-qa-loop-workflow.test.ts
git commit -m "docs(perun): re-point Workflow 0 test-it routing at the QA loop"
```

### Task 20: Add the loop flags to `/qa:run`

`/qa:run` *becomes* the loop with the §8 flag surface: `--mode` / `--max-iterations` / `--max-dispatches` / `--time-budget` / `--severity-floor` / `--allow-mutations` (severity default `LOW`, all settable in natural language). The command stays a thin handoff — it parses the flags out of `$ARGUMENTS` and forwards them to Perun; Perun owns the loop.

**Files:**
- Modify: `src/commands/run-qa.md` (Arguments table `:19-21`, the Perun delegation `:67-94`)

- [ ] **Step 1: Write the failing test**

`tests/commands/run-qa-loop-flags.test.ts` (create):

```typescript
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const cmd = readFileSync(
  join(__dirname, "../../src/commands/run-qa.md"),
  "utf8",
)

describe("/qa:run loop flags", () => {
  it("documents every loop flag", () => {
    for (const flag of [
      "--mode",
      "--max-iterations",
      "--max-dispatches",
      "--time-budget",
      "--severity-floor",
      "--allow-mutations",
    ]) {
      expect(cmd).toContain(flag)
    }
  })

  it("states the severity-floor default is LOW", () => {
    expect(cmd).toMatch(/--severity-floor[^\n]*LOW/i)
  })

  it("describes /qa:run as the closed loop, not a one-pass run", () => {
    expect(cmd).toMatch(/test→fix→retest|closed loop|QA loop/i)
  })

  it("no longer offers a fix-auto follow-up", () => {
    expect(cmd).not.toContain("fix-auto")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/commands/run-qa-loop-flags.test.ts`
Expected: FAIL — no flags documented, and `:94` still offers a `fix-auto` follow-up.

- [ ] **Step 3: Add the flags to the Arguments table**

In `src/commands/run-qa.md`, extend the Arguments table (`:19-21`) with the flag rows:

```markdown
| Argument | Interpretation |
|----------|---------------|
| (empty) | Find the most recent test plan in `docs/testing/plans/` |
| `<path>` | Use the specified test plan file |
| `--mode <approve\|auto\|step>` | Gate policy (default `approve`; `auto` is headless) |
| `--max-iterations <N>` | Loop iteration ceiling (default `3`) |
| `--max-dispatches <N>` | Svarog dispatch ceiling — the true MAXD gate (default `50`) |
| `--time-budget <seconds>` | Wall-clock budget checked at iteration boundaries (default `1800`) |
| `--severity-floor <LOW\|MEDIUM\|HIGH\|CRITICAL>` | Minimum severity that enters the loop (default `LOW`) |
| `--allow-mutations` | Keep mutating-expected-success scenarios in the dispatch set (default off — they are stripped by the mutation guard) |

Flags may also be given in natural language ("run QA autonomously" → `--mode auto`; "only fix highs" → `--severity-floor HIGH`). Forward whatever you parse to Perun verbatim.
```

- [ ] **Step 4: Re-frame the handoff as the loop and forward the flags**

Update Step 3's handoff (`:67-94`): change the closing line and the delegation summary so `/qa:run` is the closed loop, and replace the `fix-auto` follow-up (`:94`). Replace the `@perun run QA for <resolved-plan-path>` message and the numbered "Perun will then" list's final bullet:

```markdown
```
@perun run the QA loop for <resolved-plan-path> <parsed flags, e.g. --mode auto --severity-floor HIGH>
```

Perun runs the closed test→fix→retest loop: baseline → (gated) Svarog fixes one issue at a time → re-test → authoritative final pass → report. The `qa_loop_*` tools own the budgets, idempotency, regression/progress guards, and the report (the single writer).
```

And change `:94` from the `fix-auto` offer to:

```markdown
10. **Run the loop to completion** and display the final summary (Result, Loop History, Coverage, and the `qa_loop_undo` recovery hint). There is no separate fix follow-up — fixing IS the loop.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run tests/commands/run-qa-loop-flags.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/run-qa.md tests/commands/run-qa-loop-flags.test.ts
git commit -m "feat(run-qa): /qa:run becomes the loop with mode/budget/severity flags"
```

### Task 21: Delete the fix-auto src-side metadata mirror + its cross-boundary sync test

Per §8 "Delete": remove `src/modules/agent-registry/fix-auto.metadata.ts` (the src-side mirror) and `tests/modules/agent-registry/fix-auto-cross-boundary-sync.test.ts`. The coordinator registration that imports it is repaired in Task 22 — do these two as the first de-reg step so the failing build pins exactly the broken import.

**Files:**
- Delete: `src/modules/agent-registry/fix-auto.metadata.ts`
- Delete: `tests/modules/agent-registry/fix-auto-cross-boundary-sync.test.ts`

- [ ] **Step 1: Delete both files and confirm the dangling import (the "failing test")**

```bash
git rm src/modules/agent-registry/fix-auto.metadata.ts tests/modules/agent-registry/fix-auto-cross-boundary-sync.test.ts
```

- [ ] **Step 2: Run the type-check to verify the dangling import fails the build**

Run: `bunx tsc --noEmit`
Expected: FAIL — `src/modules/coordinator/index.ts:29` still imports `fixAutoSpecialistInfo` from the now-deleted module (this is the breakage Task 22 fixes).

- [ ] **Step 3: Commit the deletions (build-broken-by-design, fixed in Task 22)**

```bash
git commit -m "chore(agent-registry): delete fix-auto src-side metadata mirror + sync test"
```

### Task 22: Drop the fix-auto registration from the coordinator

Per §8 "Update": remove the import + the `registerAgentMetadata(fixAutoSpecialistInfo)` call (and its explanatory comment) from `src/modules/coordinator/index.ts` so Perun no longer advertises/dispatches fix-auto.

**Files:**
- Modify: `src/modules/coordinator/index.ts:29` (import), `:120-123` (comment + registration call)

- [ ] **Step 1: Remove the import and the registration**

In `src/modules/coordinator/index.ts`, delete the import at `:29`:

```typescript
import { fixAutoSpecialistInfo } from "../agent-registry/fix-auto.metadata.js"
```

and delete the comment + call at `:120-123`:

```typescript
  // fix-auto lives in packages/code-review (a separate build unit that cannot
  // import this bridge); register its metadata here so Perun's specialist table
  // keeps its row. Explicit src-side entry — see the renderer spec.
  registerAgentMetadata(fixAutoSpecialistInfo)
```

- [ ] **Step 2: Run the type-check + the coordinator suite**

Run: `bunx tsc --noEmit && bunx vitest run tests/modules/coordinator/`
Expected: `tsc` PASS (dangling import gone). The coordinator suite may still FAIL on the `dispatch*` tests that assert a `fix-auto` row/title — those are fixed in Task 27; confirm the build compiles cleanly here.

- [ ] **Step 3: Commit**

```bash
git commit -am "chore(coordinator): de-register fix-auto from the specialist registry"
```

### Task 23: Drop the fix-auto reference from Veles metadata

Per §8 "Update": `src/modules/plan/veles.metadata.ts:35` names fix-auto in the "execution, not planning" delegation hint. Re-point it at the real executors (svarog / stribog) now that fix-auto is not a Pantheon target.

**Files:**
- Modify: `src/modules/plan/veles.metadata.ts:35`
- Test: existing `tests/modules/plan/*` (Veles metadata coverage) — run after

- [ ] **Step 1: Edit the hint**

In `src/modules/plan/veles.metadata.ts:35`, change:

```typescript
      "The task is execution, not planning (dispatch zmora / fix-auto instead)",
```

to:

```typescript
      "The task is execution, not planning (dispatch zmora / svarog instead)",
```

- [ ] **Step 2: Run the Veles metadata suite**

Run: `bunx vitest run tests/modules/plan/`
Expected: PASS (the hint string is not asserted verbatim; if any test pins the old text, update it to `svarog`).

- [ ] **Step 3: Commit**

```bash
git commit -am "chore(plan): drop fix-auto from Veles execution-not-planning hint"
```

### Task 24: Repair the metadata-coverage + registry-freeze-e2e agent-registry tests

Per §8 "Update": `metadata-coverage.test.ts` imports `fixAutoSpecialistInfo` and asserts the baseline set is `["fix-auto", "zmora"]`; `registry-freeze-e2e.test.ts` asserts the rendered prompt contains `` `fix-auto` ``. Both must drop fix-auto.

**Files:**
- Modify: `tests/modules/agent-registry/metadata-coverage.test.ts:11,36,40-43,91`
- Modify: `tests/modules/agent-registry/registry-freeze-e2e.test.ts:41,50,60-62`

- [ ] **Step 1: Run the tests to confirm they fail post-de-reg**

Run: `bunx vitest run tests/modules/agent-registry/metadata-coverage.test.ts tests/modules/agent-registry/registry-freeze-e2e.test.ts`
Expected: FAIL — `metadata-coverage` fails on the missing import; `registry-freeze-e2e` fails its `toContain("`fix-auto`")` assertion (the coordinator no longer registers it).

- [ ] **Step 2: Remove fix-auto from metadata-coverage**

In `tests/modules/agent-registry/metadata-coverage.test.ts`: delete the import (`:11`), change the baseline expectation (`:36`) from `["fix-auto", "zmora"]` to `["zmora"]`, drop `fixAutoSpecialistInfo` from the registration array (`:40-43`) and update the surrounding comment, and change the membership assertion (`:91`) `expect(registered.has("fix-auto")).toBe(true)` to assert fix-auto is **absent**:

```typescript
    expect(registered.has("fix-auto")).toBe(false)
```

- [ ] **Step 3: Remove fix-auto from registry-freeze-e2e**

In `tests/modules/agent-registry/registry-freeze-e2e.test.ts`: drop the fix-auto mentions in the comments (`:41,50,60`) and change the prompt assertion (`:62`) from `expect(prompt).toContain("`fix-auto`")` to assert the rendered prompt no longer advertises it:

```typescript
    expect(prompt).not.toContain("`fix-auto`")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run tests/modules/agent-registry/metadata-coverage.test.ts tests/modules/agent-registry/registry-freeze-e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "test(agent-registry): drop fix-auto from metadata-coverage + registry-freeze"
```

### Task 25: Repair the perun-prompt-builder + perun-prompt-integration tests

Per §8 "Update": `perun-prompt-builder.test.ts:45,48` and `perun-prompt-integration.test.ts:10,31,40` build/assert a fix-auto specialist row. Drop it.

**Files:**
- Modify: `tests/modules/agent-registry/perun-prompt-builder.test.ts:45,48`
- Modify: `tests/modules/agent-registry/perun-prompt-integration.test.ts:10,31,40`

- [ ] **Step 1: Run the tests to confirm they fail post-de-reg**

Run: `bunx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts tests/modules/agent-registry/perun-prompt-integration.test.ts`
Expected: FAIL — `perun-prompt-integration` fails on the deleted `fixAutoSpecialistInfo` import; `perun-prompt-builder` asserts a `` | `fix-auto` | subagent | f | `` row that no longer renders.

- [ ] **Step 2: Remove fix-auto from perun-prompt-builder**

In `tests/modules/agent-registry/perun-prompt-builder.test.ts`: drop the `info({ name: "fix-auto", description: "f" })` entry from the metadata array (`:45`) and delete the row assertion (`:48`) `expect(lines[2]).toBe("| `fix-auto` | subagent | f |")`, re-indexing any subsequent `lines[n]` assertions that shift up by one.

- [ ] **Step 3: Remove fix-auto from perun-prompt-integration**

In `tests/modules/agent-registry/perun-prompt-integration.test.ts`: delete the import (`:10`), drop `fixAutoSpecialistInfo` from the registration array (`:31`), and delete the assertion (`:40`) `expect(out).toContain("| `fix-auto` | subagent |")`. Add a negative assertion to lock the de-reg in:

```typescript
    expect(out).not.toContain("fix-auto")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts tests/modules/agent-registry/perun-prompt-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "test(agent-registry): drop fix-auto from perun-prompt builder + integration"
```

### Task 26: Repair the agent-registry test + the perun-prompt-before fixture

Per §8 "Update": `agent-registry.test.ts:50-52,69-71` registers + asserts a `fix-auto` agent; the `perun-prompt-before.md` fixture (the renderer's BEFORE snapshot) still carries the fix-auto specialist row, the Workflow-2 fix-auto dispatch, and the "Edit only for Status lines" rule. The fixture must mirror the post-de-reg, post-Task-18 Perun template so the renderer's BEFORE→AFTER assertions stay coherent.

**Files:**
- Modify: `tests/modules/agent-registry/agent-registry.test.ts:50-52,69-71`
- Modify: `tests/modules/agent-registry/__fixtures__/perun-prompt-before.md` (lines `:15,34,287,434-452,472,497,531`)

- [ ] **Step 1: Run the tests to confirm they fail post-de-reg**

Run: `bunx vitest run tests/modules/agent-registry/agent-registry.test.ts`
Expected: FAIL — the `info("fix-auto")` registration + lookups assert fix-auto is registered/dispatchable, which the renderer no longer produces.

- [ ] **Step 2: Re-point agent-registry.test.ts to a surviving agent**

In `tests/modules/agent-registry/agent-registry.test.ts`: the `info("fix-auto")` registration + lookup cases (`:50-52,69-71`) test generic register/lookup behavior keyed on the name string — replace the `"fix-auto"` literal with a surviving dispatchable name (`"svarog"`) in both blocks so the behavioral coverage stays but no longer asserts a de-registered agent:

```typescript
    registerAgentMetadata(info("svarog"))
```
```typescript
      "svarog",
```
(apply at both `:50/:52` and `:69/:71`).

- [ ] **Step 3: Update the perun-prompt-before fixture to the post-de-reg template**

In `tests/modules/agent-registry/__fixtures__/perun-prompt-before.md`:
- `:15` — the comment describing the asserted subagent list `["fix-auto", "zmora"]` → `["zmora"]`.
- `:34` — delete the `` | `fix-auto` | subagent | Auto-fix code issues from reports | … | `` specialist-table row.
- `:287,531` — delete the Polish fix-auto fix-offer lines (`Mogę zlecić to fix-auto specjaliście…`).
- `:434-452` — delete the Workflow-2 `dispatch_parallel({ agent: "fix-auto", … })` block and its surrounding "Fix each issue sequentially" steps (the fixture mirrors the collapsed-into-loop template from Task 18; replace with the Svarog loop dispatch or remove the Workflow-2 region wholesale to match the live `perun.md`).
- `:472` — delete the "Sequential fixes only … `fix-auto`" rule line.
- `:497` — change "Do not edit source code yourself; that is `fix-auto`'s job." to drop fix-auto (the tool owns the report; source edits are Svarog's job inside the loop).

> The fixture must end with **zero** occurrences of `fix-auto` and structurally mirror the live `src/agents/perun.md` after Task 18 (single QA Loop workflow). Verify with `grep -c fix-auto` returning 0.

- [ ] **Step 4: Run the agent-registry suite + the grep guard**

Run: `bunx vitest run tests/modules/agent-registry/ && ! grep -q fix-auto tests/modules/agent-registry/__fixtures__/perun-prompt-before.md`
Expected: PASS (whole agent-registry suite green; the fixture has no `fix-auto` left).

- [ ] **Step 5: Commit**

```bash
git commit -am "test(agent-registry): de-reg fix-auto from registry test + prompt fixture"
```

### Task 27: Repair the dispatch* coordinator tests

Per §8 "Update": `dispatch.test.ts:826,834,844` and `dispatch-tool-title.test.ts:160-171` exercise a `fix-auto` dispatch (config, task name, result name, tool title). fix-auto is no longer a Pantheon-dispatched agent — re-point these cases at a surviving dispatchable agent so the dispatch behavior stays covered without naming a de-registered specialist.

**Files:**
- Modify: `tests/modules/coordinator/dispatch.test.ts:826,834,844`
- Modify: `tests/modules/coordinator/dispatch-tool-title.test.ts:160-171`

- [ ] **Step 1: Run the tests to confirm current state**

Run: `bunx vitest run tests/modules/coordinator/dispatch.test.ts tests/modules/coordinator/dispatch-tool-title.test.ts`
Expected: these may still PASS (they use `fix-auto` only as an opaque agent name in a fake config, not via the real registry) — but they advertise a de-registered agent. Re-point them so the de-reg is consistent; the precedent §8 set lists them as "Update".

- [ ] **Step 2: Re-point dispatch.test.ts**

In `tests/modules/coordinator/dispatch.test.ts`: change the agent name in the fake config (`:826`), the task name (`:834`), and the result-name assertion (`:844`) from `"fix-auto"` to `"svarog"`:

```typescript
        "svarog": { mode: "subagent" },
```
```typescript
        { name: "svarog", prompt: "fix something" },
```
```typescript
      expect(results[0]?.name).toBe("svarog")
```

- [ ] **Step 3: Re-point dispatch-tool-title.test.ts**

In `tests/modules/coordinator/dispatch-tool-title.test.ts` (`:160-171`): change the dispatch `agent`/task `name` from `"fix-auto"` to `"svarog"` and update the expected title accordingly:

```typescript
          agent: "svarog",
```
```typescript
          tasks: [{ name: "svarog", prompt: "<issue body>" }],
```
```typescript
        title: "svarog — QA-003 missing CSRF token",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run tests/modules/coordinator/dispatch.test.ts tests/modules/coordinator/dispatch-tool-title.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "test(coordinator): re-point dispatch fixtures off de-registered fix-auto"
```

### Task 28: Scrub fix-auto from pantheon.md + coordinator.md docs

Per §8 "Update": `docs/plugins/pantheon.md:19` and `docs/plugins/coordinator.md` (`:45,96,154,187,301,320,332,336,373,383`) document fix-auto as a Pantheon specialist + the old Workflow-2 sequential-fix flow. Re-document the loop (Svarog as the in-loop fixer) and keep only the §8 "Keep" cross-reference to `docs/plugins/code-review.md` (fix-auto stays a real code-review agent).

**Files:**
- Modify: `docs/plugins/pantheon.md:19`
- Modify: `docs/plugins/coordinator.md:45,96,154,187,301,320,332,336,373,383`

- [ ] **Step 1: Write the failing docs test**

`tests/docs/no-fix-auto-in-pantheon-docs.test.ts` (create):

```typescript
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "../..")

describe("Pantheon docs no longer advertise fix-auto as a Pantheon specialist", () => {
  it("pantheon.md has no fix-auto reference", () => {
    expect(readFileSync(join(root, "docs/plugins/pantheon.md"), "utf8"))
      .not.toContain("fix-auto")
  })

  it("coordinator.md mentions fix-auto only as a code-review cross-reference", () => {
    const doc = readFileSync(join(root, "docs/plugins/coordinator.md"), "utf8")
    const hits = doc.split("\n").filter((l) => l.includes("fix-auto"))
    // the only surviving mention is the code-review.md See-Also pointer
    for (const line of hits) {
      expect(line).toMatch(/code-review\.md/)
    }
  })

  it("coordinator.md documents Svarog as the in-loop fixer", () => {
    const doc = readFileSync(join(root, "docs/plugins/coordinator.md"), "utf8")
    expect(doc).toMatch(/Svarog/)
    expect(doc).toMatch(/QA loop|test→fix→retest/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/docs/no-fix-auto-in-pantheon-docs.test.ts`
Expected: FAIL — both docs carry multiple non-cross-reference fix-auto mentions.

- [ ] **Step 3: Scrub pantheon.md**

In `docs/plugins/pantheon.md:19`, drop the `fix-auto` worker mention from the concurrency sentence (re-phrase to the generic "every dispatched specialist worker" or name `svarog`/`zmora`).

- [ ] **Step 4: Scrub coordinator.md**

In `docs/plugins/coordinator.md`:
- `:45` — replace the Polish fix-auto fix-offer line with the loop framing (no separate fix offer; fixing is the loop via Svarog).
- `:96` — replace the "Fix each issue sequentially … `fix-auto` … `Edit` … `✅ Fixed`" step with the loop description (Svarog one issue at a time; `qa_loop_*` tools own the report + the `✅ Fixed` marker as the single writer).
- `:154` — delete the `` | `fix-auto` | subagent | Auto-fix code issues from reports | … | `` specialist-table row (replace with a `svarog` row if the table enumerates the in-loop fixer).
- `:187` — drop `fix-auto.metadata.ts` from the metadata-registry example list (it no longer exists src-side).
- `:301` — drop `fix-auto` from the per-agent tool-gating enumeration.
- `:320,332` — replace the "Sequential `fix-auto` dispatch" rows/bullets with "Sequential **Svarog** dispatch (one issue per iteration, inside the QA loop)".
- `:336` — change the "four logical specialists … `fix-auto` …" sentence to the current roster (`Veles - Planner`, `zmora` variants, `svarog`, `stribog`, `triglav`) — fix-auto is no longer one of Perun's specialists.
- `:373` — remove the `fix-auto.metadata.ts` line from the directory tree.
- `:383` — KEEP this line: it is the §8 "Keep" cross-reference to `code-review.md` as the source of `fix-auto`. Leave it intact.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run tests/docs/no-fix-auto-in-pantheon-docs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/plugins/pantheon.md docs/plugins/coordinator.md tests/docs/no-fix-auto-in-pantheon-docs.test.ts
git commit -m "docs(coordinator): document the QA loop + Svarog fixer, de-ref fix-auto"
```

### Task 29: Update the triglav eval scenario's metadata-file inventory

Per §8 "Update": `docs/eval/scenarios/triglav/prompt-pipeline-render.md:29` lists `src/modules/agent-registry/fix-auto.metadata.ts` as a metadata-contributing file Triglav should find. That file is deleted (Task 21); the scenario's expected-coverage list must drop it so the eval grades against reality.

**Files:**
- Modify: `docs/eval/scenarios/triglav/prompt-pipeline-render.md:29` (and any surrounding coverage prose naming fix-auto)

- [ ] **Step 1: Remove the fix-auto metadata file from the scenario**

In `docs/eval/scenarios/triglav/prompt-pipeline-render.md`, delete the bullet line:

```
  `src/modules/agent-registry/fix-auto.metadata.ts`
```

from the "metadata-contributing files" list (`:29`), and if the comma-joined list ends on a now-trailing comma, fix the punctuation so the remaining entries (`triglav.metadata.ts`, `zmora.metadata.ts`) read cleanly. If the scenario's `{USE_AVOID:<agent>}` or coverage prose names fix-auto as an expected render target, drop those mentions too.

- [ ] **Step 2: Verify no fix-auto reference remains in the scenario**

Run: `! grep -q fix-auto docs/eval/scenarios/triglav/prompt-pipeline-render.md`
Expected: exit 0 (no match).

- [ ] **Step 3: Commit**

```bash
git commit -am "docs(eval): drop deleted fix-auto.metadata.ts from triglav render scenario"
```

### Task 30: Port the loop-engineering doctrine doc

§5 + §8 make porting av-marketplace's `loop-engineering` doctrine a **hard dependency** — the scenario-kind / coverage taxonomy (§5) is sourced from it. Port it as a Pantheon reference doc so the taxonomy used by `classify.ts` / `qa_loop_ingest` has a canonical home.

**Files:**
- Create: `docs/plugins/qa-loop-engineering.md`
- Modify: `docs/plugins/coordinator.md` (See-Also list) — link the new doc
- Test: `tests/docs/loop-engineering-doctrine.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`tests/docs/loop-engineering-doctrine.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const docPath = join(__dirname, "../../docs/plugins/qa-loop-engineering.md")

describe("loop-engineering doctrine doc", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true)
  })

  it("defines the scenario-kind taxonomy used by classify.ts (§5)", () => {
    const doc = readFileSync(docPath, "utf8")
    for (const kind of ["feature", "sanity", "negative"]) {
      expect(doc).toContain(kind)
    }
  })

  it("defines the coverage buckets used by qa_loop_ingest (§5)", () => {
    const doc = readFileSync(docPath, "utf8")
    for (const bucket of [
      "enforcement",
      "auth-unverified",
      "mutation-guard",
      "tool-unavailable",
    ]) {
      expect(doc).toContain(bucket)
    }
  })

  it("states the oracle-separation invariant", () => {
    const doc = readFileSync(docPath, "utf8")
    expect(doc).toMatch(/oracle separation|independent re-run|only.*final.*Fixed/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/docs/loop-engineering-doctrine.test.ts`
Expected: FAIL — the doc does not exist.

- [ ] **Step 3: Write the doctrine doc**

`docs/plugins/qa-loop-engineering.md`:

```markdown
# QA Loop Engineering — Doctrine

> Ported from av-marketplace's `loop-engineering` skill. This is the **canonical source** of the scenario-kind / coverage taxonomy that `src/modules/qa-loop/classify.ts` and `qa_loop_ingest` implement (design spec §5). Keep this doc and that code in sync.

## The closed loop

QA on Pantheon is a closed **test → fix → retest** loop (design spec §4), not a one-pass run:

1. **Baseline** (authoritative, once) — run every scenario; record pass/fail + kind + coverage.
2. **Loop** — while failures remain ∧ within budgets: pick still-failing issues ≥ severity, dispatch **Svarog** one issue at a time, re-test the affected sections, evaluate regression-then-progress.
3. **Final** (authoritative, once) — re-run the entire plan. This is the **only** run that may stamp `✅ Fixed`.

## Oracle separation (the load-bearing invariant)

A fix is **never** "Fixed" because the fixer says so. It is Fixed only when an **independent** re-run by the verifier (Zmora) confirms the scenario passes in the authoritative **final** run. The fixer (Svarog) is test-first and may add its own regression tests — that is bonus hardening, **not** the oracle. The QA plan + scenario files are sacred; Svarog must never edit them. Only `qa_loop_finalize`, after the final ingest, writes the `Fixed` marker — one deterministic writer owns it, designing out the marker-erasure / status-race bug class.

## Scenario kinds

Every scenario is classified into exactly **one** kind at plan-parse (so the mutation guard can strip mutating scenarios pre-dispatch):

- **`feature`** — exercises new behavior under test. A green run needs ≥1 `feature`-kind PASS, else the result is `NotVerified` (nothing was truly proven).
- **`sanity`** — baseline / smoke; the app was already meant to do this.
- **`negative`** — asserts something should be **rejected / blocked** (expected non-2xx, no state change).

## Coverage buckets

`qa_loop_ingest` rolls each scenario result into a bucket:

**Exercised** (the scenario actually ran):
- `feature` ← `feature`-kind scenario passed.
- `sanity` ← `sanity`-kind scenario passed.
- `enforcement` ← a **passing `negative`** — the rejection was *enforced*.

**Not verified** (the scenario did not truly run; routed from Zmora's SKIP / `NEED_INFO` reason):
- `auth-unverified` — a feature gated behind auth that was not satisfied.
- `mutation-guard` — a mutating scenario skipped by the mutation guard (§7).
- `tool-unavailable` — a required tool (Playwright / `psql` / …) was absent.

An unrecognized SKIP reason falls back to `tool-unavailable` and is appended to `coverage.routing_warnings[]` for audit. An *unrun* `negative` routes by its skip reason like any other kind — only a *passing* negative becomes `enforcement`.

## The mutation guard

The loop re-runs scenarios (baseline + per-iteration re-test + final), so a mutating scenario's side effects **compound**. By default the loop **strips mutating-expected-success scenarios pre-dispatch** (HTTP `POST`/`PUT`/`PATCH`/`DELETE` or a write/DB-write step expected to succeed) — the mutating call never executes — recording each as `mutation-guard`. A `negative`-kind scenario asserting a mutation is **blocked** is **not** stripped (the write never lands; stripping it would gut enforcement coverage). `--allow-mutations` keeps them in.

## Oracle honesty

A plan whose **entire feature surface** is mutation-guarded (every feature scenario lands in `not_verified`) finalizes **`NotVerified`**, never `Pass`. Green requires something feature-kind to have actually passed.

## Anti-patterns (stop causes are conservative by design)

- **Regression masquerading as progress** — a scenario that passed baseline then fails a re-run stops the loop (regression beats progress; checked first).
- **No-progress churn** — an iteration where nothing newly passes stops the loop.
- **Hardcoding the oracle** — a fix that pastes the test's expected payload literal is flagged (non-blocking `hardcode_warnings`) by the anti-hardcoding diff.
- **Flaky-as-truth** — flakiness is a plan-quality problem; the guard stops rather than oscillates. Retry-on-flaky is a non-goal.
```

- [ ] **Step 4: Link the doc from coordinator.md's See-Also**

In `docs/plugins/coordinator.md` See-Also list (near `:383`), add:

```markdown
- [`docs/plugins/qa-loop-engineering.md`](./qa-loop-engineering.md) — QA loop doctrine: scenario-kind / coverage taxonomy, oracle separation, mutation guard.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run tests/docs/loop-engineering-doctrine.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/plugins/qa-loop-engineering.md docs/plugins/coordinator.md tests/docs/loop-engineering-doctrine.test.ts
git commit -m "docs(qa-loop): port loop-engineering doctrine as a Pantheon reference"
```

### Task 31: Add the Perun QA-loop eval scenarios

§8 + acceptance criteria call for new Perun eval scenarios under `docs/eval/scenarios/perun/`. Add six covering: converges (AC2), regression-guard stops (AC3), budget-exhaustion still finalizes (AC4/AC18), FAIL auto-restore (AC5/AC14), checkpoint-integrity abort (AC14), and all-feature-mutation-guarded → NotVerified (AC16). These mirror the existing `role-discipline.md` MUST/NICE-tiered format.

**Files:**
- Create: `docs/eval/scenarios/perun/qa-loop-converges.md`
- Create: `docs/eval/scenarios/perun/qa-loop-regression-guard.md`
- Create: `docs/eval/scenarios/perun/qa-loop-budget-exhaustion.md`
- Create: `docs/eval/scenarios/perun/qa-loop-fail-restore.md`
- Create: `docs/eval/scenarios/perun/qa-loop-checkpoint-integrity.md`
- Create: `docs/eval/scenarios/perun/qa-loop-mutation-guard-notverified.md`
- Test: `tests/docs/perun-qa-loop-scenarios.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`tests/docs/perun-qa-loop-scenarios.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, "../../docs/eval/scenarios/perun")

const scenarios = [
  "qa-loop-converges",
  "qa-loop-regression-guard",
  "qa-loop-budget-exhaustion",
  "qa-loop-fail-restore",
  "qa-loop-checkpoint-integrity",
  "qa-loop-mutation-guard-notverified",
]

describe("Perun QA-loop eval scenarios", () => {
  for (const name of scenarios) {
    it(`${name} exists and follows the scenario format`, () => {
      const p = join(dir, `${name}.md`)
      expect(existsSync(p)).toBe(true)
      const doc = readFileSync(p, "utf8")
      expect(doc).toContain("**Agent:** Perun - Coordinator")
      expect(doc).toContain("## Query")
      expect(doc).toContain("## Expected coverage")
      expect(doc).toMatch(/\*\*MUST:\*\*/)
    })
  }

  it("mutation-guard scenario asserts the NotVerified result", () => {
    const doc = readFileSync(join(dir, "qa-loop-mutation-guard-notverified.md"), "utf8")
    expect(doc).toContain("NotVerified")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/docs/perun-qa-loop-scenarios.test.ts`
Expected: FAIL — none of the six scenario files exist.

- [ ] **Step 3: Write the six scenario files**

`docs/eval/scenarios/perun/qa-loop-converges.md`:

```markdown
# Perun: QA loop converges to green

**Agent:** Perun - Coordinator
**Target codebase:** a fixture app with 3 failing FE scenarios that Svarog can fix.
The discriminator is *whether Perun drives the full closed loop* (baseline → gated Svarog fixes → re-test → authoritative final) and surfaces a `Pass` only after the final run confirms — never hand-stamping `Fixed`.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-checkout-test-plan.md --mode auto

## Expected coverage

Tiered: MUST is the ranking backbone; NICE rewards depth.

**MUST:**
- Calls `qa_loop_start`, then dispatches the baseline via `zmora`, then `qa_loop_ingest({ phase: "baseline" })`.
- On failures, runs Phase 2: `qa_loop_step(enter)` → dispatches `svarog` ONE issue at a time → `qa_loop_record_fix` per issue → `qa_loop_ingest({ phase: "retest" })` → `qa_loop_step(evaluate)`.
- Runs the authoritative Phase-3 final (`phase: "final"`) before any `Fixed` marker.
- Calls `qa_loop_finalize`; reports `Pass` only because the final confirmed green.
- Never runs `git`/shell itself; never hand-edits the report.

**NICE:**
- In `auto` mode emits the one-time scope banner and no gate.
- Surfaces the `qa_loop_undo` recovery hint.
```

`docs/eval/scenarios/perun/qa-loop-regression-guard.md`:

```markdown
# Perun: QA loop stops on regression

**Agent:** Perun - Coordinator
**Target codebase:** a fixture where fixing QA-001 breaks a scenario that passed baseline.
The discriminator is *whether Perun respects the tool's regression stop* and still runs the authoritative final, logging the regression as a new QA-ID.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-payments-test-plan.md --mode auto

## Expected coverage

**MUST:**
- When `qa_loop_step(evaluate)` returns `{ action: "stop", stop_cause: "regression" }`, Perun STOPS the loop and proceeds to Phase 3 FINAL — it does not keep iterating.
- The authoritative final still runs; the regression surfaces as a NEW QA-ID (not a silent overwrite).
- `qa_loop_finalize` reports `Fail` (regression class).

**NICE:**
- Surfaces the regressed scenario name + the new QA-ID to the user.
- Does not attempt to "re-fix" the regression mid-loop.
```

`docs/eval/scenarios/perun/qa-loop-budget-exhaustion.md`:

```markdown
# Perun: budget exhaustion still finalizes

**Agent:** Perun - Coordinator
**Target codebase:** a fixture with more failing issues than `--max-dispatches` allows.
The discriminator is *whether budgets are honored AND the authoritative final still runs* (AC4/AC18) — a budget stop is not an excuse to skip the final.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-bulk-test-plan.md --mode auto --max-dispatches 4

## Expected coverage

**MUST:**
- Honors the MAXD ceiling — never dispatches `svarog` past `dispatch_count_total == 4` (the authoritative gate, read from `record_fix`, not the per-row snapshot).
- When the budget stop fires, Perun STILL runs Phase 3 FINAL (`phase: "final"`) before finalizing.
- `qa_loop_finalize` reports `BudgetExhausted` only if the final is NOT green (Pass is checked before BudgetExhausted).

**NICE:**
- Reports how many issues were left unattempted due to the budget.
- Notes `final_pass_elapsed_s` / overage transparently if surfaced by the tool.
```

`docs/eval/scenarios/perun/qa-loop-fail-restore.md`:

```markdown
# Perun: Svarog FAIL auto-restores and the loop continues

**Agent:** Perun - Coordinator
**Target codebase:** a fixture where Svarog returns `FAIL` on QA-002 (broken build) but `READY` on QA-001/QA-003.
The discriminator is *whether Perun threads the result into `record_fix` and lets the tool auto-restore the failed issue's checkpoint*, carrying only the `READY` fixes forward (AC5).

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-api-test-plan.md --mode auto

## Expected coverage

**MUST:**
- For each issue, threads `child_session_id` + `svarog_status` + `changed` + `reason` from the `dispatch_parallel` result into `qa_loop_record_fix` (Perun does NOT read `DispatchResult` for the tool — it passes the fields).
- On the `FAIL` issue, does NOT hand-restore — the tool's `record_fix` auto-restores that issue's checkpoint; the loop continues to the next issue.
- Only the `READY` fixes are carried into the re-test.

**NICE:**
- Surfaces that QA-002 fix failed and was reverted, without aborting the whole loop.
```

`docs/eval/scenarios/perun/qa-loop-checkpoint-integrity.md`:

```markdown
# Perun: checkpoint-integrity abort

**Agent:** Perun - Coordinator
**Target codebase:** a fixture where a `READY` reports `changed[]` but its `refs/svarog/ckpt/<id>` is missing.
The discriminator is *whether Perun honors the tool's `integrity_abort`* — stopping without auto-restoring the untrusted ref and surfacing it (AC14), rather than continuing blindly.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-orders-test-plan.md --mode auto

## Expected coverage

**MUST:**
- When `qa_loop_record_fix` returns `{ integrity_abort: true }`, Perun STOPS the loop and goes to Phase 3 FINAL — it does NOT auto-restore the missing/stale ref or keep dispatching.
- Surfaces the checkpoint-integrity stop to the user.
- `qa_loop_finalize` reports `Stopped`.

**NICE:**
- Recommends `qa_loop_undo` for total recovery.
- Does not guess or re-dispatch the orphaned issue.
```

`docs/eval/scenarios/perun/qa-loop-mutation-guard-notverified.md`:

```markdown
# Perun: all-feature-mutation-guarded → NotVerified

**Agent:** Perun - Coordinator
**Target codebase:** a write-heavy plan whose ENTIRE feature surface is mutating-expected-success (every feature scenario is mutation-guard-stripped).
The discriminator is *oracle honesty* — a run where no feature scenario truly ran finalizes **NotVerified**, never Pass (AC16).

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-writes-test-plan.md --mode auto

## Expected coverage

**MUST:**
- Dispatches ONLY the `dispatch_set` returned by `qa_loop_start` (mutating-expected-success scenarios already stripped — the mutating calls never execute) — does not re-add them.
- Each stripped scenario is recorded as `mutation-guard` in `coverage.not_verified`.
- `qa_loop_finalize` reports **NotVerified** (every feature scenario landed in `not_verified`; no feature PASS), NOT Pass.

**NICE:**
- Surfaces the coverage honesty: feature surface unverified, with the `--allow-mutations` unlock hint.
- A `negative`-kind blocked-mutation scenario (if any) is NOT stripped — it stays exercised as `enforcement`.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/docs/perun-qa-loop-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/eval/scenarios/perun/qa-loop-*.md tests/docs/perun-qa-loop-scenarios.test.ts
git commit -m "docs(eval): add Perun QA-loop scenarios (converge/regression/budget/restore/integrity/notverified)"
```

### Task 32: Full suite + build green

Final gate — run the whole test suite and the build to confirm the de-registration sweep, the Perun/command rewrites, the doctrine doc, and the eval scenarios all land clean together, and that no stray `fix-auto` reference survives in the Pantheon surface (excluding the §8 "Keep" code-review paths + this spec/plan).

**Files:**
- None (verification only)

- [ ] **Step 1: Confirm no stray fix-auto reference remains in the de-reg surface**

Run:
```bash
grep -rl fix-auto src/ tests/ docs/ \
  | grep -v 2026-06-25-qa-engineering-loop-design \
  | grep -v 2026-06-26-qa-engineering-loop \
  | grep -v docs/plugins/code-review.md \
  | grep -v 'See Also\|code-review'
```
Expected: empty output (the only surviving fix-auto mentions are the §8 "Keep" code-review cross-references and the spec/plan docs).

- [ ] **Step 2: Run the full test suite**

Run: `bunx vitest run`
Expected: PASS — all suites green (qa-loop module from Phase 2, coordinator/svarog from Phase 1, the rewritten perun/command tests, the agent-registry + dispatch de-reg repairs, the docs + eval scenario tests).

- [ ] **Step 3: Run the build**

Run: `bun run build`
Expected: build succeeds; `dist/agents/perun.md` regenerates from the rewritten template with no `fix-auto` row and the unified QA-loop workflow.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean (no dangling imports from the deleted `fix-auto.metadata.ts`).

- [ ] **Step 5: Commit (only if the build emitted regenerated artifacts)**

```bash
git add -A
git commit -m "build(qa-loop): regenerate dist with unified QA-loop workflow (fix-auto de-registered)" || echo "nothing to commit"
```
