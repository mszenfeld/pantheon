import { isImmutableDeny } from "../_shared/stribog-extra-tools-contract.js";
import { SVAROG_AGENT_KEY, SVAROG_SERENA_EDITORS } from "./svarog.metadata.js";
const TOOL_DENIED = "SVAROG_TOOL_DENIED";
const SECRET_DENIED = "SVAROG_SECRET_DENIED";
const SECRET_GEN_BASH = /\bopenssl\s+(rand|genrsa|genpkey|ecparam)\b|\buuidgen\b|\/dev\/urandom\b|\brandom(bytes|uuid|fill)\b|\bsecrets\.token|\bos\.urandom\b|\buuid4\b|\bgpg\s+--(gen|full-gen)|\bssh-keygen\b/i;
const PREFILTER_READS = /* @__PURE__ */ new Set(["read", "glob", "grep"]);
const MUTATING_NATIVE = /* @__PURE__ */ new Set(["edit", "write", "multiedit"]);
function makeSvarogToolHook(deps) {
  const checkpointed = /* @__PURE__ */ new Set();
  const hook = async (input, output) => {
    try {
      const raw = input.tool;
      if (PREFILTER_READS.has(raw)) return;
      const agent = await deps.resolveAgent(input.sessionID);
      if (agent !== SVAROG_AGENT_KEY) return;
      const norm = raw.toLowerCase().replace(/-/g, "_");
      const mutating = MUTATING_NATIVE.has(raw) || SVAROG_SERENA_EDITORS.test(norm);
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
        return;
      }
      if (SVAROG_SERENA_EDITORS.test(norm)) return;
      if (norm === "question") {
        throw new Error(
          `${TOOL_DENIED}: Svarog runs headless and has no \`question\` tool. A task that needs a decision is an ESCALATE, not a question \u2014 return the ESCALATE result with the open question in \`reason\`.`
        );
      }
      if (isImmutableDeny(norm)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Svarog (capability class: secret-mint / dispatch / shell / DB-mutation / serena-memory-write). Svarog is a leaf executor \u2014 if the task requires this, return the ESCALATE result.`
        );
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SECRET_DENIED))
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
