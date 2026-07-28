import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalPlanningArtifactDigest,
  resolvePlanningArtifactPath
} from "./artifact-digest.js";
function approvalSidecarPath(canonicalPath) {
  const filename = createHash("sha256").update(canonicalPath, "utf8").digest("hex");
  return path.join(process.cwd(), "docs/.veles-approvals", `${filename}.json`);
}
function isApprovalSidecar(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return typeof Reflect.get(value, "approvedAt") === "string" && typeof Reflect.get(value, "approvedBySession") === "string" && typeof Reflect.get(value, "canonicalDigest") === "string" && typeof Reflect.get(value, "path") === "string";
}
function readVerifiedPlanningArtifact(pathValue) {
  try {
    const artifactPath = resolvePlanningArtifactPath(pathValue);
    const content = readFileSync(artifactPath.absolutePath, "utf8");
    const digest = canonicalPlanningArtifactDigest(content);
    const canonicalPath = artifactPath.relativePath;
    const sidecarPath = approvalSidecarPath(canonicalPath);
    const sidecarStat = lstatSync(sidecarPath);
    if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) {
      return { status: "error", reason: "planning artifact approval sidecar is not a regular file" };
    }
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    if (!isApprovalSidecar(sidecar) || sidecar.path !== canonicalPath) {
      return { status: "error", reason: "planning artifact approval sidecar is malformed" };
    }
    if (sidecar.canonicalDigest !== digest) {
      return { status: "error", reason: "planning artifact digest does not match its approval" };
    }
    return { status: "ok", content };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "could not read verified planning artifact"
    };
  }
}
export {
  readVerifiedPlanningArtifact
};
