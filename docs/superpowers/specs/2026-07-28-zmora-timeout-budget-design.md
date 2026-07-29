# Zmora timeout budget — design

**Date:** 2026-07-28
**Status:** approved for planning

## Problem

Manual QA runs frequently lose scenarios to the dispatch timeout. Zmora
(`zmora-fe` / `zmora-be` / `zmora-setup`) is dispatched by Perun via
`dispatch_parallel`, one scenario per task, and has no entry in
`AGENT_TIMEOUT_OVERRIDES` — so every scenario gets the flat
`DEFAULT_TASK_TIMEOUT_MS = 5 min` wall-clock budget
(`src/modules/coordinator/budget-enforcer.ts`). Frontend (Playwright)
scenarios legitimately run 10–20 minutes; at 5 minutes the task is killed
mid-work, the partial result is discarded, and Perun records the scenario
as SKIP. The pain is concentrated in FE scenarios but BE scenarios are
exposed to the same cliff.

The infrastructure to fix this already exists: Veles uses an
inactivity-based budget (`idleMs` heartbeat under a wall-clock backstop)
implemented in `pollUntilIdle` (`src/modules/coordinator/poller.ts`) and
keyed per agent through `resolveAgentTimeout(task.name)`.

## Decision

Give the two Zmora executor variants the same inactivity-based budget
shape as Veles, with values sized to observed scenario runtimes. Fixed
override in code — no new configuration surface (explicit user decision).

### Core change — `src/modules/coordinator/budget-enforcer.ts`

```ts
export const ZMORA_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const ZMORA_WALLCLOCK_BACKSTOP_MS = 30 * 60 * 1000

// AGENT_TIMEOUT_OVERRIDES additions:
["zmora-fe", { wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS, idleMs: ZMORA_IDLE_TIMEOUT_MS }],
["zmora-be", { wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS, idleMs: ZMORA_IDLE_TIMEOUT_MS }],
```

Both `ZMORA_*` constants are also re-exported from
`src/modules/coordinator/dispatch.ts` alongside the Veles constants
(`VELES_IDLE_TIMEOUT_MS` / `VELES_WALLCLOCK_BACKSTOP_MS`): that barrel is
what `tests/modules/coordinator/agent-task-timeout.test.ts` imports from,
and `docs/plugins/coordinator.md`'s budget-table column cites it.

No changes to the dispatch/poller mechanism anywhere else:
`resolveAgentTimeout()` already resolves by dispatch task name, Perun
already dispatches under the names `zmora-fe` / `zmora-be`
(`src/agents/perun.md`, Step 5f / resume step), and the poller already
implements the idle heartbeat (deadline resets on output growth or a
`busy` status probe — the Veles path).

Behavioral result:

- A healthy long scenario runs up to 30 minutes (observed max 10–20 min
  plus headroom).
- A genuinely hung session (dead Playwright, no sign of life) is killed
  ~5 minutes after activity stops — comparable to today's flat cap for a
  session hung from the start, and much faster than a 30-minute flat cap
  would allow.

### Sized values — rationale

- **Backstop 30 min, not Veles' 45 min:** upper observed bound (20 min)
  plus ~50% headroom. A longer backstop only extends the pathological
  "busy forever, never finishes" worst case.
- **Idle 5 min:** same inactivity window as Veles
  (`VELES_IDLE_TIMEOUT_MS`); Playwright/API steps produce regular tool
  activity and the `busy` probe covers long in-flight tool calls.
- **`zmora-setup` stays on the 5-minute default:** setup recipes are
  short deterministic `execute_recipe` steps; a long setup is a symptom
  of a problem, not honest work.

### Unchanged semantics

- Timeout still returns `status: "timeout"`; Perun still records the
  scenario as SKIP without cascading (`perun.md` wave-result handling).
- `PollerTimeoutError.reason` already names which bound fired (`"idle"`
  vs `"wall-clock"`) and flows into the result error string.
- The internal `taskTimeoutMs` field of `dispatchParallel()`
  (`DispatchParallelInput`, `src/modules/coordinator/dispatch.ts`) remains
  an escape hatch that overrides the per-agent budget as a pure wall-clock
  cap. It is NOT exposed on the `dispatch_parallel` tool schema — that
  tool's args are exactly `agent` / `summary` / `tasks` — so it is
  reachable only from TypeScript callers. Nothing passes it today, and no
  agent prompt can set a per-call timeout for `dispatch_parallel` tasks
  (`wait_background`'s `timeoutMs` is prompt-settable, but the background
  path never consults the overrides). It must not be added to the tool
  schema: no new configuration surface, so changing the Zmora budget
  requires a code change.
- The QA loop (`qa-loop` module) records state only; all Zmora dispatch
  flows through `dispatch_parallel`, so the override covers both the QA
  loop baseline/re-test waves and plain QA runs.
- **Known constraint — QA bindings TTL (accepted risk).**
  `src/modules/qa/index.ts` sets `TTL_MS = 1 h` from mint with a 5-minute
  sweep; `BindingsStore.sweepExpired` purges by `createdAt`, never
  refreshes an entry, and skips only entries pinned by an in-flight
  dispatch wave. With a 30-minute per-scenario ceiling, QA runs exceeding
  1 h become routine, so minted `QA_BIND_*` values can be swept between
  waves; later scenarios then stall as NEED_INFO(credentials) / SKIP, and
  the user cannot restore it by pasting: the store would accept a paste
  under the swept `QA_BIND_*` name, but the minted value was never
  disclosed to the user, so there is nothing to paste. DECISION: accepted
  risk for this change — it is documented in `docs/plugins/qa.md`
  (companion surface 3). Raising or refreshing the TTL is deferred to a
  separate
  project (see Non-goals).
- **Known constraint — busy-hang slot hold (accepted risk).** A session
  stuck in an in-flight tool call keeps answering the `busy` probe, so
  the idle deadline never fires and the slot is held up to the 30-min
  backstop instead of today's flat 5 min. DECISION: accepted risk for
  this change — no cap on `busy`-probe deadline resets; documented in
  `docs/plugins/qa.md` (companion surface 3).

## Companion surfaces (same commit)

Every place that pins the "5 minutes" doctrine:

1. `src/modules/coordinator/index.ts` (~line 170) — `dispatch_parallel`
   description. Replace the clause "5 minutes for most agents; the
   planner Veles gets a longer budget because it authors and
   self-verifies plans." with this complete sentence, verbatim:
   "5 minutes for most agents; the planner Veles and the QA executors
   (`zmora-fe` / `zmora-be`) get an inactivity-based budget: the deadline
   resets on signs of life, under a longer wall-clock backstop."
   The shipped string carries no `**` bold markup (bold in earlier drafts
   of this spec was spec-side emphasis only); the backticks around the
   agent names follow the surrounding description's existing convention.
   The rest of that bullet is unchanged, including its tail: `On expiry
   the task is returned with status "timeout" and the partial result is
   discarded.`
2. `docs/plugins/coordinator.md` — budget table (Per-task timeout rows):
   add the Zmora row (idle 5 min / backstop 30 min via
   `AGENT_TIMEOUT_OVERRIDES`); rewrite the "Per-agent timeout model"
   paragraph and the code-enforced boundary row so the inactivity model
   is no longer described as planner-only.

   Same file, two further pins: the Registered elements row for
   `dispatch_parallel` (~line 81) — restate its timeout clause so the
   inactivity model is not planner-only; and the Background dispatch
   defaults sentence (~line 215) — qualify it to "matches the leaf-agent
   default (`DEFAULT_TASK_TIMEOUT_MS`); background dispatch never
   consults `AGENT_TIMEOUT_OVERRIDES`."
3. `docs/plugins/qa.md` — "Pool starvation by a slow scenario" paragraph:
   a slot can now be held up to 30 min by a *healthy* long scenario. The
   rewrite must state the two hang classes separately, and must state the
   busy-hang regression explicitly:
   - **Silent hang** (dead Playwright, no sign of life): the ~5-min
     inactivity window itself is unchanged, but its reference point
     moved from dispatch time to the last sign of life — previously
     (flat cap from dispatch) a scenario that worked N minutes and then
     went silent was killed (5 − N) min later (the longer it worked, the
     sooner a subsequent hang was caught, always ≤5 min from dispatch);
     now it is killed ~5 min after going silent regardless of N, up to
     the 30-min backstop — so the slot is held for N + ~5 min instead of
     a flat 5.
   - **Busy hang** (stuck in an in-flight tool call): regression — the
     `busy` status probe keeps resetting the idle deadline, so the slot is
     now held up to the 30-min backstop instead of today's flat 5 min.

   Same file, alongside that paragraph: document the bindings-TTL
   constraint recorded under "Unchanged semantics" — a QA run longer than
   the 1 h `TTL_MS` can lose minted `QA_BIND_*` values to the sweep
   between waves, later scenarios then stall as NEED_INFO(credentials) /
   SKIP, and the user cannot restore the value by pasting (it was never
   disclosed). Accepted risk for this change.

4. `src/commands/run-qa.md` (~line 128) — the `/run-qa` command prompt
   pins a "5-minute per-task timeout" where it describes
   `dispatch_parallel` runtime characteristics; update it to name the
   Zmora executor exception — `zmora-fe` / `zmora-be` only (idle 5 min /
   backstop 30 min); `zmora-setup` keeps the 5-minute default.

Two further surfaces were verified and deliberately left untouched:

- `src/modules/coordinator/index.ts` (~line 574) — the `wait_background`
  `timeoutMs` describe ("Per-task timeout in ms (default 5 min).") stays
  accurate: `wait_background`'s `timeoutMs` is prompt-settable and
  defaults to `DEFAULT_TASK_TIMEOUT_MS`; `dispatch_background` /
  `poll_background` take no timeout arg. Neither background path ever
  consults `AGENT_TIMEOUT_OVERRIDES`, so background dispatch keeps the
  flat default and is unaffected by this change.
- Agent prompts need no edit: `src/agents/perun.md` and the Zmora prompt
  sections were scanned and contain no 5-minute figure. Recorded as a
  deliberate no-op, not an oversight.

## Testing

- Extend `tests/modules/coordinator/agent-task-timeout.test.ts`:
  - `resolveAgentTimeout("zmora-fe")` and `("zmora-be")` return
    `{ wallClockMs: 30 min, idleMs: 5 min }`.
  - `resolveAgentTimeout("zmora-setup")` and unknown names still return
    the flat 5-minute wall-clock default.
- During planning, check whether
  `tests/docs/agent-contracts-doctrine.test.ts` pins any of the doctrine
  strings updated above; if so, update the pins in the same commit.
- Full gate: `bun run build && bun run test:nobuild` green.

## Non-goals

- No `pantheon.json` configurability for timeouts (explicit decision:
  fixed override; configurability can be a later standalone project).
- No preservation of partial results on timeout.
- No change to `DEFAULT_TASK_TIMEOUT_MS` or any other agent's budget.
- No change to `zmora-setup`'s budget.
- No change to the QA bindings TTL (1 h from mint) or its sweep; raising
  or refreshing it is deferred to a separate project.
- No cap on `busy`-probe idle-deadline resets, and no change to the
  poller's activity signals.
