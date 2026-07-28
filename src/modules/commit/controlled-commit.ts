import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { normalizeCommitMessage } from "./message-policy.js"

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
  runGit?: GitRunner
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

export async function createControlledCommit(input: ControlledCommitInput) {
  const runGit = input.runGit ?? defaultGitRunner
  const repoCheck = await runGit(input.cwd, [
    "rev-parse",
    "--is-inside-work-tree",
  ])

  if (repoCheck.exitCode !== 0) {
    throw new Error("Current directory is not a git repository.")
  }

  const addArgs =
    input.files && input.files.length > 0
      ? ["add", "--", ...input.files]
      : ["add", "-A"]

  const addResult = await runGit(input.cwd, addArgs)

  if (addResult.exitCode !== 0) {
    throw new Error(
      addResult.stderr.trim() || addResult.stdout.trim() || "git add failed.",
    )
  }

  const stagedChanges = await runGit(input.cwd, ["diff", "--cached", "--quiet"])

  if (stagedChanges.exitCode === 0) {
    throw new Error("No changes to commit.")
  }

  const commitMessage = normalizeCommitMessage(input.message, input.taskId)
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
  const inMerge =
    input.files &&
    input.files.length > 0 &&
    (await isMergeInProgress(runGit, input.cwd))
  const commitArgs =
    input.files && input.files.length > 0 && !inMerge
      ? ["commit", "-m", commitMessage, "--", ...input.files]
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
