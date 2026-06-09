import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { STRIBOG_AGENT_KEY, DEFAULT_STRIBOG_MODEL, stribogSpecialistInfo } from "./stribog.metadata.js"
import { buildStribogPrompt } from "./prompt.js"

export const AppVerkStribogPlugin: Plugin = async () => {
  registerAgentMetadata(stribogSpecialistInfo)

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent[STRIBOG_AGENT_KEY] = {
        description: stribogSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildStribogPrompt()
        },
      }
      // Stribog pins a Sonnet-class default (it is a doer, not cheap retrieval),
      // overridable via `agents.stribog.model`. The override is pre-validated by
      // MODEL_REGEX (CWE-117) — see src/modules/pantheon-config/schema.ts — so an
      // invalid value is already absent here and falls through to the default.
      const override = loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model
      config.agent[STRIBOG_AGENT_KEY].model = override ?? DEFAULT_STRIBOG_MODEL
    },
  }
}

export default AppVerkStribogPlugin
