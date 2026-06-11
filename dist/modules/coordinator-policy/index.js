import {
  buildViolationError,
  classifyCoordinatorBash,
  forgetSessionAgent,
  isCoordinatorSession
} from "@appverk/opencode-skill-utils";
import { readCoordinatorBashAllowlist } from "./read-allowlist.js";
function makeBashGate(client, allowed) {
  return async (input, output) => {
    if (input.tool !== "bash") return;
    if (!await isCoordinatorSession(input.sessionID, client)) return;
    const command = String(output.args?.command ?? "");
    const verdict = classifyCoordinatorBash(command, allowed);
    if (!verdict.allowed) throw buildViolationError({ tool: "bash", command, reason: "not-allowlisted" });
  };
}
const AppVerkCoordinatorPolicyPlugin = async ({ client }) => {
  const allowed = readCoordinatorBashAllowlist();
  const gate = makeBashGate(client, allowed);
  return {
    "tool.execute.before": gate,
    // The per-bash-call gate resolves identity through `isCoordinatorSession`, which
    // memoizes into the shared session→agent cache in skill-utils. Evict that entry on
    // session teardown so the module-level map does not grow unbounded over a long-lived
    // process (one entry per session, plus one per dispatch-child, otherwise kept forever).
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const deletedID = event.properties?.info?.id;
      if (typeof deletedID === "string" && deletedID.length > 0) {
        forgetSessionAgent(deletedID);
      }
    }
  };
};
export {
  AppVerkCoordinatorPolicyPlugin,
  makeBashGate
};
