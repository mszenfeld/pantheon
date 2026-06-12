import { buildAgentPrompt } from "../_shared/build-agent-prompt.js"
import { TRIGLAV_TOOLS } from "./allowed-tools.js"
import { triglavSpecialistInfo } from "./triglav.metadata.js"

let cached: string | undefined

export function buildTriglavPrompt(): string {
  cached ??= buildAgentPrompt(
    triglavSpecialistInfo,
    TRIGLAV_TOOLS,
    import.meta.url,
    "triglav.md",
  )
  return cached
}
