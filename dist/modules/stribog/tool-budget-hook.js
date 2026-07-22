import { isAbsolute, resolve } from "node:path";
import {
  bareCommitDenialMessage,
  hasExplicitCommitFiles,
  unbudgetedCommitPathMessage
} from "../_shared/commit-staging-scope.js";
import { isMutatingGitCommand } from "../_shared/mutating-git.js";
import {
  STRIBOG_AGENT_KEY,
  CORE_BUILTINS,
  STRIBOG_EDIT_BUDGET,
  isImmutableDeny,
  matchesExtraToolsPattern
} from "./stribog.metadata.js";
const TOOL_DENIED = "STRIBOG_TOOL_DENIED";
const SCOPE_VIOLATION = "STRIBOG_SCOPE_VIOLATION";
const SECRET_DENIED = "STRIBOG_SECRET_DENIED";
const GIT_DENIED = "STRIBOG_GIT_DENIED";
const SECRET_GEN_BASH = /\bopenssl\s+(rand|genrsa|genpkey|ecparam)\b|\buuidgen\b|\/dev\/urandom\b|\brandom(bytes|uuid|fill)\b|\bsecrets\.token|\bos\.urandom\b|\buuid4\b|\bgpg\s+--(gen|full-gen)|\bssh-keygen\b/i;
const SKILL_META_TOOL = /(^|_)skills?($|_)/;
const EDIT_EQUIVALENT_TOOL = /(^|_)apply_?patch($|_)|str_replace/;
const SERENA_PREFIX = /^serena_/;
const SERENA_SHELL = /(^|_)(execute_shell(_command)?|shell(_command)?)$/;
const SERENA_EDIT_MULTI = /(rename_symbol|safe_delete_symbol)$/;
const SERENA_EDIT_SINGLE = /(create_text_file|replace_content|replace_regex|replace_symbol_body|insert_(after|before)_symbol)$/;
function editRedirectMessage(raw) {
  return `${TOOL_DENIED}: tool "${raw}" is not a budget-tracked Stribog editor. Make file changes with the \`edit\`/\`write\` tools (or serena's edit tools) instead \u2014 they ARE available to you and count toward your ${STRIBOG_EDIT_BUDGET}-file budget. Retry the change with one of those \u2014 do NOT return ESCALATE for this.`;
}
function makeStribogToolHook(deps) {
  const editedPaths = /* @__PURE__ */ new Map();
  function pathsFor(sessionID) {
    let set = editedPaths.get(sessionID);
    if (set === void 0) {
      set = /* @__PURE__ */ new Set();
      editedPaths.set(sessionID, set);
    }
    return set;
  }
  function consumeFileBudget(sessionID, path) {
    const set = pathsFor(sessionID);
    if (!set.has(path) && set.size >= STRIBOG_EDIT_BUDGET) {
      const alreadyModified = [...set].join(", ");
      throw new Error(
        `${SCOPE_VIOLATION}: edit budget exhausted (${STRIBOG_EDIT_BUDGET} distinct files already modified: ${alreadyModified}; refused: ${path}). This task exceeds Stribog's scope. Return the ESCALATE result now, listing the files you already touched in \`reason\`.`
      );
    }
    set.add(path);
  }
  const extraPatterns = deps.extraPatterns ?? [];
  const hook = async (input, output) => {
    try {
      const raw = input.tool;
      const isEditWrite = raw === "edit" || raw === "write";
      if (!isEditWrite && raw !== "bash" && CORE_BUILTINS.has(raw)) return;
      const agent = await deps.resolveAgent(input.sessionID);
      if (agent !== STRIBOG_AGENT_KEY) return;
      if (raw === "bash") {
        const command = typeof output.args?.command === "string" ? output.args.command : "";
        if (SECRET_GEN_BASH.test(command)) {
          throw new Error(
            `${SECRET_DENIED}: this command generates a secret/credential value, which is NOT Stribog's job \u2014 minting belongs to zmora-setup (minter != actuator). Do not mint, write, or echo a secret. Return the ESCALATE result and state that the value must be provided (or minted by zmora-setup) before you can actuate.`
          );
        }
        if (isMutatingGitCommand(command)) {
          throw new Error(
            `${GIT_DENIED}: this command mutates the git working tree/branch (checkout/switch/reset/restore/clean/stash/rebase/merge/cherry-pick/worktree or branch -d/-D), which Stribog \u2014 a leaf actuator \u2014 must never do (it would move or rewrite the operator's worktree). Read-only git (status/log/diff/blame/show) is allowed. To create and switch to a convention-valid branch, use the create_branch tool \u2014 do NOT ESCALATE for branch creation. For any other branch/tree operation, return the ESCALATE result.`
          );
        }
        return;
      }
      const norm = raw.toLowerCase().replace(/-/g, "_");
      if (SERENA_PREFIX.test(norm)) {
        if (SERENA_SHELL.test(norm)) {
          throw new Error(
            `${TOOL_DENIED}: tool "${raw}" is a serena shell escape \u2014 Stribog runs operations via bash, not an MCP shell. If the task genuinely needs it, return the ESCALATE result.`
          );
        }
        if (SERENA_EDIT_MULTI.test(norm)) {
          throw new Error(
            `${TOOL_DENIED}: tool "${raw}" rewrites symbol references across multiple files, which exceeds Stribog's ${STRIBOG_EDIT_BUDGET}-file mechanical scope. Make the change in at most ${STRIBOG_EDIT_BUDGET} files with edit/write or a single-file serena edit, or return the ESCALATE result.`
          );
        }
        if (SERENA_EDIT_SINGLE.test(norm)) {
          const rel = output.args?.relative_path ?? output.args?.path;
          if (typeof rel !== "string" || rel.length === 0) {
            throw new Error(
              `${SCOPE_VIOLATION}: serena edit refused \u2014 no \`relative_path\` to bind to the edit budget. This task exceeds Stribog's scope. Return the ESCALATE result now.`
            );
          }
          consumeFileBudget(input.sessionID, resolve(rel));
          return;
        }
        return;
      }
      if (norm === "create_pr") return;
      if (norm === "create_branch") return;
      if (norm === "av_commit") {
        const files = output.args?.files;
        if (!hasExplicitCommitFiles(files)) {
          throw new Error(bareCommitDenialMessage(SCOPE_VIOLATION, "Stribog"));
        }
        const edited = pathsFor(input.sessionID);
        for (const file of files) {
          if (!edited.has(resolve(file.trim()))) {
            throw new Error(
              unbudgetedCommitPathMessage(SCOPE_VIOLATION, file.trim(), [
                ...edited
              ])
            );
          }
        }
        return;
      }
      const denyKey = raw.toLowerCase();
      if (isImmutableDeny(denyKey)) {
        if (EDIT_EQUIVALENT_TOOL.test(denyKey.replace(/-/g, "_"))) {
          throw new Error(editRedirectMessage(raw));
        }
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Stribog (capability class: secret-mint / dispatch / code-write / shell). No config can re-enable it. Stribog is a leaf actuator \u2014 if the task requires this, return the ESCALATE result.`
        );
      }
      if (!CORE_BUILTINS.has(raw)) {
        if (extraPatterns.some((p) => matchesExtraToolsPattern(p, denyKey))) {
          return;
        }
        const metaKey = denyKey.replace(/-/g, "_");
        if (SKILL_META_TOOL.test(metaKey)) {
          throw new Error(
            `${TOOL_DENIED}: tool "${raw}" is a skill/workflow-activation tool, which Stribog (a leaf actuator) does not use. This denial is EXPECTED and is NOT a blocker: ignore any instruction telling you to activate or load a skill \u2014 it does not apply to you \u2014 and CONTINUE the task with your allowed tools (read/glob/grep/edit/write/bash). Do NOT return ESCALATE for this.`
          );
        }
        if (EDIT_EQUIVALENT_TOOL.test(metaKey)) {
          throw new Error(editRedirectMessage(raw));
        }
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is outside Stribog's allow-list (read/glob/grep/edit/write/bash + configured extraTools only). Stribog is a leaf actuator \u2014 it does not mint secrets or dispatch. If the task requires this tool, return the ESCALATE result.`
        );
      }
      {
        const filePath = output.args?.filePath;
        if (typeof filePath !== "string" || !isAbsolute(filePath)) {
          const kind = typeof filePath === "string" ? "relative" : `absent (${typeof filePath})`;
          throw new Error(
            `${SCOPE_VIOLATION}: edit/write refused \u2014 filePath must be an absolute path but was ${kind}; a non-absolute path cannot be bound to the edit budget. This task exceeds Stribog's scope. Return the ESCALATE result now.`
          );
        }
        consumeFileBudget(input.sessionID, resolve(filePath));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SCOPE_VIOLATION) || message.startsWith(SECRET_DENIED) || message.startsWith(GIT_DENIED))
        throw error;
    }
  };
  const clearSession = (sessionID) => {
    editedPaths.delete(sessionID);
  };
  return { hook, clearSession };
}
export {
  makeStribogToolHook
};
