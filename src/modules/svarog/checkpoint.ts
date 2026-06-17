import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf-8",
  }).trim()
}

/**
 * Snapshot the working tree (tracked + untracked, EXCLUDING gitignored) into a scratch ref
 * WITHOUT touching the real index or working tree, and return the ref name. A throwaway index
 * seeded from the real one preserves staged state and keeps the live index untouched. `git stash`
 * cannot do this: `stash create` drops untracked files; `stash -u` mutates the working tree.
 *
 * Honest limits (documented in docs/heavy-execution.md): gitignored files, embedded/vendored
 * repos, and started services are NOT captured. Also assumes a born HEAD (at least one commit) —
 * `commit-tree -p HEAD` fails on a brand-new repo, which is outside the executor's lane.
 *
 * Precondition: `sessionId` must be a valid git ref-name component (no `..`, spaces, `~^:?*[\\`,
 * no leading/trailing `.`/`/`). The opencode session id (`ses_…`) satisfies this; callers passing
 * arbitrary ids should sanitize first, else `update-ref` throws.
 */
export function createCheckpoint(cwd: string, sessionId: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "svarog-ckpt-"))
  const idx = path.join(dir, "index")
  try {
    // Seed the throwaway index from the real one (preserves staged adds/deletes); ok if absent.
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
      "svarog checkpoint",
    ])
    const ref = `refs/svarog/ckpt/${sessionId}`
    git(cwd, ["update-ref", ref, commit])
    return ref
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Restore the working tree to a checkpoint ref: recover tracked content, remove ONLY files Svarog
 * created this turn (present-now AND absent-from-checkpoint), then reset the index to HEAD. NOTE:
 * original staging is NOT preserved — restore is a recovery aid that yields a clean, recoverable
 * tree, not a replay of mid-turn staging. NEVER `clean -x` (it would delete the operator's
 * gitignored data). Gitignored / embedded-repo / started-service side effects are not recovered.
 */
export function restoreCheckpoint(cwd: string, ckptRef: string): void {
  const inCkpt = new Set(
    git(cwd, ["ls-tree", "-r", "--name-only", ckptRef])
      .split("\n")
      .filter(Boolean),
  )
  const present = [
    ...git(cwd, ["ls-files"]).split("\n"),
    ...git(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean)
  const orphans = present.filter((f) => !inCkpt.has(f))

  git(cwd, ["read-tree", ckptRef]) // index := checkpoint tree
  git(cwd, ["checkout-index", "-a", "-f"]) // worktree := checkpoint tracked content
  for (const f of orphans) rmSync(path.join(cwd, f), { force: true })
  git(cwd, ["reset", "-q"]) // index -> HEAD; original staging is intentionally NOT restored (recovery aid)
}
