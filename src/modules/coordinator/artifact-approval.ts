import { createHash } from "node:crypto"
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import {
  canonicalPlanningArtifactDigest,
  parsePlanningArtifactFrontmatter,
  resolvePlanningArtifactPath,
  serializePlanningArtifact,
} from "./artifact-digest.js"

export type PlanningArtifactApprovalResult =
  | { status: "ok"; approvedFileDigest: string }
  | { status: "error"; reason: string }

interface ApprovalSidecar {
  approvedAt: string
  approvedBySession: string
  canonicalDigest: string
  path: string
}

function sidecarFileName(canonicalPath: string): string {
  return `${createHash("sha256").update(canonicalPath, "utf8").digest("hex")}.json`
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  )
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function isWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
}

function verifiedDirectoryDescriptor(directory: string, boundary: string): number {
  const descriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    if (!fstatSync(descriptor).isDirectory() || !isWithin(boundary, realpathSync(directory))) {
      throw new Error("planning artifact approval directory escapes the worktree")
    }
    return descriptor
  } catch (error: unknown) {
    closeSync(descriptor)
    throw error
  }
}

function verifyNoFollowDescriptor(descriptor: number, target: string, directory: string): void {
  const opened = fstatSync(descriptor)
  const named = lstatSync(target)
  if (
    !opened.isFile() ||
    named.isSymbolicLink() ||
    opened.dev !== named.dev ||
    opened.ino !== named.ino ||
    realpathSync(path.dirname(target)) !== directory
  ) {
    throw new Error("planning artifact changed while approval was starting")
  }
}

function artifactDirectory(worktree: string, artifactPath: string): string | undefined {
  for (const directory of ["docs/specs", "docs/plans"]) {
    const allowedDirectory = realpathSync(path.join(worktree, directory))
    if (isWithin(allowedDirectory, realpathSync(artifactPath))) return allowedDirectory
  }
  return undefined
}

/** Approves a planning artifact and writes its immutable verification sidecar. */
export async function approvePlanningArtifact(
  pathValue: string,
  preApprovalDigest: string,
  sessionId: string,
): Promise<PlanningArtifactApprovalResult> {
  let lockPath: string | undefined
  let artifactDescriptor: number | undefined
  let approvalDirectoryDescriptor: number | undefined
  try {
    if (sessionId.length === 0) throw new Error("approval requires a session ID")
    const artifactPath = resolvePlanningArtifactPath(pathValue)
    const worktree = realpathSync(process.cwd())
    const canonicalPath = artifactPath.relativePath
    const docsDirectory = path.join(worktree, "docs")
    const docsDirectoryDescriptor = verifiedDirectoryDescriptor(docsDirectory, worktree)
    closeSync(docsDirectoryDescriptor)
    const approvalDirectoryPath = path.join(docsDirectory, ".veles-approvals")
    mkdirSync(approvalDirectoryPath, { recursive: true })
    approvalDirectoryDescriptor = verifiedDirectoryDescriptor(approvalDirectoryPath, docsDirectory)
    const approvalDirectory = realpathSync(approvalDirectoryPath)
    const sidecarPath = path.join(approvalDirectory, sidecarFileName(canonicalPath))
    lockPath = `${sidecarPath}.lock`

    let lockDescriptor: number
    try {
      lockDescriptor = openSync(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      )
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        return { status: "error", reason: "planning artifact approval is already in progress" }
      }
      throw error
    }
    verifyNoFollowDescriptor(lockDescriptor, lockPath, approvalDirectory)
    closeSync(lockDescriptor)

    try {
      lstatSync(sidecarPath)
      return { status: "error", reason: "planning artifact already has an approval record" }
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
    }

    artifactDescriptor = openSync(
      artifactPath.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    const allowedDirectory = artifactDirectory(worktree, artifactPath.absolutePath)
    if (allowedDirectory === undefined) {
      throw new Error("planning artifact resolves outside its allowed directory")
    }
    verifyNoFollowDescriptor(artifactDescriptor, artifactPath.absolutePath, path.dirname(artifactPath.absolutePath))
    if (!isWithin(allowedDirectory, realpathSync(artifactPath.absolutePath))) {
      throw new Error("planning artifact resolves outside its allowed directory")
    }
    const content = readFileSync(artifactDescriptor, "utf8")
    const digest = canonicalPlanningArtifactDigest(content)
    if (digest !== preApprovalDigest) {
      return { status: "error", reason: "planning artifact digest changed before approval" }
    }

    closeSync(artifactDescriptor)
    artifactDescriptor = undefined

    const artifact = parsePlanningArtifactFrontmatter(content)
    const approvedAt = new Date().toISOString()
    artifact.values.set("approved", true)
    artifact.values.set("approved_at", approvedAt)
    artifact.values.set("approved_by_session", sessionId)
    artifactDescriptor = openSync(
      artifactPath.absolutePath,
      constants.O_RDWR | constants.O_NOFOLLOW,
    )
    verifyNoFollowDescriptor(artifactDescriptor, artifactPath.absolutePath, path.dirname(artifactPath.absolutePath))
    const approvedContent = serializePlanningArtifact(artifact)
    ftruncateSync(artifactDescriptor, 0)
    writeFileSync(artifactDescriptor, approvedContent, "utf8")

    const approvedFileDigest = canonicalPlanningArtifactDigest(approvedContent)
    closeSync(artifactDescriptor)
    artifactDescriptor = undefined
    const sidecar: ApprovalSidecar = {
      approvedAt,
      approvedBySession: sessionId,
      canonicalDigest: approvedFileDigest,
      path: canonicalPath,
    }
    const sidecarDescriptor = openSync(
      sidecarPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    )
    try {
      verifyNoFollowDescriptor(sidecarDescriptor, sidecarPath, approvalDirectory)
      writeFileSync(sidecarDescriptor, `${JSON.stringify(sidecar)}\n`, "utf8")
    } finally {
      closeSync(sidecarDescriptor)
    }
    return { status: "ok", approvedFileDigest }
  } catch (error: unknown) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "could not approve planning artifact",
    }
  } finally {
    if (artifactDescriptor !== undefined) closeSync(artifactDescriptor)
    if (approvalDirectoryDescriptor !== undefined) closeSync(approvalDirectoryDescriptor)
    if (lockPath !== undefined) rmSync(lockPath, { force: true })
  }
}
