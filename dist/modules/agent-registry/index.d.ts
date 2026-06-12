import { SpecialistInfo } from './agent-metadata.js';
export { AgentCategory, AgentCost, AgentMode, AgentPromptMetadata, DelegationTrigger } from './agent-metadata.js';
export { PERUN_PLACEHOLDERS, PerunPromptOptions, buildDelegationTable, buildDispatchableAllowlistSentence, buildKeyTriggersSection, buildPerunPrompt, buildSpecialistsTable, buildUseAvoidSection, buildWorkflowContribution } from './perun-prompt-builder.js';

/**
 * Push one logical agent's metadata into the process-wide registry. Called once
 * per agent in its registering module's factory body (mirrors
 * `registerDispatchExtensions`). Throws on a CONFLICTING duplicate logical name
 * (same name, different metadata) — fail-fast at startup, mirroring the
 * `mergeTools` duplicate-tool throw in `src/index.ts`.
 *
 * Re-registering the SAME logical name with identical metadata is a no-op. The
 * factory bodies that call this run once per plugin construction, and a process
 * (or a test suite) may construct a factory more than once over its lifetime
 * (e.g. one OpenCode session per test). Idempotence on identical input keeps
 * that safe while still catching a genuine name collision between two distinct
 * agents — mirroring `registerDispatchExtensions`'s merge-don't-throw semantics
 * without silently shadowing a real conflict.
 *
 * Throws AFTER the registry has been snapshotted for Perun's prompt
 * (`snapshotAgentMetadataRegistry`). A late registration could never reach the
 * already-cached Perun prompt, so the agent would exist but be invisible to
 * routing — a silent failure. Failing loud here makes a mis-ordered
 * `defaultPluginFactories` (an agent-registering module placed AFTER
 * `AppVerkCoordinatorPlugin`) crash at startup instead of quietly dropping the
 * agent from Perun's view. Mirrors the conflicting-name throw above. NOTE:
 * re-registering IDENTICAL metadata after freeze is still allowed (returns
 * early below) — only a genuinely NEW or CONFLICTING entry is rejected.
 */
declare function registerAgentMetadata(info: SpecialistInfo): void;
/** Returns a name-sorted copy (deterministic order; callers cannot mutate state). */
declare function getAgentMetadataRegistry(): SpecialistInfo[];
/**
 * Returns a name-sorted copy AND freezes the registry against any subsequent
 * NEW registration. Called once by the coordinator when it builds (and caches)
 * Perun's prompt: the snapshot it returns is what Perun routes on for the rest
 * of the process. After this runs, a `registerAgentMetadata()` of a new agent
 * throws (see that function) rather than silently failing to reach the cached
 * prompt — enforcing the "register before the coordinator" ordering invariant
 * documented in AGENTS.md "Adding a New Plugin". Idempotent: calling it again
 * (the prompt is also cached, so this is not expected in practice) returns the
 * same snapshot and keeps the registry frozen.
 */
declare function snapshotAgentMetadataRegistry(): SpecialistInfo[];
/** Reset to empty AND un-freeze. Tests only — production code never clears. */
declare function clearAgentMetadataRegistry(): void;

export { SpecialistInfo, clearAgentMetadataRegistry, getAgentMetadataRegistry, registerAgentMetadata, snapshotAgentMetadataRegistry };
