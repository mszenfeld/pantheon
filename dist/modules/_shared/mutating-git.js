const MUTATING_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "checkout",
  "switch",
  "reset",
  "restore",
  "clean",
  "stash",
  "rebase",
  "merge",
  "cherry-pick",
  "worktree"
]);
const GLOBAL_OPTS_WITH_ARG = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path"
]);
function programIndex(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === void 0) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++;
      continue;
    }
    if (t === "sudo" || t === "command" || t === "nohup" || t === "env" || t === "time") {
      i++;
      continue;
    }
    break;
  }
  return i;
}
function subcommandOf(tokens, gitIdx) {
  let i = gitIdx + 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === void 0) break;
    if (t.startsWith("-")) {
      i += GLOBAL_OPTS_WITH_ARG.has(t) ? 2 : 1;
      continue;
    }
    break;
  }
  return i;
}
function isMutatingGitCommand(command) {
  for (const segment of command.split(/&&|\|\||[;|&\n]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const pi = programIndex(tokens);
    if (tokens[pi] !== "git") continue;
    const si = subcommandOf(tokens, pi);
    const sub = tokens[si];
    if (sub === void 0) continue;
    if (MUTATING_SUBCOMMANDS.has(sub)) return true;
    if (sub === "branch") {
      const rest = tokens.slice(si + 1);
      if (rest.some((t) => t === "-d" || t === "-D" || t === "--delete"))
        return true;
    }
  }
  return false;
}
export {
  isMutatingGitCommand
};
