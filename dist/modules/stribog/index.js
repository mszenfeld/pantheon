import {
  forgetSessionAgent,
  getSessionAgentCached
} from "@appverk/opencode-skill-utils";
import { registerAgentMetadata } from "../agent-registry/index.js";
import {
  applyModelOverride,
  captureUserModels
} from "../_shared/apply-model-override.js";
import {
  isProviderConfigured,
  providerIdOf
} from "../_shared/provider-detect.js";
import { loadPantheonConfig } from "../pantheon-config/index.js";
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  STRIBOG_DENIED_TOOLS,
  stribogSpecialistInfo
} from "./stribog.metadata.js";
import { buildStribogPrompt } from "./prompt.js";
import { makeStribogToolHook } from "./tool-budget-hook.js";
const DEFAULT_MODEL_PROVIDER = providerIdOf(DEFAULT_STRIBOG_MODEL);
const AppVerkStribogPlugin = async ({ client }) => {
  registerAgentMetadata(stribogSpecialistInfo);
  const extraTools = loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.extraTools ?? [];
  const extraPatterns = extraTools.map((p) => p.toLowerCase());
  const { hook, clearSession } = makeStribogToolHook({
    resolveAgent: (sessionID) => getSessionAgentCached(sessionID, client),
    extraPatterns
  });
  let providerMissing = false;
  let toastShown = false;
  return {
    config: async (config) => {
      config.agent ??= {};
      const userModels = captureUserModels(config, STRIBOG_AGENT_KEY);
      config.agent[STRIBOG_AGENT_KEY] = {
        description: stribogSpecialistInfo.description,
        mode: "subagent",
        // DECLARATIVE intent: a binary check on opencode 1.17.3 found config.agent[x].tools is
        // honored but DEFAULT-ALLOW (a tool absent from the map still executes), so this deny-map
        // only bites as an explicit deny and is not load-bearing. The tool-budget hook is the real
        // boundary; this map documents intent (no execute_recipe → minter != actuator; no
        // task/dispatch → leaf) and yields defense-in-depth via its explicit denies.
        tools: { ...STRIBOG_DENIED_TOOLS },
        get prompt() {
          return buildStribogPrompt();
        }
      };
      const providerOk = isProviderConfigured(config, DEFAULT_MODEL_PROVIDER);
      const overridePinned = userModels.has(STRIBOG_AGENT_KEY) || loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model !== void 0;
      providerMissing = !providerOk && !overridePinned;
      applyModelOverride(
        config,
        STRIBOG_AGENT_KEY,
        STRIBOG_AGENT_KEY,
        providerOk ? DEFAULT_STRIBOG_MODEL : void 0,
        userModels
      );
    },
    "tool.execute.before": hook,
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id;
        if (typeof deletedID === "string" && deletedID.length > 0) {
          clearSession(deletedID);
          forgetSessionAgent(deletedID);
        }
        return;
      }
      if (event.type !== "session.created") return;
      if (toastShown || !providerMissing) return;
      const message = `Stribog's pinned default model (${DEFAULT_STRIBOG_MODEL}) needs the "${DEFAULT_MODEL_PROVIDER}" provider, which is not configured \u2014 falling back to the session default. Set agents.stribog.model in pantheon.json to a model on your provider, or configure the provider.`;
      try {
        console.error(`Pantheon: ${message}`);
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message }
        });
      } catch {
      }
      toastShown = true;
    }
  };
};
var stribog_default = AppVerkStribogPlugin;
export {
  AppVerkStribogPlugin,
  stribog_default as default
};
