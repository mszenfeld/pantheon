import {
  AGGREGATE_TRUNCATION_MARKER,
  truncateBytesWithMarker,
} from "./truncate-bytes.js"

import type { AgentTimeout, DispatchResult } from "./dispatch-types.js"

export type { AgentTimeout } from "./dispatch-types.js"

export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_RESULT_MAX_BYTES = 100 * 1024
export const DEFAULT_AGGREGATE_MAX_BYTES = 128 * 1024
export const VELES_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const VELES_WALLCLOCK_BACKSTOP_MS = 45 * 60 * 1000
export const ZMORA_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const ZMORA_WALLCLOCK_BACKSTOP_MS = 30 * 60 * 1000

// Keys are the registered dispatch task names; literals avoid a
// coordinator→plan/qa import (drift pins live in agent-task-timeout.test.ts).
export const AGENT_TIMEOUT_OVERRIDES: ReadonlyMap<string, AgentTimeout> =
  new Map<string, AgentTimeout>([
    [
      "Veles - Planner",
      {
        wallClockMs: VELES_WALLCLOCK_BACKSTOP_MS,
        idleMs: VELES_IDLE_TIMEOUT_MS,
      },
    ],
    [
      "zmora-fe",
      {
        wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS,
        idleMs: ZMORA_IDLE_TIMEOUT_MS,
      },
    ],
    [
      "zmora-be",
      {
        wallClockMs: ZMORA_WALLCLOCK_BACKSTOP_MS,
        idleMs: ZMORA_IDLE_TIMEOUT_MS,
      },
    ],
  ])

export function resolveAgentTimeout(
  agentName: string,
  defaultMs: number = DEFAULT_TASK_TIMEOUT_MS,
): AgentTimeout {
  return AGENT_TIMEOUT_OVERRIDES.get(agentName) ?? { wallClockMs: defaultMs }
}

/** Bound the total UTF-8 payload emitted for successful results in one wave. */
export function enforceAggregateBudget(
  results: DispatchResult[],
  aggregateMaxBytes: number,
): void {
  let remaining = aggregateMaxBytes
  for (const result of results) {
    if (result.status !== "success" || result.result.length === 0) continue
    const bodyBytes = Buffer.byteLength(result.result, "utf8")
    if (bodyBytes <= remaining) {
      remaining -= bodyBytes
      continue
    }
    result.result = truncateBytesWithMarker(
      result.result,
      remaining,
      AGGREGATE_TRUNCATION_MARKER,
    )
    remaining = 0
  }
}
