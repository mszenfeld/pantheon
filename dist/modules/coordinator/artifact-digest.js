import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  PLANNING_ARTIFACT_DIRECTORIES,
  containsTraversalSegment,
  isWithin
} from "../_shared/artifact-path-safety.js";
const MUTABLE_APPROVAL_FIELDS = /* @__PURE__ */ new Set([
  "approved",
  "approved_at",
  "approved_by_session",
  "approved_file_digest"
]);
const FRONTMATTER_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const NUMBER_VALUE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function parseFrontmatterValue(value) {
  if (value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (NUMBER_VALUE.test(value)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("frontmatter number is not finite");
    return parsed;
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") {
        throw new Error("double-quoted frontmatter value must be a string");
      }
      return parsed;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`invalid double-quoted frontmatter value: ${error.message}`);
      }
      throw new Error("invalid double-quoted frontmatter value");
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error("invalid single-quoted frontmatter value");
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.includes("#") || value.includes("	") || /:\s/.test(value)) {
    throw new Error("frontmatter value must be a scalar without comments or mappings");
  }
  return value;
}
function serializeFrontmatterValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === "" || value.trim() !== value || value.includes("\n") || value.includes("\r") || value.includes("#") || value.includes("	") || /:\s/.test(value) || value === "true" || value === "false" || value === "null" || value === "~" || NUMBER_VALUE.test(value) || value.startsWith("'") || value.startsWith('"')) {
    return JSON.stringify(value);
  }
  return value;
}
function parsePlanningArtifactFrontmatter(content) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    throw new Error("planning artifact must start with a frontmatter delimiter");
  }
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") {
      closingIndex = index;
      break;
    }
    if (line === void 0 || line === "" || line === "...") {
      throw new Error("frontmatter contains a malformed delimiter or empty line");
    }
  }
  if (closingIndex === -1) {
    throw new Error("planning artifact has no closing frontmatter delimiter");
  }
  const values = /* @__PURE__ */ new Map();
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([^:\s]+):(?: (.*))?$/.exec(line);
    if (match === null) throw new Error("frontmatter must contain only simple key-value mappings");
    const key = match[1];
    if (key === void 0 || !FRONTMATTER_KEY.test(key)) {
      throw new Error("frontmatter key is invalid");
    }
    if (values.has(key)) throw new Error(`duplicate frontmatter key: ${key}`);
    values.set(key, parseFrontmatterValue(match[2] ?? ""));
  }
  return { values, body: lines.slice(closingIndex + 1).join("\n") };
}
function serializePlanningArtifact(artifact) {
  const lines = ["---"];
  for (const key of [...artifact.values.keys()].sort((left, right) => left.localeCompare(right))) {
    const value = artifact.values.get(key);
    if (value === void 0) throw new Error(`frontmatter value disappeared for key: ${key}`);
    lines.push(`${key}: ${serializeFrontmatterValue(value)}`);
  }
  lines.push("---");
  return `${lines.join("\n")}
${artifact.body.replace(/\r\n?/g, "\n")}`;
}
function canonicalizePlanningArtifact(artifact) {
  const canonicalValues = /* @__PURE__ */ new Map();
  for (const [key, value] of artifact.values) {
    if (!MUTABLE_APPROVAL_FIELDS.has(key)) canonicalValues.set(key, value);
  }
  return serializePlanningArtifact({ values: canonicalValues, body: artifact.body });
}
function canonicalPlanningArtifactDigest(content) {
  const artifact = parsePlanningArtifactFrontmatter(content);
  return createHash("sha256").update(canonicalizePlanningArtifact(artifact), "utf8").digest("hex");
}
function resolvePlanningArtifactPath(pathValue) {
  if (path.isAbsolute(pathValue) || containsTraversalSegment(pathValue)) {
    throw new Error("planning artifact path must be a traversal-free relative path");
  }
  const worktree = realpathSync(process.cwd());
  const absolutePath = path.resolve(worktree, pathValue);
  const lexicalDirectory = PLANNING_ARTIFACT_DIRECTORIES.map((directory) => path.resolve(worktree, directory)).find((directory) => isWithin(directory, absolutePath));
  if (lexicalDirectory === void 0) {
    throw new Error("planning artifacts must be under docs/specs or docs/plans");
  }
  const canonicalDirectory = realpathSync(lexicalDirectory);
  if (!isWithin(worktree, canonicalDirectory)) {
    throw new Error("planning artifact directory escapes the worktree");
  }
  const relativeParts = path.relative(worktree, absolutePath).split(path.sep);
  let current = worktree;
  for (const part of relativeParts) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("planning artifact path must not traverse a symlink");
    }
  }
  const fileStat = lstatSync(absolutePath);
  if (!fileStat.isFile()) throw new Error("planning artifact must be a regular file");
  const canonicalPath = realpathSync(absolutePath);
  if (!isWithin(canonicalDirectory, canonicalPath)) {
    throw new Error("planning artifact resolves outside its allowed directory");
  }
  return {
    absolutePath: canonicalPath,
    canonicalPath,
    relativePath: path.relative(worktree, canonicalPath).split(path.sep).join("/")
  };
}
function getPlanningArtifactDigest(pathValue) {
  try {
    const artifactPath = resolvePlanningArtifactPath(pathValue);
    return {
      status: "ok",
      digest: canonicalPlanningArtifactDigest(readFileSync(artifactPath.absolutePath, "utf8"))
    };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "could not digest planning artifact"
    };
  }
}
export {
  canonicalPlanningArtifactDigest,
  canonicalizePlanningArtifact,
  getPlanningArtifactDigest,
  parsePlanningArtifactFrontmatter,
  resolvePlanningArtifactPath,
  serializePlanningArtifact
};
