function hasExplicitCommitFiles(files) {
  return Array.isArray(files) && files.length > 0 && files.every((file) => typeof file === "string" && file.trim() !== "");
}
function bareCommitDenialMessage(marker, agent) {
  return `${marker}: ${agent} must call av_commit with an explicit, non-empty 'files' list naming the paths it edited. A bare av_commit stages the ENTIRE worktree (git add -A), which in a shared working tree would commit unrelated operator changes \u2014 and create_pr would publish them. Retry as av_commit({ message, files: ["path/you/edited.ts"] }). Do NOT ESCALATE for this \u2014 it is a redirect.`;
}
export {
  bareCommitDenialMessage,
  hasExplicitCommitFiles
};
