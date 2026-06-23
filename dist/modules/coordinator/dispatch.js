import {
  pollUntilIdle,
  PollerAbortError,
  PollerTimeoutError
} from "./poller.js";
import {
  neutralizeUntrustedOutput,
  normalizeVariantSuffix
} from "../_shared/sanitize.js";
import {
  truncateBytes,
  truncateBytesWithMarker,
  AGGREGATE_TRUNCATION_MARKER
} from "./truncate-bytes.js";
const DISPATCHABLE_ALL_AGENTS = /* @__PURE__ */ new Set([
  "Veles - Planner"
]);
function validateDispatchable(agentRegistry, name, callerMode) {
  const agentInfo = agentRegistry[name];
  if (agentInfo === void 0) {
    throw new Error(`Unknown agent: ${name}`);
  }
  if (agentInfo.mode === "subagent") {
    return;
  }
  if (agentInfo.mode === "all" && DISPATCHABLE_ALL_AGENTS.has(name) && callerMode === "primary") {
    return;
  }
  throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${name}`);
}
const DEFAULT_POLL_INTERVAL_MS = 1e3;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1e3;
const VELES_TASK_TIMEOUT_MS = 15 * 60 * 1e3;
const AGENT_TASK_TIMEOUT_MS_OVERRIDES = /* @__PURE__ */ new Map([["Veles - Planner", VELES_TASK_TIMEOUT_MS]]);
function resolveTaskTimeoutMs(agentName, defaultMs = DEFAULT_TASK_TIMEOUT_MS) {
  return AGENT_TASK_TIMEOUT_MS_OVERRIDES.get(agentName) ?? defaultMs;
}
const DEFAULT_RESULT_MAX_BYTES = 100 * 1024;
const DEFAULT_AGGREGATE_MAX_BYTES = 128 * 1024;
const DISPATCH_MAX_TASKS = 4;
const DISPATCH_CONCURRENCY = 4;
async function dispatchParallel(input) {
  const {
    tasks,
    agentRegistry,
    specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    // No default here: an explicit value is a deliberate per-call override; when
    // omitted, each task's timeout is resolved per-agent in the worker below so
    // the planner gets a longer budget than leaf agents (resolveTaskTimeoutMs).
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
  if (tasks.length > DISPATCH_MAX_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${DISPATCH_MAX_TASKS})`
    );
  }
  for (const task of tasks) {
    validateDispatchable(agentRegistry, task.name, callerMode);
  }
  if (preflight !== void 0 && parentSessionID !== void 0 && parentSessionID.length > 0) {
    try {
      await preflight({
        parentSessionID,
        taskNames: tasks.map((t) => t.name)
      });
    } catch {
    }
  }
  let scrubberSession;
  if (scrubberFactory !== void 0 && parentSessionID !== void 0 && parentSessionID.length > 0) {
    try {
      scrubberSession = scrubberFactory(parentSessionID);
    } catch {
      scrubberSession = void 0;
    }
  }
  const effectiveScrubber = scrubberSession !== void 0 ? (text) => scrubberSession.scrub(text) : scrubber;
  const results = new Array(tasks.length);
  const nextRef = { value: 0 };
  async function worker() {
    while (true) {
      if (signal?.aborted === true) {
        fillUnstartedAsAborted(results, tasks, nextRef);
        return;
      }
      const i = nextRef.value++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      results[i] = await runTask(task, specialist, {
        pollIntervalMs,
        // Explicit per-call override wins; otherwise resolve per-agent so the
        // planner (Veles) gets a longer budget than leaf agents.
        taskTimeoutMs: taskTimeoutMs ?? resolveTaskTimeoutMs(task.name),
        resultMaxBytes,
        signal,
        sessionAgentRegistry,
        scrubber: effectiveScrubber,
        parentSessionID
      });
    }
  }
  try {
    const workerCount = Math.min(DISPATCH_CONCURRENCY, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    if (scrubberSession !== void 0) {
      try {
        scrubberSession.release();
      } catch {
      }
    }
  }
  for (const r of results) {
    r.name = normalizeVariantSuffix(r.name);
    if (r.error !== void 0) {
      r.error = normalizeVariantSuffix(r.error);
    }
  }
  enforceAggregateBudget(results, aggregateMaxBytes);
  return results;
}
function enforceAggregateBudget(results, aggregateMaxBytes) {
  let remaining = aggregateMaxBytes;
  for (const r of results) {
    if (r.status !== "success" || r.result.length === 0) {
      continue;
    }
    const bodyBytes = Buffer.byteLength(r.result, "utf8");
    if (bodyBytes <= remaining) {
      remaining -= bodyBytes;
      continue;
    }
    r.result = truncateBytesWithMarker(
      r.result,
      remaining,
      AGGREGATE_TRUNCATION_MARKER
    );
    remaining = 0;
  }
}
function fillUnstartedAsAborted(results, tasks, nextRef) {
  while (nextRef.value < tasks.length) {
    const i = nextRef.value++;
    const task = tasks[i];
    results[i] = {
      name: task.name,
      status: "aborted",
      result: "",
      duration_ms: 0,
      error: "aborted before start"
    };
  }
}
function classifyError(err) {
  if (err instanceof PollerAbortError) {
    return "aborted";
  }
  if (err instanceof PollerTimeoutError) {
    return "timeout";
  }
  return "error";
}
async function cleanupOnAbort(specialist, sessionId) {
  if (sessionId === void 0) {
    return;
  }
  try {
    await specialist.abortTask(sessionId);
  } catch {
  }
}
async function runTask(task, specialist, options) {
  const startTime = Date.now();
  let sessionId;
  try {
    const fullPrompt = task.context ? `${task.prompt}

${task.context}` : task.prompt;
    const id = await specialist.startTask(
      task.name,
      fullPrompt,
      (createdId) => {
        sessionId = createdId;
        options.sessionAgentRegistry?.register(createdId, task.name);
      }
    );
    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(id),
      // Status gate: only collect once the child session reports inactive —
      // a terminal-looking message alone can be the inter-step finish race
      // (see DispatchSpecialist.isSessionActive).
      isSessionActive: () => specialist.isSessionActive(id),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      // Bound in-flight memory in the poller too: the per-poll cap matches
      // the final cap so we never hold an oversized string before the final
      // truncation pass below.
      maxBytes: options.resultMaxBytes
    });
    const neutralized = neutralizeUntrustedOutput(rawResult);
    const scrubbed = options.scrubber !== void 0 && options.parentSessionID !== void 0 ? options.scrubber(neutralized, options.parentSessionID) : neutralized;
    const result = truncateBytes(scrubbed, options.resultMaxBytes);
    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime
    };
  } catch (err) {
    const status = classifyError(err);
    if (status === "aborted" || status === "timeout") {
      await cleanupOnAbort(specialist, sessionId);
    }
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: neutralizeUntrustedOutput(
        err instanceof Error ? err.message : String(err)
      )
    };
  }
}
export {
  AGENT_TASK_TIMEOUT_MS_OVERRIDES,
  DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  DISPATCHABLE_ALL_AGENTS,
  DISPATCH_CONCURRENCY,
  DISPATCH_MAX_TASKS,
  VELES_TASK_TIMEOUT_MS,
  dispatchParallel,
  resolveTaskTimeoutMs,
  validateDispatchable
};
