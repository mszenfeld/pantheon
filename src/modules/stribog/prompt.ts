import { loadModuleAsset } from "../_shared/load-asset.js"
import { STRIBOG_TOOLS } from "./allowed-tools.js"
import { stribogSpecialistInfo } from "./stribog.metadata.js"

let cached: string | undefined

export function buildStribogPrompt(): string {
  if (cached === undefined) {
    const frontmatter = [
      "---",
      `name: ${stribogSpecialistInfo.name}`,
      `description: ${stribogSpecialistInfo.description}`,
      `mode: ${stribogSpecialistInfo.mode}`,
      `allowed-tools: ${STRIBOG_TOOLS.join(", ")}`,
      "---",
    ].join("\n")
    const body = loadModuleAsset(import.meta.url, "stribog.md")
    cached = `${frontmatter}\n\n${body}`
  }
  return cached
}
