import type { SessionAgentRegistry } from "../_shared/session-agent-registry.js"
import {
  pollUntilIdle,
  PollerAbortError,
  PollerTimeoutError,
  type PollerMessage,
} from "./poller.js"
import {
  neutralizeUntrustedOutput,
  normalizeVariantSuffix,
} from "../_shared/sanitize.js"
import {
  truncateBytes,
  truncateBytesWithMarker,
  AGGREGATE_TRUNCATION_MARKER,
} from "./truncate-bytes.js"

export interface DispatchTask {
  name: string
  prompt: string
  context?: string
}

export interface DispatchResult {
  name: string
  status: "success" | "error" | "timeout" | "aborted"
  result: string
  duration_ms: number
  error?: string
}

export interface DispatchSpecialist {
  /**
   * Start a foreground task: create the child session, then fire the turn via
   * `session.promptAsync` (returns immediately; the server runs the turn
   * autonomously). Resolves the child session id WITHOUT awaiting the turn —
   * completion is observed by `runTask`'s `pollUntilIdle`, so `taskTimeoutMs`
   * and the abort `signal` govern the ENTIRE turn rather than only a post-turn
   * confirmatory poll. `onSessionCreated`, if provided, fires with the child
   * session id AFTER the session is created but BEFORE the turn is fired — this
   * is the only point at which a caller can record the child→agent mapping in
   * time for the `shell.env` hook, which fires mid-turn server-side.
   */
  startTask(
    agentName: string,
    prompt: string,
    onSessionCreated?: (sessionId: string) => void,
  ): Promise<string>
  fetchMessages(sessionId: string): Promise<PollerMessage[]>
  /**
   * Authoritative "turn loop still running" probe for a child session
   * (`GET /session/status`; absence from the map means idle). Completion
   * detection needs BOTH signals: the server persists `finish` on the
   * assistant message after every step, so a terminal-looking transcript
   * observed while the session is still active is the inter-step (or
   * auto-compaction) race, not completion.
   *
   * Degraded-mode contract (two intentional layers, not a redundancy):
   *  - Producer SHOULD degrade to `false` on status-endpoint failure rather
   *    than propagate, so a flaky status call reads as "idle" and completion
   *    falls back to the message-only predicate instead of failing the dispatch.
   *  - Callers do NOT rely on that alone: every consumer routes this probe
   *    through the shared `probeSessionActive` primitive (`session-active.js`),
   *    which is the single authoritative consumer-side degraded-mode gate
   *    (rejection ⇒ inactive). That defence-in-depth means a future
   *    implementation that DOES throw cannot wedge or fail the poll — it
   *    degrades to message-only completion exactly as if it had returned `false`.
   */
  isSessionActive(sessionId: string): Promise<boolean>
  /**
   * Cancel a previously-started session so the child stops doing work
   * server-side (no orphaned compute, no charges). Called on BOTH terminal
   * non-success paths: when `ToolContext.abort` fires, AND when the task times
   * out — in both cases the child's `promptAsync` turn is still running
   * autonomously and would otherwise run to completion as orphaned compute.
   * Implementations should treat this as best-effort: errors must not surface
   * to the caller (the abort/timeout path already returns its result).
   */
  abortTask(sessionId: string): Promise<void>
  /**
   * Start a task in the background: create the child session, then fire it via
   * `session.promptAsync` (returns a 204 immediately; the server runs the LLM
   * turn autonomously). Resolves the child session id WITHOUT awaiting the turn.
   * Rejects if session creation or the async-prompt acknowledgement fails.
   */
  startBackground(agentName: string, prompt: string): Promise<string>
}

export interface AgentInfo {
  mode: "primary" | "subagent" | "all"
}

/**
 * Names of `mode: "all"` agents that MAY be dispatched — but ONLY by a
 * primary-mode caller. This is the single narrow relaxation of the otherwise
 * subagent-only rule: it lets the primary coordinator (Perun) dispatch the
 * planning agent (Veles, a `mode: "all"` agent that is also user-switchable)
 * while still blocking Veles→Veles, *→Perun, and any other `primary`/`all`
 * target. Keep this set MINIMAL — every entry widens the anti-recursion surface.
 */
// Value must match `VELES_AGENT_KEY` in `plan/veles.metadata.ts` (the agent's
// registered name). Kept as a literal here to avoid a coordinator→plan import;
// `validate-dispatchable.test.ts` pins the two together against drift.
export const DISPATCHABLE_ALL_AGENTS: ReadonlySet<string> = new Set<string>([
  "Veles - Planner",
])

/**
 * Anti-recursion guard. Dispatchable targets:
 *   - any strict `subagent` (from any caller), OR
 *   - an allowlisted `all` agent (DISPATCHABLE_ALL_AGENTS) when the CALLER is
 *     `primary`.
 * Everything else throws: a `primary` target, a non-allowlisted `all` target,
 * or an allowlisted `all` target dispatched by a non-primary caller (this last
 * case blocks Veles→Veles self/nested recursion). `callerMode` is resolved by
 * the dispatch tool from `agentRegistry[context.agent].mode`; when omitted
 * (legacy callers / unit tests) the allowlisted-`all` path is closed, so the
 * default stays safe. Shared by `dispatchParallel` and the background path.
 */
export function validateDispatchable(
  agentRegistry: Record<string, AgentInfo>,
  name: string,
  callerMode?: AgentInfo["mode"],
): void {
  const agentInfo = agentRegistry[name]
  if (agentInfo === undefined) {
    throw new Error(`Unknown agent: ${name}`)
  }
  if (agentInfo.mode === "subagent") {
    return
  }
  if (
    agentInfo.mode === "all" &&
    DISPATCHABLE_ALL_AGENTS.has(name) &&
    callerMode === "primary"
  ) {
    return
  }
  throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${name}`)
}

export interface DispatchParallelInput {
  tasks: DispatchTask[]
  agentRegistry: Record<string, AgentInfo>
  specialist: DispatchSpecialist
  pollIntervalMs?: number
  taskTimeoutMs?: number
  resultMaxBytes?: number
  /**
   * Optional aggregate (whole-wave) byte budget for the SUCCESSFUL results of
   * this call, applied AFTER the per-task `resultMaxBytes` cap. Results are
   * walked in input order, summing UTF-8 body bytes against the budget; once it
   * is exhausted, each remaining successful body is truncated to fit (or to an
   * empty-but-marked pointer when nothing fits) with a marker pointing to the
   * child session. Defaults to `DEFAULT_AGGREGATE_MAX_BYTES`. See that constant
   * for the rationale (bounds a single tool-result's token footprint).
   */
  aggregateMaxBytes?: number
  /**
   * Optional abort signal threaded through to every in-flight task. When the
   * signal aborts, each task whose poller is still running terminates within
   * one poll-interval with status `"aborted"`, and `abortTask(sessionId)` is
   * called best-effort so the child session is cancelled server-side.
   */
  signal?: AbortSignal
  /**
   * Optional registry that records (childSessionID → task.name) at dispatch
   * time. Consumed by plugin hooks (e.g. shell.env) that need to know which
   * agent is running in a given session. Registration persists for the
   * OpenCode session lifetime; cleanup is the plugin's session.deleted
   * handler — not unregistered inside dispatch.
   */
  sessionAgentRegistry?: SessionAgentRegistry
  /**
   * Optional log-scrubber applied to every task result after the untrusted-
   * output neutraliser, before truncation. Receives (text, parentSessionID)
   * and returns redacted text. Used by the QA bindings flow to redact known
   * secret values from Zmora results before they reach the report or TUI.
   *
   * If a `scrubberFactory` is also provided, the factory wins and this field
   * is ignored — the factory yields a pinned-snapshot scrubber, which is the
   * race-safe path.
   */
  scrubber?: (text: string, parentSessionID: string) => string
  /**
   * Optional factory that produces a per-dispatch scrubber session. Called
   * ONCE at the start of `dispatchParallel`; the returned `scrub(text)` is
   * applied to every task result; `release()` is invoked in a `finally` after
   * all tasks complete (success, failure, or abort). Takes precedence over
   * `scrubber`. This is the only race-safe scrubber path for store-backed
   * implementations — see `DispatchScrubberFactory` for the contract.
   */
  scrubberFactory?: (
    parentSessionID: string,
  ) => { scrub: (text: string) => string; release: () => void } | undefined
  /**
   * Parent (Perun) session ID — passed to the scrubber/factory. Required if
   * either is set; ignored otherwise.
   */
  parentSessionID?: string
  /**
   * Mode of the agent that invoked the dispatch tool (resolved from
   * `agentRegistry[context.agent]`). Passed to `validateDispatchable` so an
   * allowlisted `all` target (Veles) is dispatchable only from a `primary`
   * caller (Perun). Omitted ⇒ allowlisted-`all` dispatch is rejected.
   */
  callerMode?: AgentInfo["mode"]
  /**
   * Optional preflight hook fired ONCE per `dispatchParallel` call, before any
   * specialist session is spawned. The QA plugin uses this to lazily parse the
   * parent plan's `**Bindings:**` section into `QaRunState` so subsequent
   * `execute_recipe` calls can find recipes by name. Implementations must be
   * idempotent and must not throw — preflight errors are swallowed so they
   * cannot break unrelated dispatches.
   */
  preflight?: (input: {
    parentSessionID: string
    taskNames: readonly string[]
  }) => Promise<void>
}

// Poll interval for the foreground completion loop. `startTask` fires the turn
// via `session.promptAsync` (fire-and-forget), so `pollUntilIdle` is what
// actually drives the turn to completion — it is NOT merely confirmatory. The
// 1 s interval bounds tail-latency on observing idle while keeping per-task
// polling load low; it also bounds the abort/timeout reaction window to ~one
// interval (the poller checks `signal` and the timeout each iteration and
// during the inter-poll sleep). Shared with the background path.
export const DEFAULT_POLL_INTERVAL_MS = 1000
export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000
/**
 * Per-agent foreground-dispatch timeout. Two bounds, both governing the ENTIRE
 * turn (the turn runs fire-and-forget via `promptAsync`, so `pollUntilIdle` is
 * what enforces them):
 *  - `wallClockMs` — absolute ceiling regardless of progress (the backstop).
 *  - `idleMs` (optional) — INACTIVITY window: the max time with no sign of life
 *    before the task is treated as hung. The poller resets it on every observed
 *    progress (assistant output growing, OR the child still reporting busy), so
 *    a healthy-but-slow agent runs to completion while a genuinely wedged one is
 *    caught within `idleMs`. Omitted ⇒ pure wall-clock (the historical model).
 */
export interface AgentTimeout {
  wallClockMs: number
  idleMs?: number
}

// Veles heartbeat budget. The planner runs the heaviest single workload in the
// system — the multi-step `qa-plan-authoring` skill (Step 0→7) with a
// code-re-reading refute pass, often reading the whole diff in its own turn —
// and on a large diff with a cheaper model it legitimately streams for well past
// the old flat 15-min ceiling (observed: continuous output right up to the
// 15-min mark, then killed mid-stream). A bigger flat number just defers the
// same false kill, so the planner instead uses an INACTIVITY timeout: it may run
// as long as it keeps producing/working, bounded only by a generous absolute
// backstop for the pathological "busy forever, never finishes" case. Every other
// agent keeps the fast-fail pure-wall-clock default, so a real leaf hang is still
// detected in 5 min.
//
// Keyed by the registered agent name. Kept as a literal (not imported from the
// plan module) for the same reason as DISPATCHABLE_ALL_AGENTS above — avoid a
// coordinator→plan import; `agent-task-timeout.test.ts` pins the key against
// `VELES_AGENT_KEY` so it cannot drift from the planner's real registered name.
export const VELES_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // no sign of life ⇒ hung
export const VELES_WALLCLOCK_BACKSTOP_MS = 45 * 60 * 1000 // absolute ceiling
export const AGENT_TIMEOUT_OVERRIDES: ReadonlyMap<string, AgentTimeout> =
  new Map<string, AgentTimeout>([
    [
      "Veles - Planner",
      {
        wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
        idleMs: VELES_IDLE_TIMEOUT_MS,
      },
    ],
  ])

/**
 * Resolve the foreground dispatch timeout for a given agent. Agents absent from
 * `AGENT_TIMEOUT_OVERRIDES` get a pure wall-clock budget of `defaultMs`
 * (`DEFAULT_TASK_TIMEOUT_MS`, no heartbeat). An explicit `taskTimeoutMs` passed
 * to `dispatchParallel` still wins over this — a deliberate per-call wall-clock
 * override (used by tests and any caller that knows its own budget); this
 * resolver governs only the unspecified-timeout path.
 */
export function resolveAgentTimeout(
  agentName: string,
  defaultMs: number = DEFAULT_TASK_TIMEOUT_MS,
): AgentTimeout {
  return AGENT_TIMEOUT_OVERRIDES.get(agentName) ?? { wallClockMs: defaultMs }
}
export const DEFAULT_RESULT_MAX_BYTES = 100 * 1024
// Aggregate (whole-wave) byte budget for the SUCCESSFUL results returned from a
// single `dispatch_parallel` call. The per-task `DEFAULT_RESULT_MAX_BYTES` cap
// alone is insufficient: with `DISPATCH_MAX_TASKS == 4`, four maxed-out tasks
// return 4×100KB ≈ 400KB, and the model-facing `JSON.stringify` then inflates
// that with field framing/escaping — a single tool-result can approach
// ~100-130k tokens, dominating/overflowing the coordinator's window and
// inflating every subsequent turn's cost. This cap bounds the wave total to
// ~128KB (mid-range of the 100-150KB target). When the budget is exhausted,
// later successful results are truncated in place with a marker that points the
// reader to the child session for the full output — never silently dropped, and
// `error`/`timeout`/`aborted` results (which carry no body) are left untouched.
export const DEFAULT_AGGREGATE_MAX_BYTES = 128 * 1024
// Aligned with DISPATCH_CONCURRENCY so the per-call cap matches the worker
// pool size. The label `×N` rendered by the caller (e.g. Perun) now always
// equals the concurrent burst, and callers with more than 4 tasks must chunk
// into multiple sequential dispatch_parallel calls. This also caps the number
// of child sessions a single call can spawn, bounding cost-DoS via crafted
// plans (the worker pool throttles wall-clock concurrency, the cap throttles
// per-call session count).
export const DISPATCH_MAX_TASKS = 4
export const DISPATCH_CONCURRENCY = 4

export async function dispatchParallel(
  input: DispatchParallelInput,
): Promise<DispatchResult[]> {
  const {
    tasks,
    agentRegistry,
    specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    // No default here: an explicit value is a deliberate per-call override; when
    // omitted, each task's timeout is resolved per-agent in the worker below so
    // the planner gets the inactivity-based budget while leaf agents keep the
    // flat wall-clock (resolveAgentTimeout).
    taskTimeoutMs,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    aggregateMaxBytes = DEFAULT_AGGREGATE_MAX_BYTES,
    signal,
    sessionAgentRegistry,
    scrubber,
    scrubberFactory,
    parentSessionID,
    preflight,
    callerMode,
  } = input

  if (tasks.length > DISPATCH_MAX_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${DISPATCH_MAX_TASKS})`,
    )
  }

  // Anti-recursion: validate every task BEFORE any session spawns.
  for (const task of tasks) {
    validateDispatchable(agentRegistry, task.name, callerMode)
  }

  // Preflight runs ONCE per dispatch, after validation but BEFORE any session
  // is spawned, so dependent state (e.g. QA bindings) is populated before the
  // first specialist task starts. Swallow errors so a buggy hook cannot break
  // unrelated dispatches — the hook is expected to be self-defensive.
  if (
    preflight !== undefined &&
    parentSessionID !== undefined &&
    parentSessionID.length > 0
  ) {
    try {
      await preflight({
        parentSessionID,
        taskNames: tasks.map((t) => t.name),
      })
    } catch {
      // Never let a preflight failure mask a downstream dispatch result.
    }
  }

  // Materialise the per-dispatch scrubber session BEFORE any task runs so the
  // pinned snapshot exists for the full duration of the wave. The factory
  // takes precedence over the legacy `scrubber` field — when both are set the
  // factory wins because it is the race-safe path. Factory failures
  // are absorbed: a buggy factory must not break unrelated dispatches.
  let scrubberSession:
    | { scrub: (text: string) => string; release: () => void }
    | undefined
  if (
    scrubberFactory !== undefined &&
    parentSessionID !== undefined &&
    parentSessionID.length > 0
  ) {
    try {
      scrubberSession = scrubberFactory(parentSessionID)
    } catch {
      scrubberSession = undefined
    }
  }
  // Adapt the per-dispatch scrubber to the per-task `(text, parentSessionID)`
  // signature so `runTask` can stay agnostic of which path produced it. The
  // session's `scrub` already closes over the snapshot.
  const effectiveScrubber:
    | ((text: string, parent: string) => string)
    | undefined =
    scrubberSession !== undefined
      ? (text) => scrubberSession!.scrub(text)
      : scrubber

  // Worker pool: maintain DISPATCH_CONCURRENCY workers draining a shared queue.
  // `nextRef.value++` is race-free in single-threaded JS between `await` points.
  // `nextRef` is passed by reference so the abort-drain helper can advance the
  // shared cursor — keeps the queue invariant ("every index has a result")
  // testable in isolation from the run-loop.
  const results: DispatchResult[] = new Array(tasks.length)
  const nextRef = { value: 0 }

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted === true) {
        // First worker to detect abort drains the remaining slots; later
        // workers see `nextRef.value >= tasks.length` and exit immediately.
        fillUnstartedAsAborted(results, tasks, nextRef)
        return
      }
      const i = nextRef.value++
      if (i >= tasks.length) return
      const task = tasks[i]!
      results[i] = await runTask(task, specialist, {
        pollIntervalMs,
        // Explicit per-call override wins (as a pure wall-clock budget, no
        // heartbeat — back-compat for callers/tests that pass their own number);
        // otherwise resolve per-agent so the planner (Veles) gets the
        // inactivity-based budget while leaf agents keep the flat wall-clock.
        timeout:
          taskTimeoutMs !== undefined
            ? { wallClockMs: taskTimeoutMs }
            : resolveAgentTimeout(task.name),
        resultMaxBytes,
        signal,
        sessionAgentRegistry,
        scrubber: effectiveScrubber,
        parentSessionID,
      })
    }
  }

  try {
    const workerCount = Math.min(DISPATCH_CONCURRENCY, tasks.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  } finally {
    // Release the pinned snapshot regardless of how the wave terminated
    // (success, abort, or unhandled error in a worker). Swallow release
    // failures so a buggy plugin can't corrupt the dispatch return value.
    if (scrubberSession !== undefined) {
      try {
        scrubberSession.release()
      } catch {
        /* swallow: release is best-effort cleanup */
      }
    }
  }

  // Convert the variant-suffix invariant from a prompt-only convention into
  // a code-enforced one. The agent registry still validates input task names
  // as the original variants (zmora-fe / zmora-be / zmora-setup); only the
  // OUTPUT `name` and `error` strings are normalised, so prompt drift or
  // partial injection cannot leak any zmora-<variant> suffix into reports.
  for (const r of results) {
    r.name = normalizeVariantSuffix(r.name)
    if (r.error !== undefined) {
      r.error = normalizeVariantSuffix(r.error)
    }
  }
  // Aggregate (whole-wave) budget pass: bound the TOTAL bytes of successful
  // result bodies returned from this call, on top of the per-task cap. Runs
  // LAST so it sees the final (neutralised, scrubbed, per-task-truncated,
  // name-normalised) bodies. See `DEFAULT_AGGREGATE_MAX_BYTES` for why.
  enforceAggregateBudget(results, aggregateMaxBytes)
  return results
}

/**
 * Bound the combined UTF-8 byte size of the SUCCESSFUL result bodies in a wave.
 * Walks results in input order, charging each successful body against a shared
 * budget. Once the budget is exhausted, every remaining successful body is
 * truncated to whatever bytes still fit (possibly zero) and marked with a
 * pointer to the child session, so the coordinator sees a clear "the rest lives
 * in the child session" signal rather than a silently dropped or window-blowing
 * payload.
 *
 * Non-success entries (`error` / `timeout` / `aborted`) carry an empty `result`
 * by construction, so they neither consume budget nor get a marker — only
 * bodies that actually contribute tokens are governed.
 *
 * Mutates `results` in place (consistent with the variant-suffix pass above);
 * `name`/`error`/`status`/`duration_ms` are left untouched.
 */
function enforceAggregateBudget(
  results: DispatchResult[],
  aggregateMaxBytes: number,
): void {
  let remaining = aggregateMaxBytes
  for (const r of results) {
    if (r.status !== "success" || r.result.length === 0) {
      continue
    }
    const bodyBytes = Buffer.byteLength(r.result, "utf8")
    if (bodyBytes <= remaining) {
      remaining -= bodyBytes
      continue
    }
    // Budget exhausted for this (and every later) body: keep only what fits and
    // append a pointer-to-child marker. `truncateBytesWithMarker` is UTF-8-safe
    // and never splits a multi-byte sequence at the cut.
    r.result = truncateBytesWithMarker(
      r.result,
      remaining,
      AGGREGATE_TRUNCATION_MARKER,
    )
    remaining = 0
  }
}

/**
 * Drain every task slot that the worker pool has not yet claimed and fill it
 * with a "never-started" aborted result. Called from the abort branch of
 * `worker()` so the post-condition "every index in `results` has a defined
 * entry" still holds after the pool short-circuits.
 *
 * Single-writer invariant: only the first worker to observe `signal.aborted`
 * reaches this drain — by the time it returns, `nextRef.value >= tasks.length`,
 * so every subsequent worker takes the `i >= tasks.length` exit. `nextRef.value++`
 * is race-free in single-threaded JS between `await` points (no awaits here).
 *
 * `name: task.name` is the raw variant name; the final normalisation pass
 * in `dispatchParallel` rewrites it to the logical agent name, so we don't
 * normalise here.
 */
function fillUnstartedAsAborted(
  results: DispatchResult[],
  tasks: DispatchTask[],
  nextRef: { value: number },
): void {
  while (nextRef.value < tasks.length) {
    const i = nextRef.value++
    const task = tasks[i]!
    results[i] = {
      name: task.name,
      status: "aborted",
      result: "",
      duration_ms: 0,
      error: "aborted before start",
    }
  }
}

/**
 * Discriminates a `runTask` failure by error class. Kept as a pure helper so
 * the happy-path in `runTask` stays focused. New poller error types should
 * be added here, not in the caller.
 */
function classifyError(err: unknown): "timeout" | "error" | "aborted" {
  if (err instanceof PollerAbortError) {
    return "aborted"
  }
  if (err instanceof PollerTimeoutError) {
    return "timeout"
  }
  return "error"
}

/**
 * Best-effort server-side cancellation of a dispatched child session. Called
 * from BOTH the abort and the timeout path so the specialist stops doing work
 * and resources are released — a timed-out child whose turn is still running
 * server-side is orphaned compute unless it is cancelled here. Errors are
 * swallowed — the caller is already returning an "aborted"/"timeout" result
 * and we must not mask it.
 */
async function cleanupOnAbort(
  specialist: DispatchSpecialist,
  sessionId: string | undefined,
): Promise<void> {
  if (sessionId === undefined) {
    return
  }
  try {
    await specialist.abortTask(sessionId)
  } catch {
    /* swallow: best-effort cleanup */
  }
}

async function runTask(
  task: DispatchTask,
  specialist: DispatchSpecialist,
  options: {
    pollIntervalMs: number
    timeout: AgentTimeout
    resultMaxBytes: number
    signal?: AbortSignal
    sessionAgentRegistry?: SessionAgentRegistry
    scrubber?: (text: string, parentSessionID: string) => string
    parentSessionID?: string
  },
): Promise<DispatchResult> {
  const startTime = Date.now()
  let sessionId: string | undefined

  try {
    const fullPrompt = task.context
      ? `${task.prompt}\n\n${task.context}`
      : task.prompt
    const id = await specialist.startTask(
      task.name,
      fullPrompt,
      (createdId) => {
        // Runs after the child session is created but BEFORE its turn is fired.
        //  - Mirror into the outer `let` so the catch block's abort-path cleanup
        //    can cancel a child that fails (or is aborted) mid-turn.
        //  - Register (childSessionID → agent name) so plugin hooks resolve which
        //    agent owns the session. This MUST happen before the turn: the
        //    `shell.env` hook fires mid-turn server-side, and the turn starts as
        //    soon as `session.promptAsync` is acknowledged, so registering after
        //    `startTask` resolves would race the hook — it could see no mapping
        //    and inject no bindings. Cleanup is the plugin's `session.deleted`
        //    handler, not this dispatcher.
        sessionId = createdId
        options.sessionAgentRegistry?.register(createdId, task.name)
      },
    )

    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(id),
      // Status gate: only collect once the child session reports inactive —
      // a terminal-looking message alone can be the inter-step finish race
      // (see DispatchSpecialist.isSessionActive). The same probe doubles as the
      // heartbeat's liveness fallback when `idleTimeoutMs` is set below.
      isSessionActive: () => specialist.isSessionActive(id),
      timeoutMs: options.timeout.wallClockMs,
      idleTimeoutMs: options.timeout.idleMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      // Bound in-flight memory in the poller too: the per-poll cap matches
      // the final cap so we never hold an oversized string before the final
      // truncation pass below.
      maxBytes: options.resultMaxBytes,
    })

    // Treat specialist output as untrusted, then optionally redact known
    // secret values via the scrubber, then truncate by UTF-8 byte length
    // (not UTF-16 code units). Scrubber runs AFTER neutralisation so its
    // input is already control-byte-free, and BEFORE truncation so a long
    // redacted token cannot be split mid-marker.
    const neutralized = neutralizeUntrustedOutput(rawResult)
    const scrubbed =
      options.scrubber !== undefined && options.parentSessionID !== undefined
        ? options.scrubber(neutralized, options.parentSessionID)
        : neutralized
    const result = truncateBytes(scrubbed, options.resultMaxBytes)

    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime,
    }
  } catch (err) {
    const status = classifyError(err)
    // Cancel the child server-side on BOTH abort AND timeout. A timeout means
    // we have stopped polling but the child's LLM turn is still running
    // autonomously (it was fired fire-and-forget via `promptAsync`); without
    // this `abortTask` the child runs to completion as orphaned compute and
    // keeps accruing charges. `"error"` is left alone: those are create/ack
    // failures where either no child exists or the turn never started.
    if (status === "aborted" || status === "timeout") {
      await cleanupOnAbort(specialist, sessionId)
    }
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: neutralizeUntrustedOutput(
        err instanceof Error ? err.message : String(err),
      ),
    }
  }
}
