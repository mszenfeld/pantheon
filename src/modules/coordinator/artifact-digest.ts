import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"

const ALLOWED_DIRECTORIES = ["docs/specs", "docs/plans"]
const MUTABLE_APPROVAL_FIELDS = new Set([
  "approved",
  "approved_at",
  "approved_by_session",
  "approved_file_digest",
])
const FRONTMATTER_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/
const NUMBER_VALUE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

export type FrontmatterValue = boolean | number | string | null

export interface PlanningArtifactFrontmatter {
  values: Map<string, FrontmatterValue>
  body: string
}

export type PlanningArtifactDigestResult =
  | { status: "ok"; digest: string }
  | { status: "error"; reason: string }

export interface ValidatedArtifactPath {
  absolutePath: string
  canonicalPath: string
  relativePath: string
}

function isWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
}

function containsTraversal(pathValue: string): boolean {
  return pathValue.split(/[\\/]/).some((segment: string): boolean =>
    segment === "" || segment === "." || segment === "..",
  )
}

function parseFrontmatterValue(value: string): FrontmatterValue {
  if (value === "") return null
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null" || value === "~") return null
  if (NUMBER_VALUE.test(value)) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error("frontmatter number is not finite")
    return parsed
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed !== "string") {
        throw new Error("double-quoted frontmatter value must be a string")
      }
      return parsed
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`invalid double-quoted frontmatter value: ${error.message}`)
      }
      throw new Error("invalid double-quoted frontmatter value")
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error("invalid single-quoted frontmatter value")
    }
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.includes("#") || value.includes("\t") || /:\s/.test(value)) {
    throw new Error("frontmatter value must be a scalar without comments or mappings")
  }
  return value
}

function serializeFrontmatterValue(value: FrontmatterValue): string {
  if (value === null) return "null"
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (
    value === "" ||
    value.trim() !== value ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes("#") ||
    value.includes("\t") ||
    /:\s/.test(value) ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value === "~" ||
    NUMBER_VALUE.test(value) ||
    value.startsWith("'") ||
    value.startsWith('"')
  ) {
    return JSON.stringify(value)
  }
  return value
}

/** Parses the leading, flat YAML frontmatter block used by planning artifacts. */
export function parsePlanningArtifactFrontmatter(content: string): PlanningArtifactFrontmatter {
  const normalized = content.replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  if (lines[0] !== "---") {
    throw new Error("planning artifact must start with a frontmatter delimiter")
  }

  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === "---") {
      closingIndex = index
      break
    }
    if (line === undefined || line === "" || line === "...") {
      throw new Error("frontmatter contains a malformed delimiter or empty line")
    }
  }
  if (closingIndex === -1) {
    throw new Error("planning artifact has no closing frontmatter delimiter")
  }

  const values = new Map<string, FrontmatterValue>()
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([^:\s]+):(?: (.*))?$/.exec(line)
    if (match === null) throw new Error("frontmatter must contain only simple key-value mappings")
    const key = match[1]
    if (key === undefined || !FRONTMATTER_KEY.test(key)) {
      throw new Error("frontmatter key is invalid")
    }
    if (values.has(key)) throw new Error(`duplicate frontmatter key: ${key}`)
    values.set(key, parseFrontmatterValue(match[2] ?? ""))
  }

  return { values, body: lines.slice(closingIndex + 1).join("\n") }
}

/** Serializes an artifact with sorted frontmatter keys and LF line endings. */
export function serializePlanningArtifact(
  artifact: PlanningArtifactFrontmatter,
): string {
  const lines = ["---"]
  for (const key of [...artifact.values.keys()].sort((left, right) => left.localeCompare(right))) {
    const value = artifact.values.get(key)
    if (value === undefined) throw new Error(`frontmatter value disappeared for key: ${key}`)
    lines.push(`${key}: ${serializeFrontmatterValue(value)}`)
  }
  lines.push("---")
  return `${lines.join("\n")}\n${artifact.body.replace(/\r\n?/g, "\n")}`
}

/** Produces the stable bytes hashed for artifact approval and verification. */
export function canonicalizePlanningArtifact(
  artifact: PlanningArtifactFrontmatter,
): string {
  const canonicalValues = new Map<string, FrontmatterValue>()
  for (const [key, value] of artifact.values) {
    if (!MUTABLE_APPROVAL_FIELDS.has(key)) canonicalValues.set(key, value)
  }
  return serializePlanningArtifact({ values: canonicalValues, body: artifact.body })
}

/** Computes the SHA-256 digest of the canonical planning-artifact representation. */
export function canonicalPlanningArtifactDigest(content: string): string {
  const artifact = parsePlanningArtifactFrontmatter(content)
  return createHash("sha256")
    .update(canonicalizePlanningArtifact(artifact), "utf8")
    .digest("hex")
}

export function resolvePlanningArtifactPath(pathValue: string): ValidatedArtifactPath {
  if (path.isAbsolute(pathValue) || containsTraversal(pathValue)) {
    throw new Error("planning artifact path must be a traversal-free relative path")
  }

  const worktree = realpathSync(process.cwd())
  const absolutePath = path.resolve(worktree, pathValue)
  const lexicalDirectory = ALLOWED_DIRECTORIES
    .map((directory: string): string => path.resolve(worktree, directory))
    .find((directory: string): boolean => isWithin(directory, absolutePath))
  if (lexicalDirectory === undefined) {
    throw new Error("planning artifacts must be under docs/specs or docs/plans")
  }

  const canonicalDirectory = realpathSync(lexicalDirectory)
  if (!isWithin(worktree, canonicalDirectory)) {
    throw new Error("planning artifact directory escapes the worktree")
  }

  const relativeParts = path.relative(worktree, absolutePath).split(path.sep)
  let current = worktree
  for (const part of relativeParts) {
    current = path.join(current, part)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("planning artifact path must not traverse a symlink")
    }
  }

  const fileStat = lstatSync(absolutePath)
  if (!fileStat.isFile()) throw new Error("planning artifact must be a regular file")

  const canonicalPath = realpathSync(absolutePath)
  if (!isWithin(canonicalDirectory, canonicalPath)) {
    throw new Error("planning artifact resolves outside its allowed directory")
  }
  return {
    absolutePath: canonicalPath,
    canonicalPath,
    relativePath: path.relative(worktree, canonicalPath).split(path.sep).join("/"),
  }
}

/** Reads, validates, canonicalizes, and hashes a planning artifact. */
export function getPlanningArtifactDigest(pathValue: string): PlanningArtifactDigestResult {
  try {
    const artifactPath = resolvePlanningArtifactPath(pathValue)
    return {
      status: "ok",
      digest: canonicalPlanningArtifactDigest(readFileSync(artifactPath.absolutePath, "utf8")),
    }
  } catch (error: unknown) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "could not digest planning artifact",
    }
  }
}
