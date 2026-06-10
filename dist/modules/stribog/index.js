import { getSessionAgentCached } from "@appverk/opencode-skill-utils";
import { registerAgentMetadata } from "../agent-registry/index.js";
import { loadPantheonConfig } from "../pantheon-config/index.js";
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  STRIBOG_DENIED_TOOLS,
  stribogSpecialistInfo
} from "./stribog.metadata.js";
import { buildStribogPrompt } from "./prompt.js";
import { clearStribogSession, makeStribogToolHook } from "./tool-budget-hook.js";
const AppVerkStribogPlugin = async ({ client }) => {
  registerAgentMetadata(stribogSpecialistInfo);
  const toolHook = makeStribogToolHook({
    resolveAgent: (sessionID) => getSessionAgentCached(sessionID, client)
  });
  return {
    config: async (config) => {
      config.agent ??= {};
      config.agent[STRIBOG_AGENT_KEY] = {
        description: stribogSpecialistInfo.description,
        mode: "subagent",
        // DECLARATIVE only: a 2026-06-10 live probe found config.agent[x].tools is INERT in
        // opencode 1.15.10 (a denied tool still executed). The tool-budget hook is the real
        // boundary; this map documents intent (no execute_recipe → minter != actuator; no task
        // → leaf) and yields free defense-in-depth if a future opencode honors it.
        tools: { ...STRIBOG_DENIED_TOOLS },
        get prompt() {
          return buildStribogPrompt();
        }
      };
      const override = loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model;
      config.agent[STRIBOG_AGENT_KEY].model = override ?? DEFAULT_STRIBOG_MODEL;
    },
    "tool.execute.before": toolHook,
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id;
        if (typeof deletedID === "string" && deletedID.length > 0) {
          clearStribogSession(deletedID);
        }
      }
    }
  };
};
var stribog_default = AppVerkStribogPlugin;
export {
  AppVerkStribogPlugin,
  stribog_default as default
};
