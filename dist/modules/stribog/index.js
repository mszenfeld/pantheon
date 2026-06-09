import { registerAgentMetadata } from "../agent-registry/index.js";
import { loadPantheonConfig } from "../pantheon-config/index.js";
import { STRIBOG_AGENT_KEY, DEFAULT_STRIBOG_MODEL, stribogSpecialistInfo } from "./stribog.metadata.js";
import { buildStribogPrompt } from "./prompt.js";
const AppVerkStribogPlugin = async () => {
  registerAgentMetadata(stribogSpecialistInfo);
  return {
    config: async (config) => {
      config.agent ??= {};
      config.agent[STRIBOG_AGENT_KEY] = {
        description: stribogSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildStribogPrompt();
        }
      };
      const override = loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model;
      config.agent[STRIBOG_AGENT_KEY].model = override ?? DEFAULT_STRIBOG_MODEL;
    }
  };
};
var stribog_default = AppVerkStribogPlugin;
export {
  AppVerkStribogPlugin,
  stribog_default as default
};
