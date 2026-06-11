type AgentCategory = "exploration" | "specialist" | "advisor" | "utility";
type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE";
type AgentMode = "subagent" | "primary" | "all";
interface DelegationTrigger {
    domain: string;
    trigger: string;
}
interface AgentPromptMetadata {
    /**
     * Coarse omo-derived routing taxonomy. CURRENTLY UNRENDERED — no
     * `buildPerunPrompt` section reads it, so it never reaches Perun's prompt.
     * Optional (not required) so callers are not forced to author a value that
     * the renderer would silently drop; populate it only once a renderer that
     * consumes it exists. See the `cost` note below.
     */
    category?: AgentCategory;
    /**
     * Coarse model-tier hint (FREE/CHEAP/EXPENSIVE) carried over from omo.
     * CURRENTLY UNRENDERED — Perun's effective model is chosen via `pantheon.json`
     * (see docs/configuring-agents.md), NOT from this field, and no specialist-table
     * column reads it. Kept optional and unset rather than required-and-dead so it
     * does not advertise a routing signal Perun never sees. Re-introduce a value
     * (and a `| Cost |` column in `buildSpecialistsTable`) together if cost ever
     * becomes genuinely routing-relevant.
     */
    cost?: AgentCost;
    keyTrigger?: string;
    useWhen?: string[];
    avoidWhen?: string[];
    triggers: DelegationTrigger[];
    /**
     * CURRENTLY UNRENDERED and never populated by any agent — reserved for a future
     * renderer that maps a registered agent name to an alternate prompt alias. Kept
     * optional so it is an honest "not yet wired" slot rather than a dead required field.
     */
    promptAlias?: string;
    /**
     * Optional per-agent workflow prose injected into Perun's prompt via the
     * `{WORKFLOW:<name>}` placeholder. This generalizes the per-agent `USE_AVOID`
     * slot: where `useWhen`/`avoidWhen` render a fixed two-list shape, this is a
     * free-form markdown block an agent contributes verbatim (e.g. routing rules,
     * dispatch nuances) so adding a specialist that needs bespoke coordinator
     * guidance is a metadata edit rather than a hand-edit of the monolithic
     * `perun.md`. Each line is rendered as-is; absent ⇒ the placeholder renders to
     * "" like any empty section. Most agents leave this unset.
     */
    workflowContribution?: string;
}
/** Pantheon-specific wrapper. `name`/`mode`/`description` are known where the
 *  agent is registered; `metadata` carries the omo-derived routing fields. */
interface SpecialistInfo {
    name: string;
    mode: AgentMode;
    description: string;
    metadata: AgentPromptMetadata;
}

export type { AgentCategory, AgentCost, AgentMode, AgentPromptMetadata, DelegationTrigger, SpecialistInfo };
