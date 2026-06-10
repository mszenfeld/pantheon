import { isAbsolute, resolve } from "node:path"
import { STRIBOG_AGENT_KEY, STRIBOG_ALLOWED_TOOL_IDS, STRIBOG_EDIT_BUDGET } from "./stribog.metadata.js"

const TOOL_DENIED = "STRIBOG_TOOL_DENIED"
const SCOPE_VIOLATION = "STRIBOG_SCOPE_VIOLATION"

export interface StribogToolHookDeps {
  /** Resolve a session's agent key. Returns undefined when unknown (→ fail-open). */
  resolveAgent: (sessionID: string) => Promise<string | undefined>
}

export interface StribogToolHookInput {
  tool: string
  sessionID: string
  callID: string
}

export interface StribogToolHookOutput {
  args: { filePath?: unknown }
}

/** Per-session set of distinct, resolved absolute paths modified via edit/write. */
const editedPaths = new Map<string, Set<string>>()

function pathsFor(sessionID: string): Set<string> {
  let set = editedPaths.get(sessionID)
  if (set === undefined) {
    set = new Set<string>()
    editedPaths.set(sessionID, set)
  }
  return set
}

/** Drop a session's edit-budget state. Invoked from the plugin's `session.deleted` handler. */
export function clearStribogSession(sessionID: string): void {
  editedPaths.delete(sessionID)
}

/** Test-only: clear all per-session state. */
export function __resetStribogStateForTests(): void {
  editedPaths.clear()
}

/**
 * Build the `tool.execute.before` handler enforcing, for a session positively attributed as
 * `stribog`: (1) the tool-name allow-list (deny anything outside STRIBOG_ALLOWED_TOOL_IDS),
 * and (2) the edit budget (at most STRIBOG_EDIT_BUDGET distinct files via edit/write).
 *
 * Fail-open by construction: non-stribog/unknown sessions and any internal/attribution error
 * pass the call through. Only the two intended denials throw (their markers re-thrown past the
 * internal-error guard so they reach the model as a tool-error part).
 */
export function makeStribogToolHook(
  deps: StribogToolHookDeps,
): (input: StribogToolHookInput, output: StribogToolHookOutput) => Promise<void> {
  return async (input, output) => {
    try {
      const agent = await deps.resolveAgent(input.sessionID)
      if (agent !== STRIBOG_AGENT_KEY) return // pass-through for other/undefined agents

      if (!STRIBOG_ALLOWED_TOOL_IDS.has(input.tool)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${input.tool}" is outside Stribog's allow-list ` +
            `(read/glob/grep/edit/write/bash only). Stribog is a leaf actuator — it does not ` +
            `mint secrets or dispatch. If the task requires this tool, return the ESCALATE result.`,
        )
      }

      if (input.tool === "edit" || input.tool === "write") {
        const filePath = output.args?.filePath
        if (typeof filePath !== "string" || !isAbsolute(filePath)) return // fail-open: missing/relative
        const path = resolve(filePath)
        const set = pathsFor(input.sessionID)
        if (!set.has(path) && set.size >= STRIBOG_EDIT_BUDGET) {
          const alreadyModified = [...set].join(", ")
          throw new Error(
            `${SCOPE_VIOLATION}: edit budget exhausted (${STRIBOG_EDIT_BUDGET} distinct files ` +
              `already modified: ${alreadyModified}; refused: ${path}). This task exceeds ` +
              `Stribog's scope. Return the ESCALATE result now, listing the files you already ` +
              "touched in `reason`.",
          )
        }
        set.add(path)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SCOPE_VIOLATION)) throw error
      // never throw from a hook on internal/attribution errors
    }
  }
}
