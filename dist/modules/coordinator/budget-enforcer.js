import {
  AGGREGATE_TRUNCATION_MARKER,
  truncateBytesWithMarker
} from "./truncate-bytes.js";
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1e3;
const DEFAULT_RESULT_MAX_BYTES = 100 * 1024;
const DEFAULT_AGGREGATE_MAX_BYTES = 128 * 1024;
const VELES_IDLE_TIMEOUT_MS = 5 * 60 * 1e3;
const VELES_WALLCLOCK_BACKSTOP_MS = 45 * 60 * 1e3;
const AGENT_TIMEOUT_OVERRIDES = /* @__PURE__ */ new Map([
  [
    "Veles - Planner",
    {
      wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
      idleMs: VELES_IDLE_TIMEOUT_MS
    }
  ]
]);
function resolveAgentTimeout(agentName, defaultMs = DEFAULT_TASK_TIMEOUT_MS) {
  return AGENT_TIMEOUT_OVERRIDES.get(agentName) ?? { wallClockMs: defaultMs };
}
function enforceAggregateBudget(results, aggregateMaxBytes) {
  let remaining = aggregateMaxBytes;
  for (const result of results) {
    if (result.status !== "success" || result.result.length === 0) continue;
    const bodyBytes = Buffer.byteLength(result.result, "utf8");
    if (bodyBytes <= remaining) {
      remaining -= bodyBytes;
      continue;
    }
    result.result = truncateBytesWithMarker(
      result.result,
      remaining,
      AGGREGATE_TRUNCATION_MARKER
    );
    remaining = 0;
  }
}
export {
  AGENT_TIMEOUT_OVERRIDES,
  DEFAULT_AGGREGATE_MAX_BYTES,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  VELES_IDLE_TIMEOUT_MS,
  VELES_WALLCLOCK_BACKSTOP_MS,
  enforceAggregateBudget,
  resolveAgentTimeout
};
