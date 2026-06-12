import { buildAgentPrompt } from "../_shared/build-agent-prompt.js";
import { TRIGLAV_TOOLS } from "./allowed-tools.js";
import { triglavSpecialistInfo } from "./triglav.metadata.js";
let cached;
function buildTriglavPrompt() {
  cached ??= buildAgentPrompt(
    triglavSpecialistInfo,
    TRIGLAV_TOOLS,
    import.meta.url,
    "triglav.md"
  );
  return cached;
}
export {
  buildTriglavPrompt
};
