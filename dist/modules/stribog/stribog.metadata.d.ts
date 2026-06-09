import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
declare const STRIBOG_AGENT_KEY: "stribog";
/** Default model. Stribog is a doer, so it pins a Sonnet-class default (unlike
 *  Triglav, which inherits the session default). Overridable via
 *  `agents.stribog.model`. NOT a security control — see spec decision #7.
 *  Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts. */
declare const DEFAULT_STRIBOG_MODEL = "anthropic/claude-sonnet-4-6";
declare const STRIBOG_DESCRIPTION = "Light execution specialist: performs ONE small, mechanical task with real side effects \u2014 bring up/fix a service, restart, read logs, or a 1\u20132 file config/value change \u2014 then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor).";
declare const stribogSpecialistInfo: SpecialistInfo;

export { DEFAULT_STRIBOG_MODEL, STRIBOG_AGENT_KEY, STRIBOG_DESCRIPTION, stribogSpecialistInfo };
