interface GitScopeRunner {
    (cwd: string, args: string[]): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
}
type CommitChangeStatus = "added" | "modified" | "deleted" | "renamed";
interface RepositoryIdentity {
    root: string;
    commonDir: string;
}
interface CommitChange {
    path: string;
    status: CommitChangeStatus;
    porcelain: string;
    renameFrom?: string;
}
interface CommitScopeSnapshot {
    repository: RepositoryIdentity;
    head: string;
    changes: readonly CommitChange[];
    digest: string;
}
/** Parse only the ordinary, rename, and untracked porcelain-v2 records we can commit safely. */
declare function parsePorcelainV2(output: string): CommitChange[];
/**
 * Paths the snapshot proves are absent from BOTH the worktree and the index: an already-staged
 * deletion, or the source half of an already-staged rename. `git add -- <path>` cannot match those
 * ("pathspec did not match any files"), so they stay out of the staging call while remaining in the
 * commit pathspec, which records them from the index. The index half of the porcelain-v2 `XY` field
 * is the discriminator — an unstaged deletion (`.D`) is still in the index and must be staged.
 */
declare function collectIndexAbsentPaths(changes: readonly CommitChange[]): Set<string>;
declare function createCommitScopeSnapshot(cwd: string, runGit?: GitScopeRunner): Promise<CommitScopeSnapshot>;

export { type CommitChange, type CommitChangeStatus, type CommitScopeSnapshot, type GitScopeRunner, type RepositoryIdentity, collectIndexAbsentPaths, createCommitScopeSnapshot, parsePorcelainV2 };
