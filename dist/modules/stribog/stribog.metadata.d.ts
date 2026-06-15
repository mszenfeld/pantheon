import { SpecialistInfo } from '../agent-registry/agent-metadata.js';
export { IMMUTABLE_DENY_NAMED, IMMUTABLE_DENY_PATTERNS, STRIBOG_AGENT_KEY, isImmutableDeny, matchesExtraToolsPattern, validateExtraToolsPattern } from '../_shared/stribog-extra-tools-contract.js';

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
/** Lowercase RUNTIME tool ids forming the CORE BUILTINS — the static boundary. These are the
 *  names opencode passes to `tool.execute.before` (NOT the `Edit`/`Write` display casing of
 *  STRIBOG_TOOLS). extraTools is a SEPARATE dynamic source layered on top by the hook (see
 *  tool-budget-hook.ts); this set is the always-on floor and never includes config-granted ids. */
declare const CORE_BUILTINS: ReadonlySet<string>;
/** Native opencode deny-map for `config.agent.stribog.tools`. NOTE: a binary check on opencode
 *  1.17.3 found `config.agent[x].tools` is honored but DEFAULT-ALLOW (a tool absent from the map
 *  still executes) — so this map only bites as an explicit deny, and the tool-budget hook remains
 *  the load-bearing enforcement. Kept as declared defense-in-depth and to document intent
 *  (no execute_recipe → minter != actuator; no task/dispatch → leaf). */
declare const STRIBOG_DENIED_TOOLS: Readonly<Record<string, false>>;
declare const stribogSpecialistInfo: SpecialistInfo;

export { CORE_BUILTINS, DEFAULT_STRIBOG_MODEL, STRIBOG_DENIED_TOOLS, STRIBOG_DESCRIPTION, STRIBOG_EDIT_BUDGET, stribogSpecialistInfo };
