import { execFile, spawn } from "node:child_process"

const CHANGE_MANIFEST_MARKER = "CHANGE_MANIFEST_V1:"
const RISK_FLAGS = new Set([
  "auth",
  "egress",
  "agent_contract",
  "public_api",
  "cross_module",
  "data_migration",
])
const SENSITIVE_PATH_PREFIXES = [
  "src/modules/_shared/",
  "src/modules/agent-registry/",
  "src/modules/agent-roster/",
  "src/modules/coordinator/",
  "src/modules/coordinator-policy/",
  "src/modules/plan/",
  "src/modules/qa/",
  "src/modules/commit/",
  "src/modules/stribog/",
  "src/modules/svarog/",
  "src/agents/",
  "src/commands/",
] as const
const SENSITIVE_PATHS = new Set([
  "packages/skill-utils/src/session-identity.ts",
  "packages/skill-utils/src/coordinator-bash-policy.ts",
  "docs/agent-contracts.md",
  "docs/configuring-agents.md",
])

export interface FeatureManifest {
  files_changed: string[]
  modules_affected: string[]
  new_surface_types: string[]
  risk_flags: string[]
  estimated_complexity: "mechanical" | "simple" | "complex"
}

export interface GitRunner {
  revParse(ref: string): Promise<string>
  mergeBase(base: string, head: string): Promise<string>
  diffNameOnly(base: string): Promise<string[]>
}

export function isGitRunner(value: unknown): value is GitRunner {
  if (!isRecord(value)) return false
  return (
    typeof value.revParse === "function" &&
    typeof value.mergeBase === "function" &&
    typeof value.diffNameOnly === "function"
  )
}

export interface ValidateAndClassifyOptions {
  gitRunner?: GitRunner
  base?: string
  userRequestedPlanning?: boolean
}

export type ValidateAndClassifyResult =
  | { executor: "stribog" | "svarog" | "veles"; reason: string }
  | { error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown): item is string => typeof item === "string")
}

function isEstimatedComplexity(
  value: unknown,
): value is FeatureManifest["estimated_complexity"] {
  return value === "mechanical" || value === "simple" || value === "complex"
}

function isFeatureManifest(value: unknown): value is FeatureManifest {
  if (!isRecord(value)) return false
  return (
    isStringArray(value.files_changed) &&
    isStringArray(value.modules_affected) &&
    isStringArray(value.new_surface_types) &&
    isStringArray(value.risk_flags) &&
    isEstimatedComplexity(value.estimated_complexity)
  )
}

/** Extract the first wrapped Triglav manifest after the stable output marker. */
export function parseManifest(text: string): FeatureManifest | undefined {
  const markerIndex = text.indexOf(CHANGE_MANIFEST_MARKER)
  if (markerIndex === -1) return undefined

  const afterMarker = text.slice(markerIndex + CHANGE_MANIFEST_MARKER.length)
  const fencedJson = /```json\s*\n([\s\S]*?)\n```/.exec(afterMarker)
  const payload = fencedJson?.[1]
  if (payload === undefined) return undefined

  try {
    const parsed: unknown = JSON.parse(payload)
    if (!isRecord(parsed) || !isFeatureManifest(parsed.manifest)) return undefined
    return parsed.manifest
  } catch {
    return undefined
  }
}

function hasUniqueNonEmptyStrings(values: string[]): boolean {
  return (
    values.every((value: string): boolean => value.trim().length > 0) &&
    new Set(values).size === values.length
  )
}

function isRepoRelativePath(value: string): boolean {
  return (
    value.trim().length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment: string): boolean => segment === "." || segment === "..")
  )
}

function hasSensitivePath(files: string[]): boolean {
  return files.some((file: string): boolean => {
    const lowerCaseFile = file.toLowerCase()
    return (
      SENSITIVE_PATH_PREFIXES.some((prefix: string): boolean => file.startsWith(prefix)) ||
      SENSITIVE_PATHS.has(file) ||
      lowerCaseFile.includes("auth") ||
      lowerCaseFile.includes("egress") ||
      lowerCaseFile.includes("secret") ||
      lowerCaseFile.includes("credential")
    )
  })
}

function matchesTrustedFiles(manifestFiles: string[], changedFiles: string[]): boolean {
  if (manifestFiles.length !== changedFiles.length) return false
  if (!hasUniqueNonEmptyStrings(changedFiles) || !changedFiles.every(isRepoRelativePath)) return false

  const manifestSet = new Set(manifestFiles)
  return changedFiles.every((file: string): boolean => manifestSet.has(file))
}

function isValidManifest(manifest: FeatureManifest): boolean {
  return (
    hasUniqueNonEmptyStrings(manifest.files_changed) &&
    manifest.files_changed.every(isRepoRelativePath) &&
    hasUniqueNonEmptyStrings(manifest.modules_affected) &&
    hasUniqueNonEmptyStrings(manifest.new_surface_types) &&
    hasUniqueNonEmptyStrings(manifest.risk_flags) &&
    manifest.risk_flags.every((flag: string): boolean => RISK_FLAGS.has(flag))
  )
}

/**
 * Apply the conservative routing table. A trusted changed-file list is required
 * for every direct executor route; malformed or uncertain input routes to Veles.
 */
export function classifyManifest(
  manifest: FeatureManifest,
  changedFiles?: string[],
): "stribog" | "svarog" | "veles" {
  if (!isValidManifest(manifest) || changedFiles === undefined) return "veles"
  if (!matchesTrustedFiles(manifest.files_changed, changedFiles)) return "veles"
  if (hasSensitivePath(manifest.files_changed)) return "veles"
  if (
    manifest.estimated_complexity === "complex" ||
    manifest.risk_flags.length > 0 ||
    manifest.new_surface_types.length > 0 ||
    manifest.modules_affected.length >= 3
  ) {
    return "veles"
  }

  if (
    manifest.estimated_complexity === "mechanical" &&
    manifest.files_changed.length >= 1 &&
    manifest.files_changed.length <= 2
  ) {
    return "stribog"
  }

  if (
    manifest.estimated_complexity === "simple" &&
    manifest.files_changed.length >= 1 &&
    manifest.files_changed.length <= 3
  ) {
    return "svarog"
  }

  return "veles"
}

function runGit(args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      args,
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
      (error: Error | null, stdout: string | Buffer): void => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve(typeof stdout === "string" ? Buffer.from(stdout) : stdout)
      },
    )
  })
}

function decodeGitOutput(output: Buffer): string {
  return output.toString("utf8").trim()
}

export function parseNulDelimitedPaths(chunks: readonly Buffer[]): string[] {
  const paths: string[] = []
  let remainder = Buffer.alloc(0)
  for (const chunk of chunks) {
    let data = Buffer.concat([remainder, chunk])
    let delimiterIndex = data.indexOf(0)
    while (delimiterIndex !== -1) {
      if (delimiterIndex > 0) paths.push(data.subarray(0, delimiterIndex).toString("utf8"))
      data = data.subarray(delimiterIndex + 1)
      delimiterIndex = data.indexOf(0)
    }
    remainder = data
  }
  if (remainder.length > 0) paths.push(remainder.toString("utf8"))
  return paths
}

function streamGitDiffNameOnly(base: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn("git", ["diff", "--name-only", "-z", "--end-of-options", base, "HEAD"])
    const chunks: Buffer[] = []
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer): void => {
      chunks.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer): void => {
      stderr += chunk.toString("utf8")
    })
    child.once("error", reject)
    child.once("close", (code: number | null): void => {
      if (code !== 0) {
        reject(new Error(stderr || `git diff exited with status ${code ?? "unknown"}`))
        return
      }
      resolve(parseNulDelimitedPaths(chunks))
    })
  })
}

/** Production git adapter. `diffNameOnly` uses NUL-delimited output for safe filenames. */
export const execFileGitRunner: GitRunner = {
  async revParse(ref: string): Promise<string> {
    return decodeGitOutput(await runGit(["rev-parse", "--verify", "--end-of-options", ref]))
  },
  async mergeBase(base: string, head: string): Promise<string> {
    return decodeGitOutput(await runGit(["merge-base", "--end-of-options", base, head]))
  },
  async diffNameOnly(base: string): Promise<string[]> {
    return streamGitDiffNameOnly(base)
  },
}

async function resolveBase(gitRunner: GitRunner, base?: string): Promise<string> {
  if (base !== undefined) return gitRunner.revParse(base)

  try {
    return await gitRunner.revParse("origin/HEAD")
  } catch {
    try {
      return await gitRunner.revParse("master")
    } catch {
      return gitRunner.revParse("main")
    }
  }
}

function classificationReason(executor: "stribog" | "svarog" | "veles"): string {
  if (executor === "stribog") {
    return "mechanical manifest matches the trusted git diff"
  }
  if (executor === "svarog") {
    return "simple manifest matches the trusted git diff"
  }
  return "manifest requires conservative Veles planning"
}

/** Validate a Triglav result against Git's authoritative changed-file list. */
export async function validateAndClassify(
  text: string,
  options: ValidateAndClassifyOptions = {},
): Promise<ValidateAndClassifyResult> {
  if (options.userRequestedPlanning === true) {
    return { executor: "veles", reason: "user explicitly requested planning" }
  }

  const manifest = parseManifest(text)
  if (manifest === undefined) {
    return { executor: "veles", reason: "missing or invalid change manifest" }
  }

  const gitRunner = options.gitRunner ?? execFileGitRunner
  try {
    const base = await resolveBase(gitRunner, options.base)
    const mergeBase = await gitRunner.mergeBase(base, "HEAD")
    const changedFiles = await gitRunner.diffNameOnly(mergeBase)
    if (changedFiles.length === 0) {
      return { executor: "veles", reason: "no changed files found in trusted git diff" }
    }

    const executor = classifyManifest(manifest, changedFiles)
    return { executor, reason: classificationReason(executor) }
  } catch {
    return { executor: "veles", reason: "could not derive changed files from git" }
  }
}
