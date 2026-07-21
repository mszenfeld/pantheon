import { validateDispatchable } from "./dispatch-authorizer.js"
import { neutralizeUntrustedOutput } from "../_shared/sanitize.js"

export interface DispatchTask {
  name: string
  prompt: string
  context?: string
  executionContext?: "perun-headless"
}

export interface AgentInfo {
  mode: "primary" | "subagent" | "all"
}

export const DISPATCH_MAX_TASKS = 4

/** Build the exact specialist prompt from a validated task payload. */
export function buildTaskPrompt(task: DispatchTask): string {
  return task.context ? `${task.prompt}\n\n${task.context}` : task.prompt
}

/** Neutralize caller-controlled fields before copying task details to UI metadata. */
export function sanitizeTaskMetadata(
  tasks: readonly DispatchTask[],
): Array<{ name: string; prompt: string }> {
  return tasks.map((task: DispatchTask): { name: string; prompt: string } => ({
    name: neutralizeUntrustedOutput(task.name),
    prompt: neutralizeUntrustedOutput(task.prompt),
  }))
}

/** Split scenarios into ordered waves without changing their payloads. */
export function chunkDispatchTasks(
  tasks: readonly DispatchTask[],
  size: number = DISPATCH_MAX_TASKS,
): DispatchTask[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("dispatch task chunk size must be a positive integer")
  }
  const chunks: DispatchTask[][] = []
  for (let start = 0; start < tasks.length; start += size) {
    chunks.push(tasks.slice(start, start + size))
  }
  return chunks
}

/** Validate the complete wave before any child session can be spawned. */
export function validateDispatchTasks(
  tasks: readonly DispatchTask[],
  agentRegistry: Record<string, AgentInfo>,
  callerMode?: AgentInfo["mode"],
): void {
  if (tasks.length > DISPATCH_MAX_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${DISPATCH_MAX_TASKS})`,
    )
  }
  for (const task of tasks) {
    validateDispatchable(agentRegistry, task.name, callerMode)
  }
}
