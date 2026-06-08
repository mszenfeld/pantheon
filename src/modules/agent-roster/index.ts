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
