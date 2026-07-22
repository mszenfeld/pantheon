import {
  forgetSessionAgent,
  getSessionAgentCached
} from "../_shared/session-identity.js";
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
  SVAROG_AGENT_KEY,
  DEFAULT_SVAROG_MODEL,
  SVAROG_DENIED_TOOLS,
  svarogSpecialistInfo
} from "./svarog.metadata.js";
import { buildSvarogPrompt } from "./prompt.js";
import { makeSvarogToolHook } from "./tool-budget-hook.js";
import { createCheckpoint } from "./checkpoint.js";
const DEFAULT_MODEL_PROVIDER = providerIdOf(DEFAULT_SVAROG_MODEL);
const AppVerkSvarogPlugin = async ({
  client,
  worktree,
  directory
}) => {
  registerAgentMetadata(svarogSpecialistInfo);
  const { hook, clearSession } = makeSvarogToolHook({
    resolveAgent: (sessionID) => getSessionAgentCached(sessionID, client),
    // Option C: auto-create the recovery checkpoint on the first mutating tool; restore is manual.
    // Phase-1 assumes Svarog edits the repo it runs in (process.cwd()).
    createCheckpoint: (sessionID) => createCheckpoint(process.cwd(), sessionID),
    // Same base av_commit stages against, so the staging-scope guard checks the path the
    // commit would actually add (falls back to process.cwd() when the host supplies neither).
    worktree: worktree ?? directory
  });
  let providerMissing = false;
  let toastShown = false;
  return {
    config: async (config) => {
      config.agent ??= {};
      const userModels = captureUserModels(config, SVAROG_AGENT_KEY);
      config.agent[SVAROG_AGENT_KEY] = {
        description: svarogSpecialistInfo.description,
        mode: "subagent",
        // DECLARATIVE intent only (DEFAULT-ALLOW on 1.17.3); the tool hook is the real boundary.
        tools: { ...SVAROG_DENIED_TOOLS },
        get prompt() {
          return buildSvarogPrompt();
        }
      };
      const providerOk = isProviderConfigured(config, DEFAULT_MODEL_PROVIDER);
      const overridePinned = userModels.has(SVAROG_AGENT_KEY) || loadPantheonConfig().agents[SVAROG_AGENT_KEY]?.model !== void 0;
      providerMissing = !providerOk && !overridePinned;
      applyModelOverride(
        config,
        SVAROG_AGENT_KEY,
        SVAROG_AGENT_KEY,
        providerOk ? DEFAULT_SVAROG_MODEL : void 0,
        userModels
      );
    },
    "tool.execute.before": hook,
    // NO tool.execute.after — Svarog gates invocation, it does not scrub results (same as Stribog).
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
      const message = `Svarog's pinned default model (${DEFAULT_SVAROG_MODEL}) needs the "${DEFAULT_MODEL_PROVIDER}" provider, which is not configured \u2014 falling back to the session default. Set agents.svarog.model in pantheon.json to a model on your provider, or configure the provider.`;
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
var svarog_default = AppVerkSvarogPlugin;
export {
  AppVerkSvarogPlugin,
  svarog_default as default
};
