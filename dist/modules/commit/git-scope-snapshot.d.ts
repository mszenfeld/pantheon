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
declare function createCommitScopeSnapshot(cwd: string, runGit?: GitScopeRunner): Promise<CommitScopeSnapshot>;

export { type CommitChange, type CommitChangeStatus, type CommitScopeSnapshot, type GitScopeRunner, type RepositoryIdentity, createCommitScopeSnapshot, parsePorcelainV2 };
