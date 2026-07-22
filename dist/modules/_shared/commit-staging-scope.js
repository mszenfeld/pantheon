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
function bareCommitDenialMessage(marker, agent) {
  return `${marker}: ${agent} must call av_commit with an explicit 'files' list naming the concrete paths it edited \u2014 e.g. av_commit({ message, files: ["src/thing.ts"] }). Omitting 'files', or naming a whole-tree pathspec ("." / "./" / "/" / ":/" / a glob / a "..") stages the ENTIRE worktree, which in a shared working tree would commit unrelated operator changes \u2014 and create_pr would publish them. Retry with the individual file paths. Do NOT ESCALATE for this \u2014 it is a redirect.`;
}
function unbudgetedCommitPathMessage(marker, path, edited) {
  return `${marker}: av_commit named '${path}', which Stribog never edited this session (edited: ${edited.length > 0 ? edited.join(", ") : "nothing yet"}). A leaf actuator commits only the files it changed \u2014 staging anything else would publish unrelated work past the edit budget. Retry naming only your own edited paths. Do NOT ESCALATE for this \u2014 it is a redirect.`;
}
function matchesEditedPath(candidate, edited) {
  const normalized = candidate.trim().replace(/^\.\//, "");
  for (const path of edited) {
    if (path === normalized) return true;
    if (path.endsWith(`/${normalized}`)) return true;
  }
  return false;
}
export {
  bareCommitDenialMessage,
  hasExplicitCommitFiles,
  isScopedCommitPath,
  matchesEditedPath,
  unbudgetedCommitPathMessage
};
