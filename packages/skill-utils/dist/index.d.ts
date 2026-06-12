import { PluginInput, Plugin } from '@opencode-ai/plugin';

/**
 * Canonical Category → Prefix mapping for the code-review and QA plugin ecosystem.
 *
 * This is the single source of truth for issue prefixes. Both the code-review
 * plugin (`/review`, `/fix`) and the QA plugin (`/qa:run`) must stay in sync
 * with this table.
 *
 * - **Owned by:** code-review plugin (defines categories and prefixes)
 * - **Consumed by:** QA plugin (produces QA-XXX issues with Category: Testing)
 *
 * When adding a new category or prefix, update this mapping and then regenerate
 * the built assets in both plugins.
 */
declare const CATEGORY_PREFIX_MAPPING: Readonly<Record<string, string>>;
/** Valid issue prefixes derived from the canonical mapping. */
declare const VALID_PREFIXES: string[];
/** Valid categories derived from the canonical mapping. */
declare const VALID_CATEGORIES: string[];

type Client = PluginInput["client"];
/**
 * The agent identifier the coordinator (Perun) session runs under.
 * Pinned in Task 1b to the observed `UserMessage.info.agent` value and kept in
 * sync with the `config.agent[...]` key in src/modules/coordinator/index.ts via
 * the sync test in Task 7.
 */
declare const COORDINATOR_AGENT_NAME = "Perun - Coordinator";
/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
declare function getSessionAgent(sessionID: string, client: Client): Promise<string | undefined>;
/**
 * Memoized variant of {@link getSessionAgent}, shared by all consumers (the bash gate
 * and the skill-registry transform) so the underlying transcript fetch happens at most
 * once per session.
 *
 * IMPORTANT: only RESOLVED (non-undefined) identities are cached forever. On the
 * coordinator's very first turn `getSessionAgent` may be unresolvable (messages not yet
 * queryable); caching that miss permanently would freeze the turn-1 unresolved window and
 * the identity could never resolve later. So a miss is never cached forever — instead:
 *
 *  - concurrent resolves of the same session coalesce into ONE transcript fetch
 *    (promise-dedup, the `loadAgentRegistry` pattern); and
 *  - after {@link NEGATIVE_CACHE_AFTER_MISSES} consecutive misses a session is
 *    negatively cached for {@link NEGATIVE_CACHE_TTL_MS}, so an unresolved identity no
 *    longer triggers a full-transcript fetch on EVERY call (previously quadratic over the
 *    life of a never-resolving session). The short TTL lets a late-resolving session
 *    re-attempt within seconds.
 */
declare function getSessionAgentCached(sessionID: string, client: Client): Promise<string | undefined>;
/**
 * Evict ALL per-session identity bookkeeping for `sessionID`. Call this from a
 * consumer's `session.deleted` handler so the module-level maps do not grow
 * unbounded over a long-lived process (one entry per session, plus one per
 * dispatch-child, retained forever otherwise — mirrors the per-session eviction
 * every other store in the repo already does: qa's `BindingsStore.purgeParent`,
 * stribog's edit-budget `clearSession`, the coordinator's `BackgroundTaskStore`).
 *
 * Clears every map that {@link getSessionAgentCached} populates for a session —
 * the resolved-identity cache AND the negative-cache bookkeeping (the in-flight
 * coalescing promise, the consecutive-miss counter, and the negative-cache TTL).
 * A deleted session id is never reused, so dropping a still-in-flight coalescing
 * entry is safe: any awaiter already holds the promise; only the map slot is freed.
 *
 * Idempotent and safe to call for an id that was never cached (every `delete` is
 * a no-op on an absent key).
 */
declare function forgetSessionAgent(sessionID: string): void;
/**
 * True only when the session is positively identified as the coordinator.
 *
 * Resolves identity through the memoized {@link getSessionAgentCached}, so the shared
 * production call sites (the per-bash-call gate and the per-turn skill-registry
 * transform) can route through this predicate without reintroducing a full-transcript
 * fetch on every invocation.
 */
declare function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean>;

/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
declare function parseAllowedBashPrograms(frontmatter: string): string[];
/**
 * True when the command contains a compound separator/operator/redirect or a
 * shell wrapper (the same forms `classifyCoordinatorBash` rejects without a
 * single resolvable program token). Shared so the rejection classifier and the
 * violation-error subject agree on what "compound" means.
 */
declare function isCompoundCommand(command: string): boolean;
interface BashClassification {
    allowed: boolean;
    program: string | null;
}
/**
 * Decide whether a coordinator bash command is permitted (allowlist + no compounds).
 *
 * This allowlist is a workflow rail, NOT a security boundary. It is
 * defense-in-depth that keeps the coordinator on its intended path (dispatch
 * agents rather than inspect the repo directly) and raises the cost of a
 * prompt-injection escalation; it is NOT a hardened control over shell
 * execution. Per project doctrine (`docs/plugins/coordinator.md` — "Security
 * model — code-enforced vs LLM-requested"): code-enforced rules are the
 * security boundary; LLM-requested rails like this one are defense in depth.
 * Real shell-execution boundaries (sandboxing, permission controls) live
 * outside this plugin. Do not "harden" this into a fake boundary.
 */
declare function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification;
interface ViolationInfo {
    tool: string;
    command?: string;
    skill?: string;
    reason: string;
}
/**
 * Build the rejection error. The message embeds a machine-readable marker + JSON
 * (so it surfaces in `info.error`, which the eval reads) and a human/LLM redirect (G).
 */
declare function buildViolationError(info: ViolationInfo): Error;

interface CreateSkillPluginOptions {
    namespace: string;
    agentName: string;
    commandName: string;
    agentDescription: string;
    commandDescription: string;
    loadSkill: ((name: string) => string) | null;
    availableSkills: readonly string[];
    moduleDirectory: string;
    mode?: "primary" | "subagent";
}

declare function createSkillPlugin(options: CreateSkillPluginOptions): Plugin;

export { type BashClassification, CATEGORY_PREFIX_MAPPING, COORDINATOR_AGENT_NAME, type CreateSkillPluginOptions, VALID_CATEGORIES, VALID_PREFIXES, type ViolationInfo, buildViolationError, classifyCoordinatorBash, createSkillPlugin, forgetSessionAgent, getSessionAgent, getSessionAgentCached, isCompoundCommand, isCoordinatorSession, parseAllowedBashPrograms };
