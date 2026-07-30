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

/** Any C0 or C1 control byte — never present in a legitimate path. */
const CONTROL_BYTE = /[\x00-\x1f\x7f-\x9f]/

/** Paths that stage the entire tree (or an unbounded slice of it) regardless of cwd. */
const ROOT_EQUIVALENT = new Set([
  ".",
  "./",
  "..",
  "../",
  "/",
  "*",
  "**",
  "",
  "./.",
])

/** Encode a path for denial text without allowing terminal-control injection. */
export function formatCommitPath(path: string): string {
  return JSON.stringify(path).replace(
    /[\x00-\x1f\x7f-\x9f]/g,
    (byte: string): string => `\\u${byte.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

/**
 * True when `value` names one concrete path that cannot by itself expand to the whole tree.
 * Shape only — it cannot tell a file from a directory (see `findDirectoryPath`).
 */
export function isScopedCommitPath(value: unknown): value is string {
  if (typeof value !== "string") return false
  // The hooks validate, and git stages, DIFFERENT spellings unless they coincide: the guard
  // trims, but `git add -- "a.ts "` stages the literal edge-whitespace path. Reject any entry
  // that is not already trimmed so the validated string and the staged string are identical.
  if (value !== value.trim()) return false
  const path = value.trim()
  if (path === "") return false
  // No C0/C1 control bytes: a real path never carries them, and rejecting them at the gate means
  // a forged path (a newline log-injection, a NUL, an OSC/BEL terminal escape) is refused here
  // rather than echoed raw into a denial message — the module's own CWE-117 discipline, matching
  // the JSON-encoded create_pr/create_branch error templates.
  if (CONTROL_BYTE.test(path)) return false
  if (path.startsWith(":")) return false // pathspec magic — not a plain path
  if (path.includes("*") || path.includes("?") || path.includes("["))
    return false // glob
  const normalized = path.replace(/\/+$/, "")
  if (ROOT_EQUIVALENT.has(normalized) || ROOT_EQUIVALENT.has(path)) return false
  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "..")) return false
  // A path that is nothing but separators/dots collapses to the repo root.
  return segments.some((segment) => segment !== "" && segment !== ".")
}

/** True when an `av_commit` call names at least one concrete, non-whole-tree path. */
export function hasExplicitCommitFiles(files: unknown): files is string[] {
  return (
    Array.isArray(files) && files.length > 0 && files.every(isScopedCommitPath)
  )
}

/**
 * The first named path that is a directory on disk, or `undefined` when none is. A directory
 * pathspec stages everything modified or untracked beneath it, which is the whole-tree sweep in
 * miniature. A path that does not exist is not a directory — `git add` surfaces that itself.
 */
export function findDirectoryPath(
  files: readonly string[],
  isDirectory: (path: string) => boolean,
): string | undefined {
  return files.find((file) => isDirectory(file.trim()))
}

/**
 * Denial text for an unscoped `av_commit` on an executor session. Phrased as a redirect ("retry
 * scoped"), not an escalation signal — the capability is granted, only the unscoped shape is
 * refused. The wording names the rejected idioms explicitly so a retry does not simply swap one
 * whole-tree spelling for another.
 */
export function bareCommitDenialMessage(marker: string, agent: string): string {
  return (
    `${marker}: ${agent} must call av_commit with an explicit 'files' list naming the concrete ` +
    `paths it edited — e.g. av_commit({ message, files: ["src/thing.ts"] }). Omitting 'files', ` +
    `or naming a whole-tree pathspec ("." / "./" / "/" / ":/" / a glob / a "..") stages the ` +
    `ENTIRE worktree, which in a shared working tree would commit unrelated operator changes — ` +
    `and create_pr would publish them. Retry with the individual file paths. Do NOT ESCALATE ` +
    `for this — it is a redirect.`
  )
}

/**
 * Denial text for an `av_commit` path that is a directory — or that could not be resolved to a
 * file at all, which the guard treats the same way (fail-closed: it cannot prove the path is a
 * single file, and for Svarog this check is the only scope binding).
 */
export function directoryCommitDenialMessage(
  marker: string,
  agent: string,
  path: string,
): string {
  return (
    `${marker}: av_commit named ${formatCommitPath(path)}, which is not a single existing file — a ` +
    `DIRECTORY would stage every modified and untracked file beneath it (including unrelated ` +
    `operator changes in the shared worktree, which create_pr would then publish), and a path ` +
    `that does not resolve cannot be checked at all. ${agent} must name individual, existing ` +
    `file paths, relative to the repo root or absolute. Retry with the concrete files you ` +
    `changed. Do NOT ESCALATE for this — it is a redirect.`
  )
}

/**
 * Denial text for a Stribog `av_commit` naming a path outside its edit budget. The budget set is
 * the authoritative per-session blast radius; a commit that reaches past it would publish work
 * the budget exists to bound.
 */
export function unbudgetedCommitPathMessage(
  marker: string,
  path: string,
  edited: readonly string[],
): string {
  return (
    `${marker}: av_commit named ${formatCommitPath(path)}, which Stribog did not edit this session ` +
    `(edited: ${edited.length > 0 ? edited.map(formatCommitPath).join(", ") : "nothing yet"}). A leaf actuator ` +
    `commits only the files it changed — staging anything else would publish unrelated work ` +
    `past the edit budget. Retry naming exactly those paths (the same spelling works: an ` +
    `absolute path, or one relative to the repo root). If the task genuinely requires ` +
    `committing a file you did not edit, return the ESCALATE result instead.`
  )
}
