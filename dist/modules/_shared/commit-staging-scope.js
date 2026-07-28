const CONTROL_BYTE = /[\x00-\x1f\x7f-\x9f]/;
const ROOT_EQUIVALENT = /* @__PURE__ */ new Set([
  ".",
  "./",
  "..",
  "../",
  "/",
  "*",
  "**",
  "",
  "./."
]);
function isScopedCommitPath(value) {
  if (typeof value !== "string") return false;
  if (value !== value.trim()) return false;
  const path = value.trim();
  if (path === "") return false;
  if (CONTROL_BYTE.test(path)) return false;
  if (path.startsWith(":")) return false;
  if (path.includes("*") || path.includes("?") || path.includes("["))
    return false;
  const normalized = path.replace(/\/+$/, "");
  if (ROOT_EQUIVALENT.has(normalized) || ROOT_EQUIVALENT.has(path)) return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return false;
  return segments.some((segment) => segment !== "" && segment !== ".");
}
function hasExplicitCommitFiles(files) {
  return Array.isArray(files) && files.length > 0 && files.every(isScopedCommitPath);
}
function findDirectoryPath(files, isDirectory) {
  return files.find((file) => isDirectory(file.trim()));
}
function bareCommitDenialMessage(marker, agent) {
  return `${marker}: ${agent} must call av_commit with an explicit 'files' list naming the concrete paths it edited \u2014 e.g. av_commit({ message, files: ["src/thing.ts"] }). Omitting 'files', or naming a whole-tree pathspec ("." / "./" / "/" / ":/" / a glob / a "..") stages the ENTIRE worktree, which in a shared working tree would commit unrelated operator changes \u2014 and create_pr would publish them. Retry with the individual file paths. Do NOT ESCALATE for this \u2014 it is a redirect.`;
}
function directoryCommitDenialMessage(marker, agent, path) {
  return `${marker}: av_commit named ${JSON.stringify(path)}, which is not a single existing file \u2014 a DIRECTORY would stage every modified and untracked file beneath it (including unrelated operator changes in the shared worktree, which create_pr would then publish), and a path that does not resolve cannot be checked at all. ${agent} must name individual, existing file paths, relative to the repo root or absolute. Retry with the concrete files you changed. Do NOT ESCALATE for this \u2014 it is a redirect.`;
}
function unbudgetedCommitPathMessage(marker, path, edited) {
  return `${marker}: av_commit named ${JSON.stringify(path)}, which Stribog did not edit this session (edited: ${edited.length > 0 ? edited.map((p) => JSON.stringify(p)).join(", ") : "nothing yet"}). A leaf actuator commits only the files it changed \u2014 staging anything else would publish unrelated work past the edit budget. Retry naming exactly those paths (the same spelling works: an absolute path, or one relative to the repo root). If the task genuinely requires committing a file you did not edit, return the ESCALATE result instead.`;
}
export {
  bareCommitDenialMessage,
  directoryCommitDenialMessage,
  findDirectoryPath,
  hasExplicitCommitFiles,
  isScopedCommitPath,
  unbudgetedCommitPathMessage
};
