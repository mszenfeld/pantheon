import { SessionAgentRegistry } from './modules/_shared/session-agent-registry.js';
import { PollerMessage } from './modules/coordinator/poller.js';
import { DispatchTask } from './modules/coordinator/task-builder.js';

declare const DEFAULT_TASK_TIMEOUT_MS: number;
declare const DEFAULT_RESULT_MAX_BYTES: number;
declare const DEFAULT_AGGREGATE_MAX_BYTES: number;
declare const VELES_IDLE_TIMEOUT_MS: number;
declare const VELES_WALLCLOCK_BACKSTOP_MS: number;
interface AgentTimeout {
    wallClockMs: number;
    idleMs?: number;
}
declare const AGENT_TIMEOUT_OVERRIDES: ReadonlyMap<string, AgentTimeout>;
declare function resolveAgentTimeout(agentName: string, defaultMs?: number): AgentTimeout;
/** Bound the total UTF-8 payload emitted for successful results in one wave. */
declare function enforceAggregateBudget(results: DispatchResult[], aggregateMaxBytes: number): void;

interface DispatchResult {
    name: string;
    status: "success" | "error" | "timeout" | "aborted";
    result: string;
    duration_ms: number;
    error?: string;
    sessionId?: string;
}
interface DispatchSpecialist {
    startTask(agentName: string, prompt: string, onSessionCreated?: (sessionId: string) => void): Promise<string>;
    fetchMessages(sessionId: string): Promise<PollerMessage[]>;
    isSessionActive(sessionId: string): Promise<boolean>;
    abortTask(sessionId: string): Promise<void>;
    startBackground(agentName: string, prompt: string, onSessionCreated?: (sessionId: string) => void): Promise<string>;
}
interface RunTaskOptions {
    pollIntervalMs: number;
    timeout: AgentTimeout;
    resultMaxBytes: number;
    signal?: AbortSignal;
    sessionAgentRegistry?: SessionAgentRegistry;
    scrubber?: DispatchScrubber;
    parentSessionID?: string;
}
interface WorkerPoolInput {
    tasks: readonly DispatchTask[];
    concurrency: number;
    signal?: AbortSignal;
    runTask: (task: DispatchTask) => Promise<DispatchResult>;
    onUnstartedAbort: (task: DispatchTask) => DispatchResult;
}
/** Drain tasks with a fixed worker count while retaining input-order results. */
declare function runWorkerPool(input: WorkerPoolInput): Promise<DispatchResult[]>;
declare function createUnstartedAbortResult(task: DispatchTask): DispatchResult;
/** Execute and poll one foreground child, including cleanup on abort or timeout. */
declare function runDispatchedTask(task: DispatchTask, specialist: DispatchSpecialist, options: RunTaskOptions): Promise<DispatchResult>;

interface DispatchScrubberSession {
    scrub: (text: string) => string;
    release: () => void;
}
type DispatchScrubber = (text: string, parentSessionID: string) => string;
type DispatchScrubberFactory = (parentSessionID: string) => DispatchScrubberSession | undefined;
declare function createDispatchScrubber(parentSessionID: string | undefined, scrubber: DispatchScrubber | undefined, scrubberFactory: DispatchScrubberFactory | undefined): {
    scrubber: DispatchScrubber | undefined;
    release: () => void;
};
/** Remove internal variant suffixes only from values returned to callers. */
declare function normalizeDispatchResults(results: DispatchResult[]): DispatchResult[];

export { AGENT_TIMEOUT_OVERRIDES as A, DEFAULT_AGGREGATE_MAX_BYTES as D, type RunTaskOptions as R, VELES_IDLE_TIMEOUT_MS as V, type WorkerPoolInput as W, type AgentTimeout as a, DEFAULT_RESULT_MAX_BYTES as b, DEFAULT_TASK_TIMEOUT_MS as c, type DispatchResult as d, type DispatchScrubber as e, type DispatchScrubberFactory as f, type DispatchScrubberSession as g, type DispatchSpecialist as h, VELES_WALLCLOCK_BACKSTOP_MS as i, createDispatchScrubber as j, createUnstartedAbortResult as k, enforceAggregateBudget as l, runDispatchedTask as m, normalizeDispatchResults as n, runWorkerPool as o, resolveAgentTimeout as r };
