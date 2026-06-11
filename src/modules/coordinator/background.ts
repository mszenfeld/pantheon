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

  if (store.countRunningByParent(parentSessionId) >= BACKGROUND_MAX_CONCURRENT) {
    throw new Error(
      `dispatch_background: max ${BACKGROUND_MAX_CONCURRENT} background tasks running for this session — collect one (wait_background / poll_background) before firing more`,
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
  scrubber?: (text: string, parentSessionID: string) => string
  parentSessionId?: string
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
  return Promise.all(input.ids.map((id) => collectOne(id, input)))
}

async function collectOne(
  id: string,
  input: CollectBackgroundInput,
): Promise<BackgroundCollectResult> {
  const {
    store,
    specialist,
    block,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
    scrubber,
    parentSessionId,
  } = input

  const task = store.get(id)
  if (task === undefined) {
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
    store.remove(id)
    if (err instanceof PollerAbortError) {
      // Abort discards the result → kill the child (same as dispatch_parallel).
      try {
        await specialist.abortTask(task.childSessionId)
      } catch {
        /* best-effort */
      }
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
