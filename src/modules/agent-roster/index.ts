import type { Config } from "@opencode-ai/plugin"

/**
 * Visible-primary native built-in agents on opencode 1.15.10 — the ONLY natives
 * that appear in the picker. `general`/`explore` are `mode:"subagent"` (already
 * excluded by the picker filter `mode!=="subagent" && !hidden`), and
 * `compaction`/`title`/`summary` are already `hidden`. Natives live in the
 * runtime's INTERNAL agent map and are NEVER present in `config.agent`, so the
 * snapshot-diff cannot hide them — only the backstop (override-by-key) can.
 * Re-verify against the actual picker (NOT the SDK type enum) on opencode bumps.
 */
export const NATIVE_BUILTINS = ["build", "plan"] as const

/**
 * `default_agent` is honored by the opencode runtime but is absent from the v1
 * SDK `Config` type the plugin compiles against (it exists only in v2 types,
 * unused for `Config`). These accessors localize the cast. Re-check on the next
 * `@opencode-ai/plugin` bump — once the field is native, the cast is removable.
 */
export function getDefaultAgent(config: Config): string | undefined {
  return (config as { default_agent?: string }).default_agent
}

export function setDefaultAgent(config: Config, name: string): void {
  ;(config as { default_agent?: string }).default_agent = name
}

const HIDE = { hidden: true } as const
const COORDINATOR_AGENT = "Perun - Coordinator"

type AgentMap = NonNullable<Config["agent"]>
type AgentEntry = AgentMap[string]

function isVisiblePrimary(entry: AgentEntry | undefined): boolean {
  if (entry === undefined) return false
  const e = entry as { mode?: string; hidden?: boolean }
  return e.mode === "primary" && e.hidden !== true
}

/**
 * Make the harness own the agent roster: hide every `config.agent` key we did
 * not register. `preExisting` = keys present BEFORE the harness's per-module
 * config hooks ran (user/project agents). Pure — mutates `config` in place.
 *
 * Two complementary mechanisms (a union, not redundant):
 *  - snapshot-diff hides user/project agents (they appear in config.agent);
 *  - the NATIVE_BUILTINS backstop hides build/plan (natives are never in
 *    config.agent, so only override-by-key can reach them).
 */
export function applyRosterPolicy(config: Config, preExisting: Set<string>): void {
  config.agent ??= {}
  const agents = config.agent as AgentMap

  // 1. snapshot-diff: hide user/project agents that pre-existed our hooks.
  for (const key of Object.keys(agents)) {
    if (!preExisting.has(key)) continue
    if ((agents[key] as { hidden?: boolean }).hidden === true) continue
    agents[key] = { ...agents[key], ...HIDE }
  }

  // 2. backstop: hide native visible-primary built-ins via override-by-key.
  for (const name of NATIVE_BUILTINS) {
    agents[name] = { ...(agents[name] ?? {}), ...HIDE }
  }

  // 3. default_agent guard: after hiding, the runtime throws if default_agent
  //    points to a hidden/subagent agent. Repoint to a visible primary,
  //    preferring Perun (named), else the first by sorted key order.
  const current = getDefaultAgent(config)
  if (current !== undefined && isVisiblePrimary(agents[current])) return
  if (isVisiblePrimary(agents[COORDINATOR_AGENT])) {
    setDefaultAgent(config, COORDINATOR_AGENT)
    return
  }
  const fallback = Object.keys(agents)
    .sort()
    .find((k) => isVisiblePrimary(agents[k]))
  if (fallback !== undefined) setDefaultAgent(config, fallback)
}
