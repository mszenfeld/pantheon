import { readFileSync } from "node:fs"
import type { SkillEntry } from "./skill-catalog.js"

export function createSkillLoader(
  catalog: Map<string, SkillEntry>,
): (name: string) => string {
  const cache = new Map<string, string>()
  const availableNames = Array.from(catalog.keys()).sort()

  return function loadSkill(name: string): string {
    const entry = catalog.get(name)
    if (!entry) {
      throw new Error(
        `AppVerk skill not found: "${name}". Available skills: ${availableNames.join(", ")}`,
      )
    }

    if (cache.has(name)) {
      return cache.get(name)!
    }

    const content = readFileSync(entry.filePath, "utf8")
    cache.set(name, content)
    return content
  }
}
