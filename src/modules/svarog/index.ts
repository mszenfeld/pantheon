import type { Plugin } from "@opencode-ai/plugin"
import {
  forgetSessionAgent,
  getSessionAgentCached,
} from "@appverk/opencode-skill-utils"
import { registerAgentMetadata } from "../agent-registry/index.js"
import {
  applyModelOverride,
  captureUserModels,
} from "../_shared/apply-model-override.js"
import {
  isProviderConfigured,
  providerIdOf,
} from "../_shared/provider-detect.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import {
  SVAROG_AGENT_KEY,
  DEFAULT_SVAROG_MODEL,
  SVAROG_DENIED_TOOLS,
  svarogSpecialistInfo,
} from "./svarog.metadata.js"
import { buildSvarogPrompt } from "./prompt.js"
import { makeSvarogToolHook } from "./tool-budget-hook.js"
import { createCheckpoint } from "./checkpoint.js"

/** Provider id the pinned default needs (`openai` for `openai/gpt-5.4`). */
const DEFAULT_MODEL_PROVIDER = providerIdOf(DEFAULT_SVAROG_MODEL)

export const AppVerkSvarogPlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(svarogSpecialistInfo)

  // The hook is the load-bearing enforcement; attribution via getSessionAgentCached resolves
  // dispatched AND eval/direct sessions (the _shared SessionAgentRegistry is dispatch-only).
  const { hook, clearSession } = makeSvarogToolHook({
    resolveAgent: (sessionID) => getSessionAgentCached(sessionID, client),
    // Option C: auto-create the recovery checkpoint on the first mutating tool; restore is manual.
    // Phase-1 assumes Svarog edits the repo it runs in (process.cwd()).
    createCheckpoint: (sessionID) => createCheckpoint(process.cwd(), sessionID),
  })

  // One-time degraded-mode warning if the pinned default's provider is absent.
  let providerMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      // Capture the user's opencode.json model BEFORE the wholesale replace drops it, so
      // applyModelOverride keeps it at the top of the precedence chain.
      const userModels = captureUserModels(config, SVAROG_AGENT_KEY)
      config.agent[SVAROG_AGENT_KEY] = {
        description: svarogSpecialistInfo.description,
        mode: "subagent",
        // DECLARATIVE intent only (DEFAULT-ALLOW on 1.17.3); the tool hook is the real boundary.
        tools: { ...SVAROG_DENIED_TOOLS },
        get prompt() {
          return buildSvarogPrompt()
        },
      }
      // Pin a STRONG default, provider-gated: only pass the default when its provider is
      // configured, else inherit the session default (one-time toast). User opencode.json and
      // pantheon.json overrides win over the default regardless of the provider probe.
      const providerOk = isProviderConfigured(config, DEFAULT_MODEL_PROVIDER)
      const overridePinned =
        userModels.has(SVAROG_AGENT_KEY) ||
        loadPantheonConfig().agents[SVAROG_AGENT_KEY]?.model !== undefined
      providerMissing = !providerOk && !overridePinned
      applyModelOverride(
        config,
        SVAROG_AGENT_KEY,
        SVAROG_AGENT_KEY,
        providerOk ? DEFAULT_SVAROG_MODEL : undefined,
        userModels,
      )
    },
    "tool.execute.before": hook,
    // NO tool.execute.after — Svarog gates invocation, it does not scrub results (same as Stribog).
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id
        if (typeof deletedID === "string" && deletedID.length > 0) {
          clearSession(deletedID) // drop the session's checkpoint-created marker
          forgetSessionAgent(deletedID) // evict the identity cache entry
        }
        return
      }
      if (event.type !== "session.created") return
      if (toastShown || !providerMissing) return
      const message =
        `Svarog's pinned default model (${DEFAULT_SVAROG_MODEL}) needs the "${DEFAULT_MODEL_PROVIDER}" provider, which is not configured — ` +
        `falling back to the session default. Set agents.svarog.model in pantheon.json to a model on your provider, or configure the provider.`
      try {
        console.error(`Pantheon: ${message}`)
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message },
        })
      } catch {
        // best-effort: headless / non-TUI invocations must not crash.
      }
      toastShown = true
    },
  }
}

export default AppVerkSvarogPlugin
