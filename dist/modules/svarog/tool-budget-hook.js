import {
  bareCommitDenialMessage,
  hasExplicitCommitFiles
} from "../_shared/commit-staging-scope.js";
import { isImmutableDeny } from "../_shared/stribog-extra-tools-contract.js";
import { isMutatingGitCommand } from "../_shared/mutating-git.js";
import { SVAROG_AGENT_KEY, SVAROG_SERENA_EDITORS } from "./svarog.metadata.js";
const TOOL_DENIED = "SVAROG_TOOL_DENIED";
const SECRET_DENIED = "SVAROG_SECRET_DENIED";
const GIT_DENIED = "SVAROG_GIT_DENIED";
const SECRET_GEN_BASH = /\bopenssl\s+(rand|genrsa|genpkey|ecparam)\b|\buuidgen\b|\/dev\/urandom\b|\brandom(bytes|uuid|fill)\b|\bsecrets\.token|\bos\.urandom\b|\buuid4\b|\bgpg\s+--(gen|full-gen)|\bssh-keygen\b/i;
const PREFILTER_READS = /* @__PURE__ */ new Set(["read", "glob", "grep"]);
const MUTATING_NATIVE = /* @__PURE__ */ new Set([
  "edit",
  "write",
  "multiedit",
  "patch",
  "apply_patch"
]);
function makeSvarogToolHook(deps) {
  const checkpointed = /* @__PURE__ */ new Set();
  const hook = async (input, output) => {
    try {
      const raw = input.tool;
      if (PREFILTER_READS.has(raw)) return;
      const agent = await deps.resolveAgent(input.sessionID);
      if (agent !== SVAROG_AGENT_KEY) return;
      const norm = raw.toLowerCase().replace(/-/g, "_");
      const mutating = MUTATING_NATIVE.has(norm) || SVAROG_SERENA_EDITORS.test(norm);
      if (mutating && deps.createCheckpoint && !checkpointed.has(input.sessionID)) {
        try {
          deps.createCheckpoint(input.sessionID);
          checkpointed.add(input.sessionID);
        } catch {
        }
      }
      if (raw === "bash") {
        const command = typeof output.args?.command === "string" ? output.args.command : "";
        if (SECRET_GEN_BASH.test(command)) {
          throw new Error(
            `${SECRET_DENIED}: this command generates a secret/credential value, which is NOT Svarog's job \u2014 minting belongs to zmora-setup (minter != actuator). Do not mint, write, or echo a secret. Return the ESCALATE result and state the value must be provided (or minted by zmora-setup).`
          );
        }
        if (isMutatingGitCommand(command)) {
          throw new Error(
            `${GIT_DENIED}: this command mutates the git working tree/branch (checkout/switch/reset/restore/clean/stash/rebase/merge/cherry-pick/worktree or branch -d/-D), which Svarog \u2014 an in-tree leaf executor \u2014 must never do (it would move or rewrite the operator's worktree). Read-only git (status/log/diff/blame/show) is allowed. To create and switch to a convention-valid branch, use the create_branch tool \u2014 do NOT ESCALATE for branch creation. For any other branch/tree operation, return the ESCALATE result.`
          );
        }
        return;
      }
      if (SVAROG_SERENA_EDITORS.test(norm)) return;
      if (norm === "question") {
        throw new Error(
          `${TOOL_DENIED}: Svarog runs headless and has no \`question\` tool. A task that needs a decision is an ESCALATE, not a question \u2014 return the ESCALATE result with the open question in \`reason\`.`
        );
      }
      if (norm === "webfetch" || norm === "websearch") {
        throw new Error(
          `${TOOL_DENIED}: Svarog is a leaf in-tree executor with no network egress (\`${raw}\` denied). If the task genuinely needs external data, return the ESCALATE result.`
        );
      }
      if (norm === "av_commit" && !hasExplicitCommitFiles(output.args?.files)) {
        throw new Error(bareCommitDenialMessage(TOOL_DENIED, "Svarog"));
      }
      if (norm === "create_pr") return;
      if (norm === "create_branch") return;
      if (isImmutableDeny(norm)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Svarog (capability class: secret-mint / dispatch / shell / DB-mutation / serena-memory-write). Svarog is a leaf executor \u2014 if the task requires this, return the ESCALATE result.`
        );
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SECRET_DENIED) || message.startsWith(GIT_DENIED))
        throw error;
    }
  };
  const clearSession = (sessionID) => {
    checkpointed.delete(sessionID);
  };
  return { hook, clearSession };
}
export {
  makeSvarogToolHook
};
