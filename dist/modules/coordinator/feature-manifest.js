import { execFile, spawn } from "node:child_process";
const CHANGE_MANIFEST_MARKER = "CHANGE_MANIFEST_V1:";
const RISK_FLAGS = /* @__PURE__ */ new Set([
  "auth",
  "egress",
  "agent_contract",
  "public_api",
  "cross_module",
  "data_migration"
]);
const SENSITIVE_PATH_PREFIXES = [
  "src/modules/_shared/",
  "src/modules/agent-registry/",
  "src/modules/agent-roster/",
  "src/modules/coordinator/",
  "src/modules/coordinator-policy/",
  "src/modules/plan/",
  "src/modules/qa/",
  "src/modules/commit/",
  "src/modules/stribog/",
  "src/modules/svarog/",
  "src/agents/",
  "src/commands/"
];
const SENSITIVE_PATHS = /* @__PURE__ */ new Set([
  "packages/skill-utils/src/session-identity.ts",
  "packages/skill-utils/src/coordinator-bash-policy.ts",
  "docs/agent-contracts.md",
  "docs/configuring-agents.md"
]);
function isGitRunner(value) {
  if (!isRecord(value)) return false;
  return typeof value.revParse === "function" && typeof value.mergeBase === "function" && typeof value.diffNameOnly === "function";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isEstimatedComplexity(value) {
  return value === "mechanical" || value === "simple" || value === "complex";
}
function isFeatureManifest(value) {
  if (!isRecord(value)) return false;
  return isStringArray(value.files_changed) && isStringArray(value.modules_affected) && isStringArray(value.new_surface_types) && isStringArray(value.risk_flags) && isEstimatedComplexity(value.estimated_complexity);
}
function parseManifest(text) {
  const markerIndex = text.indexOf(CHANGE_MANIFEST_MARKER);
  if (markerIndex === -1) return void 0;
  const afterMarker = text.slice(markerIndex + CHANGE_MANIFEST_MARKER.length);
  const fencedJson = /```json\s*\n([\s\S]*?)\n```/.exec(afterMarker);
  const payload = fencedJson?.[1];
  if (payload === void 0) return void 0;
  try {
    const parsed = JSON.parse(payload);
    if (!isRecord(parsed) || !isFeatureManifest(parsed.manifest)) return void 0;
    return parsed.manifest;
  } catch {
    return void 0;
  }
}
function hasUniqueNonEmptyStrings(values) {
  return values.every((value) => value.trim().length > 0) && new Set(values).size === values.length;
}
function isRepoRelativePath(value) {
  return value.trim().length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((segment) => segment === "." || segment === "..");
}
function hasSensitivePath(files) {
  return files.some((file) => {
    const lowerCaseFile = file.toLowerCase();
    return SENSITIVE_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)) || SENSITIVE_PATHS.has(file) || lowerCaseFile.includes("auth") || lowerCaseFile.includes("egress") || lowerCaseFile.includes("secret") || lowerCaseFile.includes("credential");
  });
}
function matchesTrustedFiles(manifestFiles, changedFiles) {
  if (manifestFiles.length !== changedFiles.length) return false;
  if (!hasUniqueNonEmptyStrings(changedFiles) || !changedFiles.every(isRepoRelativePath)) return false;
  const manifestSet = new Set(manifestFiles);
  return changedFiles.every((file) => manifestSet.has(file));
}
function isValidManifest(manifest) {
  return hasUniqueNonEmptyStrings(manifest.files_changed) && manifest.files_changed.every(isRepoRelativePath) && hasUniqueNonEmptyStrings(manifest.modules_affected) && hasUniqueNonEmptyStrings(manifest.new_surface_types) && hasUniqueNonEmptyStrings(manifest.risk_flags) && manifest.risk_flags.every((flag) => RISK_FLAGS.has(flag));
}
function classifyManifest(manifest, changedFiles) {
  if (!isValidManifest(manifest) || changedFiles === void 0) return "veles";
  if (!matchesTrustedFiles(manifest.files_changed, changedFiles)) return "veles";
  if (hasSensitivePath(manifest.files_changed)) return "veles";
  if (manifest.estimated_complexity === "complex" || manifest.risk_flags.length > 0 || manifest.new_surface_types.length > 0 || manifest.modules_affected.length >= 3) {
    return "veles";
  }
  if (manifest.estimated_complexity === "mechanical" && manifest.files_changed.length >= 1 && manifest.files_changed.length <= 2) {
    return "stribog";
  }
  if (manifest.estimated_complexity === "simple" && manifest.files_changed.length >= 1 && manifest.files_changed.length <= 3) {
    return "svarog";
  }
  return "veles";
}
function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(typeof stdout === "string" ? Buffer.from(stdout) : stdout);
      }
    );
  });
}
function decodeGitOutput(output) {
  return output.toString("utf8").trim();
}
function parseNulDelimitedPaths(chunks) {
  const paths = [];
  let remainder = Buffer.alloc(0);
  for (const chunk of chunks) {
    let data = Buffer.concat([remainder, chunk]);
    let delimiterIndex = data.indexOf(0);
    while (delimiterIndex !== -1) {
      if (delimiterIndex > 0) paths.push(data.subarray(0, delimiterIndex).toString("utf8"));
      data = data.subarray(delimiterIndex + 1);
      delimiterIndex = data.indexOf(0);
    }
    remainder = data;
  }
  if (remainder.length > 0) paths.push(remainder.toString("utf8"));
  return paths;
}
function streamGitDiffNameOnly(base) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--name-only", "-z", "--end-of-options", base, "HEAD"]);
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `git diff exited with status ${code ?? "unknown"}`));
        return;
      }
      resolve(parseNulDelimitedPaths(chunks));
    });
  });
}
const execFileGitRunner = {
  async revParse(ref) {
    return decodeGitOutput(await runGit(["rev-parse", "--verify", "--end-of-options", ref]));
  },
  async mergeBase(base, head) {
    return decodeGitOutput(await runGit(["merge-base", "--end-of-options", base, head]));
  },
  async diffNameOnly(base) {
    return streamGitDiffNameOnly(base);
  }
};
async function resolveBase(gitRunner, base) {
  if (base !== void 0) return gitRunner.revParse(base);
  try {
    return await gitRunner.revParse("origin/HEAD");
  } catch {
    try {
      return await gitRunner.revParse("master");
    } catch {
      return gitRunner.revParse("main");
    }
  }
}
function classificationReason(executor) {
  if (executor === "stribog") {
    return "mechanical manifest matches the trusted git diff";
  }
  if (executor === "svarog") {
    return "simple manifest matches the trusted git diff";
  }
  return "manifest requires conservative Veles planning";
}
async function validateAndClassify(text, options = {}) {
  if (options.userRequestedPlanning === true) {
    return { executor: "veles", reason: "user explicitly requested planning" };
  }
  const manifest = parseManifest(text);
  if (manifest === void 0) {
    return { executor: "veles", reason: "missing or invalid change manifest" };
  }
  const gitRunner = options.gitRunner ?? execFileGitRunner;
  try {
    const base = await resolveBase(gitRunner, options.base);
    const mergeBase = await gitRunner.mergeBase(base, "HEAD");
    const changedFiles = await gitRunner.diffNameOnly(mergeBase);
    if (changedFiles.length === 0) {
      return { executor: "veles", reason: "no changed files found in trusted git diff" };
    }
    const executor = classifyManifest(manifest, changedFiles);
    return { executor, reason: classificationReason(executor) };
  } catch {
    return { executor: "veles", reason: "could not derive changed files from git" };
  }
}
export {
  classifyManifest,
  execFileGitRunner,
  isGitRunner,
  parseManifest,
  parseNulDelimitedPaths,
  validateAndClassify
};
