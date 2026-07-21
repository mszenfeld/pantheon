import { fstatSync, lstatSync, realpathSync } from "node:fs"
import path from "node:path"

/** Worktree-relative directories allowed to contain planning artifacts. */
export const PLANNING_ARTIFACT_DIRECTORIES: readonly string[] = ["docs/specs", "docs/plans"]

/** Lexically checks that `candidate` equals `directory` or lives beneath it. */
export function isWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
}

/**
 * Rejects paths containing empty, `.`, or `..` segments on either separator.
 * Empty-segment rejection also refuses absolute paths and leading, trailing,
 * or doubled separators; callers that accept a trailing separator must
 * normalize it away before this check.
 */
export function containsTraversalSegment(pathValue: string): boolean {
  return pathValue
    .split(/[\\/]/)
    .some((segment: string): boolean => segment === "" || segment === "." || segment === "..")
}

/**
 * Compares an O_NOFOLLOW-opened descriptor against the path it was opened
 * from: the descriptor must reference a regular file, the name must not be a
 * symlink, both must be the same inode, and the parent must still resolve to
 * the trusted canonical directory. Filesystem errors propagate to the caller.
 */
export function matchesNoFollowFileDescriptor(
  descriptor: number,
  targetPath: string,
  canonicalParent: string,
): boolean {
  const opened = fstatSync(descriptor)
  const named = lstatSync(targetPath)
  return (
    opened.isFile() &&
    !named.isSymbolicLink() &&
    opened.dev === named.dev &&
    opened.ino === named.ino &&
    realpathSync(path.dirname(targetPath)) === canonicalParent
  )
}

/** Non-throwing form of {@link matchesNoFollowFileDescriptor}: false on any filesystem error. */
export function verifiesNoFollowFileDescriptor(
  descriptor: number,
  targetPath: string,
  canonicalParent: string,
): boolean {
  try {
    return matchesNoFollowFileDescriptor(descriptor, targetPath, canonicalParent)
  } catch {
    return false
  }
}
