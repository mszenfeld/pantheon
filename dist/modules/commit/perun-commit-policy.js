import path from "node:path";
import {
  escapeControlBytes,
  formatCommitPath,
  isScopedCommitPath
} from "../_shared/commit-staging-scope.js";
import { COORDINATOR_AGENT_NAME } from "../_shared/session-identity.js";
import { STRIBOG_AGENT_KEY } from "../stribog/stribog.metadata.js";
import { SVAROG_AGENT_KEY } from "../svarog/svarog.metadata.js";
const PUBLICATION_AGENT_IDENTITIES = [
  SVAROG_AGENT_KEY,
  STRIBOG_AGENT_KEY
];
const publicationAgentIdentitySet = new Set(
  PUBLICATION_AGENT_IDENTITIES
);
function scopeError(message) {
  return new Error(`Perun commit scope: ${message}`);
}
function invalidStatusRecord(record) {
  return scopeError(`invalid git status record ${formatCommitPath(record)}.`);
}
function formatUnknownPath(value) {
  if (typeof value === "string") return formatCommitPath(value);
  try {
    const encoded = JSON.stringify(value);
    return encoded === void 0 ? '"<unserializable>"' : escapeControlBytes(encoded);
  } catch {
    return '"<unserializable>"';
  }
}
function canonicalizeRepositoryPath(value, repositoryRoot) {
  if (!isScopedCommitPath(value)) {
    throw scopeError(`invalid file path ${formatCommitPath(value)}.`);
  }
  const absolutePath = path.resolve(repositoryRoot, value);
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw scopeError(`file path escapes the repository root: ${formatCommitPath(value)}.`);
  }
  const canonicalPath = relativePath.split(path.sep).join("/");
  if (!isScopedCommitPath(canonicalPath)) {
    throw scopeError(`invalid file path ${formatCommitPath(value)}.`);
  }
  return canonicalPath;
}
function isUnmergedStatus(status) {
  return status[0] === "U" || status[1] === "U" || status === "DD " || status === "AA ";
}
function parsePorcelainV1StatusDetailed(output) {
  const changedFiles = /* @__PURE__ */ new Set();
  const indexAbsentFiles = /* @__PURE__ */ new Set();
  const renamePairs = /* @__PURE__ */ new Map();
  if (output === "") return { changedFiles, indexAbsentFiles, renamePairs };
  if (!output.endsWith("\0")) {
    throw invalidStatusRecord(output);
  }
  const records = output.slice(0, -1).split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === void 0 || record.length < 4) {
      throw invalidStatusRecord(record ?? "");
    }
    if (record.startsWith("?? ")) {
      const pathname2 = record.slice(3);
      if (pathname2 === "") throw invalidStatusRecord(record);
      changedFiles.add(pathname2);
      continue;
    }
    const status = record.slice(0, 3);
    if (status === "   " || !/^[ MADRCUT][ MADRCUT] $/.test(status)) {
      throw invalidStatusRecord(record);
    }
    const pathname = record.slice(3);
    if (pathname === "") throw invalidStatusRecord(record);
    changedFiles.add(pathname);
    const unmerged = isUnmergedStatus(status);
    if (status[0] === "D" && !unmerged) {
      indexAbsentFiles.add(pathname);
    }
    if (status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") {
      const sourcePath = records[index + 1];
      if (sourcePath === void 0 || sourcePath === "") {
        throw invalidStatusRecord(record);
      }
      changedFiles.add(sourcePath);
      renamePairs.set(pathname, sourcePath);
      if ((status[0] === "R" || status[0] === "C") && !unmerged) {
        indexAbsentFiles.add(sourcePath);
      }
      index += 1;
    }
  }
  return { changedFiles, indexAbsentFiles, renamePairs };
}
function parsePorcelainV1Status(output) {
  return parsePorcelainV1StatusDetailed(output).changedFiles;
}
function authorizePerunExactFiles(input) {
  if (!path.isAbsolute(input.repositoryRoot)) {
    throw scopeError("repository root must be an absolute path.");
  }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw scopeError("files must be a non-empty list of concrete file paths.");
  }
  const requestedFiles = [];
  for (const file of input.files) {
    if (!isScopedCommitPath(file)) {
      throw scopeError(`invalid file path ${formatUnknownPath(file)}.`);
    }
    requestedFiles.push(file);
  }
  const canonicalChangedFiles = /* @__PURE__ */ new Set();
  for (const changedFile of input.changedFiles) {
    canonicalChangedFiles.add(
      canonicalizeRepositoryPath(changedFile, input.repositoryRoot)
    );
  }
  const authorizedFiles = [];
  const seenFiles = /* @__PURE__ */ new Set();
  for (const file of requestedFiles) {
    const canonicalPath = canonicalizeRepositoryPath(file, input.repositoryRoot);
    if (seenFiles.has(canonicalPath)) {
      throw scopeError(`duplicate file path ${formatCommitPath(file)}.`);
    }
    const absolutePath = path.resolve(input.repositoryRoot, canonicalPath);
    if (input.isDirectory(absolutePath)) {
      throw scopeError(`file path is an existing directory: ${formatCommitPath(file)}.`);
    }
    if (!canonicalChangedFiles.has(canonicalPath)) {
      throw scopeError(`file path is not a current repository change: ${formatCommitPath(file)}.`);
    }
    seenFiles.add(canonicalPath);
    authorizedFiles.push(canonicalPath);
  }
  for (const [newPath, sourcePath] of input.renamePairs ?? []) {
    const canonicalNew = canonicalizeRepositoryPath(newPath, input.repositoryRoot);
    const canonicalSource = canonicalizeRepositoryPath(sourcePath, input.repositoryRoot);
    const hasNew = seenFiles.has(canonicalNew);
    const hasSource = seenFiles.has(canonicalSource);
    if (hasNew !== hasSource) {
      throw scopeError(
        `a rename must be authorized as a whole \u2014 name both ${formatCommitPath(canonicalSource)} and ${formatCommitPath(canonicalNew)}.`
      );
    }
  }
  return authorizedFiles;
}
function assertKnownCaller(agent, operation) {
  if (typeof agent !== "string" || agent.trim() === "") {
    throw new Error(`${operation}: caller identity is unavailable; refusing before mutation.`);
  }
  return agent;
}
function classifyCommitCaller(agent) {
  return assertKnownCaller(agent, "av_commit") === COORDINATOR_AGENT_NAME ? "perun-exact" : "generic";
}
function assertPublicationCaller(agent, operation) {
  const caller = assertKnownCaller(agent, operation);
  if (!publicationAgentIdentitySet.has(caller)) {
    throw new Error(`${operation}: caller is not authorized.`);
  }
}
export {
  PUBLICATION_AGENT_IDENTITIES,
  assertPublicationCaller,
  authorizePerunExactFiles,
  canonicalizeRepositoryPath,
  classifyCommitCaller,
  parsePorcelainV1Status,
  parsePorcelainV1StatusDetailed
};
