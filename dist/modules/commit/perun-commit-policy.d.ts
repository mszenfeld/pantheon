type CommitScopePolicy = "generic" | "perun-exact";
type PublicationOperation = "create_branch" | "create_pr";
declare const PUBLICATION_AGENT_IDENTITIES: readonly ["svarog", "stribog"];
interface PerunExactFileAuthorizationInput {
    files: unknown;
    repositoryRoot: string;
    changedFiles: ReadonlySet<string>;
    isDirectory: (absolutePath: string) => boolean;
}
declare function canonicalizeRepositoryPath(value: string, repositoryRoot: string): string;
/** Parse machine-readable `git status --porcelain=v1 -z` output fail-closed. */
declare function parsePorcelainV1Status(output: string): Set<string>;
/**
 * Validate Perun's requested files without touching Git or the index. Callers supply the
 * repository root, authoritative changed set, and directory predicate so this remains pure and
 * unit-testable with no filesystem or process dependency.
 */
declare function authorizePerunExactFiles(input: PerunExactFileAuthorizationInput): string[];
/** Select the internal commit policy from the runtime identity, never a tool argument. */
declare function classifyCommitCaller(agent: unknown): CommitScopePolicy;
/** Allow publication only from the canonical executor identities. */
declare function assertPublicationCaller(agent: unknown, operation: PublicationOperation): void;

export { type CommitScopePolicy, PUBLICATION_AGENT_IDENTITIES, type PerunExactFileAuthorizationInput, type PublicationOperation, assertPublicationCaller, authorizePerunExactFiles, canonicalizeRepositoryPath, classifyCommitCaller, parsePorcelainV1Status };
