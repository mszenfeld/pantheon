import { AgentInfo } from './task-builder.js';

/** Enforces the execution-time dispatch trust boundary before child creation. */
declare function authorizeDispatchCaller(caller: string, targets: readonly string[]): void;
declare const DISPATCHABLE_ALL_AGENTS: ReadonlySet<string>;
/** Reject recursive and non-dispatchable targets before any work starts. */
declare function validateDispatchable(agentRegistry: Record<string, AgentInfo>, name: string, callerMode?: AgentInfo["mode"]): void;

export { DISPATCHABLE_ALL_AGENTS, authorizeDispatchCaller, validateDispatchable };
