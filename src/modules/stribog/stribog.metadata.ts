import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"
import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js"

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
export const STRIBOG_AGENT_KEY = "stribog" as const

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

/** Native opencode deny-map for `config.agent.stribog.tools`. NOTE: a live probe (2026-06-10)
 *  found `config.agent[x].tools` is INERT in opencode 1.15.10 — this map is declarative only;
 *  the tool-budget hook is the load-bearing enforcement. Kept so a future opencode fix yields
 *  free defense-in-depth, and to document intent (no execute_recipe → minter != actuator; no
 *  task → leaf). opencode is default-ALLOW, so denies are explicit opt-outs. */
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

/** Immutable deny — capability-aware, no config can re-enable. Named ids: minter + leaf-dispatch family.
 *  Invariant (locked by metadata.test.ts): IMMUTABLE_DENY_NAMED ⊆ keys(STRIBOG_DENIED_TOOLS). */
export const IMMUTABLE_DENY_NAMED: ReadonlySet<string> = new Set([
  "execute_recipe",
  "task", // opencode-native leaf dispatch; NOT in DISPATCH_TOOL_NAMES, so explicit
  ...DISPATCH_TOOL_NAMES,
])

/** Capability-class deny patterns (segment-anchored; matched against the normalized lowercase id).
 *  Prefix/server-key agnostic so serena_*, serena2_*, etc. are all covered. */
export const IMMUTABLE_DENY_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|_)execute_shell(_command)?$/i,
  /(^|_)shell(_command)?$/i,
  /(^|_)dispatch(_|$)/i,
  /(^|_)recipe(_|$)/i,
  /^task(_|$)/i,
  /(^|_)(write|create|replace|insert|rename|delete|move|edit)_/i,
  /_(memory|symbol|symbol_body|content|text_file)$/i,
]

/** True if a normalized (lowercase) tool id is immutably denied (named OR capability-class). */
export function isImmutableDeny(normalizedId: string): boolean {
  return (
    IMMUTABLE_DENY_NAMED.has(normalizedId) ||
    IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(normalizedId))
  )
}

/** Validate one extraTools entry. Returns {valid:true} or {valid:false,error}. */
export function validateExtraToolsPattern(
  pattern: string,
): { valid: true } | { valid: false; error: string } {
  if (!/^[a-z0-9_-]+\*?$/.test(pattern)) {
    return {
      valid: false,
      error: "must be lowercase alnum/_/-, optional single trailing *",
    }
  }
  if (pattern === "*") return { valid: false, error: "bare * not allowed" }
  if (IMMUTABLE_DENY_NAMED.has(pattern)) {
    return { valid: false, error: `exact denied id: ${pattern}` }
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    for (const deniedId of IMMUTABLE_DENY_NAMED) {
      if (deniedId.startsWith(prefix)) {
        return {
          valid: false,
          error: `glob ${pattern} would cover denied id ${deniedId}`,
        }
      }
    }
    if (IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(prefix))) {
      return {
        valid: false,
        error: `glob ${pattern} prefix matches a denied capability class`,
      }
    }
  }
  return { valid: true }
}

/** Match a validated pattern (glob or exact) against a normalized id. */
export function matchesExtraToolsPattern(
  pattern: string,
  normalizedId: string,
): boolean {
  return pattern.endsWith("*")
    ? normalizedId.startsWith(pattern.slice(0, -1))
    : normalizedId === pattern
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
