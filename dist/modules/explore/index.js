import { registerAgentMetadata } from "../agent-registry/index.js";
import {
  applyModelOverride,
  captureUserModels
} from "../_shared/apply-model-override.js";
import { TRIGLAV_AGENT_KEY, triglavSpecialistInfo } from "./triglav.metadata.js";
import { buildTriglavPrompt } from "./prompt.js";
import { isSerenaAvailable } from "../_shared/serena-detect.js";
import { makeSerenaDegradedNotifier } from "../_shared/serena-degraded-notifier.js";
const AppVerkExplorePlugin = async ({ client }) => {
  registerAgentMetadata(triglavSpecialistInfo);
  const serenaNotifier = makeSerenaDegradedNotifier(
    client,
    "Triglav registered but serena MCP not found \u2014 exploration runs in degraded mode (Grep/Glob). Install serena for semantic search."
  );
  return {
    config: async (config) => {
      config.agent ??= {};
      const userModels = captureUserModels(config, TRIGLAV_AGENT_KEY);
      config.agent[TRIGLAV_AGENT_KEY] = {
        description: triglavSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildTriglavPrompt();
        }
      };
      applyModelOverride(
        config,
        "triglav",
        TRIGLAV_AGENT_KEY,
        void 0,
        userModels
      );
      serenaNotifier.markSerenaMissing(!isSerenaAvailable(config));
    },
    event: serenaNotifier.onEvent
  };
};
var explore_default = AppVerkExplorePlugin;
export {
  AppVerkExplorePlugin,
  explore_default as default
};
