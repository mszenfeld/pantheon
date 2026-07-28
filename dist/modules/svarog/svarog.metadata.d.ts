import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/** Canonical agent key — centralised so the literal "svarog" is not duplicated
 *  across registration, config injection, tests, and docs. */
declare const SVAROG_AGENT_KEY: "svarog";
/** Pinned default — retained by the Svarog model eval (docs/eval/scenarios/svarog/): on
 *  `openai/gpt-5.5` it cleared all 5 execution scenarios at high quality (loads the TDD skill,
 *  serena diagnostics, build+test green, minimal idiomatic diffs) and never minted or wrote a
 *  real secret value; the residual gaps are escalate-first posture + one soft test-fixture dummy.
 *  Svarog's role (a leaf executor running a vetted plan) weights execution above refusal
 *  discipline, so that residual does not disqualify a 5/5 executor — but a non-openai comparison
 *  point is not yet captured (Layer-2 A/B pending). A heavy in-tree editor must not run on a weak
 *  model. Provider-gated on `openai` with a session-default fallback + one-time toast (see
 *  index.ts). Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts. NOT a security control. */
declare const DEFAULT_SVAROG_MODEL = "openai/gpt-5.5";
declare const SVAROG_DESCRIPTION = "Heavy/main code executor: implements a multi-file feature or refactor from a plan or task \u2014 writes code test-first, runs the full suite/build, and returns a verified diff with a recoverable checkpoint. Finishes at READY; commits only via the sanctioned av_commit tool (never bash git commit). NOT for trivial 1-2 file mechanical changes (use stribog), secrets (use zmora-setup), or work needing an unsettled design decision (plan with veles).";
/** Serena single-file + cross-file EDITORS Svarog may use (suffix-matched, server-prefix
 *  agnostic). The tool hook ALLOWS these via a carve-out BEFORE the reused isImmutableDeny
 *  floor — which would otherwise deny them via its mutation-verb / `_symbol`/`_content`/
 *  `_text_file` patterns. Deliberately EXCLUDES `write_memory`/`delete_memory` (serena memory
 *  writes stay denied) and `execute_shell_command` (shell escape stays denied). */
declare const SVAROG_SERENA_EDITORS: RegExp;
/** Native opencode deny-map for `config.agent.svarog.tools`. DEFAULT-ALLOW on opencode 1.17.3
 *  (so this only bites as an explicit deny; the tool hook is the load-bearing boundary). Kept
 *  as declared defense-in-depth + intent: no execute_recipe (minter != actuator), no
 *  task/dispatch (leaf), no question (headless -> ESCALATE), no webfetch/websearch (a leaf
 *  in-tree executor has no business reaching the network — Stribog denies these too; without it
 *  an action-biased model + an injected source file has a native exfil channel the floor never
 *  sees). `todowrite` is deliberately NOT denied — Svarog's heavy multi-step work benefits from a
 *  task list (Stribog's 1-2 file scope does not, so it denies it). */
declare const SVAROG_DENIED_TOOLS: Readonly<Record<string, false>>;
declare const svarogSpecialistInfo: SpecialistInfo;

export { DEFAULT_SVAROG_MODEL, SVAROG_AGENT_KEY, SVAROG_DENIED_TOOLS, SVAROG_DESCRIPTION, SVAROG_SERENA_EDITORS, svarogSpecialistInfo };
