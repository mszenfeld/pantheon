const STRIBOG_AGENT_KEY = "stribog";
const DEFAULT_STRIBOG_MODEL = "anthropic/claude-sonnet-4-6";
const STRIBOG_DESCRIPTION = "Light execution specialist: performs ONE small, mechanical task with real side effects \u2014 bring up/fix a service, restart, read logs, or a 1\u20132 file config/value change \u2014 then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor).";
const stribogSpecialistInfo = {
  name: STRIBOG_AGENT_KEY,
  mode: "subagent",
  description: STRIBOG_DESCRIPTION,
  metadata: {
    category: "specialist",
    cost: "CHEAP",
    keyTrigger: "Environment down, or a tiny mechanical change needed \u2192 dispatch `stribog`",
    useWhen: [
      "Bring up / fix a downed environment for QA (docker compose / make / start a service)",
      "A small mechanical change (add a config field, change a value)",
      "Light debugging (read logs, restart, diagnose)"
    ],
    avoidWhen: [
      "Producing or refreshing a secret/credential value (use zmora-setup)",
      "Feature development or any multi-file / architectural change (main executor)",
      "Anything requiring a design decision"
    ],
    triggers: [
      {
        domain: "Environment ops",
        trigger: "Bring up, restart, or fix a service/environment so QA can run against it"
      },
      {
        domain: "Small mechanical change",
        trigger: "Apply a narrow, deterministic edit (config field/value) and verify it"
      }
    ]
  }
};
export {
  DEFAULT_STRIBOG_MODEL,
  STRIBOG_AGENT_KEY,
  STRIBOG_DESCRIPTION,
  stribogSpecialistInfo
};
