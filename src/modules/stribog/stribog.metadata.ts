import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"
// The extraTools / immutable-deny CONTRACT lives in a neutral shared leaf
// (`_shared/stribog-extra-tools-contract.ts`) so the pure config layer can depend
// on it without importing this feature module (ARCH-001 — inverted DIP). We
// re-export every contract symbol below so existing consumers keep importing them
// from `stribog.metadata.js` unchanged; `STRIBOG_AGENT_KEY` is also imported into
// local scope because `stribogSpecialistInfo` references it directly (a re-exported
// binding is not in local scope).
import { STRIBOG_AGENT_KEY } from "../_shared/stribog-extra-tools-contract.js"
export {
  STRIBOG_AGENT_KEY,
  IMMUTABLE_DENY_NAMED,
  IMMUTABLE_DENY_PATTERNS,
  isImmutableDeny,
  validateExtraToolsPattern,
  matchesExtraToolsPattern,
} from "../_shared/stribog-extra-tools-contract.js"

/** Default model. Stribog is a doer, so it pins an explicit default (unlike
 *  Triglav, which inherits the session default). `openai/gpt-5.4` won the
 *  2026-06-10 four-round eval (docs/eval/scenarios/stribog/): the cheapest model
 *  passing all three discipline gates (scope/secret/liveness) natively. Overridable
 *  via `agents.stribog.model`. NOT a security control — see spec decision #7.
 *  Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts.
 *
 *  L3: this default needs the `openai` provider. The plugin's config hook probes
 *  it (see index.ts / _shared/provider-detect.ts) and, when OpenAI is absent on a
 *  fresh non-OpenAI install, falls back to the session default instead of pinning
 *  an unresolvable model (plus a one-time toast). The provider id is derived from
 *  this string, so keep it in `provider/model` form. */
export const DEFAULT_STRIBOG_MODEL = "openai/gpt-5.4"

export const STRIBOG_DESCRIPTION =
  "Light execution specialist: performs ONE small, mechanical task with real side effects — bring up/fix a service, restart, read logs, or a 1–2 file config/value change — then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor). EXPERIMENTAL (Phase 1): no automatic edit-recovery yet — a botched edit cannot be auto-restored."

/** Hard cap on the number of distinct files Stribog may modify (Edit/Write) per task.
 *  Enforced structurally by the tool-budget hook — see tool-budget-hook.ts. */
export const STRIBOG_EDIT_BUDGET = 2

/** Lowercase RUNTIME tool ids forming the CORE BUILTINS — the static boundary. These are the
 *  names opencode passes to `tool.execute.before` (NOT the `Edit`/`Write` display casing of
 *  STRIBOG_TOOLS). extraTools is a SEPARATE dynamic source layered on top by the hook (see
 *  tool-budget-hook.ts); this set is the always-on floor and never includes config-granted ids. */
export const CORE_BUILTINS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "bash",
])

/** Native opencode deny-map for `config.agent.stribog.tools`. NOTE: a binary check on opencode
 *  1.17.3 found `config.agent[x].tools` is honored but DEFAULT-ALLOW (a tool absent from the map
 *  still executes) — so this map only bites as an explicit deny, and the tool-budget hook remains
 *  the load-bearing enforcement. Kept as declared defense-in-depth and to document intent
 *  (no execute_recipe → minter != actuator; no task/dispatch → leaf). */
export const STRIBOG_DENIED_TOOLS: Readonly<Record<string, false>> = {
  task: false,
  execute_recipe: false,
  dispatch_parallel: false,
  dispatch_background: false,
  poll_background: false,
  wait_background: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
}

export const stribogSpecialistInfo: SpecialistInfo = {
  name: STRIBOG_AGENT_KEY,
  mode: "subagent",
  description: STRIBOG_DESCRIPTION,
  metadata: {
    keyTrigger:
      "Environment down, or a tiny mechanical change needed → dispatch `stribog`",
    useWhen: [
      "Bring up / fix a downed environment for QA (docker compose / make / start a service)",
      "A small mechanical change (add a config field, change a value)",
      "Light debugging (read logs, restart, diagnose)",
    ],
    avoidWhen: [
      "Producing or refreshing a secret/credential value (use zmora-setup)",
      "Feature development or any multi-file / architectural change (main executor)",
      "Anything requiring a design decision",
    ],
    triggers: [
      {
        domain: "Environment ops",
        trigger:
          "Bring up, restart, or fix a service/environment so QA can run against it",
      },
      {
        domain: "Small mechanical change",
        trigger:
          "Apply a narrow, deterministic edit (config field/value) and verify it",
      },
    ],
  },
}
