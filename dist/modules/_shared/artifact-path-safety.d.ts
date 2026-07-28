/** Worktree-relative directories allowed to contain planning artifacts. */
declare const PLANNING_ARTIFACT_DIRECTORIES: readonly string[];
/** Lexically checks that `candidate` equals `directory` or lives beneath it. */
declare function isWithin(directory: string, candidate: string): boolean;
/**
 * Rejects paths containing empty, `.`, or `..` segments on either separator.
 * Empty-segment rejection also refuses absolute paths and leading, trailing,
 * or doubled separators; callers that accept a trailing separator must
 * normalize it away before this check.
 */
declare function containsTraversalSegment(pathValue: string): boolean;
/**
 * Compares an O_NOFOLLOW-opened descriptor against the path it was opened
 * from: the descriptor must reference a regular file, the name must not be a
 * symlink, both must be the same inode, and the parent must still resolve to
 * the trusted canonical directory. Filesystem errors propagate to the caller.
 */
declare function matchesNoFollowFileDescriptor(descriptor: number, targetPath: string, canonicalParent: string): boolean;
/** Non-throwing form of {@link matchesNoFollowFileDescriptor}: false on any filesystem error. */
declare function verifiesNoFollowFileDescriptor(descriptor: number, targetPath: string, canonicalParent: string): boolean;

export { PLANNING_ARTIFACT_DIRECTORIES, containsTraversalSegment, isWithin, matchesNoFollowFileDescriptor, verifiesNoFollowFileDescriptor };
