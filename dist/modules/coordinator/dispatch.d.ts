import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';
import { DispatchTask, AgentInfo, DispatchScrubber, DispatchScrubberFactory, DispatchResult } from './dispatch-types.js';
export { AgentTimeout, DispatchScrubberSession } from './dispatch-types.js';
export { DISPATCH_MAX_TASKS } from './task-builder.js';
import { DispatchSpecialist } from './worker-pool.js';
export { DISPATCHABLE_ALL_AGENTS, authorizeDispatchCaller, validateDispatchable } from './dispatch-authorizer.js';
export { AGENT_TIMEOUT_OVERRIDES, DEFAULT_AGGREGATE_MAX_BYTES, DEFAULT_RESULT_MAX_BYTES, DEFAULT_TASK_TIMEOUT_MS, SVAROG_IDLE_TIMEOUT_MS, SVAROG_WALLCLOCK_BACKSTOP_MS, VELES_IDLE_TIMEOUT_MS, VELES_WALLCLOCK_BACKSTOP_MS, ZMORA_IDLE_TIMEOUT_MS, ZMORA_WALLCLOCK_BACKSTOP_MS, enforceAggregateBudget, resolveAgentTimeout } from './budget-enforcer.js';
import './poller.js';

declare const DEFAULT_POLL_INTERVAL_MS = 1000;
declare const DISPATCH_CONCURRENCY = 4;
interface DispatchParallelInput {
    tasks: DispatchTask[];
    agentRegistry: Record<string, AgentInfo>;
    specialist: DispatchSpecialist;
    pollIntervalMs?: number;
    taskTimeoutMs?: number;
    resultMaxBytes?: number;
    aggregateMaxBytes?: number;
    signal?: AbortSignal;
    sessionAgentRegistry?: SessionAgentRegistry;
    scrubber?: DispatchScrubber;
    scrubberFactory?: DispatchScrubberFactory;
    parentSessionID?: string;
    callerMode?: AgentInfo["mode"];
    preflight?: (input: {
        parentSessionID: string;
        taskNames: readonly string[];
    }) => Promise<void>;
}
/**
 * Coordinate one validated dispatch wave. Focused modules own authorization,
 * task construction, worker lifecycle, budgets, and scrubber lifecycle.
 */
declare function dispatchParallel(input: DispatchParallelInput): Promise<DispatchResult[]>;

export { AgentInfo, DEFAULT_POLL_INTERVAL_MS, DISPATCH_CONCURRENCY, type DispatchParallelInput, DispatchResult, DispatchScrubber, DispatchScrubberFactory, DispatchSpecialist, DispatchTask, dispatchParallel };
