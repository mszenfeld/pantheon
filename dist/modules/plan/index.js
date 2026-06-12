import { registerAgentMetadata } from "../agent-registry/index.js";
import {
  applyModelOverride,
  captureUserModels
} from "../_shared/apply-model-override.js";
import { VELES_AGENT_KEY, velesSpecialistInfo } from "./veles.metadata.js";
import { buildVelesPrompt } from "./prompt.js";
import { isSerenaAvailable } from "../_shared/serena-detect.js";
import { makeSerenaDegradedNotifier } from "../_shared/serena-degraded-notifier.js";
import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js";
const VELES_DISPATCH_TOOLS = Object.fromEntries(
  DISPATCH_TOOL_NAMES.map((name) => [name, true])
);
const AppVerkPlanPlugin = async ({ client }) => {
  registerAgentMetadata(velesSpecialistInfo);
  const serenaNotifier = makeSerenaDegradedNotifier(
    client,
    "Veles registered but serena MCP not found \u2014 planning runs in degraded mode (Grep/Glob). Install serena for semantic context."
  );
  return {
    config: async (config) => {
      config.agent ??= {};
      const userModels = captureUserModels(config, VELES_AGENT_KEY);
      config.agent[VELES_AGENT_KEY] = {
        description: velesSpecialistInfo.description,
        mode: "all",
        get prompt() {
          return buildVelesPrompt();
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
        tools: { ...VELES_DISPATCH_TOOLS }
      };
      applyModelOverride(
        config,
        "veles",
        VELES_AGENT_KEY,
        void 0,
        userModels
      );
      serenaNotifier.markSerenaMissing(!isSerenaAvailable(config));
    },
    event: serenaNotifier.onEvent
  };
};
var plan_default = AppVerkPlanPlugin;
export {
  AppVerkPlanPlugin,
  plan_default as default
};
