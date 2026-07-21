import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';
import { h as DispatchSpecialist, e as DispatchScrubber, f as DispatchScrubberFactory, d as DispatchResult } from '../../dispatch-scrubbers-CdWGxgiG.js';
export { A as AGENT_TIMEOUT_OVERRIDES, a as AgentTimeout, D as DEFAULT_AGGREGATE_MAX_BYTES, b as DEFAULT_RESULT_MAX_BYTES, c as DEFAULT_TASK_TIMEOUT_MS, g as DispatchScrubberSession, V as VELES_IDLE_TIMEOUT_MS, i as VELES_WALLCLOCK_BACKSTOP_MS, l as enforceAggregateBudget, r as resolveAgentTimeout } from '../../dispatch-scrubbers-CdWGxgiG.js';
import { DispatchTask, AgentInfo } from './task-builder.js';
export { DISPATCH_MAX_TASKS } from './task-builder.js';
export { DISPATCHABLE_ALL_AGENTS, authorizeDispatchCaller, validateDispatchable } from './dispatch-authorizer.js';
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
