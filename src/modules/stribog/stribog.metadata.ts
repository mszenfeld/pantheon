import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
export const STRIBOG_AGENT_KEY = "stribog" as const

/** Default model. Stribog is a doer, so it pins a Sonnet-class default (unlike
 *  Triglav, which inherits the session default). Overridable via
 *  `agents.stribog.model`. NOT a security control — see spec decision #7.
 *  Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts. */
export const DEFAULT_STRIBOG_MODEL = "anthropic/claude-sonnet-4-6"

export const STRIBOG_DESCRIPTION =
  "Light execution specialist: performs ONE small, mechanical task with real side effects — bring up/fix a service, restart, read logs, or a 1–2 file config/value change — then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor)."

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
