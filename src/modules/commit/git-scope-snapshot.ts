import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { realpathSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { canonicalizeRepositoryPath } from "./perun-commit-policy.js"

const execFileAsync = promisify(execFile)

export interface GitScopeRunner {
  (cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

const defaultGitRunner: GitScopeRunner = async (cwd: string, args: string[]) => {
  try {
    const result = await execFileAsync("git", args, { cwd })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number }
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: Number(failure.code ?? 1) }
  }
}

export type CommitChangeStatus = "added" | "modified" | "deleted" | "renamed"

export interface RepositoryIdentity {
  root: string
  commonDir: string
}

export interface CommitChange {
  path: string
  status: CommitChangeStatus
  porcelain: string
  renameFrom?: string
}

export interface CommitScopeSnapshot {
  repository: RepositoryIdentity
  head: string
  changes: readonly CommitChange[]
  digest: string
}

function malformed(record: string): Error {
  return new Error(`Perun commit scope: malformed porcelain v2 record ${JSON.stringify(record)}.`)
}

function statusFromXY(xy: string): CommitChangeStatus {
  if (xy.includes("R")) return "renamed"
  if (xy.includes("D")) return "deleted"
  if (xy.includes("A") || xy === "??") return "added"
  if (/^[.MTCU]{2}$/.test(xy)) return "modified"
  throw malformed(xy)
}

/** Parse only the ordinary, rename, and untracked porcelain-v2 records we can commit safely. */
export function parsePorcelainV2(output: string): CommitChange[] {
  if (output === "") return []
  if (!output.endsWith("\0")) throw malformed(output)
  const records = output.slice(0, -1).split("\0")
  const changes: CommitChange[] = []
  const seen = new Set<string>()
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record === "") throw malformed(record ?? "")
    if (record.startsWith("? ")) {
      const candidate = record.slice(2)
      if (candidate === "") throw malformed(record)
      changes.push({ path: candidate, status: "added", porcelain: "??" })
      seen.add(candidate)
      continue
    }
    if (record.startsWith("1 ")) {
      const fields = record.split(" ")
      const candidate = fields.slice(8).join(" ")
      const xy = fields[1]
      if (xy === undefined || candidate === "") throw malformed(record)
      const status = statusFromXY(xy)
      if (status === "renamed") throw malformed(record)
      if (seen.has(candidate)) throw malformed(record)
      seen.add(candidate)
      changes.push({ path: candidate, status, porcelain: xy })
      continue
    }
    if (record.startsWith("2 ")) {
      const fields = record.split(" ")
      const xy = fields[1]
      const candidate = fields.slice(9).join(" ")
      const source = records[index + 1]
      if (xy === undefined || !xy.includes("R") || candidate === "" || source === undefined || source === "" || seen.has(candidate) || seen.has(source)) {
        throw malformed(record)
      }
      seen.add(candidate)
      seen.add(source)
      changes.push({ path: candidate, status: "renamed", porcelain: xy, renameFrom: source })
      index += 1
      continue
    }
    // Unmerged and ignored records cannot be safely bound to an exact commit.
    throw malformed(record)
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Paths the snapshot proves are absent from BOTH the worktree and the index: an already-staged
 * deletion, or the source half of an already-staged rename. `git add -- <path>` cannot match those
 * ("pathspec did not match any files"), so they stay out of the staging call while remaining in the
 * commit pathspec, which records them from the index. The index half of the porcelain-v2 `XY` field
 * is the discriminator — an unstaged deletion (`.D`) is still in the index and must be staged.
 */
export function collectIndexAbsentPaths(changes: readonly CommitChange[]): Set<string> {
  const absent = new Set<string>()
  for (const change of changes) {
    const indexHalf = change.porcelain[0]
    if (change.status === "deleted" && indexHalf === "D") {
      absent.add(change.path)
    }
    if (
      change.status === "renamed" &&
      change.renameFrom !== undefined &&
      (indexHalf === "R" || indexHalf === "C")
    ) {
      absent.add(change.renameFrom)
    }
  }
  return absent
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function createCommitScopeSnapshot(cwd: string, runGit: GitScopeRunner = defaultGitRunner): Promise<CommitScopeSnapshot> {
  const [rootResult, commonResult, headResult, statusResult] = await Promise.all([
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
    runGit(cwd, ["rev-parse", "--git-common-dir"]),
    runGit(cwd, ["rev-parse", "HEAD"]),
    runGit(cwd, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
  ])
  if (rootResult.exitCode !== 0 || commonResult.exitCode !== 0 || headResult.exitCode !== 0 || statusResult.exitCode !== 0) {
    throw new Error("Perun commit scope: could not create a Git snapshot.")
  }
  const root = realpathSync(rootResult.stdout.trim())
  const commonRaw = commonResult.stdout.trim()
  const commonDir = realpathSync(path.isAbsolute(commonRaw) ? commonRaw : path.resolve(root, commonRaw))
  const changes = parsePorcelainV2(statusResult.stdout).map((change: CommitChange): CommitChange => ({
    ...change,
    path: canonicalizeRepositoryPath(change.path, root),
    ...(change.renameFrom === undefined ? {} : { renameFrom: canonicalizeRepositoryPath(change.renameFrom, root) }),
  }))
  const repository = { root, commonDir }
  const head = headResult.stdout.trim()
  return { repository, head, changes, digest: digest(JSON.stringify({ repository, head, changes })) }
}
