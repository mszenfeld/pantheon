import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';
import { AgentTimeout, DispatchScrubber, DispatchTask, DispatchResult } from './dispatch-types.js';
import { PollerMessage } from './poller.js';

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

export { DispatchResult, type DispatchSpecialist, type RunTaskOptions, type WorkerPoolInput, createUnstartedAbortResult, runDispatchedTask, runWorkerPool };
