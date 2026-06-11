import { randomUUID } from "node:crypto";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  validateDispatchable
} from "./dispatch.js";
import { PollerAbortError, PollerTimeoutError, pollUntilIdle } from "./poller.js";
import { neutralizeUntrustedOutput, normalizeVariantSuffix } from "./sanitize.js";
import { truncateBytes } from "./truncate-bytes.js";
const BACKGROUND_MAX_CONCURRENT = 4;
async function startBackgroundTask(input) {
  const { store, specialist, agentRegistry, parentSessionId, agent, prompt, context, callerMode, sessionAgentRegistry } = input;
  validateDispatchable(agentRegistry, agent, callerMode);
  if (store.countActiveByParent(parentSessionId) >= BACKGROUND_MAX_CONCURRENT) {
    throw new Error(
      `dispatch_background: max ${BACKGROUND_MAX_CONCURRENT} background tasks (running or finished-but-uncollected) for this session \u2014 collect one (wait_background, or poll_background until it reports success) before firing more`
    );
  }
  const fullPrompt = context ? `${prompt}

${context}` : prompt;
  const childSessionId = await specialist.startBackground(agent, fullPrompt);
  const id = `bg_${randomUUID().slice(0, 8)}`;
  sessionAgentRegistry?.register(childSessionId, agent);
  store.register({ id, childSessionId, parentSessionId, agent, startedAt: Date.now() });
  return { id, agent, status: "running" };
}
async function collectBackground(input) {
  let scrubberSession;
  if (input.scrubberFactory !== void 0 && input.parentSessionId !== void 0 && input.parentSessionId.length > 0) {
    try {
      scrubberSession = input.scrubberFactory(input.parentSessionId);
    } catch {
      scrubberSession = void 0;
    }
  }
  const effectiveScrubber = scrubberSession !== void 0 ? (text) => scrubberSession.scrub(text) : input.scrubber;
  try {
    return await Promise.all(
      input.ids.map((id) => collectOne(id, input, effectiveScrubber))
    );
  } finally {
    if (scrubberSession !== void 0) {
      try {
        scrubberSession.release();
      } catch {
      }
    }
  }
}
async function collectOne(id, input, scrubber) {
  const {
    store,
    specialist,
    block,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
    parentSessionId,
    allowUnscopedCollect = false
  } = input;
  const task = store.get(id);
  if (task === void 0) {
    return { id, agent: "", status: "not_found" };
  }
  const callerIsUnknown = parentSessionId === void 0;
  const callerOwnsTask = !callerIsUnknown && task.parentSessionId === parentSessionId;
  const skipGate = callerIsUnknown && allowUnscopedCollect;
  if (!callerOwnsTask && !skipGate) {
    return { id, agent: "", status: "not_found" };
  }
  const agent = normalizeVariantSuffix(task.agent);
  const finalize = (text) => {
    const neutralized = neutralizeUntrustedOutput(text);
    const scrubbed = scrubber !== void 0 && parentSessionId !== void 0 ? scrubber(neutralized, parentSessionId) : neutralized;
    return truncateBytes(scrubbed, resultMaxBytes);
  };
  if (!block) {
    const messages = await specialist.fetchMessages(task.childSessionId);
    const last = messages[messages.length - 1];
    if (last !== void 0 && last.role === "assistant" && last.finish_reason) {
      store.remove(id);
      return {
        id,
        agent,
        status: "success",
        result: finalize(last.content),
        duration_ms: Date.now() - task.startedAt
      };
    }
    return { id, agent, status: "running" };
  }
  try {
    const raw = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(task.childSessionId),
      timeoutMs,
      pollIntervalMs,
      signal,
      maxBytes: resultMaxBytes
    });
    store.remove(id);
    return { id, agent, status: "success", result: finalize(raw), duration_ms: Date.now() - task.startedAt };
  } catch (err) {
    if (err instanceof PollerAbortError || err instanceof PollerTimeoutError) {
      try {
        await specialist.abortTask(task.childSessionId);
      } catch {
      }
    }
    store.remove(id);
    if (err instanceof PollerAbortError) {
      return { id, agent, status: "aborted", result: "", duration_ms: Date.now() - task.startedAt, error: "aborted" };
    }
    if (err instanceof PollerTimeoutError) {
      return { id, agent, status: "timeout", result: "", duration_ms: Date.now() - task.startedAt, error: "timeout" };
    }
    return {
      id,
      agent,
      status: "error",
      result: "",
      duration_ms: Date.now() - task.startedAt,
      error: neutralizeUntrustedOutput(err instanceof Error ? err.message : String(err))
    };
  }
}
export {
  BACKGROUND_MAX_CONCURRENT,
  collectBackground,
  startBackgroundTask
};
