import { buildAgentPrompt } from "../_shared/build-agent-prompt.js"
import { VELES_TOOLS } from "./allowed-tools.js"
import { velesSpecialistInfo } from "./veles.metadata.js"

let cached: string | undefined

export function buildVelesPrompt(): string {
  cached ??= buildAgentPrompt(
    velesSpecialistInfo,
    VELES_TOOLS,
    import.meta.url,
    "veles.md",
  )
  return cached
}
