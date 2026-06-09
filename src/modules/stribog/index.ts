import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { STRIBOG_AGENT_KEY, stribogSpecialistInfo } from "./stribog.metadata.js"
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
    },
  }
}

export default AppVerkStribogPlugin
