/**
 * Staging-scope guard for the executor commit path.
 *
 * The sanctioned `av_commit` tool stages `git add -- <files>` when `files` is non-empty and
 * falls back to `git add -A` when it is not (`src/modules/commit/controlled-commit.ts`). The
 * repo-wide fallback is fine for the operator-driven `/commit` flow, but a dispatched executor
 * shares the operator's real working tree (`docs/heavy-execution.md`), so a bare call would
 * sweep unrelated modified/untracked paths into the executor's commit — which `create_pr` then
 * pushes to origin, durably and past a recovery checkpoint that does not rewind commits.
 *
 * Both executor hooks therefore refuse a bare `av_commit` fail-closed, mirroring how they
 * already refuse an `edit`/`write` whose `filePath` cannot be bound to the edit budget.
 */

/** True when an `av_commit` call names at least one non-blank path to stage. */
export function hasExplicitCommitFiles(files: unknown): boolean {
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every((file) => typeof file === "string" && file.trim() !== "")
  )
}

/**
 * Denial text for a bare `av_commit` on an executor session. Phrased as a redirect ("retry
 * scoped"), not an escalation signal — the capability is granted, only the unscoped shape is
 * refused.
 */
export function bareCommitDenialMessage(marker: string, agent: string): string {
  return (
    `${marker}: ${agent} must call av_commit with an explicit, non-empty 'files' list naming ` +
    `the paths it edited. A bare av_commit stages the ENTIRE worktree (git add -A), which in a ` +
    `shared working tree would commit unrelated operator changes — and create_pr would publish ` +
    `them. Retry as av_commit({ message, files: ["path/you/edited.ts"] }). Do NOT ESCALATE for ` +
    `this — it is a redirect.`
  )
}
