import { COORDINATOR_AGENT_NAME } from "../_shared/session-identity.js"

import type { AgentInfo } from "./dispatch-types.js"

const READ_ONLY_DISPATCH_CALLERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Veles - Planner", new Set(["triglav"])],
])

/** Enforces the execution-time dispatch trust boundary before child creation. */
export function authorizeDispatchCaller(caller: string, targets: readonly string[]): void {
  if (caller === COORDINATOR_AGENT_NAME) {
    if (targets.includes(caller)) {
      throw new Error(`${caller} cannot dispatch itself`)
    }
    return
  }

  const allowedTargets = READ_ONLY_DISPATCH_CALLERS.get(caller)
  if (allowedTargets === undefined) {
    throw new Error("dispatch tools are restricted to Perun - Coordinator")
  }
  if (targets.some((target: string): boolean => !allowedTargets.has(target))) {
    throw new Error(`${caller} may dispatch only read-only targets`)
  }
}

export const DISPATCHABLE_ALL_AGENTS: ReadonlySet<string> = new Set<string>([
  "Veles - Planner",
])

/** Reject recursive and non-dispatchable targets before any work starts. */
export function validateDispatchable(
  agentRegistry: Record<string, AgentInfo>,
  name: string,
  callerMode?: AgentInfo["mode"],
): void {
  const agentInfo = agentRegistry[name]
  if (agentInfo === undefined) {
    throw new Error(`Unknown agent: ${name}`)
  }
  if (agentInfo.mode === "subagent") return
  if (
    agentInfo.mode === "all" &&
    DISPATCHABLE_ALL_AGENTS.has(name) &&
    callerMode === "primary"
  ) {
    return
  }
  throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${name}`)
}
