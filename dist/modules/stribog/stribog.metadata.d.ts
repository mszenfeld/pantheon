import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
declare const STRIBOG_AGENT_KEY: "stribog";
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
declare const DEFAULT_STRIBOG_MODEL = "openai/gpt-5.4";
declare const STRIBOG_DESCRIPTION = "Light execution specialist: performs ONE small, mechanical task with real side effects \u2014 bring up/fix a service, restart, read logs, or a 1\u20132 file config/value change \u2014 then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor). EXPERIMENTAL (Phase 1): no automatic edit-recovery yet \u2014 a botched edit cannot be auto-restored.";
/** Hard cap on the number of distinct files Stribog may modify (Edit/Write) per task.
 *  Enforced structurally by the tool-budget hook — see tool-budget-hook.ts. */
declare const STRIBOG_EDIT_BUDGET = 2;
/** Lowercase RUNTIME tool ids the hook permits. These are the names opencode passes to
 *  `tool.execute.before` (NOT the `Edit`/`Write` display casing of STRIBOG_TOOLS). Anything
 *  outside this set is refused for a stribog session, making the allow-list a real boundary. */
declare const STRIBOG_ALLOWED_TOOL_IDS: ReadonlySet<string>;
/** Native opencode deny-map for `config.agent.stribog.tools`. NOTE: a live probe (2026-06-10)
 *  found `config.agent[x].tools` is INERT in opencode 1.15.10 — this map is declarative only;
 *  the tool-budget hook is the load-bearing enforcement. Kept so a future opencode fix yields
 *  free defense-in-depth, and to document intent (no execute_recipe → minter != actuator; no
 *  task → leaf). opencode is default-ALLOW, so denies are explicit opt-outs. */
declare const STRIBOG_DENIED_TOOLS: Readonly<Record<string, false>>;
declare const stribogSpecialistInfo: SpecialistInfo;

export { DEFAULT_STRIBOG_MODEL, STRIBOG_AGENT_KEY, STRIBOG_ALLOWED_TOOL_IDS, STRIBOG_DENIED_TOOLS, STRIBOG_DESCRIPTION, STRIBOG_EDIT_BUDGET, stribogSpecialistInfo };
