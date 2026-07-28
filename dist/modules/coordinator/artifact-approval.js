import { createHash } from "node:crypto";
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
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  PLANNING_ARTIFACT_DIRECTORIES,
  isWithin,
  matchesNoFollowFileDescriptor
} from "../_shared/artifact-path-safety.js";
import {
  canonicalPlanningArtifactDigest,
  parsePlanningArtifactFrontmatter,
  resolvePlanningArtifactPath,
  serializePlanningArtifact
} from "./artifact-digest.js";
function sidecarFileName(canonicalPath) {
  return `${createHash("sha256").update(canonicalPath, "utf8").digest("hex")}.json`;
}
function isAlreadyExists(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
function isNotFound(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function verifiedDirectoryDescriptor(directory, boundary) {
  const descriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    if (!fstatSync(descriptor).isDirectory() || !isWithin(boundary, realpathSync(directory))) {
      throw new Error("planning artifact approval directory escapes the worktree");
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}
function verifyNoFollowDescriptor(descriptor, target, directory) {
  if (!matchesNoFollowFileDescriptor(descriptor, target, directory)) {
    throw new Error("planning artifact changed while approval was starting");
  }
}
function artifactDirectory(worktree, artifactPath) {
  for (const directory of PLANNING_ARTIFACT_DIRECTORIES) {
    const allowedDirectory = realpathSync(path.join(worktree, directory));
    if (isWithin(allowedDirectory, realpathSync(artifactPath))) return allowedDirectory;
  }
  return void 0;
}
async function approvePlanningArtifact(pathValue, preApprovalDigest, sessionId) {
  let lockPath;
  let artifactDescriptor;
  let approvalDirectoryDescriptor;
  try {
    if (sessionId.length === 0) throw new Error("approval requires a session ID");
    const artifactPath = resolvePlanningArtifactPath(pathValue);
    const worktree = realpathSync(process.cwd());
    const canonicalPath = artifactPath.relativePath;
    const docsDirectory = path.join(worktree, "docs");
    const docsDirectoryDescriptor = verifiedDirectoryDescriptor(docsDirectory, worktree);
    closeSync(docsDirectoryDescriptor);
    const approvalDirectoryPath = path.join(docsDirectory, ".veles-approvals");
    mkdirSync(approvalDirectoryPath, { recursive: true });
    approvalDirectoryDescriptor = verifiedDirectoryDescriptor(approvalDirectoryPath, docsDirectory);
    const approvalDirectory = realpathSync(approvalDirectoryPath);
    const sidecarPath = path.join(approvalDirectory, sidecarFileName(canonicalPath));
    lockPath = `${sidecarPath}.lock`;
    let lockDescriptor;
    try {
      lockDescriptor = openSync(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
      );
    } catch (error) {
      if (isAlreadyExists(error)) {
        return { status: "error", reason: "planning artifact approval is already in progress" };
      }
      throw error;
    }
    verifyNoFollowDescriptor(lockDescriptor, lockPath, approvalDirectory);
    closeSync(lockDescriptor);
    try {
      lstatSync(sidecarPath);
      return { status: "error", reason: "planning artifact already has an approval record" };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    artifactDescriptor = openSync(
      artifactPath.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const allowedDirectory = artifactDirectory(worktree, artifactPath.absolutePath);
    if (allowedDirectory === void 0) {
      throw new Error("planning artifact resolves outside its allowed directory");
    }
    verifyNoFollowDescriptor(artifactDescriptor, artifactPath.absolutePath, path.dirname(artifactPath.absolutePath));
    if (!isWithin(allowedDirectory, realpathSync(artifactPath.absolutePath))) {
      throw new Error("planning artifact resolves outside its allowed directory");
    }
    const content = readFileSync(artifactDescriptor, "utf8");
    const digest = canonicalPlanningArtifactDigest(content);
    if (digest !== preApprovalDigest) {
      return { status: "error", reason: "planning artifact digest changed before approval" };
    }
    closeSync(artifactDescriptor);
    artifactDescriptor = void 0;
    const artifact = parsePlanningArtifactFrontmatter(content);
    const approvedAt = (/* @__PURE__ */ new Date()).toISOString();
    artifact.values.set("approved", true);
    artifact.values.set("approved_at", approvedAt);
    artifact.values.set("approved_by_session", sessionId);
    artifactDescriptor = openSync(
      artifactPath.absolutePath,
      constants.O_RDWR | constants.O_NOFOLLOW
    );
    verifyNoFollowDescriptor(artifactDescriptor, artifactPath.absolutePath, path.dirname(artifactPath.absolutePath));
    const approvedContent = serializePlanningArtifact(artifact);
    ftruncateSync(artifactDescriptor, 0);
    writeFileSync(artifactDescriptor, approvedContent, "utf8");
    const approvedFileDigest = canonicalPlanningArtifactDigest(approvedContent);
    closeSync(artifactDescriptor);
    artifactDescriptor = void 0;
    const sidecar = {
      approvedAt,
      approvedBySession: sessionId,
      canonicalDigest: approvedFileDigest,
      path: canonicalPath
    };
    const sidecarDescriptor = openSync(
      sidecarPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    );
    try {
      verifyNoFollowDescriptor(sidecarDescriptor, sidecarPath, approvalDirectory);
      writeFileSync(sidecarDescriptor, `${JSON.stringify(sidecar)}
`, "utf8");
    } finally {
      closeSync(sidecarDescriptor);
    }
    return { status: "ok", approvedFileDigest };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "could not approve planning artifact"
    };
  } finally {
    if (artifactDescriptor !== void 0) closeSync(artifactDescriptor);
    if (approvalDirectoryDescriptor !== void 0) closeSync(approvalDirectoryDescriptor);
    if (lockPath !== void 0) rmSync(lockPath, { force: true });
  }
}
export {
  approvePlanningArtifact
};
