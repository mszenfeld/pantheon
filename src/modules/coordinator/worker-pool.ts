import type { SessionAgentRegistry } from "../_shared/session-agent-registry.js"
import { neutralizeUntrustedOutput } from "../_shared/sanitize.js"

import type { AgentTimeout } from "./budget-enforcer.js"
import {
  PollerAbortError,
  PollerTimeoutError,
  pollUntilIdle,
  type PollerMessage,
} from "./poller.js"
import type { DispatchScrubber } from "./dispatch-scrubbers.js"
import { buildTaskPrompt, type DispatchTask } from "./task-builder.js"
import { truncateBytes } from "./truncate-bytes.js"

export interface DispatchResult {
  name: string
  status: "success" | "error" | "timeout" | "aborted"
  result: string
  duration_ms: number
  error?: string
  sessionId?: string
}

export interface DispatchSpecialist {
  startTask(
    agentName: string,
    prompt: string,
    onSessionCreated?: (sessionId: string) => void,
  ): Promise<string>
  fetchMessages(sessionId: string): Promise<PollerMessage[]>
  isSessionActive(sessionId: string): Promise<boolean>
  abortTask(sessionId: string): Promise<void>
  startBackground(
    agentName: string,
    prompt: string,
    onSessionCreated?: (sessionId: string) => void,
  ): Promise<string>
}

export interface RunTaskOptions {
  pollIntervalMs: number
  timeout: AgentTimeout
  resultMaxBytes: number
  signal?: AbortSignal
  sessionAgentRegistry?: SessionAgentRegistry
  scrubber?: DispatchScrubber
  parentSessionID?: string
}

export interface WorkerPoolInput {
  tasks: readonly DispatchTask[]
  concurrency: number
  signal?: AbortSignal
  runTask: (task: DispatchTask) => Promise<DispatchResult>
  onUnstartedAbort: (task: DispatchTask) => DispatchResult
}

/** Drain tasks with a fixed worker count while retaining input-order results. */
export async function runWorkerPool(input: WorkerPoolInput): Promise<DispatchResult[]> {
  const results: DispatchResult[] = new Array(input.tasks.length)
  const nextRef = { value: 0 }

  const fillUnstartedAsAborted = (): void => {
    while (nextRef.value < input.tasks.length) {
      const index = nextRef.value++
      const task = input.tasks[index]
      if (task !== undefined) results[index] = input.onUnstartedAbort(task)
    }
  }

  const worker = async (): Promise<void> => {
    while (true) {
      if (input.signal?.aborted === true) {
        fillUnstartedAsAborted()
        return
      }
      const index = nextRef.value++
      const task = input.tasks[index]
      if (task === undefined) return
      results[index] = await input.runTask(task)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, input.tasks.length) }, worker),
  )
  return results
}

export function createUnstartedAbortResult(task: DispatchTask): DispatchResult {
  return {
    name: task.name,
    status: "aborted",
    result: "",
    duration_ms: 0,
    error: "aborted before start",
  }
}

function classifyError(error: unknown): DispatchResult["status"] {
  if (error instanceof PollerAbortError) return "aborted"
  if (error instanceof PollerTimeoutError) return "timeout"
  return "error"
}

async function cleanupOnAbort(
  specialist: DispatchSpecialist,
  sessionId: string | undefined,
): Promise<void> {
  if (sessionId === undefined) return
  try {
    await specialist.abortTask(sessionId)
  } catch {
    // Cancellation is best-effort after a terminal failure.
  }
}

/** Execute and poll one foreground child, including cleanup on abort or timeout. */
export async function runDispatchedTask(
  task: DispatchTask,
  specialist: DispatchSpecialist,
  options: RunTaskOptions,
): Promise<DispatchResult> {
  const startTime = Date.now()
  let sessionId: string | undefined
  try {
    const id = await specialist.startTask(task.name, buildTaskPrompt(task), (createdId: string): void => {
      sessionId = createdId
      options.sessionAgentRegistry?.registerWithMetadata(createdId, task.name, {
        headless: task.executionContext === "perun-headless",
      })
    })
    const rawResult = await pollUntilIdle({
      fetchMessages: (): Promise<PollerMessage[]> => specialist.fetchMessages(id),
      isSessionActive: (): Promise<boolean> => specialist.isSessionActive(id),
      timeoutMs: options.timeout.wallClockMs,
      idleTimeoutMs: options.timeout.idleMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      maxBytes: options.resultMaxBytes,
    })
    const neutralized = neutralizeUntrustedOutput(rawResult)
    const scrubbed =
      options.scrubber !== undefined && options.parentSessionID !== undefined
        ? options.scrubber(neutralized, options.parentSessionID)
        : neutralized
    return {
      name: task.name,
      status: "success",
      result: truncateBytes(scrubbed, options.resultMaxBytes),
      duration_ms: Date.now() - startTime,
      sessionId,
    }
  } catch (error) {
    const status = classifyError(error)
    if (status === "aborted" || status === "timeout") {
      await cleanupOnAbort(specialist, sessionId)
    }
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: neutralizeUntrustedOutput(error instanceof Error ? error.message : String(error)),
      sessionId,
    }
  }
}
