import { buildAgentPrompt } from "../_shared/build-agent-prompt.js";
import { VELES_TOOLS } from "./allowed-tools.js";
import { velesSpecialistInfo } from "./veles.metadata.js";
function buildVelesPrompt() {
  return buildAgentPrompt(
    velesSpecialistInfo,
    VELES_TOOLS,
    import.meta.url,
    "veles.md"
  );
}
export {
  buildVelesPrompt
};
