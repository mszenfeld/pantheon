/**
 * §6 total-undo capture. Snapshot the WHOLE working tree (tracked + untracked, excluding
 * gitignored — the same scope as createCheckpoint) into refs/qa-loop/pre/<run> BEFORE the first
 * fix, via a throwaway index so the live index/worktree are untouched. Capturing dirty work means
 * undoToPreLoop returns the user's WORKING TREE to where they started (§6). It does not rewind
 * commits: since the 2026-07-22 executor-chain decision the in-loop Svarog fixer may commit its
 * verified-green work via `av_commit`, and `restoreCheckpoint` never moves `HEAD`.
 */
declare function capturePreLoopRef(cwd: string, runId: string): string;
/** True iff `ref` resolves — the §6 existence check (checkpoint-integrity backstop + undo guard). */
declare function refExists(cwd: string, ref: string): boolean;
/**
 * §6 FAIL auto-restore — wraps the EXISTING restoreCheckpoint (no new restore logic). It is already
 * cumulative-safe: the checkpoint tree contains every prior READY fix, so this reverts only THIS
 * issue's edits (and deletes only files this issue created, by tree-diff) and preserves issues 1…N-1.
 */
declare function restoreFailRef(cwd: string, ref: string): void;
/**
 * §6 total undo — revert the loop's WORKING-TREE changes by restoring the pre-loop ref (same
 * mechanics as the FAIL restore).
 *
 * **Bounded, not total, since the 2026-07-22 executor-chain decision.** `restoreCheckpoint`
 * resets the index to the current `HEAD`; it never moves `HEAD`, re-checks-out a branch, or
 * un-pushes. Svarog may now commit its verified-green work through `av_commit` (and switch
 * branches through `create_branch`, publish through `create_pr`), so a loop run whose fixer
 * committed leaves those commits in place — this restores the tree around them. Undoing
 * committed loop work is an operator step (`git reset --hard <pre-loop HEAD>`, or the reflog).
 */
declare function undoToPreLoop(cwd: string, ref: string): void;
/**
 * §6 anti-hardcoding (best-effort, non-blocking). Diff each `changed[]` file against its own
 * checkpoint tree and flag ADDED lines whose text contains a BE scenario request-payload literal —
 * the av-marketplace heuristic for "the fix hardcoded the test's expected value." Recorded as
 * warnings only; surfaced in Loop History for human review. Best-effort over self-reported
 * `changed[]` (unlike the restore, which ignores `changed[]`).
 */
declare function antiHardcodeDiff(cwd: string, ckptRef: string, changed: string[], bePayloads: string[]): string[];

export { antiHardcodeDiff, capturePreLoopRef, refExists, restoreFailRef, undoToPreLoop };
