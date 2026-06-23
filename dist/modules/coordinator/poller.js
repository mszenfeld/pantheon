import { probeSessionActive } from "./session-active.js";
import { truncateBytes } from "./truncate-bytes.js";
class PollerTimeoutError extends Error {
  kind = "timeout";
  elapsedMs;
  reason;
  constructor(elapsedMs, reason = "wall-clock") {
    super(`pollUntilIdle: ${reason} timeout after ${elapsedMs}ms`);
    this.name = "PollerTimeoutError";
    this.elapsedMs = elapsedMs;
    this.reason = reason;
  }
}
class PollerAbortError extends Error {
  kind = "abort";
  elapsedMs;
  constructor(elapsedMs) {
    super(`pollUntilIdle: aborted after ${elapsedMs}ms`);
    this.name = "PollerAbortError";
    this.elapsedMs = elapsedMs;
  }
}
async function pollUntilIdle(options) {
  const {
    fetchMessages,
    timeoutMs,
    pollIntervalMs,
    signal,
    maxBytes,
    isSessionActive,
    idleTimeoutMs
  } = options;
  const startTime = Date.now();
  let lastProgressAt = startTime;
  let lastContentBytes = -1;
  while (true) {
    if (signal?.aborted === true) {
      throw new PollerAbortError(Date.now() - startTime);
    }
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new PollerTimeoutError(elapsed, "wall-clock");
    }
    if (idleTimeoutMs !== void 0 && Date.now() - lastProgressAt >= idleTimeoutMs) {
      throw new PollerTimeoutError(Date.now() - lastProgressAt, "idle");
    }
    const messages = await fetchMessages();
    const last = messages[messages.length - 1];
    if (idleTimeoutMs !== void 0) {
      const contentBytes = last !== void 0 && last.role === "assistant" ? Buffer.byteLength(last.content, "utf8") : lastContentBytes;
      let progressed = contentBytes !== lastContentBytes;
      lastContentBytes = contentBytes;
      if (!progressed && await probeSessionActive(isSessionActive)) {
        progressed = true;
      }
      if (progressed) {
        lastProgressAt = Date.now();
      }
    }
    if (last !== void 0 && last.role === "assistant" && last.finish_reason) {
      if (!await probeSessionActive(isSessionActive)) {
        return maxBytes === void 0 ? last.content : truncateBytes(last.content, maxBytes);
      }
    }
    if (maxBytes !== void 0 && last !== void 0 && last.role === "assistant" && Buffer.byteLength(last.content, "utf8") > maxBytes) {
      last.content = truncateBytes(last.content, maxBytes);
    }
    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) {
      throw new PollerTimeoutError(Date.now() - startTime, "wall-clock");
    }
    const idleRemaining = idleTimeoutMs !== void 0 ? idleTimeoutMs - (Date.now() - lastProgressAt) : Number.POSITIVE_INFINITY;
    await sleepOrAbort(
      Math.min(pollIntervalMs, remaining, idleRemaining),
      signal,
      startTime
    );
  }
}
function sleepOrAbort(ms, signal, startTime) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new PollerAbortError(Date.now() - startTime));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new PollerAbortError(Date.now() - startTime));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export {
  PollerAbortError,
  PollerTimeoutError,
  pollUntilIdle
};
