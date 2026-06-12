import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

export interface SkillEntry {
  name: string
  description: string
  activation: string
  filePath: string
  allowedTools?: string[]
}

export function parseSkillFrontmatter(
  content: string,
  fileName: string,
): SkillEntry | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch) {
    return null
  }

  const raw = frontmatterMatch[1] ?? ""
  if (!raw) {
    return null
  }
  const lines = raw.split(/\r?\n/)
  const fields: Record<string, string> = {}

  for (const line of lines) {
    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    let value = line.slice(colonIndex + 1).trim()
    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }

  if (!fields.name) {
    throw new Error(
      `Skill file ${fileName} is missing required 'name' in frontmatter`,
    )
  }

  const allowedTools = fields["allowed-tools"]
    ? fields["allowed-tools"]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined

  return {
    name: fields.name,
    description: fields.description || "",
    activation: fields.activation || "Load when relevant to the task",
    filePath: fileName,
    allowedTools,
  }
}

/**
 * Validates that every tool in `subset` is present in `superset`.
 * This enforces the security rule that a skill's `allowed-tools` must be
 * a subset of the agent's own tool set to prevent privilege escalation.
 *
 * Matching is exact (after trimming). Future enhancements could add
 * wildcard-aware comparison for Bash tool patterns.
 */
export function isToolSubset(
  subset: readonly string[],
  superset: readonly string[],
): boolean {
  const supersetNormalized = new Set(
    superset.map((t) => t.trim()).filter(Boolean),
  )
  for (const tool of subset) {
    const normalized = tool.trim()
    if (!normalized) continue
    if (!supersetNormalized.has(normalized)) {
      return false
    }
  }
  return true
}

export function buildSkillCatalog(
  directories: readonly string[],
): Map<string, SkillEntry> {
  const catalog = new Map<string, SkillEntry>()

  for (const dir of directories) {
    if (!existsSync(dir)) {
      continue
    }

    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const skillFilePath = path.join(dir, entry.name, "SKILL.md")
      if (!existsSync(skillFilePath)) {
        continue
      }

      const content = readFileSync(skillFilePath, "utf8")
      const parsed = parseSkillFrontmatter(content, skillFilePath)

      if (!parsed) {
        continue
      }

      if (catalog.has(parsed.name)) {
        throw new Error(
          `Duplicate skill name "${parsed.name}" found in ${skillFilePath}. ` +
            `Already defined in ${catalog.get(parsed.name)!.filePath}.`,
        )
      }

      catalog.set(parsed.name, parsed)
    }
  }

  return catalog
}
