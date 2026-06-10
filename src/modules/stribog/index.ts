import type { Plugin } from "@opencode-ai/plugin"
import { getSessionAgentCached } from "@appverk/opencode-skill-utils"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  STRIBOG_DENIED_TOOLS,
  stribogSpecialistInfo,
} from "./stribog.metadata.js"
import { buildStribogPrompt } from "./prompt.js"
import { makeStribogToolHook } from "./tool-budget-hook.js"

export const AppVerkStribogPlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(stribogSpecialistInfo)

  // The hook is the load-bearing enforcement (attribution via getSessionAgentCached,
  // which — unlike the dispatch-only SessionAgentRegistry — resolves direct/eval sessions too).
  // Edit-budget state is owned by this factory call's closure (see makeStribogToolHook,
  // mirroring BackgroundTaskStore) rather than a module-global.
  const { hook, clearSession } = makeStribogToolHook({
    resolveAgent: (sessionID) => getSessionAgentCached(sessionID, client),
  })

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent[STRIBOG_AGENT_KEY] = {
        description: stribogSpecialistInfo.description,
        mode: "subagent",
        // DECLARATIVE only: a 2026-06-10 live probe found config.agent[x].tools is INERT in
        // opencode 1.15.10 (a denied tool still executed). The tool-budget hook is the real
        // boundary; this map documents intent (no execute_recipe → minter != actuator; no task
        // → leaf) and yields free defense-in-depth if a future opencode honors it.
        tools: { ...STRIBOG_DENIED_TOOLS },
        get prompt() {
          return buildStribogPrompt()
        },
      }
      // Stribog pins an explicit eval-picked default (`openai/gpt-5.4`) — it is a
      // doer, not cheap retrieval — overridable via `agents.stribog.model`. The override is pre-validated by
      // MODEL_REGEX (CWE-117) — see src/modules/pantheon-config/schema.ts — so an
      // invalid value is already absent here and falls through to the default.
      const override = loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model
      config.agent[STRIBOG_AGENT_KEY].model = override ?? DEFAULT_STRIBOG_MODEL
    },
    "tool.execute.before": hook,
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id
        if (typeof deletedID === "string" && deletedID.length > 0) {
          clearSession(deletedID)
        }
      }
    },
  }
}

export default AppVerkStribogPlugin
