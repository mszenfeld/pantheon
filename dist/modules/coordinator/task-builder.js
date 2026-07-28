import { validateDispatchable } from "./dispatch-authorizer.js";
import { neutralizeUntrustedOutput } from "../_shared/sanitize.js";
const DISPATCH_MAX_TASKS = 4;
function buildTaskPrompt(task) {
  return task.context ? `${task.prompt}

${task.context}` : task.prompt;
}
function sanitizeTaskMetadata(tasks) {
  return tasks.map((task) => ({
    name: neutralizeUntrustedOutput(task.name),
    prompt: neutralizeUntrustedOutput(task.prompt)
  }));
}
function chunkDispatchTasks(tasks, size = DISPATCH_MAX_TASKS) {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("dispatch task chunk size must be a positive integer");
  }
  const chunks = [];
  for (let start = 0; start < tasks.length; start += size) {
    chunks.push(tasks.slice(start, start + size));
  }
  return chunks;
}
function validateDispatchTasks(tasks, agentRegistry, callerMode) {
  if (tasks.length > DISPATCH_MAX_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${DISPATCH_MAX_TASKS})`
    );
  }
  for (const task of tasks) {
    validateDispatchable(agentRegistry, task.name, callerMode);
  }
}
export {
  DISPATCH_MAX_TASKS,
  buildTaskPrompt,
  chunkDispatchTasks,
  sanitizeTaskMetadata,
  validateDispatchTasks
};
