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

/**
 * True when `value` names one concrete, repo-relative-or-absolute file path that cannot expand
 * to the whole tree. Rejects: git pathspec magic (`:/`, `:(glob)**` — a leading `:` is never a
 * plain path), root-equivalents, wildcards, and any `..` traversal segment.
 */
export function isScopedCommitPath(value: unknown): value is string {
  if (typeof value !== "string") return false
  const path = value.trim()
  if (path === "") return false
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

/** True when an `av_commit` call names at least one concrete, scoped path to stage. */
export function hasExplicitCommitFiles(files: unknown): files is string[] {
  return (
    Array.isArray(files) && files.length > 0 && files.every(isScopedCommitPath)
  )
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
 * Denial text for a Stribog `av_commit` naming a path the session never edited. Stribog's edit
 * budget is the authoritative per-session blast radius; a commit that reaches outside it would
 * publish work the budget was meant to bound.
 */
export function unbudgetedCommitPathMessage(
  marker: string,
  path: string,
  edited: string[],
): string {
  return (
    `${marker}: av_commit named '${path}', which Stribog never edited this session ` +
    `(edited: ${edited.length > 0 ? edited.join(", ") : "nothing yet"}). A leaf actuator ` +
    `commits only the files it changed — staging anything else would publish unrelated work ` +
    `past the edit budget. Retry naming only your own edited paths. Do NOT ESCALATE for this ` +
    `— it is a redirect.`
  )
}

/**
 * True when `candidate` (a repo-relative or absolute path from `av_commit`) refers to the same
 * file as one of the session's `edited` absolute paths. Compared by path-boundary suffix so a
 * repo-relative argument matches its absolute edited counterpart without assuming the hook's
 * cwd equals the worktree root.
 */
export function matchesEditedPath(
  candidate: string,
  edited: Iterable<string>,
): boolean {
  const normalized = candidate.trim().replace(/^\.\//, "")
  for (const path of edited) {
    if (path === normalized) return true
    if (path.endsWith(`/${normalized}`)) return true
  }
  return false
}
