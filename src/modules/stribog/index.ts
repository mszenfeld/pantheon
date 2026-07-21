import type { Plugin } from "@opencode-ai/plugin"
import {
  forgetSessionAgent,
  getSessionAgentCached,
} from "../_shared/session-identity.js"
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
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  STRIBOG_DENIED_TOOLS,
  stribogSpecialistInfo,
} from "./stribog.metadata.js"
import { buildStribogPrompt } from "./prompt.js"
import { makeStribogToolHook } from "./tool-budget-hook.js"

/** Provider id the pinned default needs (`opencode-go` for `opencode-go/kimi-k2.7-code`). */
const DEFAULT_MODEL_PROVIDER = providerIdOf(DEFAULT_STRIBOG_MODEL)

export const AppVerkStribogPlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(stribogSpecialistInfo)

  // The hook is the load-bearing enforcement (attribution via getSessionAgentCached,
  // which — unlike the dispatch-only SessionAgentRegistry — resolves direct/eval sessions too).
  // Edit-budget state is owned by this factory call's closure (see makeStribogToolHook,
  // mirroring BackgroundTaskStore) rather than a module-global.
  const extraTools =
    loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.extraTools ?? []
  // Entries are already lowercase (enforced by config validation); normalize defensively.
  const extraPatterns = extraTools.map((p) => p.toLowerCase())

  const { hook, clearSession } = makeStribogToolHook({
    resolveAgent: (sessionID) => getSessionAgentCached(sessionID, client),
    extraPatterns,
  })

  // One-time degraded-mode warning, mirroring the serena-gate pattern in
  // plan/explore: set in the `config` hook, surfaced once on `session.created`.
  let providerMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      // Capture the user's opencode.json `agent.<key>.model` BEFORE the
      // wholesale replace drops it, so applyModelOverride can keep it at the
      // top of the documented precedence chain (opencode.json > pantheon.json >
      // default). See docs/configuring-agents.md "Precedence vs. opencode.json".
      const userModels = captureUserModels(config, STRIBOG_AGENT_KEY)
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
          return buildStribogPrompt()
        },
      }
      // Stribog pins an explicit eval-picked default (`opencode-go/kimi-k2.7-code`)
      // — a cost-efficient doer — overridable via `agents.stribog.model`, and
      // a user's opencode.json `agent.stribog.model` overrides even that. The
      // shared helper resolves user > override > default per the documented
      // precedence and registers the `stribog` slug for typo detection. The
      // override is pre-validated by MODEL_REGEX (CWE-117) — see
      // src/modules/pantheon-config/schema.ts — so an invalid value is already
      // absent and falls through to the default.
      //
      // L3: that default needs the `opencode-go` provider. On an install where
      // opencode-go is absent, pinning it would yield a stribog whose dispatch
      // fails at model resolution. So we only pass the default when the provider
      // is configured; otherwise we pass
      // `undefined` and stribog inherits the session default (one-time toast
      // below documents the dependency). User opencode.json and pantheon.json
      // overrides take precedence over the default leg, so they still win even
      // when the provider probe trips — the gate only affects the fallback.
      const providerOk = isProviderConfigured(config, DEFAULT_MODEL_PROVIDER)
      // A user opencode.json model or a valid pantheon.json `agents.stribog.model`
      // override wins over the default regardless of the provider, so the degraded
      // fallback (and its toast) only applies when NEITHER is set. The pantheon
      // value is MODEL_REGEX-validated, so an invalid one is already absent here.
      const overridePinned =
        userModels.has(STRIBOG_AGENT_KEY) ||
        loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model !== undefined
      providerMissing = !providerOk && !overridePinned
      applyModelOverride(
        config,
        STRIBOG_AGENT_KEY,
        STRIBOG_AGENT_KEY,
        providerOk ? DEFAULT_STRIBOG_MODEL : undefined,
        userModels,
      )
    },
    "tool.execute.before": hook,
    // NO `tool.execute.after` — this is a DELIBERATE exclusion, not an oversight.
    // The hook above is an allow/deny gate on tool *invocation*; it does not (and
    // is not meant to) transform or scrub tool *results*. Stribog DB-tool results
    // (e.g. a granted `supabase_execute_sql`) are returned to model context
    // VERBATIM — only `zmora-*` results pass the QA stderr scrubber
    // (`scrubSecrets` in src/modules/qa/scrubber.ts), which protects zmora, not
    // stribog. The compensating control is therefore a read-restricted,
    // least-privilege DB role on the configured MCP connection — a REQUIRED
    // operator precondition, not optional hardening (spec §3.6 "Least-privilege
    // is a hard precondition"; see docs/light-execution.md "accepted trust
    // assumption"). A Stribog result-scrubber / column-denylist is a tracked,
    // forward-looking follow-up — intentionally out of scope here because a
    // half-complete scrubber on a security boundary is worse than a documented,
    // enforced-by-the-DB-role precondition.
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id
        if (typeof deletedID === "string" && deletedID.length > 0) {
          clearSession(deletedID)
          // Evict the shared session→agent identity cache too: `getSessionAgentCached`
          // above keeps one entry per resolved session forever otherwise (the module-level
          // map in skill-utils only grew before — no consumer freed it).
          forgetSessionAgent(deletedID)
        }
        return
      }
      if (event.type !== "session.created") return
      if (toastShown || !providerMissing) return
      const message =
        `Stribog's pinned default model (${DEFAULT_STRIBOG_MODEL}) needs the "${DEFAULT_MODEL_PROVIDER}" provider, which is not configured — ` +
        `falling back to the session default. Set agents.stribog.model in pantheon.json to a model on your provider, or configure the provider.`
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

export default AppVerkStribogPlugin
