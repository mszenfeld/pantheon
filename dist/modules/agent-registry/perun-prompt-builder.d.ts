import { SpecialistInfo } from './agent-metadata.js';

declare const PERUN_PLACEHOLDERS: readonly ["SPECIALISTS_TABLE", "KEY_TRIGGERS", "DELEGATION_TABLE", "DISPATCHABLE_ALLOWLIST"];
/**
 * Caller-supplied values that `buildPerunPrompt` cannot derive from the
 * specialist registry alone. `dispatchableAllowlist` is the set of `mode: "all"`
 * agent names Perun may dispatch — it lives in `coordinator/dispatch.ts`
 * (`DISPATCHABLE_ALL_AGENTS`) which is downstream of this library, so it is
 * threaded in at render time rather than imported (which would invert the
 * `coordinator → agent-registry` layering). When omitted, the
 * `{DISPATCHABLE_ALLOWLIST}` placeholder renders to "" like any empty section.
 */
interface PerunPromptOptions {
    dispatchableAllowlist?: readonly string[];
}
/**
 * Render the single sentence that names the Perun-dispatchable `mode: "all"`
 * allowlist, derived from the live constant rather than hand-written in prose.
 * The constant currently holds exactly one entry (the Veles planner); the
 * grammar adapts if it ever holds zero or several. Used both for Perun's prompt
 * (the `{DISPATCHABLE_ALLOWLIST}` placeholder) and — via the same exported
 * helper — for the coordinator's dispatch-tool descriptions, so the allowlist
 * is stated in exactly one place. Each name is rendered verbatim inside
 * backticks so a test can assert the constant appears literally in the render.
 */
declare function buildDispatchableAllowlistSentence(allowlist: readonly string[]): string;
declare function buildSpecialistsTable(registry: SpecialistInfo[]): string;
declare function buildKeyTriggersSection(registry: SpecialistInfo[]): string;
declare function buildDelegationTable(registry: SpecialistInfo[]): string;
declare function buildUseAvoidSection(agentName: string, registry: SpecialistInfo[]): string;
/**
 * Render an agent's free-form `workflowContribution` block (the `{WORKFLOW:<name>}`
 * placeholder). Throws on an unknown target — mirrors `buildUseAvoidSection`, so a
 * placeholder naming a non-registered agent fails loudly at render time rather than
 * leaving a stray token. An agent without a contribution renders to "".
 */
declare function buildWorkflowContribution(agentName: string, registry: SpecialistInfo[]): string;
declare function buildPerunPrompt(template: string, registry: SpecialistInfo[], options?: PerunPromptOptions): string;

export { PERUN_PLACEHOLDERS, type PerunPromptOptions, buildDelegationTable, buildDispatchableAllowlistSentence, buildKeyTriggersSection, buildPerunPrompt, buildSpecialistsTable, buildUseAvoidSection, buildWorkflowContribution };
