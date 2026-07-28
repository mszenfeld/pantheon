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
/** The agent identifier the coordinator (Perun) session runs under. */
declare const COORDINATOR_AGENT_NAME = "Perun - Coordinator";
/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
declare function getSessionAgent(sessionID: string, client: Client): Promise<string | undefined>;
/**
 * Memoized variant of {@link getSessionAgent}. Resolved identities are cached
 * forever; unresolved identities are only suppressed briefly after repeated
 * misses so a late-resolving first turn remains retryable.
 */
declare function getSessionAgentCached(sessionID: string, client: Client): Promise<string | undefined>;
/** Evict all session identity bookkeeping on session teardown. */
declare function forgetSessionAgent(sessionID: string): void;
/** True only when the session is positively identified as the coordinator. */
declare function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean>;

/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
declare function parseAllowedBashPrograms(frontmatter: string): string[];
/** True when a command contains a shell compound form or wrapper. */
declare function isCompoundCommand(command: string): boolean;
interface BashClassification {
    allowed: boolean;
    program: string | null;
}
/** Decide whether a coordinator bash command is permitted by its allowlist. */
declare function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification;
interface ViolationInfo {
    tool: string;
    command?: string;
    skill?: string;
    reason: string;
}
/** Build the coordinator-policy rejection error and its machine-readable marker. */
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
