type CommitScopePolicy = "generic" | "perun-exact";
type PublicationOperation = "create_branch" | "create_pr";
declare const PUBLICATION_AGENT_IDENTITIES: readonly ["svarog", "stribog"];
interface PerunExactFileAuthorizationInput {
    files: unknown;
    repositoryRoot: string;
    changedFiles: ReadonlySet<string>;
    isDirectory: (absolutePath: string) => boolean;
    /**
     * Optional new-path → source-path map from `parsePorcelainV1StatusDetailed`. When supplied, a
     * rename must be authorized as a whole: naming one half alone would commit half a rename (an
     * add without its deletion, or a deletion without its add), which the workflow contract in
     * `commit.md` / `perun.md` promises cannot happen.
     */
    renamePairs?: ReadonlyMap<string, string>;
}
declare function canonicalizeRepositoryPath(value: string, repositoryRoot: string): string;
interface PorcelainV1Status {
    /** Every path git reports as a current change — the authoritative authorizable set. */
    changedFiles: Set<string>;
    /**
     * Paths git reports as absent from BOTH the worktree and the index: an already-staged deletion
     * (`git rm`), or the source half of an already-staged rename/copy (`git mv`). `git add -- <path>`
     * cannot match these ("pathspec did not match any files"), so they must be kept out of the
     * staging call — the commit pathspec still records them from the index. Unmerged records are
     * deliberately excluded: their paths still have index entries.
     */
    indexAbsentFiles: Set<string>;
    /** new path → source path, for renames/copies git reports. Both halves belong to one change. */
    renamePairs: Map<string, string>;
}
/**
 * Parse machine-readable `git status --porcelain=v1 -z` output fail-closed, keeping the index half
 * of each record so the caller can tell an addable path from a git-recorded removal.
 */
declare function parsePorcelainV1StatusDetailed(output: string): PorcelainV1Status;
/** Flat authorizable set — the shape callers that only need membership consume. */
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

export { type CommitScopePolicy, PUBLICATION_AGENT_IDENTITIES, type PerunExactFileAuthorizationInput, type PorcelainV1Status, type PublicationOperation, assertPublicationCaller, authorizePerunExactFiles, canonicalizeRepositoryPath, classifyCommitCaller, parsePorcelainV1Status, parsePorcelainV1StatusDetailed };
