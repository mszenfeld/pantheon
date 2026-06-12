import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import {
  applyModelOverride,
  captureUserModels,
} from "../_shared/apply-model-override.js"
import { TRIGLAV_AGENT_KEY, triglavSpecialistInfo } from "./triglav.metadata.js"
import { buildTriglavPrompt } from "./prompt.js"
import { isSerenaAvailable } from "../_shared/serena-detect.js"
import { makeSerenaDegradedNotifier } from "../_shared/serena-degraded-notifier.js"

export const AppVerkExplorePlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(triglavSpecialistInfo)

  // Shared serena degraded-mode notifier (latch + one-time toast). Only the
  // message is agent-specific; the latch semantics live in `_shared`.
  const serenaNotifier = makeSerenaDegradedNotifier(
    client,
    "Triglav registered but serena MCP not found — exploration runs in degraded mode (Grep/Glob). Install serena for semantic search.",
  )

  return {
    config: async (config) => {
      config.agent ??= {}
      // Capture the user's opencode.json model before the wholesale replace so
      // applyModelOverride can honor the documented precedence (opencode.json >
      // pantheon.json). See docs/configuring-agents.md.
      const userModels = captureUserModels(config, TRIGLAV_AGENT_KEY)
      config.agent[TRIGLAV_AGENT_KEY] = {
        description: triglavSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildTriglavPrompt()
        },
      }
      // Inject model AFTER registration via the shared helper (mirrors
      // perun/zmora) — it also registers the `triglav` slug for typo detection.
      // Precedence: user opencode.json > `agents.triglav.model`; when both are
      // unset Triglav inherits OpenCode's session default. Model already
      // validated by MODEL_REGEX — see src/modules/pantheon-config/schema.ts for
      // the CWE-117 rationale.
      applyModelOverride(
        config,
        "triglav",
        TRIGLAV_AGENT_KEY,
        undefined,
        userModels,
      )
      serenaNotifier.markSerenaMissing(!isSerenaAvailable(config))
    },
    event: serenaNotifier.onEvent,
  }
}

export default AppVerkExplorePlugin
