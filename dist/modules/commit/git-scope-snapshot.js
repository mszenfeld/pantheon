import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalizeRepositoryPath } from "./perun-commit-policy.js";
const execFileAsync = promisify(execFile);
const defaultGitRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("git", args, { cwd });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error;
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: Number(failure.code ?? 1) };
  }
};
function malformed(record) {
  return new Error(`Perun commit scope: malformed porcelain v2 record ${JSON.stringify(record)}.`);
}
function statusFromXY(xy) {
  if (xy.includes("R")) return "renamed";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A") || xy === "??") return "added";
  if (/^[.MTCU]{2}$/.test(xy)) return "modified";
  throw malformed(xy);
}
function parsePorcelainV2(output) {
  if (output === "") return [];
  if (!output.endsWith("\0")) throw malformed(output);
  const records = output.slice(0, -1).split("\0");
  const changes = [];
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === void 0 || record === "") throw malformed(record ?? "");
    if (record.startsWith("? ")) {
      const candidate = record.slice(2);
      if (candidate === "") throw malformed(record);
      changes.push({ path: candidate, status: "added", porcelain: "??" });
      seen.add(candidate);
      continue;
    }
    if (record.startsWith("1 ")) {
      const fields = record.split(" ");
      const candidate = fields.slice(8).join(" ");
      const xy = fields[1];
      if (xy === void 0 || candidate === "") throw malformed(record);
      const status = statusFromXY(xy);
      if (status === "renamed") throw malformed(record);
      if (seen.has(candidate)) throw malformed(record);
      seen.add(candidate);
      changes.push({ path: candidate, status, porcelain: xy });
      continue;
    }
    if (record.startsWith("2 ")) {
      const fields = record.split(" ");
      const xy = fields[1];
      const candidate = fields.slice(9).join(" ");
      const source = records[index + 1];
      if (xy === void 0 || !xy.includes("R") || candidate === "" || source === void 0 || source === "" || seen.has(candidate) || seen.has(source)) {
        throw malformed(record);
      }
      seen.add(candidate);
      seen.add(source);
      changes.push({ path: candidate, status: "renamed", porcelain: xy, renameFrom: source });
      index += 1;
      continue;
    }
    throw malformed(record);
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}
function collectIndexAbsentPaths(changes) {
  const absent = /* @__PURE__ */ new Set();
  for (const change of changes) {
    const indexHalf = change.porcelain[0];
    if (change.status === "deleted" && indexHalf === "D") {
      absent.add(change.path);
    }
    if (change.status === "renamed" && change.renameFrom !== void 0 && (indexHalf === "R" || indexHalf === "C")) {
      absent.add(change.renameFrom);
    }
  }
  return absent;
}
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function createCommitScopeSnapshot(cwd, runGit = defaultGitRunner) {
  const [rootResult, commonResult, headResult, statusResult] = await Promise.all([
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
    runGit(cwd, ["rev-parse", "--git-common-dir"]),
    runGit(cwd, ["rev-parse", "HEAD"]),
    runGit(cwd, ["status", "--porcelain=v2", "-z", "--untracked-files=all"])
  ]);
  if (rootResult.exitCode !== 0 || commonResult.exitCode !== 0 || headResult.exitCode !== 0 || statusResult.exitCode !== 0) {
    throw new Error("Perun commit scope: could not create a Git snapshot.");
  }
  const root = realpathSync(rootResult.stdout.trim());
  const commonRaw = commonResult.stdout.trim();
  const commonDir = realpathSync(path.isAbsolute(commonRaw) ? commonRaw : path.resolve(root, commonRaw));
  const changes = parsePorcelainV2(statusResult.stdout).map((change) => ({
    ...change,
    path: canonicalizeRepositoryPath(change.path, root),
    ...change.renameFrom === void 0 ? {} : { renameFrom: canonicalizeRepositoryPath(change.renameFrom, root) }
  }));
  const repository = { root, commonDir };
  const head = headResult.stdout.trim();
  return { repository, head, changes, digest: digest(JSON.stringify({ repository, head, changes })) };
}
export {
  collectIndexAbsentPaths,
  createCommitScopeSnapshot,
  parsePorcelainV2
};
