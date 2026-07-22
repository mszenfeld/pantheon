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
  const path = value.trim();
  if (path === "") return false;
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
  return `${marker}: av_commit named '${path}', which is a DIRECTORY \u2014 staging it would add every modified and untracked file beneath it, including unrelated operator changes in the shared worktree, and create_pr would publish them. ${agent} must name individual file paths. Retry with the concrete files you changed. Do NOT ESCALATE for this \u2014 it is a redirect.`;
}
function unbudgetedCommitPathMessage(marker, path, edited) {
  return `${marker}: av_commit named '${path}', which Stribog did not edit this session (edited: ${edited.length > 0 ? edited.join(", ") : "nothing yet"}). A leaf actuator commits only the files it changed \u2014 staging anything else would publish unrelated work past the edit budget. Retry naming exactly those paths (the same spelling works: an absolute path, or one relative to the repo root). If the task genuinely requires committing a file you did not edit, return the ESCALATE result instead.`;
}
export {
  bareCommitDenialMessage,
  directoryCommitDenialMessage,
  findDirectoryPath,
  hasExplicitCommitFiles,
  isScopedCommitPath,
  unbudgetedCommitPathMessage
};
