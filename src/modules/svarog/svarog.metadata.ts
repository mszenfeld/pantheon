import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/** Canonical agent key — centralised so the literal "svarog" is not duplicated
 *  across registration, config injection, tests, and docs. */
export const SVAROG_AGENT_KEY = "svarog" as const

/** Pinned default — retained by the Svarog model eval (docs/eval/scenarios/svarog/): on
 *  `openai/gpt-5.5` it cleared all 5 execution scenarios at high quality (loads the TDD skill,
 *  serena diagnostics, build+test green, minimal idiomatic diffs) and never minted or wrote a
 *  real secret value; the residual gaps are escalate-first posture + one soft test-fixture dummy.
 *  Svarog's role (a leaf executor running a vetted plan) weights execution above refusal
 *  discipline, so that residual does not disqualify a 5/5 executor — but a non-openai comparison
 *  point is not yet captured (Layer-2 A/B pending). A heavy in-tree editor must not run on a weak
 *  model. Provider-gated on `openai` with a session-default fallback + one-time toast (see
 *  index.ts). Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts. NOT a security control. */
export const DEFAULT_SVAROG_MODEL = "openai/gpt-5.5"

export const SVAROG_DESCRIPTION =
  "Heavy/main code executor: implements a multi-file feature or refactor from a plan or task — writes code test-first, runs the full suite/build, and returns a verified diff with a recoverable checkpoint. Finishes at READY; commits only via the sanctioned av_commit tool (never bash git commit). NOT for trivial 1-2 file mechanical changes (use stribog), secrets (use zmora-setup), or work needing an unsettled design decision (plan with veles)."

/** Serena single-file + cross-file EDITORS Svarog may use (suffix-matched, server-prefix
 *  agnostic). The tool hook ALLOWS these via a carve-out BEFORE the reused isImmutableDeny
 *  floor — which would otherwise deny them via its mutation-verb / `_symbol`/`_content`/
 *  `_text_file` patterns. Deliberately EXCLUDES `write_memory`/`delete_memory` (serena memory
 *  writes stay denied) and `execute_shell_command` (shell escape stays denied). */
export const SVAROG_SERENA_EDITORS =
  /(create_text_file|replace_content|replace_regex|replace_symbol_body|insert_(after|before)_symbol|rename_symbol|safe_delete_symbol)$/

/** Native opencode deny-map for `config.agent.svarog.tools`. DEFAULT-ALLOW on opencode 1.17.3
 *  (so this only bites as an explicit deny; the tool hook is the load-bearing boundary). Kept
 *  as declared defense-in-depth + intent: no execute_recipe (minter != actuator), no
 *  task/dispatch (leaf), no question (headless -> ESCALATE), no webfetch/websearch (a leaf
 *  in-tree executor has no business reaching the network — Stribog denies these too; without it
 *  an action-biased model + an injected source file has a native exfil channel the floor never
 *  sees). `todowrite` is deliberately NOT denied — Svarog's heavy multi-step work benefits from a
 *  task list (Stribog's 1-2 file scope does not, so it denies it). */
export const SVAROG_DENIED_TOOLS: Readonly<Record<string, false>> = {
  task: false,
  execute_recipe: false,
  dispatch_parallel: false,
  dispatch_background: false,
  poll_background: false,
  wait_background: false,
  question: false,
  webfetch: false,
  websearch: false,
}

export const svarogSpecialistInfo: SpecialistInfo = {
  name: SVAROG_AGENT_KEY,
  mode: "subagent",
  description: SVAROG_DESCRIPTION,
  metadata: {
    keyTrigger:
      "A multi-file feature/refactor to implement from a plan -> dispatch `svarog`",
    useWhen: [
      "Implement a planned feature across multiple files (write code, run the full test suite)",
      "Carry out a multi-file or cross-symbol refactor that is already designed",
      "Apply a Veles plan end-to-end and return a verified diff",
    ],
    avoidWhen: [
      "A trivial 1-2 file mechanical change or environment bring-up (use stribog)",
      "Producing or refreshing a secret/credential value (use zmora-setup)",
      "The design/approach is unsettled or ambiguous (plan with veles first)",
    ],
    triggers: [
      {
        domain: "Feature implementation",
        trigger:
          "Build a planned multi-file feature, verify with the full suite, return a diff",
      },
      {
        domain: "Refactor",
        trigger:
          "Carry out a designed multi-file / cross-symbol refactor and verify it",
      },
    ],
    workflowContribution:
      "For multi-file feature/refactor work that needs the full toolset (edit many files, run the suite), dispatch `svarog` (the heavy/main executor). For a trivial 1-2 file mechanical change or environment bring-up, use `stribog`; if the design is unsettled, plan with `veles` first. Svarog finishes at READY with a verified diff; commits go only through the sanctioned `av_commit` tool (executor publish chain create_branch -> av_commit -> create_pr; 2026-07-22 decision), never bash `git commit` -- review the diff, then commit via `av_commit` or `/commit`.",
  },
}
