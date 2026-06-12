import { buildAgentPrompt } from "../_shared/build-agent-prompt.js"
import { STRIBOG_TOOLS } from "./allowed-tools.js"
import { stribogSpecialistInfo } from "./stribog.metadata.js"

let cached: string | undefined

export function buildStribogPrompt(): string {
  cached ??= buildAgentPrompt(
    stribogSpecialistInfo,
    STRIBOG_TOOLS,
    import.meta.url,
    "stribog.md",
  )
  return cached
}
