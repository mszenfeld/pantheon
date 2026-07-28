import { neutralizeUntrustedOutput } from "../_shared/sanitize.js";
import {
  PollerAbortError,
  PollerTimeoutError,
  pollUntilIdle
} from "./poller.js";
import { buildTaskPrompt } from "./task-builder.js";
import { truncateBytes } from "./truncate-bytes.js";
async function runWorkerPool(input) {
  const results = new Array(input.tasks.length);
  const nextRef = { value: 0 };
  const fillUnstartedAsAborted = () => {
    while (nextRef.value < input.tasks.length) {
      const index = nextRef.value++;
      const task = input.tasks[index];
      if (task !== void 0) results[index] = input.onUnstartedAbort(task);
    }
  };
  const worker = async () => {
    while (true) {
      if (input.signal?.aborted === true) {
        fillUnstartedAsAborted();
        return;
      }
      const index = nextRef.value++;
      const task = input.tasks[index];
      if (task === void 0) return;
      results[index] = await input.runTask(task);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, input.tasks.length) }, worker)
  );
  return results;
}
function createUnstartedAbortResult(task) {
  return {
    name: task.name,
    status: "aborted",
    result: "",
    duration_ms: 0,
    error: "aborted before start"
  };
}
function classifyError(error) {
  if (error instanceof PollerAbortError) return "aborted";
  if (error instanceof PollerTimeoutError) return "timeout";
  return "error";
}
async function cleanupOnAbort(specialist, sessionId) {
  if (sessionId === void 0) return;
  try {
    await specialist.abortTask(sessionId);
  } catch {
  }
}
async function runDispatchedTask(task, specialist, options) {
  const startTime = Date.now();
  let sessionId;
  try {
    const id = await specialist.startTask(task.name, buildTaskPrompt(task), (createdId) => {
      sessionId = createdId;
      options.sessionAgentRegistry?.registerWithMetadata(createdId, task.name, {
        headless: task.executionContext === "perun-headless"
      });
    });
    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(id),
      isSessionActive: () => specialist.isSessionActive(id),
      timeoutMs: options.timeout.wallClockMs,
      idleTimeoutMs: options.timeout.idleMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      maxBytes: options.resultMaxBytes
    });
    const neutralized = neutralizeUntrustedOutput(rawResult);
    const scrubbed = options.scrubber !== void 0 && options.parentSessionID !== void 0 ? options.scrubber(neutralized, options.parentSessionID) : neutralized;
    return {
      name: task.name,
      status: "success",
      result: truncateBytes(scrubbed, options.resultMaxBytes),
      duration_ms: Date.now() - startTime,
      sessionId
    };
  } catch (error) {
    const status = classifyError(error);
    if (status === "aborted" || status === "timeout") {
      await cleanupOnAbort(specialist, sessionId);
    }
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: neutralizeUntrustedOutput(error instanceof Error ? error.message : String(error)),
      sessionId
    };
  }
}
export {
  createUnstartedAbortResult,
  runDispatchedTask,
  runWorkerPool
};
