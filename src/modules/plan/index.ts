import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { applyModelOverride, captureUserModels } from "../_shared/apply-model-override.js"
import { VELES_AGENT_KEY, velesSpecialistInfo } from "./veles.metadata.js"
import { buildVelesPrompt } from "./prompt.js"
import { isSerenaAvailable } from "../_shared/serena-detect.js"
import { makeSerenaDegradedNotifier } from "../_shared/serena-degraded-notifier.js"
import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js"

// Veles's opt-in dispatch-tool map, derived from the coordinator's canonical
// `DISPATCH_TOOL_NAMES` rather than re-typed literals — so a rename on the
// coordinator side can no longer leave this map pointing at tool names that no
// longer exist (which would silently disable Veles's dispatch). Imported from
// the dependency-free `coordinator/dispatch-tool-names.ts` (allowed
// src/modules → src/modules direction), so we don't drag in the coordinator's
// runtime tool graph.
const VELES_DISPATCH_TOOLS: Record<string, true> = Object.fromEntries(
  DISPATCH_TOOL_NAMES.map((name) => [name, true]),
)

export const AppVerkPlanPlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(velesSpecialistInfo)

  // Shared serena degraded-mode notifier (latch + one-time toast). Only the
  // message is agent-specific; the latch semantics live in `_shared`.
  const serenaNotifier = makeSerenaDegradedNotifier(
    client,
    "Veles registered but serena MCP not found — planning runs in degraded mode (Grep/Glob). Install serena for semantic context.",
  )

  return {
    config: async (config) => {
      config.agent ??= {}
      // Capture the user's opencode.json model (keyed by the display name
      // `Veles - Planner`) before the wholesale replace so applyModelOverride
      // can honor the documented precedence. See docs/configuring-agents.md.
      const userModels = captureUserModels(config, VELES_AGENT_KEY)
      config.agent[VELES_AGENT_KEY] = {
        description: velesSpecialistInfo.description,
        mode: "all",
        get prompt() {
          return buildVelesPrompt()
        },
        // Plugin tools are opt-in per agent. Veles orchestrates read-only
        // helpers (triglav now), so it needs the dispatch tools. These are
        // the coordinator's process-wide tools — enabling here, not in the
        // markdown allow-list (which is a no-op for plugin tools). The map is
        // derived from the coordinator's canonical DISPATCH_TOOL_NAMES (see
        // VELES_DISPATCH_TOOLS above) so the keys can't drift from the real
        // tool names.
        // NOTE: the enable direction of this map is also asserted-not-probed for
        // plugin tools on opencode 1.15.10 — see AGENTS.md "Plugin-tool
        // enforcement model". Do not treat it as a security boundary.
        tools: { ...VELES_DISPATCH_TOOLS },
      }
      // Inject model AFTER registration (mirrors triglav/zmora/perun). NOTE the
      // slug↔key split this helper makes explicit: the pantheon-config slug is
      // `veles` but the agent key is the display name `Veles - Planner`. The
      // helper registers the `veles` slug so a typo there is flagged and applies
      // the documented precedence (user opencode.json > `agents.veles.model`).
      // Model already validated by MODEL_REGEX — see pantheon-config/schema.ts.
      applyModelOverride(config, "veles", VELES_AGENT_KEY, undefined, userModels)
      serenaNotifier.markSerenaMissing(!isSerenaAvailable(config))
    },
    event: serenaNotifier.onEvent,
  }
}

export default AppVerkPlanPlugin
