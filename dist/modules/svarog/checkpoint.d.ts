/**
 * Snapshot the working tree (tracked + untracked, EXCLUDING gitignored) into a scratch ref
 * WITHOUT touching the real index or working tree, and return the ref name. A throwaway index
 * seeded from the real one preserves staged state and keeps the live index untouched. `git stash`
 * cannot do this: `stash create` drops untracked files; `stash -u` mutates the working tree.
 *
 * Honest limits (documented in docs/heavy-execution.md): gitignored files, embedded/vendored
 * repos, and started services are NOT captured. Also assumes a born HEAD (at least one commit) —
 * `commit-tree -p HEAD` fails on a brand-new repo, which is outside the executor's lane.
 *
 * Precondition: `sessionId` must be a valid git ref-name component (no `..`, spaces, `~^:?*[\\`,
 * no leading/trailing `.`/`/`). The opencode session id (`ses_…`) satisfies this; callers passing
 * arbitrary ids should sanitize first, else `update-ref` throws.
 */
declare function createCheckpoint(cwd: string, sessionId: string): string;
/**
 * Restore the working tree to a checkpoint ref: recover tracked content, remove ONLY files Svarog
 * created this turn (present-now AND absent-from-checkpoint), then rebuild the index to HEAD so the
 * staging state matches the original. NEVER `clean -x` (it would delete the operator's gitignored
 * data). Gitignored / embedded-repo / started-service side effects are not recovered.
 */
declare function restoreCheckpoint(cwd: string, ckptRef: string): void;

export { createCheckpoint, restoreCheckpoint };
