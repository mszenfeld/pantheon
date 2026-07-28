import { tool } from "@opencode-ai/plugin";
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
import { getDispatchExtensions } from "../_shared/dispatch-extensions.js";
import { getSessionAgent } from "../_shared/session-identity.js";
import {
  createPlanningArtifactPathService,
  makeVelesPlanningWriteGate
} from "./artifact-path.js";
import { VELES_ARTIFACT_TOOL_NAMES } from "./artifact-tool-names.js";
import { VELES_ARTIFACT_TOOL_NAMES as VELES_ARTIFACT_TOOL_NAMES2 } from "./artifact-tool-names.js";
const VELES_DISPATCH_TOOLS = Object.fromEntries(
  DISPATCH_TOOL_NAMES.map((name) => [name, true])
);
const VELES_ARTIFACT_TOOLS = {
  [VELES_ARTIFACT_TOOL_NAMES[0]]: true,
  [VELES_ARTIFACT_TOOL_NAMES[1]]: true
};
const AppVerkPlanPlugin = async ({ client }) => {
  registerAgentMetadata(velesSpecialistInfo);
  const planningArtifactPaths = createPlanningArtifactPathService({
    resolveAgent: (sessionID) => getSessionAgent(sessionID, client)
  });
  const planningWriteGate = makeVelesPlanningWriteGate({
    resolveAgent: (sessionID) => getSessionAgent(sessionID, client)
  });
  const sessionAgentRegistry = getDispatchExtensions().sessionAgentRegistry;
  const headlessQuestionGate = async (input) => {
    if (input.tool.toLowerCase() !== "question") return;
    const agent = await getSessionAgent(input.sessionID, client);
    if (agent !== VELES_AGENT_KEY) return;
    if (sessionAgentRegistry?.lookupMetadata(input.sessionID)?.headless !== true) {
      return;
    }
    throw new Error("Headless Veles sessions must not call question.");
  };
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
        tools: { ...VELES_DISPATCH_TOOLS, ...VELES_ARTIFACT_TOOLS }
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
    tool: {
      [VELES_ARTIFACT_TOOL_NAMES[0]]: tool({
        description: "Atomically reserve an empty docs/specs or docs/plans Markdown path for the calling Veles session.",
        args: {
          directory: tool.schema.string(),
          baseName: tool.schema.string(),
          extension: tool.schema.string()
        },
        async execute(args, context) {
          return JSON.stringify(
            await planningArtifactPaths.reserve(args, {
              sessionID: context.sessionID,
              worktree: context.worktree ?? context.directory
            })
          );
        }
      }),
      [VELES_ARTIFACT_TOOL_NAMES[1]]: tool({
        description: "Write content once to a planning artifact path reserved by the calling Veles session.",
        args: {
          path: tool.schema.string(),
          content: tool.schema.string()
        },
        async execute(args, context) {
          return JSON.stringify(
            await planningArtifactPaths.write(args, {
              sessionID: context.sessionID,
              worktree: context.worktree ?? context.directory
            })
          );
        }
      })
    },
    "tool.execute.before": async (input, output) => {
      await planningWriteGate(input, output);
      await headlessQuestionGate(input);
    },
    event: serenaNotifier.onEvent
  };
};
var plan_default = AppVerkPlanPlugin;
export {
  AppVerkPlanPlugin,
  VELES_ARTIFACT_TOOL_NAMES2 as VELES_ARTIFACT_TOOL_NAMES,
  plan_default as default
};
