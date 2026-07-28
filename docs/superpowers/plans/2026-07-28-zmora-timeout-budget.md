# Zmora Timeout Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `zmora-fe` / `zmora-be` QA executors an inactivity-based dispatch budget (idle 5 min under a 30-min wall-clock backstop) so healthy 10–20-minute Playwright/API scenarios stop being killed by the flat 5-minute default.

**Architecture:** Two new entries in the existing `AGENT_TIMEOUT_OVERRIDES` map (`src/modules/coordinator/budget-enforcer.ts`), mirroring the Veles pattern — no changes to the poller or dispatch mechanism, which already implement the idle heartbeat. Every doctrine surface that pins "5 minutes" is updated in the same commit.

**Tech Stack:** TypeScript (bun + vitest), OpenCode plugin harness (Pantheon).

**Spec:** `docs/superpowers/specs/2026-07-28-zmora-timeout-budget-design.md` (status: approved for planning; spec-review loop CONVERGED).

## Global Constraints

- Values are fixed in code, verbatim from the spec: `ZMORA_IDLE_TIMEOUT_MS = 5 * 60 * 1000`, `ZMORA_WALLCLOCK_BACKSTOP_MS = 30 * 60 * 1000`. No `pantheon.json` configurability.
- `zmora-setup` keeps the flat 5-minute default (`DEFAULT_TASK_TIMEOUT_MS`) — do NOT add an override for it.
- Non-goals (do not touch): the QA bindings TTL (`TTL_MS = 1 h`) or its sweep; the poller's activity signals; any cap on `busy`-probe deadline resets; `DEFAULT_TASK_TIMEOUT_MS`; partial-result preservation; the `dispatch_parallel` tool schema (the internal `taskTimeoutMs` field must NOT become a tool arg).
- Background dispatch (`dispatch_background` / `wait_background`) intentionally keeps the flat default — it never consults `AGENT_TIMEOUT_OVERRIDES`. Its `timeoutMs` describe at `src/modules/coordinator/index.ts` (~line 574) stays byte-identical.
- **Spec rule "Companion surfaces (same commit)":** the core change, tests, and ALL doctrine-surface edits (Tasks 1–2) land in ONE commit. Task 1 therefore does not commit on its own. `dist/` sync is a separate `chore(build)` commit (repo convention).
- Commits: the pre-commit hook blocks plain `git commit` — prefix the commit command with `AV_COMMIT_SKILL=1`. Conventional Commits format. NEVER push. NEVER add Co-Authored-By or any AI attribution. GPG signing is configured — the key must be unlocked (pinentry) or the commit fails with `gpg: signing failed`.
- All user-facing doc/doctrine copy is English (english-policy gate on the publish chain).
- Verified during planning (spec's Testing item 2): `tests/docs/agent-contracts-doctrine.test.ts` pins only agent verdict vocabularies and a `qa.md → agent-contracts.md` link — none of the strings edited below. No pin updates needed there.

---

### Task 1: Core override in `budget-enforcer.ts` + barrel re-export + tests (TDD)

**Files:**
- Modify: `src/modules/coordinator/budget-enforcer.ts:13-25`
- Modify: `src/modules/coordinator/dispatch.ts:29-38` (barrel export block)
- Test: `tests/modules/coordinator/agent-task-timeout.test.ts`

**Interfaces:**
- Consumes: `AgentTimeout` type (`dispatch-types.ts`), existing `resolveAgentTimeout(agentName, defaultMs?)`, existing test helpers `makeHealthySpecialist` / `makeNeverFinishingSpecialist` (already in the test file), `VARIANTS` (exported `["fe", "be", "setup"] as const` from `src/modules/qa/index.ts:35`).
- Produces: exported constants `ZMORA_IDLE_TIMEOUT_MS: number` and `ZMORA_WALLCLOCK_BACKSTOP_MS: number`, re-exported from `src/modules/coordinator/dispatch.ts`; `AGENT_TIMEOUT_OVERRIDES` entries under keys `"zmora-fe"` and `"zmora-be"` with shape `{ wallClockMs: 1_800_000, idleMs: 300_000 }`. Task 2's doc edits cite these names.

- [ ] **Step 1: Extend the test file's import block**

In `tests/modules/coordinator/agent-task-timeout.test.ts`, replace the import of the dispatch barrel (lines 2–11) and add the `VARIANTS` import after it:

```ts
import {
  dispatchParallel,
  resolveAgentTimeout,
  AGENT_TIMEOUT_OVERRIDES,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  ZMORA_IDLE_TIMEOUT_MS,
  ZMORA_WALLCLOCK_BACKSTOP_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  type DispatchSpecialist,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"
import { VELES_AGENT_KEY } from "../../../src/modules/plan/veles.metadata.js"
import { VARIANTS } from "../../../src/modules/qa/index.js"
```

(The `VELES_AGENT_KEY` import already exists — keep it; only the barrel import gains the two `ZMORA_*` names and the `VARIANTS` line is new.)

- [ ] **Step 2: Write the failing resolver tests**

Append inside the existing `describe("resolveAgentTimeout", …)` block (after the `"keys the override on VELES_AGENT_KEY (drift pin)"` test):

```ts
  it("returns the QA executors' heartbeat budget (idle window + 30-min backstop)", () => {
    for (const key of ["zmora-fe", "zmora-be"]) {
      expect(resolveAgentTimeout(key)).toEqual({
        wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS,
        idleMs: ZMORA_IDLE_TIMEOUT_MS,
      })
    }
    // Sizing: observed FE max ~20 min + ~50% headroom = 30 min, deliberately
    // below the planner's 45-min backstop; the idle window stays a fast
    // hang-catch (≤ the flat default).
    expect(ZMORA_WALLCLOCK_BACKSTOP_MS).toBe(30 * 60 * 1000)
    expect(ZMORA_IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000)
    expect(ZMORA_WALLCLOCK_BACKSTOP_MS).toBeLessThan(VELES_WALLCLOCK_BACKSTOP_MS)
    expect(ZMORA_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(DEFAULT_TASK_TIMEOUT_MS)
  })

  it("keeps zmora-setup and unknown agents on the flat pure-wall-clock default", () => {
    expect(resolveAgentTimeout("zmora-setup")).toEqual({
      wallClockMs: DEFAULT_TASK_TIMEOUT_MS,
    })
    expect(resolveAgentTimeout("some-unknown-agent")).toEqual({
      wallClockMs: DEFAULT_TASK_TIMEOUT_MS,
    })
  })

  it("keys the zmora overrides on the registered variant names (drift pin)", () => {
    // Mirror of the VELES_AGENT_KEY pin: the override map uses literal keys
    // (no coordinator→qa import), so pin them against the names qa/index.ts
    // actually registers (`zmora-${stack}` for each stack of VARIANTS).
    const registered = VARIANTS.map((stack) => `zmora-${stack}`)
    expect(registered).toContain("zmora-fe")
    expect(registered).toContain("zmora-be")
    for (const key of ["zmora-fe", "zmora-be"]) {
      expect(AGENT_TIMEOUT_OVERRIDES.get(key)).toEqual({
        wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS,
        idleMs: ZMORA_IDLE_TIMEOUT_MS,
      })
    }
    // zmora-setup is registered but deliberately NOT overridden.
    expect(registered).toContain("zmora-setup")
    expect(AGENT_TIMEOUT_OVERRIDES.has("zmora-setup")).toBe(false)
  })
```

- [ ] **Step 3: Write the failing dispatch-level tests**

Append inside the existing `describe("dispatchParallel — per-agent heartbeat timeout", …)` block (after the `"keeps the flat 5-min pure-wall-clock default for non-planner agents"` test). Note: `makeHealthySpecialist`'s terminal message is the fixed string `"PLAN COMPLETE"` — reuse it as-is.

```ts
  it("lets a healthy FE scenario run past the 5-min leaf default while it keeps making progress, then completes", async () => {
    vi.useFakeTimers()
    const DONE_AFTER = 18 * 60 * 1000
    const { specialist, aborted } = makeHealthySpecialist("s-zmora", DONE_AFTER)

    let settled = false
    const promise = dispatchParallel({
      tasks: [{ name: "zmora-fe", prompt: "run scenario QA-001" }],
      agentRegistry: { "zmora-fe": { mode: "subagent" } },
      specialist,
      pollIntervalMs: 60_000,
    }).then((r) => {
      settled = true
      return r
    })

    // Past the flat 5-min leaf default — still running, because every poll
    // shows progress. Under the pre-override code the scenario would already
    // have been killed here mid-work and recorded as SKIP by Perun.
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(settled).toBe(false)

    // Natural finish at 18 min — collected as success, NOT timed out, and the
    // child is never cancelled server-side.
    await vi.advanceTimersByTimeAsync(13 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe("PLAN COMPLETE")
    expect(aborted).toEqual([])
  })

  it("catches a silent-hung FE scenario via the inactivity window, well before the 30-min backstop", async () => {
    vi.useFakeTimers()
    const { specialist, aborted } = makeNeverFinishingSpecialist("s-zmora")

    let settled = false
    const promise = dispatchParallel({
      tasks: [{ name: "zmora-fe", prompt: "run scenario QA-001" }],
      agentRegistry: { "zmora-fe": { mode: "subagent" } },
      specialist,
      pollIntervalMs: 60_000,
    }).then((r) => {
      settled = true
      return r
    })

    // Under the idle window — still running.
    await vi.advanceTimersByTimeAsync(ZMORA_IDLE_TIMEOUT_MS - 60_000)
    expect(settled).toBe(false)

    // Past the idle window: a scenario with no sign of life is caught HERE,
    // not at the 30-min backstop, and the child is cancelled server-side.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    const results = await promise
    expect(results[0]?.status).toBe("timeout")
    expect(results[0]?.error).toContain("idle")
    expect(aborted).toEqual(["s-zmora"])
  })
```

- [ ] **Step 4: Run the test file to verify it fails**

Run: `bunx vitest run --config vitest.config.ts tests/modules/coordinator/agent-task-timeout.test.ts`
Expected: FAIL — the whole file errors at import time because `ZMORA_IDLE_TIMEOUT_MS` / `ZMORA_WALLCLOCK_BACKSTOP_MS` are not exported from the dispatch barrel.

- [ ] **Step 5: Implement the override in `budget-enforcer.ts`**

In `src/modules/coordinator/budget-enforcer.ts`, replace lines 13–25 (from `export const VELES_IDLE_TIMEOUT_MS` through the closing `])` of the map) with:

```ts
export const VELES_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const VELES_WALLCLOCK_BACKSTOP_MS = 45 * 60 * 1000
export const ZMORA_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const ZMORA_WALLCLOCK_BACKSTOP_MS = 30 * 60 * 1000

// Keys are the registered dispatch task names; literals avoid a
// coordinator→plan/qa import (drift pins live in agent-task-timeout.test.ts).
export const AGENT_TIMEOUT_OVERRIDES: ReadonlyMap<string, AgentTimeout> =
  new Map<string, AgentTimeout>([
    [
      "Veles - Planner",
      {
        wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
        idleMs: VELES_IDLE_TIMEOUT_MS,
      },
    ],
    [
      "zmora-fe",
      {
        wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS,
        idleMs: ZMORA_IDLE_TIMEOUT_MS,
      },
    ],
    [
      "zmora-be",
      {
        wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS,
        idleMs: ZMORA_IDLE_TIMEOUT_MS,
      },
    ],
  ])
```

Nothing else in the file changes (`resolveAgentTimeout` already resolves the map by task name).

- [ ] **Step 6: Re-export the constants from the dispatch barrel**

In `src/modules/coordinator/dispatch.ts`, extend the `budget-enforcer.js` export block (lines 29–38) — add the two `ZMORA_*` names after the `VELES_*` pair, keeping the alphabetical order:

```ts
export {
  AGENT_TIMEOUT_OVERRIDES,
  DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  enforceAggregateBudget,
  resolveAgentTimeout,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  ZMORA_IDLE_TIMEOUT_MS,
  ZMORA_WALLCLOCK_BACKSTOP_MS,
} from "./budget-enforcer.js"
```

- [ ] **Step 7: Run the test file to verify it passes**

Run: `bunx vitest run --config vitest.config.ts tests/modules/coordinator/agent-task-timeout.test.ts`
Expected: PASS — all pre-existing tests (Veles + leaf default) AND the five new tests green.

**Do NOT commit yet** — the spec requires the doctrine surfaces (Task 2) in the same commit.

---

### Task 2: Doctrine surfaces — tool description + docs

Every surface that pins the "5 minutes" doctrine. All edits are exact-string replacements; line numbers are current anchors, the `old` strings are authoritative.

**Files:**
- Modify: `src/modules/coordinator/index.ts:170`
- Modify: `docs/plugins/coordinator.md:81, 162-163, 171, 215, 262`
- Modify: `docs/plugins/qa.md:367`
- Modify: `src/commands/run-qa.md:128`

**Interfaces:**
- Consumes: constant names `ZMORA_IDLE_TIMEOUT_MS` / `ZMORA_WALLCLOCK_BACKSTOP_MS` from Task 1 (cited in doc tables).
- Produces: doctrine copy only — no code interfaces.

- [ ] **Step 1: `src/modules/coordinator/index.ts` (~line 170) — `dispatch_parallel` description**

Replace this line of the description array:

```
      '- Each task has a hard timeout (5 minutes for most agents; the planner Veles gets a longer budget because it authors and self-verifies plans). On expiry the task is returned with status "timeout" and the partial result is discarded.',
```

with:

```
      '- Each task has a hard timeout (5 minutes for most agents; the planner Veles and the QA executors (`zmora-fe` / `zmora-be`) get an inactivity-based budget: the deadline resets on signs of life, under a longer wall-clock backstop). On expiry the task is returned with status "timeout" and the partial result is discarded.',
```

(The spec's replacement sentence is used verbatim; its terminal period is absorbed by the existing parenthesis — the surrounding bullet structure, including the unchanged tail about expiry, is preserved. No `**` bold markup.)

- [ ] **Step 2: `docs/plugins/coordinator.md` — Registered elements row (~line 81)**

Replace:

```
| `dispatch_parallel` | Tool | n/a | Parallel session dispatch with a 4-wide worker pool. 1 s poll interval, 5 min per-task timeout (leaf agents; the planner uses an inactivity-based budget — see runtime characteristics), 100 KB result cap, **max 4 tasks per call** (caller chunks for larger workloads). |
```

with:

```
| `dispatch_parallel` | Tool | n/a | Parallel session dispatch with a 4-wide worker pool. 1 s poll interval, 5 min per-task timeout (leaf agents; the planner Veles and the QA executors `zmora-fe` / `zmora-be` use an inactivity-based budget — see runtime characteristics), 100 KB result cap, **max 4 tasks per call** (caller chunks for larger workloads). |
```

- [ ] **Step 3: `docs/plugins/coordinator.md` — budget table (~lines 162-163): add the Zmora row**

Directly after the row:

```
| Planner (Veles) timeout | **inactivity** 5 min (no sign of life) under a 45 min absolute backstop | `VELES_IDLE_TIMEOUT_MS` / `VELES_WALLCLOCK_BACKSTOP_MS` (via `AGENT_TIMEOUT_OVERRIDES`) |
```

insert the new row:

```
| QA executor (`zmora-fe` / `zmora-be`) timeout | **inactivity** 5 min (no sign of life) under a 30 min absolute backstop | `ZMORA_IDLE_TIMEOUT_MS` / `ZMORA_WALLCLOCK_BACKSTOP_MS` (via `AGENT_TIMEOUT_OVERRIDES`) |
```

- [ ] **Step 4: `docs/plugins/coordinator.md` — rewrite the "Per-agent timeout model" paragraph (~line 171)**

Replace the whole paragraph starting `**Per-agent timeout model.**` (one long line, beginning "Leaf agents use a flat wall-clock timeout" and ending "overrides both as a pure wall-clock budget.") with:

```
**Per-agent timeout model.** Leaf agents use a flat wall-clock timeout — fast hang-detection for short, bounded work. Two classes of specialist legitimately outlive any sensible flat cap: the planner (Veles), which authors the heaviest single workload in the system (the multi-step `qa-plan-authoring` skill, often re-reading the whole diff), and the QA executors (`zmora-fe` / `zmora-be`), whose Playwright/API scenarios legitimately run 10–20 minutes. A flat cap there either kills healthy work or, raised high enough to avoid that, fails to catch a real hang for just as long. So these agents use an **inactivity (heartbeat) timeout**: `pollUntilIdle` resets the deadline on every sign of life — the assistant's output growing, or the child still reporting `busy` (the status probe is consulted as a fallback only on a poll where the visible content did not grow, so a streaming turn pays no extra HTTP). A healthy-but-slow session runs to completion; a genuinely wedged one (no new output **and** not busy) is caught within the idle window (`VELES_IDLE_TIMEOUT_MS` / `ZMORA_IDLE_TIMEOUT_MS`, both 5 min). The wall-clock backstop (`VELES_WALLCLOCK_BACKSTOP_MS` 45 min; `ZMORA_WALLCLOCK_BACKSTOP_MS` 30 min) is the absolute ceiling for the pathological "busy forever, never finishes" case. `PollerTimeoutError.reason` (`"idle"` vs `"wall-clock"`) records which bound fired. Per-agent budgets live in `AGENT_TIMEOUT_OVERRIDES`, resolved by `resolveAgentTimeout`; the internal `taskTimeoutMs` field of `dispatchParallel()` — not exposed on the `dispatch_parallel` tool schema — overrides both as a pure wall-clock budget.
```

(This also fixes the previously over-broad claim that `taskTimeoutMs` is "passed to `dispatch_parallel`" — it is an internal TypeScript field, not a tool arg; spec, "Unchanged semantics".)

- [ ] **Step 5: `docs/plugins/coordinator.md` — background dispatch defaults (~line 215)**

Replace:

```
Defaults match `dispatch_parallel`: 1 s poll interval (`DEFAULT_POLL_INTERVAL_MS`), 5 min per-task timeout (`DEFAULT_TASK_TIMEOUT_MS`), 100 KB result cap (`DEFAULT_RESULT_MAX_BYTES`).
```

with:

```
Defaults match `dispatch_parallel`: 1 s poll interval (`DEFAULT_POLL_INTERVAL_MS`), 5 min per-task timeout matching the leaf-agent default (`DEFAULT_TASK_TIMEOUT_MS`) — background dispatch never consults `AGENT_TIMEOUT_OVERRIDES` — and a 100 KB result cap (`DEFAULT_RESULT_MAX_BYTES`).
```

(Keep the rest of that line — the `neutralizeUntrustedOutput` sentence — unchanged.)

- [ ] **Step 6: `docs/plugins/coordinator.md` — code-enforced boundary row (~line 262)**

In the row starting `| Code-enforced | Per-task timeout —`, replace the first cell's text:

```
Per-task timeout — leaf agents: flat 5 min wall-clock; planner (Veles): 5 min **inactivity** under a 45 min backstop (resets on output growth / `busy`). Timed-out specialists are cut off and returned as `status: "timeout"` (`error` names the bound: `idle` vs `wall-clock`).
```

with:

```
Per-task timeout — leaf agents: flat 5 min wall-clock; planner (Veles): 5 min **inactivity** under a 45 min backstop; QA executors (`zmora-fe` / `zmora-be`): 5 min **inactivity** under a 30 min backstop (inactivity deadlines reset on output growth / `busy`). Timed-out specialists are cut off and returned as `status: "timeout"` (`error` names the bound: `idle` vs `wall-clock`).
```

(The source-pointer cell of the row stays unchanged.)

- [ ] **Step 7: `docs/plugins/qa.md` — pool starvation + bindings TTL (~line 367)**

Replace the single bullet:

```
- **Pool starvation by a slow scenario.** If one scenario hits the 5-minute per-task timeout, that pool slot is blocked for 5 minutes. The other 3 workers keep draining, so total throughput drops 25% but doesn't halt.
```

with these two bullets:

```
- **Pool starvation by a slow scenario.** A pool slot can now be held for up to 30 minutes by a *healthy* long scenario — `zmora-fe` / `zmora-be` use an inactivity budget (idle 5 min under a 30-min wall-clock backstop) instead of the flat 5-minute leaf timeout. The other 3 workers keep draining, so throughput drops but doesn't halt. Hangs split into two classes:
  - **Silent hang** (dead Playwright, no sign of life): detection latency after activity stops is unchanged (~5 min), but slot-hold time is not — the idle deadline runs from the last sign of life, not from dispatch, so a scenario that works for N minutes and then goes silent holds the slot for N + ~5 min, up to the 30-min backstop (previously: 5 min from dispatch, always).
  - **Busy hang** (stuck in an in-flight tool call): regression — the `busy` status probe keeps resetting the idle deadline, so the slot is now held up to the 30-min backstop instead of the previous flat 5 min. Accepted risk for this change; there is no cap on `busy`-probe deadline resets.
- **Long QA runs vs the bindings TTL.** A QA run longer than the 1 h `TTL_MS` can lose minted `QA_BIND_*` values to the sweep between waves (the sweep purges by `createdAt`, never refreshes an entry, and pins only entries held by an in-flight wave); later scenarios then stall as `NEED_INFO` (credentials) / SKIP, and the user cannot restore the value by pasting — it was never disclosed to them. Accepted risk for this change; raising or refreshing the TTL is deferred to a separate project.
```

- [ ] **Step 8: `src/commands/run-qa.md` (~line 128) — See Also bullet**

Replace:

```
- `docs/plugins/coordinator.md` — `dispatch_parallel` runtime characteristics (4-wide pool, max 4 tasks per call, 5-minute per-task timeout).
```

with:

```
- `docs/plugins/coordinator.md` — `dispatch_parallel` runtime characteristics (4-wide pool, max 4 tasks per call, 5-minute per-task timeout; exception: the Zmora executors `zmora-fe` / `zmora-be` use an inactivity budget — idle 5 min under a 30-min backstop — while `zmora-setup` keeps the 5-minute default).
```

- [ ] **Step 9: Verify the two deliberate no-op surfaces are untouched**

Run: `grep -n 'Per-task timeout in ms (default 5 min)' src/modules/coordinator/index.ts; grep -n 'minute' src/agents/perun.md`
Expected: the first grep prints exactly one line — the `wait_background` `timeoutMs` describe at ~line 574 (background dispatch hard-codes `DEFAULT_TASK_TIMEOUT_MS` and never consults `AGENT_TIMEOUT_OVERRIDES`, so this string stays accurate and byte-identical). The second grep prints nothing (`perun.md` contains no minute figure at all). Do not edit either file.

- [ ] **Step 10: Sanity grep for leftover doctrine drift**

Run: `grep -rn '5-minute per-task\|5 min per-task' docs/plugins/ src/commands/ | grep -v 'zmora'`
Expected: no output lines describing `dispatch_parallel` without the Zmora exception (the `wait_background`/background-dispatch mentions from Step 5 name `AGENT_TIMEOUT_OVERRIDES` explicitly and are correct as-is).

---

### Task 3: Full gate, dist sync, commits

**Files:**
- Modify: `dist/**` (regenerated by build — includes `dist/modules/coordinator/budget-enforcer.{js,d.ts}`, `dist/modules/coordinator/dispatch.{js,d.ts}`, `dist/modules/coordinator/index.js`, `dist/commands/run-qa.md`)

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: two commits on `feature/zmora-timeout-budget`; a green `bun run build && bun run test:nobuild`.

- [ ] **Step 1: Run the full gate**

Run: `bun run build && bun run test:nobuild`
Expected: build green, full vitest suite green (including `tests/docs/*` doctrine tests and `tests/modules/coordinator/*`). If any doctrine test fails on an edited string, fix the doc copy to satisfy the pin — never weaken the test.

- [ ] **Step 2: Commit the feature (src + tests + docs — the spec's "same commit" rule)**

```bash
git add src/modules/coordinator/budget-enforcer.ts src/modules/coordinator/dispatch.ts src/modules/coordinator/index.ts tests/modules/coordinator/agent-task-timeout.test.ts docs/plugins/coordinator.md docs/plugins/qa.md src/commands/run-qa.md
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator): give zmora-fe/zmora-be an inactivity timeout budget

Healthy 10-20-min Playwright/API scenarios were killed by the flat
5-min dispatch default and recorded as SKIP. Mirror the Veles pattern:
idle 5 min under a 30-min wall-clock backstop via
AGENT_TIMEOUT_OVERRIDES; zmora-setup keeps the flat default. Updates
every doctrine surface that pinned the 5-minute figure."
```

Expected: commit succeeds (requires an unlocked GPG key). NEVER push.

- [ ] **Step 3: Commit the dist sync**

```bash
git add dist
AV_COMMIT_SKILL=1 git commit -m "chore(build): sync dist for the zmora timeout budget"
```

Expected: commit succeeds; `git status --porcelain` afterwards shows no tracked-file changes (the spec/review artifacts commit from the brainstorming flow may still be pending separately). NEVER push.

---

## Verification checklist (post-plan)

- `resolveAgentTimeout("zmora-fe")` / `("zmora-be")` → `{ wallClockMs: 1_800_000, idleMs: 300_000 }`; `("zmora-setup")` and unknown names → `{ wallClockMs: 300_000 }` (spec, Testing).
- A dispatched `zmora-fe` task making progress survives past 5 min and completes; a silent one dies ~5 min after activity stops with `error` containing `idle` (spec, Behavioral result).
- All four companion surfaces name the Zmora exception; the two no-op surfaces are byte-identical (spec, Companion surfaces).
- No changes under `src/modules/qa/` (TTL untouched), `src/modules/coordinator/poller.ts`, or the `dispatch_parallel` tool schema (spec, Non-goals).
