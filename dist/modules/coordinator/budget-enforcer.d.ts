import { AgentTimeout, DispatchResult } from './dispatch-types.js';

declare const DEFAULT_TASK_TIMEOUT_MS: number;
declare const DEFAULT_RESULT_MAX_BYTES: number;
declare const DEFAULT_AGGREGATE_MAX_BYTES: number;
declare const VELES_IDLE_TIMEOUT_MS: number;
declare const VELES_WALLCLOCK_BACKSTOP_MS: number;
declare const AGENT_TIMEOUT_OVERRIDES: ReadonlyMap<string, AgentTimeout>;
declare function resolveAgentTimeout(agentName: string, defaultMs?: number): AgentTimeout;
/** Bound the total UTF-8 payload emitted for successful results in one wave. */
declare function enforceAggregateBudget(results: DispatchResult[], aggregateMaxBytes: number): void;

export { AGENT_TIMEOUT_OVERRIDES, AgentTimeout, DEFAULT_AGGREGATE_MAX_BYTES, DEFAULT_RESULT_MAX_BYTES, DEFAULT_TASK_TIMEOUT_MS, VELES_IDLE_TIMEOUT_MS, VELES_WALLCLOCK_BACKSTOP_MS, enforceAggregateBudget, resolveAgentTimeout };
