import {
  DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_RESULT_MAX_BYTES,
  enforceAggregateBudget,
  resolveAgentTimeout
} from "./budget-enforcer.js";
import { createDispatchScrubber, normalizeDispatchResults } from "./dispatch-scrubbers.js";
import { validateDispatchTasks } from "./task-builder.js";
import {
  createUnstartedAbortResult,
  runDispatchedTask,
  runWorkerPool
} from "./worker-pool.js";
import {
  authorizeDispatchCaller,
  DISPATCHABLE_ALL_AGENTS,
  validateDispatchable
} from "./dispatch-authorizer.js";
import {
  AGENT_TIMEOUT_OVERRIDES,
  DEFAULT_AGGREGATE_MAX_BYTES as DEFAULT_AGGREGATE_MAX_BYTES2,
  DEFAULT_RESULT_MAX_BYTES as DEFAULT_RESULT_MAX_BYTES2,
  DEFAULT_TASK_TIMEOUT_MS,
  enforceAggregateBudget as enforceAggregateBudget2,
  resolveAgentTimeout as resolveAgentTimeout2,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  ZMORA_IDLE_TIMEOUT_MS,
  ZMORA_WALLCLOCK_BACKSTOP_MS
} from "./budget-enforcer.js";
import { DISPATCH_MAX_TASKS } from "./task-builder.js";
const DEFAULT_POLL_INTERVAL_MS = 1e3;
const DISPATCH_CONCURRENCY = 4;
async function dispatchParallel(input) {
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
    callerMode
  } = input;
  validateDispatchTasks(tasks, agentRegistry, callerMode);
  if (preflight !== void 0 && parentSessionID !== void 0 && parentSessionID.length > 0) {
    try {
      await preflight({ parentSessionID, taskNames: tasks.map((task) => task.name) });
    } catch {
    }
  }
  const activeScrubber = createDispatchScrubber(parentSessionID, scrubber, scrubberFactory);
  try {
    const results = await runWorkerPool({
      tasks,
      concurrency: DISPATCH_CONCURRENCY,
      signal,
      runTask: (task) => runDispatchedTask(task, specialist, {
        pollIntervalMs,
        timeout: taskTimeoutMs === void 0 ? resolveAgentTimeout(task.name) : { wallClockMs: taskTimeoutMs },
        resultMaxBytes,
        signal,
        sessionAgentRegistry,
        scrubber: activeScrubber.scrubber,
        parentSessionID
      }),
      onUnstartedAbort: createUnstartedAbortResult
    });
    normalizeDispatchResults(results);
    enforceAggregateBudget(results, aggregateMaxBytes);
    return results;
  } finally {
    activeScrubber.release();
  }
}
export {
  AGENT_TIMEOUT_OVERRIDES,
  DEFAULT_AGGREGATE_MAX_BYTES2 as DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES2 as DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  DISPATCHABLE_ALL_AGENTS,
  DISPATCH_CONCURRENCY,
  DISPATCH_MAX_TASKS,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  ZMORA_IDLE_TIMEOUT_MS,
  ZMORA_WALLCLOCK_BACKSTOP_MS,
  authorizeDispatchCaller,
  dispatchParallel,
  enforceAggregateBudget2 as enforceAggregateBudget,
  resolveAgentTimeout2 as resolveAgentTimeout,
  validateDispatchable
};
