import { randomUUID } from "node:crypto"
import type { AgentInfo, DispatchSpecialist } from "./dispatch.js"
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  validateDispatchable,
} from "./dispatch.js"
import { PollerAbortError, PollerTimeoutError, pollUntilIdle } from "./poller.js"
import { neutralizeUntrustedOutput, normalizeVariantSuffix } from "./sanitize.js"
import { truncateBytes } from "./truncate-bytes.js"
import type { BackgroundTaskStore } from "./background-store.js"
import type { SessionAgentRegistry } from "../_shared/session-agent-registry.js"

/** Per-parent cap on concurrent background tasks. Mirrors DISPATCH_CONCURRENCY;
 *  bounds spawn count (cost-DoS). Separate from the synchronous worker pool. */
export const BACKGROUND_MAX_CONCURRENT = 4

export interface StartBackgroundInput {
  store: BackgroundTaskStore
  specialist: DispatchSpecialist
  agentRegistry: Record<string, AgentInfo>
  parentSessionId: string
  agent: string
  prompt: string
  context?: string
  /** Caller's mode — see dispatch.ts DispatchParallelInput.callerMode. */
  callerMode?: AgentInfo["mode"]
  /**
   * QA `sessionAgentRegistry`. When set, the background child is registered
   * (childSessionID → agent name) so it no longer reads as the coordinator in
   * the caller gate. `undefined` is a no-op (e.g. unit tests). Mirrors the
   * foreground path's `dispatch.ts` `options.sessionAgentRegistry?.register`.
   */
  sessionAgentRegistry?: SessionAgentRegistry
}

export interface StartBackgroundResult {
  id: string
  agent: string
  status: "running"
}

export async function startBackgroundTask(
  input: StartBackgroundInput,
): Promise<StartBackgroundResult> {
  const { store, specialist, agentRegistry, parentSessionId, agent, prompt, context, callerMode, sessionAgentRegistry } =
    input

  validateDispatchable(agentRegistry, agent, callerMode)

  if (store.countActiveByParent(parentSessionId) >= BACKGROUND_MAX_CONCURRENT) {
    throw new Error(
      `dispatch_background: max ${BACKGROUND_MAX_CONCURRENT} background tasks (running or finished-but-uncollected) for this session — collect one (wait_background, or poll_background until it reports success) before firing more`,
    )
  }

  const fullPrompt = context ? `${prompt}\n\n${context}` : prompt
  // Rejects on create/ack failure → propagates to the caller, nothing registered.
  const childSessionId = await specialist.startBackground(agent, fullPrompt)

  const id = `bg_${randomUUID().slice(0, 8)}`
  // Register the child in BOTH the BackgroundTaskStore AND the QA
  // `sessionAgentRegistry` (childSessionID → agent name), mirroring the
  // foreground `dispatch_parallel` path (`dispatch.ts` `register(createdId,
  // task.name)`). The registry entry is what flips the child OUT of the
  // caller gate's registry-negative "is the coordinator" bucket, denying it
  // the coordinator-only QA tools (`parse_plan`/`record_input`/`preflight`).
  // Background dispatch still injects NO `shell.env` bindings — registration
  // here is purely identity, not a bindings grant; the gate reads agent name,
  // the hook reads bindings, and only the latter is withheld for background.
  // Cleanup needs nothing extra here: the QA module's `session.deleted`
  // handler calls `registry.unregister(deletedID)` for ANY id, so a child
  // that outlives the parent turn is cleaned up generically. Registering AFTER
  // `startBackground` resolves is sufficient — unlike the foreground path,
  // the background turn is fire-and-forget (`promptAsync`) and consults no
  // bindings, so there is no before-the-turn ordering constraint to satisfy.
  // See `sdk-specialist.ts` `startBackground`.
  sessionAgentRegistry?.register(childSessionId, agent)
  store.register({ id, childSessionId, parentSessionId, agent, startedAt: Date.now() })
  return { id, agent, status: "running" }
}

export interface CollectBackgroundInput {
  store: BackgroundTaskStore
  specialist: DispatchSpecialist
  ids: string[]
  block: boolean
  timeoutMs?: number
  pollIntervalMs?: number
  resultMaxBytes?: number
  signal?: AbortSignal
  /**
   * Legacy live-read scrubber applied to every collected result after the
   * untrusted-output neutraliser, before truncation. Receives
   * (text, parentSessionID). Used only when no `scrubberFactory` is provided —
   * the factory is the race-safe path and takes precedence.
   */
  scrubber?: (text: string, parentSessionID: string) => string
  /**
   * Factory that pins a per-collect scrubber session. Called ONCE per
   * `collectBackground` call (i.e. per `poll_background` / `wait_background`),
   * BEFORE any task is collected; the returned `scrub(text)` is applied to
   * every result and `release()` is invoked in a `finally`. Takes precedence
   * over `scrubber`. This is the only path that routes background results
   * through the QA secret scrubber — the legacy `scrubber` field is permanently
   * `undefined` because the QA plugin registers only `scrubberFactory`.
   * Snapshotting per collect (rather than once at dispatch) keeps the redacted
   * view coherent with whatever bindings exist when the result is read, even
   * though the background turn itself injects no bindings.
   */
  scrubberFactory?: (
    parentSessionID: string,
  ) => { scrub: (text: string) => string; release: () => void } | undefined
  /**
   * The CALLER's session id (the poll_background / wait_background invoker),
   * threaded from `context.sessionID`. Serves two purposes:
   *   1. Pins the per-collect scrubber session (passed to `scrubberFactory`).
   *   2. Parent-session ownership gate in `collectOne`: a task is only
   *      collectable when `task.parentSessionId === parentSessionId`; a
   *      foreign task is reported as `not_found` (it is never read, and on the
   *      blocking path never removed). Caller identity is REQUIRED — when
   *      `undefined` the gate fails CLOSED (every task reads as foreign →
   *      `not_found`); see `collectOne`. Both production handlers always pass
   *      `context.sessionID`, so this is never `undefined` in production.
   */
  parentSessionId?: string
  /**
   * TEST-ONLY escape hatch. When `true`, an absent `parentSessionId` skips the
   * ownership gate (the pre-fix fail-OPEN behaviour) so unit tests that don't
   * model a specific caller can still collect a seeded task. Production
   * handlers (`poll_background` / `wait_background`) MUST NEVER set this — they
   * always thread `context.sessionID`, so they have no reason to. Keeping the
   * fail-open path behind an explicit opt-in (rather than inferring it from a
   * missing id) means a real handler that forgets to pass an id fails closed,
   * not open. SEC-001.
   */
  allowUnscopedCollect?: boolean
}

export interface BackgroundCollectResult {
  id: string
  agent: string
  status: "running" | "success" | "timeout" | "aborted" | "error" | "not_found"
  result?: string
  duration_ms?: number
  error?: string
}

export async function collectBackground(
  input: CollectBackgroundInput,
): Promise<BackgroundCollectResult[]> {
  // Materialise a per-collect scrubber session BEFORE any result is read so a
  // single pinned binding snapshot covers every id in this call. The factory
  // takes precedence over the legacy `scrubber` field — when both are set the
  // factory wins because it is the race-safe (snapshot-pinned) path. Factory
  // failures are absorbed (the contract is "never throw; return undefined"),
  // falling back to the legacy `scrubber` (typically also undefined → no-op).
  // Mirrors `dispatchParallel`'s scrubber-session lifecycle in dispatch.ts.
  let scrubberSession: { scrub: (text: string) => string; release: () => void } | undefined
  if (
    input.scrubberFactory !== undefined &&
    input.parentSessionId !== undefined &&
    input.parentSessionId.length > 0
  ) {
    try {
      scrubberSession = input.scrubberFactory(input.parentSessionId)
    } catch {
      scrubberSession = undefined
    }
  }
  // Adapt the per-collect scrubber to the `(text, parentSessionID)` signature
  // so `collectOne` stays agnostic of which path produced it. The session's
  // `scrub` already closes over the pinned snapshot.
  const effectiveScrubber: ((text: string, parentSessionID: string) => string) | undefined =
    scrubberSession !== undefined
      ? (text) => scrubberSession!.scrub(text)
      : input.scrubber

  try {
    return await Promise.all(
      input.ids.map((id) => collectOne(id, input, effectiveScrubber)),
    )
  } finally {
    // Release the pinned snapshot regardless of how collection terminated.
    // Swallow release failures so a buggy plugin can't corrupt the return value.
    if (scrubberSession !== undefined) {
      try {
        scrubberSession.release()
      } catch {
        /* swallow: release is best-effort cleanup */
      }
    }
  }
}

async function collectOne(
  id: string,
  input: CollectBackgroundInput,
  scrubber: ((text: string, parentSessionID: string) => string) | undefined,
): Promise<BackgroundCollectResult> {
  const {
    store,
    specialist,
    block,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
    parentSessionId,
    allowUnscopedCollect = false,
  } = input

  const task = store.get(id)
  if (task === undefined) {
    return { id, agent: "", status: "not_found" }
  }
  // Parent-session ownership gate: a session may only poll/wait its OWN
  // background tasks. The store is a single per-process map shared by every
  // session, so `store.get(id)` alone lets ANY session in the process collect
  // another session's task by id — and on the blocking path `wait_background`
  // would then REMOVE it, denying the rightful owner its result. We reuse the
  // caller's session id (`parentSessionId`, threaded from `context.sessionID`
  // by the poll_background/wait_background handlers) and refuse to disclose a
  // foreign task: returning `not_found` (rather than a distinct "forbidden")
  // also avoids leaking that the id exists at all.
  //
  // Caller identity is REQUIRED: `parentSessionId === undefined` is a
  // programming error (a handler that forgot to thread `context.sessionID`),
  // NOT a license to collect anything. We therefore fail CLOSED — an absent
  // caller id matches no owner, so every task reads as foreign → `not_found`.
  // Both production handlers (`index.ts` poll_background / wait_background) pass
  // a length-guarded `context.sessionID`, so production is always scoped and
  // never hits the closed path. The single, explicit exception is the
  // test-only `allowUnscopedCollect` opt-in (SEC-001), which unit tests set to
  // collect a seeded task without modelling a caller; production never sets it.
  const callerIsUnknown = parentSessionId === undefined
  const callerOwnsTask = !callerIsUnknown && task.parentSessionId === parentSessionId
  const skipGate = callerIsUnknown && allowUnscopedCollect
  if (!callerOwnsTask && !skipGate) {
    return { id, agent: "", status: "not_found" }
  }
  const agent = normalizeVariantSuffix(task.agent)
  const finalize = (text: string): string => {
    const neutralized = neutralizeUntrustedOutput(text)
    const scrubbed =
      scrubber !== undefined && parentSessionId !== undefined
        ? scrubber(neutralized, parentSessionId)
        : neutralized
    return truncateBytes(scrubbed, resultMaxBytes)
  }

  if (!block) {
    const messages = await specialist.fetchMessages(task.childSessionId)
    const last = messages[messages.length - 1]
    if (last !== undefined && last.role === "assistant" && last.finish_reason) {
      // A successful poll is TERMINAL — it returns the full result AND removes
      // the task, exactly like `wait_background` (one-time retrieval). This is
      // what frees the per-parent slot and stops every subsequent poll from
      // re-fetching the transcript over HTTP and re-running neutralise + scrub
      // + truncate on up to RESULT_MAX_BYTES. Without this remove(), a finished
      // task that the model already "collected" via poll would pin the cap of 4
      // until `wait_background`/`session.deleted`, so Perun could hit "max 4
      // background tasks" with zero tasks actually running (review M7). Done
      // BEFORE finalize so the slot frees even if scrubbing/truncation throws.
      store.remove(id)
      return {
        id,
        agent,
        status: "success",
        result: finalize(last.content),
        duration_ms: Date.now() - task.startedAt,
      }
    }
    return { id, agent, status: "running" }
  }

  try {
    const raw = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(task.childSessionId),
      timeoutMs,
      pollIntervalMs,
      signal,
      maxBytes: resultMaxBytes,
    })
    store.remove(id)
    return { id, agent, status: "success", result: finalize(raw), duration_ms: Date.now() - task.startedAt }
  } catch (err) {
    // Cancel the still-running child server-side BEFORE removing the task from
    // the store, on BOTH abort AND timeout. The background turn was fired
    // fire-and-forget (`promptAsync`), so on either path the child's LLM turn
    // is still running autonomously — discarding our wait does not stop it.
    // Cancelling must happen before `store.remove(id)`: once the task is gone
    // from the store the `session.deleted` recovery path (which iterates
    // `listByParent` → `abortTask`) can no longer reach it, so a remove-first
    // ordering would orphan a timed-out child's compute (and accrue charges).
    if (err instanceof PollerAbortError || err instanceof PollerTimeoutError) {
      try {
        await specialist.abortTask(task.childSessionId)
      } catch {
        /* best-effort: must not mask the abort/timeout result */
      }
    }
    store.remove(id)
    if (err instanceof PollerAbortError) {
      return { id, agent, status: "aborted", result: "", duration_ms: Date.now() - task.startedAt, error: "aborted" }
    }
    if (err instanceof PollerTimeoutError) {
      return { id, agent, status: "timeout", result: "", duration_ms: Date.now() - task.startedAt, error: "timeout" }
    }
    return {
      id,
      agent,
      status: "error",
      result: "",
      duration_ms: Date.now() - task.startedAt,
      error: neutralizeUntrustedOutput(err instanceof Error ? err.message : String(err)),
    }
  }
}
