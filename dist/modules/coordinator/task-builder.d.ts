interface DispatchTask {
    name: string;
    prompt: string;
    context?: string;
    executionContext?: "perun-headless";
}
interface AgentInfo {
    mode: "primary" | "subagent" | "all";
}
declare const DISPATCH_MAX_TASKS = 4;
/** Build the exact specialist prompt from a validated task payload. */
declare function buildTaskPrompt(task: DispatchTask): string;
/** Neutralize caller-controlled fields before copying task details to UI metadata. */
declare function sanitizeTaskMetadata(tasks: readonly DispatchTask[]): Array<{
    name: string;
    prompt: string;
}>;
/** Split scenarios into ordered waves without changing their payloads. */
declare function chunkDispatchTasks(tasks: readonly DispatchTask[], size?: number): DispatchTask[][];
/** Validate the complete wave before any child session can be spawned. */
declare function validateDispatchTasks(tasks: readonly DispatchTask[], agentRegistry: Record<string, AgentInfo>, callerMode?: AgentInfo["mode"]): void;

export { type AgentInfo, DISPATCH_MAX_TASKS, type DispatchTask, buildTaskPrompt, chunkDispatchTasks, sanitizeTaskMetadata, validateDispatchTasks };
