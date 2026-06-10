import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
export const STRIBOG_AGENT_KEY = "stribog" as const

/** Default model. Stribog is a doer, so it pins an explicit default (unlike
 *  Triglav, which inherits the session default). `openai/gpt-5.4` won the
 *  2026-06-10 four-round eval (docs/eval/scenarios/stribog/): the cheapest model
 *  passing all three discipline gates (scope/secret/liveness) natively. Overridable
 *  via `agents.stribog.model`. NOT a security control — see spec decision #7.
 *  Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts. */
export const DEFAULT_STRIBOG_MODEL = "openai/gpt-5.4"

export const STRIBOG_DESCRIPTION =
  "Light execution specialist: performs ONE small, mechanical task with real side effects — bring up/fix a service, restart, read logs, or a 1–2 file config/value change — then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor). EXPERIMENTAL (Phase 1): no automatic edit-recovery yet — a botched edit cannot be auto-restored."

/** Hard cap on the number of distinct files Stribog may modify (Edit/Write) per task.
 *  Enforced structurally by the tool-budget hook — see tool-budget-hook.ts. */
export const STRIBOG_EDIT_BUDGET = 2

/** Lowercase RUNTIME tool ids the hook permits. These are the names opencode passes to
 *  `tool.execute.before` (NOT the `Edit`/`Write` display casing of STRIBOG_TOOLS). Anything
 *  outside this set is refused for a stribog session, making the allow-list a real boundary. */
export const STRIBOG_ALLOWED_TOOL_IDS: ReadonlySet<string> = new Set([
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
  todowrite: false,
  webfetch: false,
  websearch: false,
}

export const stribogSpecialistInfo: SpecialistInfo = {
  name: STRIBOG_AGENT_KEY,
  mode: "subagent",
  description: STRIBOG_DESCRIPTION,
  metadata: {
    category: "specialist",
    cost: "CHEAP",
    keyTrigger: "Environment down, or a tiny mechanical change needed → dispatch `stribog`",
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
        trigger: "Bring up, restart, or fix a service/environment so QA can run against it",
      },
      {
        domain: "Small mechanical change",
        trigger: "Apply a narrow, deterministic edit (config field/value) and verify it",
      },
    ],
  },
}
