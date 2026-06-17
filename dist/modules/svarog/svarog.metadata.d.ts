import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/** Canonical agent key — centralised so the literal "svarog" is not duplicated
 *  across registration, config injection, tests, and docs. */
declare const SVAROG_AGENT_KEY: "svarog";
/** Pinned default — the strongest GPT tier on the OpenAI subscription (a heavy executor doing
 *  broad in-tree edits must not run on a weak model). `openai/gpt-5.5` is the top standard GPT
 *  SKU on the subscription (the `-pro` tier needs higher access; `-fast`/`-mini` are weaker).
 *  Provider-gated on `openai` with a session-default fallback + one-time toast (see index.ts);
 *  the Svarog eval may still refine the tier. Must satisfy MODEL_REGEX in
 *  src/modules/pantheon-config/schema.ts. NOT a security control. */
declare const DEFAULT_SVAROG_MODEL = "openai/gpt-5.5";
declare const SVAROG_DESCRIPTION = "Heavy/main code executor: implements a multi-file feature or refactor from a plan or task \u2014 writes code test-first, runs the full suite/build, and returns a verified diff with a recoverable checkpoint. Stops at READY (does not commit). NOT for trivial 1-2 file mechanical changes (use stribog), secrets (use zmora-setup), or work needing an unsettled design decision (plan with veles).";
/** Serena single-file + cross-file EDITORS Svarog may use (suffix-matched, server-prefix
 *  agnostic). The tool hook ALLOWS these via a carve-out BEFORE the reused isImmutableDeny
 *  floor — which would otherwise deny them via its mutation-verb / `_symbol`/`_content`/
 *  `_text_file` patterns. Deliberately EXCLUDES `write_memory`/`delete_memory` (serena memory
 *  writes stay denied) and `execute_shell_command` (shell escape stays denied). */
declare const SVAROG_SERENA_EDITORS: RegExp;
/** Native opencode deny-map for `config.agent.svarog.tools`. DEFAULT-ALLOW on opencode 1.17.3
 *  (so this only bites as an explicit deny; the tool hook is the load-bearing boundary). Kept
 *  as declared defense-in-depth + intent: no execute_recipe (minter != actuator), no
 *  task/dispatch (leaf), no question (headless -> ESCALATE). */
declare const SVAROG_DENIED_TOOLS: Readonly<Record<string, false>>;
declare const svarogSpecialistInfo: SpecialistInfo;

export { DEFAULT_SVAROG_MODEL, SVAROG_AGENT_KEY, SVAROG_DENIED_TOOLS, SVAROG_DESCRIPTION, SVAROG_SERENA_EDITORS, svarogSpecialistInfo };
