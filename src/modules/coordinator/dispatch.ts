import type { SessionAgentRegistry } from "../_shared/session-agent-registry.js"

import {
  DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_RESULT_MAX_BYTES,
  enforceAggregateBudget,
  resolveAgentTimeout,
} from "./budget-enforcer.js"
import type { AgentTimeout } from "./budget-enforcer.js"
import { createDispatchScrubber, normalizeDispatchResults } from "./dispatch-scrubbers.js"
import type {
  DispatchScrubber,
  DispatchScrubberFactory,
} from "./dispatch-scrubbers.js"
import { validateDispatchTasks } from "./task-builder.js"
import type { AgentInfo, DispatchTask } from "./task-builder.js"
import {
  createUnstartedAbortResult,
  runDispatchedTask,
  runWorkerPool,
} from "./worker-pool.js"
import type { DispatchResult, DispatchSpecialist } from "./worker-pool.js"

export {
  authorizeDispatchCaller,
  DISPATCHABLE_ALL_AGENTS,
  validateDispatchable,
} from "./dispatch-authorizer.js"
export {
  AGENT_TIMEOUT_OVERRIDES,
  DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  enforceAggregateBudget,
  resolveAgentTimeout,
  SVAROG_IDLE_TIMEOUT_MS,
  SVAROG_WALLCLOCK_BACKSTOP_MS,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  ZMORA_IDLE_TIMEOUT_MS,
  ZMORA_WALLCLOCK_BACKSTOP_MS,
} from "./budget-enforcer.js"
export type { AgentTimeout } from "./budget-enforcer.js"
export type {
  DispatchScrubber,
  DispatchScrubberFactory,
  DispatchScrubberSession,
} from "./dispatch-scrubbers.js"
export { DISPATCH_MAX_TASKS } from "./task-builder.js"
export type { AgentInfo, DispatchTask } from "./task-builder.js"
export type { DispatchResult, DispatchSpecialist } from "./worker-pool.js"

export const DEFAULT_POLL_INTERVAL_MS = 1000
export const DISPATCH_CONCURRENCY = 4

export interface DispatchParallelInput {
  tasks: DispatchTask[]
  agentRegistry: Record<string, AgentInfo>
  specialist: DispatchSpecialist
  pollIntervalMs?: number
  taskTimeoutMs?: number
  resultMaxBytes?: number
  aggregateMaxBytes?: number
  signal?: AbortSignal
  sessionAgentRegistry?: SessionAgentRegistry
  scrubber?: DispatchScrubber
  scrubberFactory?: DispatchScrubberFactory
  parentSessionID?: string
  callerMode?: AgentInfo["mode"]
  preflight?: (input: {
    parentSessionID: string
    taskNames: readonly string[]
  }) => Promise<void>
}

/**
 * Coordinate one validated dispatch wave. Focused modules own authorization,
 * task construction, worker lifecycle, budgets, and scrubber lifecycle.
 */
export async function dispatchParallel(
  input: DispatchParallelInput,
): Promise<DispatchResult[]> {
  const {
    tasks,
    agentRegistry,
    specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
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

  validateDispatchTasks(tasks, agentRegistry, callerMode)

  if (preflight !== undefined && parentSessionID !== undefined && parentSessionID.length > 0) {
    try {
      await preflight({ parentSessionID, taskNames: tasks.map((task) => task.name) })
    } catch {
      // Plugin preflight failures must not block unrelated dispatches.
    }
  }

  const activeScrubber = createDispatchScrubber(parentSessionID, scrubber, scrubberFactory)
  try {
    const results = await runWorkerPool({
      tasks,
      concurrency: DISPATCH_CONCURRENCY,
      signal,
      runTask: (task: DispatchTask): Promise<DispatchResult> =>
        runDispatchedTask(task, specialist, {
          pollIntervalMs,
          timeout:
            taskTimeoutMs === undefined
              ? resolveAgentTimeout(task.name)
              : { wallClockMs: taskTimeoutMs } satisfies AgentTimeout,
          resultMaxBytes,
          signal,
          sessionAgentRegistry,
          scrubber: activeScrubber.scrubber,
          parentSessionID,
        }),
      onUnstartedAbort: createUnstartedAbortResult,
    })
    normalizeDispatchResults(results)
    enforceAggregateBudget(results, aggregateMaxBytes)
    return results
  } finally {
    activeScrubber.release()
  }
}
