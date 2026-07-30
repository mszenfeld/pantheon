import path from "node:path"
import {
  formatCommitPath,
  isScopedCommitPath,
} from "../_shared/commit-staging-scope.js"
import { COORDINATOR_AGENT_NAME } from "../_shared/session-identity.js"
import { STRIBOG_AGENT_KEY } from "../stribog/stribog.metadata.js"
import { SVAROG_AGENT_KEY } from "../svarog/svarog.metadata.js"

export type CommitScopePolicy = "generic" | "perun-exact"
export type PublicationOperation = "create_branch" | "create_pr"

export const PUBLICATION_AGENT_IDENTITIES = [
  SVAROG_AGENT_KEY,
  STRIBOG_AGENT_KEY,
] as const

const publicationAgentIdentitySet: ReadonlySet<string> = new Set(
  PUBLICATION_AGENT_IDENTITIES,
)

export interface PerunExactFileAuthorizationInput {
  files: unknown
  repositoryRoot: string
  changedFiles: ReadonlySet<string>
  isDirectory: (absolutePath: string) => boolean
}

function scopeError(message: string): Error {
  return new Error(`Perun commit scope: ${message}`)
}

function invalidStatusRecord(record: string): Error {
  return scopeError(`invalid git status record ${formatCommitPath(record)}.`)
}

function formatUnknownPath(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '"<unserializable>"'
  } catch {
    return '"<unserializable>"'
  }
}

export function canonicalizeRepositoryPath(
  value: string,
  repositoryRoot: string,
): string {
  if (!isScopedCommitPath(value)) {
    throw scopeError(`invalid file path ${formatCommitPath(value)}.`)
  }

  const absolutePath = path.resolve(repositoryRoot, value)
  const relativePath = path.relative(repositoryRoot, absolutePath)
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw scopeError(`file path escapes the repository root: ${formatCommitPath(value)}.`)
  }

  const canonicalPath = relativePath.split(path.sep).join("/")
  if (!isScopedCommitPath(canonicalPath)) {
    throw scopeError(`invalid file path ${formatCommitPath(value)}.`)
  }
  return canonicalPath
}

/** Parse machine-readable `git status --porcelain=v1 -z` output fail-closed. */
export function parsePorcelainV1Status(output: string): Set<string> {
  if (output === "") return new Set<string>()
  if (!output.endsWith("\0")) {
    throw invalidStatusRecord(output)
  }

  const records = output.slice(0, -1).split("\0")
  const changedFiles = new Set<string>()

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length < 4) {
      throw invalidStatusRecord(record ?? "")
    }

    if (record.startsWith("?? ")) {
      const pathname = record.slice(3)
      if (pathname === "") throw invalidStatusRecord(record)
      changedFiles.add(pathname)
      continue
    }

    const status = record.slice(0, 3)
    if (status === "   " || !/^[ MADRCUT][ MADRCUT] $/.test(status)) {
      throw invalidStatusRecord(record)
    }

    const pathname = record.slice(3)
    if (pathname === "") throw invalidStatusRecord(record)
    changedFiles.add(pathname)

    if (status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") {
      const sourcePath = records[index + 1]
      if (sourcePath === undefined || sourcePath === "") {
        throw invalidStatusRecord(record)
      }
      changedFiles.add(sourcePath)
      index += 1
    }
  }

  return changedFiles
}

/**
 * Validate Perun's requested files without touching Git or the index. Callers supply the
 * repository root, authoritative changed set, and directory predicate so this remains pure and
 * unit-testable with no filesystem or process dependency.
 */
export function authorizePerunExactFiles(
  input: PerunExactFileAuthorizationInput,
): string[] {
  if (!path.isAbsolute(input.repositoryRoot)) {
    throw scopeError("repository root must be an absolute path.")
  }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw scopeError("files must be a non-empty list of concrete file paths.")
  }

  const requestedFiles: string[] = []
  for (const file of input.files) {
    if (!isScopedCommitPath(file)) {
      throw scopeError(`invalid file path ${formatUnknownPath(file)}.`)
    }
    requestedFiles.push(file)
  }

  const canonicalChangedFiles = new Set<string>()
  for (const changedFile of input.changedFiles) {
    canonicalChangedFiles.add(
      canonicalizeRepositoryPath(changedFile, input.repositoryRoot),
    )
  }

  const authorizedFiles: string[] = []
  const seenFiles = new Set<string>()
  for (const file of requestedFiles) {
    const canonicalPath = canonicalizeRepositoryPath(file, input.repositoryRoot)
    if (seenFiles.has(canonicalPath)) {
      throw scopeError(`duplicate file path ${formatCommitPath(file)}.`)
    }

    const absolutePath = path.resolve(input.repositoryRoot, canonicalPath)
    if (input.isDirectory(absolutePath)) {
      throw scopeError(`file path is an existing directory: ${formatCommitPath(file)}.`)
    }
    if (!canonicalChangedFiles.has(canonicalPath)) {
      throw scopeError(`file path is not a current repository change: ${formatCommitPath(file)}.`)
    }

    seenFiles.add(canonicalPath)
    authorizedFiles.push(canonicalPath)
  }

  return authorizedFiles
}

function assertKnownCaller(agent: unknown, operation: string): string {
  if (typeof agent !== "string" || agent.trim() === "") {
    throw new Error(`${operation}: caller identity is unavailable; refusing before mutation.`)
  }
  return agent
}

/** Select the internal commit policy from the runtime identity, never a tool argument. */
export function classifyCommitCaller(agent: unknown): CommitScopePolicy {
  return assertKnownCaller(agent, "av_commit") === COORDINATOR_AGENT_NAME
    ? "perun-exact"
    : "generic"
}

/** Allow publication only from the canonical executor identities. */
export function assertPublicationCaller(
  agent: unknown,
  operation: PublicationOperation,
): void {
  const caller = assertKnownCaller(agent, operation)
  if (!publicationAgentIdentitySet.has(caller)) {
    throw new Error(`${operation}: caller is not authorized.`)
  }
}
