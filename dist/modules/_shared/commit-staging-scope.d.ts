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
 * Both executor hooks refuse an unscoped `av_commit` fail-closed, mirroring how they already
 * refuse an `edit`/`write` whose `filePath` cannot be bound to the edit budget.
 *
 * This guard validates the `files` ARGUMENT; `createControlledCommit` is what makes the
 * validated list bind the commit's CONTENTS, by passing the same paths as a pathspec to
 * `git commit`. Without that, `git commit -m` would capture the whole index and anything staged
 * out-of-band — a bash `git add -A` (not covered by the mutating-git tripwire), or work the
 * operator staged before the dispatch — would ride along regardless of what this guard allowed.
 * The two halves are load-bearing together; neither is sufficient alone.
 *
 * The binding is layered, and the strength of the outer layer differs by agent posture:
 *
 *  - **Shape gate (both):** `isScopedCommitPath` rejects whole-tree pathspecs (`.`, `./`, `/`),
 *    git pathspec magic (a leading `:`, e.g. `:/`), globs and `..` traversal. These expand to the
 *    whole tree exactly like the `add -A` fallback, and `.` is the reflexive staging idiom a
 *    model reaches for after being told to name paths.
 *  - **Stribog — exact membership.** A deny-by-default leaf actuator bounded to
 *    `STRIBOG_EDIT_BUDGET` files may commit only paths it actually edited this session, compared
 *    as resolved absolute paths against the budget set. Exact comparison (never a suffix match:
 *    `a.ts` must not satisfy `/repo/src/a.ts`) also rejects directories for free, since a
 *    directory is never an edited file path.
 *  - **Svarog — directory rejection.** An allow-by-default deep worker legitimately commits
 *    files it never hand-edited (generated output such as this repo's committed `dist/` tree),
 *    so membership would produce false denials. Its floor is therefore the shape gate plus a
 *    filesystem check that no named path is a directory — `git add -- src` would otherwise stage
 *    every modified and untracked file beneath it.
 */
/**
 * True when `value` names one concrete path that cannot by itself expand to the whole tree.
 * Shape only — it cannot tell a file from a directory (see `findDirectoryPath`).
 */
declare function isScopedCommitPath(value: unknown): value is string;
/** True when an `av_commit` call names at least one concrete, non-whole-tree path. */
declare function hasExplicitCommitFiles(files: unknown): files is string[];
/**
 * The first named path that is a directory on disk, or `undefined` when none is. A directory
 * pathspec stages everything modified or untracked beneath it, which is the whole-tree sweep in
 * miniature. A path that does not exist is not a directory — `git add` surfaces that itself.
 */
declare function findDirectoryPath(files: readonly string[], isDirectory: (path: string) => boolean): string | undefined;
/**
 * Denial text for an unscoped `av_commit` on an executor session. Phrased as a redirect ("retry
 * scoped"), not an escalation signal — the capability is granted, only the unscoped shape is
 * refused. The wording names the rejected idioms explicitly so a retry does not simply swap one
 * whole-tree spelling for another.
 */
declare function bareCommitDenialMessage(marker: string, agent: string): string;
/**
 * Denial text for an `av_commit` path that is a directory — or that could not be resolved to a
 * file at all, which the guard treats the same way (fail-closed: it cannot prove the path is a
 * single file, and for Svarog this check is the only scope binding).
 */
declare function directoryCommitDenialMessage(marker: string, agent: string, path: string): string;
/**
 * Denial text for a Stribog `av_commit` naming a path outside its edit budget. The budget set is
 * the authoritative per-session blast radius; a commit that reaches past it would publish work
 * the budget exists to bound.
 */
declare function unbudgetedCommitPathMessage(marker: string, path: string, edited: readonly string[]): string;

export { bareCommitDenialMessage, directoryCommitDenialMessage, findDirectoryPath, hasExplicitCommitFiles, isScopedCommitPath, unbudgetedCommitPathMessage };
