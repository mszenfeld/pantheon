/**
 * Staging-scope guard for the executor commit path.
 *
 * The sanctioned `av_commit` tool stages `git add -- <files>` when `files` is non-empty and
 * falls back to `git add -A` when it is not (`src/modules/commit/controlled-commit.ts`). The
 * repo-wide fallback is fine for the operator-driven `/commit` flow, but a dispatched executor
 * shares the operator's real working tree (`docs/heavy-execution.md`), so an unscoped call would
 * sweep unrelated modified/untracked paths into the executor's commit — which `create_pr` then
 * pushes to origin, durably and past a recovery checkpoint that does not rewind commits.
 *
 * Both executor hooks therefore refuse an unscoped `av_commit` fail-closed, mirroring how they
 * already refuse an `edit`/`write` whose `filePath` cannot be bound to the edit budget.
 *
 * The guard binds SCOPE, not merely shape: `files: ["."]` and `files: [":/"]` stage the whole
 * tree just as `add -A` does, and `.` is the reflexive staging idiom a model reaches for after
 * being told to name paths — so root-equivalents, git pathspec magic, wildcards and traversal
 * are all rejected alongside the empty case.
 */
/**
 * True when `value` names one concrete, repo-relative-or-absolute file path that cannot expand
 * to the whole tree. Rejects: git pathspec magic (`:/`, `:(glob)**` — a leading `:` is never a
 * plain path), root-equivalents, wildcards, and any `..` traversal segment.
 */
declare function isScopedCommitPath(value: unknown): value is string;
/** True when an `av_commit` call names at least one concrete, scoped path to stage. */
declare function hasExplicitCommitFiles(files: unknown): files is string[];
/**
 * Denial text for an unscoped `av_commit` on an executor session. Phrased as a redirect ("retry
 * scoped"), not an escalation signal — the capability is granted, only the unscoped shape is
 * refused. The wording names the rejected idioms explicitly so a retry does not simply swap one
 * whole-tree spelling for another.
 */
declare function bareCommitDenialMessage(marker: string, agent: string): string;
/**
 * Denial text for a Stribog `av_commit` naming a path the session never edited. Stribog's edit
 * budget is the authoritative per-session blast radius; a commit that reaches outside it would
 * publish work the budget was meant to bound.
 */
declare function unbudgetedCommitPathMessage(marker: string, path: string, edited: string[]): string;
/**
 * True when `candidate` (a repo-relative or absolute path from `av_commit`) refers to the same
 * file as one of the session's `edited` absolute paths. Compared by path-boundary suffix so a
 * repo-relative argument matches its absolute edited counterpart without assuming the hook's
 * cwd equals the worktree root.
 */
declare function matchesEditedPath(candidate: string, edited: Iterable<string>): boolean;

export { bareCommitDenialMessage, hasExplicitCommitFiles, isScopedCommitPath, matchesEditedPath, unbudgetedCommitPathMessage };
