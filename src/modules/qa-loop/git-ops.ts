import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { restoreCheckpoint } from "../svarog/checkpoint.js"

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf-8",
  }).trim()
}

/**
 * §6 total-undo capture. Snapshot the WHOLE working tree (tracked + untracked, excluding
 * gitignored — the same scope as createCheckpoint) into refs/qa-loop/pre/<run> BEFORE the first
 * fix, via a throwaway index so the live index/worktree are untouched. Capturing dirty work means
 * undoToPreLoop returns the user's WORKING TREE to where they started (§6). It does not rewind
 * commits: since the 2026-07-22 executor-chain decision the in-loop Svarog fixer may commit its
 * verified-green work via `av_commit`, and `restoreCheckpoint` never moves `HEAD`.
 */
export function capturePreLoopRef(cwd: string, runId: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-loop-pre-"))
  const idx = path.join(dir, "index")
  try {
    const rel = git(cwd, ["rev-parse", "--git-path", "index"])
    const realIndex = path.isAbsolute(rel) ? rel : path.join(cwd, rel)
    if (existsSync(realIndex)) copyFileSync(realIndex, idx)

    const env = { ...process.env, GIT_INDEX_FILE: idx }
    git(cwd, ["add", "-A"], env)
    const tree = git(cwd, ["write-tree"], env)
    const commit = git(cwd, [
      "commit-tree",
      tree,
      "-p",
      "HEAD",
      "-m",
      "qa-loop pre-loop",
    ])
    const ref = `refs/qa-loop/pre/${runId}`
    git(cwd, ["update-ref", ref, commit])
    return ref
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** True iff `ref` resolves — the §6 existence check (checkpoint-integrity backstop + undo guard). */
export function refExists(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref])
    return true
  } catch {
    return false
  }
}

/**
 * §6 FAIL auto-restore — wraps the EXISTING restoreCheckpoint (no new restore logic). It is already
 * cumulative-safe: the checkpoint tree contains every prior READY fix, so this reverts only THIS
 * issue's edits (and deletes only files this issue created, by tree-diff) and preserves issues 1…N-1.
 */
export function restoreFailRef(cwd: string, ref: string): void {
  restoreCheckpoint(cwd, ref)
}

/**
 * §6 total undo — revert the loop's WORKING-TREE changes by restoring the pre-loop ref (same
 * mechanics as the FAIL restore).
 *
 * **Bounded, not total, since the 2026-07-22 executor-chain decision.** `restoreCheckpoint`
 * resets the index to the current `HEAD`; it never moves `HEAD`, re-checks-out a branch, or
 * un-pushes. Svarog may now commit its verified-green work through `av_commit` (and switch
 * branches through `create_branch`, publish through `create_pr`), so a loop run whose fixer
 * committed leaves those commits in place — this restores the tree around them. Undoing
 * committed loop work is an operator step (`git reset --hard <pre-loop HEAD>`, or the reflog).
 */
export function undoToPreLoop(cwd: string, ref: string): void {
  restoreCheckpoint(cwd, ref)
}

/**
 * §6 anti-hardcoding (best-effort, non-blocking). Diff each `changed[]` file against its own
 * checkpoint tree and flag ADDED lines whose text contains a BE scenario request-payload literal —
 * the av-marketplace heuristic for "the fix hardcoded the test's expected value." Recorded as
 * warnings only; surfaced in Loop History for human review. Best-effort over self-reported
 * `changed[]` (unlike the restore, which ignores `changed[]`).
 */
export function antiHardcodeDiff(
  cwd: string,
  ckptRef: string,
  changed: string[],
  bePayloads: string[],
): string[] {
  const warnings: string[] = []
  const payloads = bePayloads.map((p) => p.trim()).filter(Boolean)
  if (payloads.length === 0 || changed.length === 0) return warnings

  for (const file of changed) {
    // Defense-in-depth over untrusted self-reported changed[]: skip anything that is not a
    // plain in-tree path so an entry cannot be read as a git flag (`-x`) or a pathspec magic
    // prefix (`:(glob)`). The diff is best-effort and read-only; the restore path ignores
    // changed[] entirely and derives orphans from git ls-files.
    if (file.startsWith("-") || file.startsWith(":") || file.includes(".."))
      continue
    let diff = ""
    try {
      diff = git(cwd, ["diff", "--no-color", ckptRef, "--", file])
    } catch {
      continue // file may not exist in the ckpt tree; skip best-effort
    }
    const addedLines = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    for (const line of addedLines) {
      for (const payload of payloads) {
        if (line.includes(payload)) {
          warnings.push(
            `${file}: added literal matching BE payload ${payload} — possible hardcoded test value`,
          )
        }
      }
    }
  }
  return warnings
}
