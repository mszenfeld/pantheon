import { execFile } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { normalizeCommitMessage } from "./message-policy.js"
import {
  authorizePerunExactFiles,
  parsePorcelainV1Status,
} from "./perun-commit-policy.js"
import type { CommitScopePolicy } from "./perun-commit-policy.js"
import { createCommitScopeSnapshot } from "./git-scope-snapshot.js"
import type { CommitAuthorization } from "./perun-commit-consent.js"

const execFileAsync = promisify(execFile)

export interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface GitRunner {
  (cwd: string, args: string[]): Promise<GitResult>
}

export interface ControlledCommitInput {
  cwd: string
  message: string
  files?: string[]
  taskId?: string
  scopePolicy?: CommitScopePolicy
  runGit?: GitRunner
  pathExists?: (absolutePath: string) => boolean
  authorization?: CommitAuthorization
}

export const defaultGitRunner: GitRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("git", args, { cwd })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
      code?: number
    }

    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: Number(failure.code ?? 1),
    }
  }
}

/** True when a merge or cherry-pick is mid-flight, so git cannot do a partial (pathspec) commit. */
async function isMergeInProgress(
  runGit: GitRunner,
  cwd: string,
): Promise<boolean> {
  for (const ref of ["MERGE_HEAD", "CHERRY_PICK_HEAD"]) {
    const result = await runGit(cwd, ["rev-parse", "-q", "--verify", ref])
    if (result.exitCode === 0) return true
  }
  return false
}

function stateInspectionError(state: "rebase" | "revert"): Error {
  return new Error(
    `Perun commit state: ${state} is active; complete or abort the operation outside Perun's local-commit exception.`,
  )
}

function stateInspectionFailure(state: "rebase" | "revert"): Error {
  return new Error(
    `Perun commit state: could not inspect ${state} state; refusing before mutation.`,
  )
}

async function assertPerunSequencerIsInactive(
  runGit: GitRunner,
  cwd: string,
  pathExists: (absolutePath: string) => boolean,
): Promise<void> {
  for (const marker of ["rebase-merge", "rebase-apply"]) {
    const markerPath = await runGit(cwd, ["rev-parse", "--git-path", marker])
    const resolvedPath = markerPath.stdout.trim()
    if (markerPath.exitCode !== 0 || resolvedPath === "") {
      throw stateInspectionFailure("rebase")
    }
    const absolutePath = path.isAbsolute(resolvedPath)
      ? resolvedPath
      : path.resolve(cwd, resolvedPath)
    if (pathExists(absolutePath)) {
      throw stateInspectionError("rebase")
    }
  }

  const revertHead = await runGit(cwd, [
    "rev-parse",
    "-q",
    "--verify",
    "REVERT_HEAD",
  ])
  if (revertHead.exitCode === 0) {
    throw stateInspectionError("revert")
  }
  if (revertHead.exitCode !== 1) {
    throw stateInspectionFailure("revert")
  }
}

function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory()
  } catch {
    return false
  }
}

function parseNulDelimitedPaths(output: string): Set<string> {
  if (output === "") return new Set<string>()
  if (!output.endsWith("\0")) {
    throw new Error("Perun merge index mismatch: Git returned malformed staged paths.")
  }

  const paths = output.slice(0, -1).split("\0")
  if (paths.some((path) => path === "")) {
    throw new Error("Perun merge index mismatch: Git returned malformed staged paths.")
  }
  return new Set(paths)
}

async function assertPerunMergeIndexMatches(
  runGit: GitRunner,
  cwd: string,
  authorizedFiles: readonly string[],
): Promise<void> {
  const stagedFiles = await runGit(cwd, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
  ])
  if (stagedFiles.exitCode !== 0) {
    throw new Error(
      `Perun merge index mismatch: ${stagedFiles.stderr.trim() || stagedFiles.stdout.trim() || "could not inspect staged paths."}`,
    )
  }

  const stagedPathSet = parseNulDelimitedPaths(stagedFiles.stdout)
  if (
    stagedPathSet.size !== authorizedFiles.length ||
    authorizedFiles.some((file) => !stagedPathSet.has(file))
  ) {
    throw new Error("Perun merge index mismatch: staged files differ from the authorized files.")
  }
}

export async function createControlledCommit(input: ControlledCommitInput) {
  const runGit = input.runGit ?? defaultGitRunner
  const pathExists = input.pathExists ?? existsSync
  const commitMessage = normalizeCommitMessage(input.message, input.taskId)
  const repoCheck = await runGit(input.cwd, [
    "rev-parse",
    "--is-inside-work-tree",
  ])

  if (repoCheck.exitCode !== 0) {
    throw new Error("Current directory is not a git repository.")
  }

  if (input.scopePolicy === "perun-exact" && input.authorization === undefined) {
    await assertPerunSequencerIsInactive(runGit, input.cwd, pathExists)
  }

  let files = input.files
  if (input.authorization !== undefined) {
    const current = await createCommitScopeSnapshot(input.cwd, runGit)
    const authorized = input.authorization.snapshot
    if (current.digest !== authorized.digest || current.repository.root !== authorized.repository.root || current.repository.commonDir !== authorized.repository.commonDir || current.head !== authorized.head) {
      throw new Error("Perun commit authorization: selected Git scope changed before staging.")
    }
    files = authorized.changes.flatMap((change): string[] => change.renameFrom === undefined ? [change.path] : [change.path, change.renameFrom])
  }
  if (input.scopePolicy === "perun-exact") {
    const repositoryRoot = await runGit(input.cwd, [
      "rev-parse",
      "--show-toplevel",
    ])
    if (repositoryRoot.exitCode !== 0 || repositoryRoot.stdout.trim() === "") {
      throw new Error("Perun commit scope: could not resolve the repository root.")
    }

    const status = await runGit(input.cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ])
    if (status.exitCode !== 0) {
      throw new Error(
        status.stderr.trim() || status.stdout.trim() || "git status failed.",
      )
    }

    files = authorizePerunExactFiles({
      files: input.files,
      repositoryRoot: repositoryRoot.stdout.trim(),
      changedFiles: parsePorcelainV1Status(status.stdout),
      isDirectory,
    })
  }

  const addArgs =
    files && files.length > 0
      ? ["add", "--", ...files]
      : ["add", "-A"]

  const addResult = await runGit(input.cwd, addArgs)

  if (addResult.exitCode !== 0) {
    throw new Error(
      addResult.stderr.trim() || addResult.stdout.trim() || "git add failed.",
    )
  }

  if (input.authorization !== undefined) {
    const current = await createCommitScopeSnapshot(input.cwd, runGit)
    const authorized = input.authorization.snapshot
    if (current.repository.root !== authorized.repository.root || current.repository.commonDir !== authorized.repository.commonDir || current.head !== authorized.head) {
      throw new Error("Perun commit authorization: repository state changed before commit.")
    }
  }

  const stagedChangeArgs =
    input.scopePolicy === "perun-exact" && files
      ? ["diff", "--cached", "--quiet", "--", ...files]
      : ["diff", "--cached", "--quiet"]
  const stagedChanges = await runGit(input.cwd, stagedChangeArgs)

  if (stagedChanges.exitCode === 0) {
    throw new Error("No changes to commit.")
  }

  // Bind the commit to the SAME paths that were staged. `git commit -m` with no pathspec
  // captures the whole index, so anything staged out-of-band before this call — the operator's
  // own `git add`, or a bash `git add -A` from an executor session (bash `add` is not on the
  // mutating-git tripwire) — would ride along, defeating the executor staging-scope guard in
  // `_shared/commit-staging-scope.ts` and getting published by `create_pr`. With `files` empty
  // the caller asked for the whole tree (`add -A` above), so no pathspec is the correct shape.
  //
  // EXCEPTION — an in-progress merge/cherry-pick: git refuses a partial (pathspec) commit there
  // ("fatal: cannot do a partial commit during a merge"). The merge itself already scopes the
  // commit to its result, so the whole-index shape is both required and correct; a pathspec
  // would hard-fail the operator's conflict-resolution commit and dead-end an executor.
  const scopedCommitFiles =
    input.scopePolicy === "perun-exact" ? files : input.files
  const inMerge =
    scopedCommitFiles &&
    scopedCommitFiles.length > 0 &&
    (await isMergeInProgress(runGit, input.cwd))
  if (input.scopePolicy === "perun-exact" && inMerge) {
    await assertPerunMergeIndexMatches(runGit, input.cwd, scopedCommitFiles)
  }
  const commitArgs =
    scopedCommitFiles && scopedCommitFiles.length > 0 && !inMerge
      ? ["commit", "-m", commitMessage, "--", ...scopedCommitFiles]
      : ["commit", "-m", commitMessage]
  const commitResult = await runGit(input.cwd, commitArgs)

  if (commitResult.exitCode !== 0) {
    throw new Error(
      commitResult.stderr.trim() ||
        commitResult.stdout.trim() ||
        "git commit failed.",
    )
  }

  const statusResult = await runGit(input.cwd, ["status", "--short"])

  return {
    commitMessage,
    status: statusResult.stdout.trim(),
  }
}
