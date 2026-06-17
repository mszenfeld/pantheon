import { buildAgentPrompt } from "../_shared/build-agent-prompt.js";
import { SVAROG_TOOLS } from "./allowed-tools.js";
import { svarogSpecialistInfo } from "./svarog.metadata.js";
let cached;
function buildSvarogPrompt() {
  cached ??= buildAgentPrompt(
    svarogSpecialistInfo,
    SVAROG_TOOLS,
    import.meta.url,
    "svarog.md"
  );
  return cached;
}
export {
  buildSvarogPrompt
};
