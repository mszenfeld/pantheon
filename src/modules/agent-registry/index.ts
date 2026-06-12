import type { SpecialistInfo } from "./agent-metadata.js"

export * from "./agent-metadata.js"
export {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildDispatchableAllowlistSentence,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
  buildWorkflowContribution,
  type PerunPromptOptions,
} from "./perun-prompt-builder.js"

const registry: SpecialistInfo[] = []

// Flipped true the first time `snapshotAgentMetadataRegistry()` runs (the
// coordinator building Perun's prompt). Once frozen the registry is the
// permanent source of truth for Perun's routing — a LATE `registerAgentMetadata`
// would silently never reach the already-cached prompt, so we fail-fast instead.
let frozen = false

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
export function registerAgentMetadata(info: SpecialistInfo): void {
  const existing = registry.find((a) => a.name === info.name)
  if (existing === undefined && frozen) {
    throw new Error(
      `Late agent registration after Perun prompt snapshot: ${info.name}. ` +
        `Every agent-registering module must appear BEFORE AppVerkCoordinatorPlugin ` +
        `in defaultPluginFactories (src/index.ts) so it is in the registry when ` +
        `getPerunPrompt() snapshots it.`,
    )
  }
  if (existing !== undefined) {
    // Idempotence check via JSON.stringify is intentionally a serialized-form
    // comparison, NOT structural equality: it is sensitive to object key order
    // and to present-as-`undefined` fields. This is safe because every call
    // site passes a canonical module-level `SpecialistInfo` literal with a
    // stable key order. A dynamically-constructed metadata object (e.g. built
    // via spread + conditional fields, or with fields in a different
    // declaration order) could serialize differently and falsely trip the
    // `Duplicate agent metadata` throw below — if such call sites are ever
    // added, switch this to an order-insensitive comparison.
    if (JSON.stringify(existing) === JSON.stringify(info)) return
    throw new Error(`Duplicate agent metadata: ${info.name}`)
  }
  registry.push(info)
}

/** Returns a name-sorted copy (deterministic order; callers cannot mutate state). */
export function getAgentMetadataRegistry(): SpecialistInfo[] {
  return [...registry].sort((a, b) => a.name.localeCompare(b.name))
}

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
export function snapshotAgentMetadataRegistry(): SpecialistInfo[] {
  frozen = true
  return getAgentMetadataRegistry()
}

/** Reset to empty AND un-freeze. Tests only — production code never clears. */
export function clearAgentMetadataRegistry(): void {
  registry.length = 0
  frozen = false
}
