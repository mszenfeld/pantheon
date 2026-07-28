import { execFile } from "node:child_process"
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createControlledCommit } from "../../../src/modules/commit/controlled-commit.js"

const execFileAsync = promisify(execFile)

async function createRepo(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "av-opencode-commit-"))

  await execFileAsync("git", ["init"], { cwd: directory })
  await execFileAsync("git", ["config", "user.email", "dev@example.com"], {
    cwd: directory,
  })
  await execFileAsync("git", ["config", "user.name", "Dev User"], {
    cwd: directory,
  })

  return directory
}

describe("createControlledCommit", () => {
  it("creates a commit for staged changes", async () => {
    const directory = await createRepo()

    await writeFile(path.join(directory, "note.txt"), "hello\n")

    const result = await createControlledCommit({
      cwd: directory,
      files: ["note.txt"],
      message: "feat: add note",
    })

    const log = await execFileAsync("git", ["log", "-1", "--format=%B"], {
      cwd: directory,
    })

    expect(log.stdout.trim()).toBe("feat: add note")
    expect(result.commitMessage).toBe("feat: add note")
  })

  it("fails when there are no changes to commit", async () => {
    const directory = await createRepo()

    await expect(
      createControlledCommit({
        cwd: directory,
        message: "chore: empty commit",
      }),
    ).rejects.toThrow(/No changes to commit/i)
  })

  it("commits only the named files even when the index was widened out-of-band", async () => {
    // The executor staging-scope guard validates av_commit's `files`, but `git commit -m`
    // with no pathspec captures the WHOLE index — so anything staged beforehand (the
    // operator's own `git add`, or a bash `git add -A` from an executor session, which the
    // mutating-git tripwire does not cover) would ride along and be published by create_pr.
    const directory = await createRepo()
    await writeFile(path.join(directory, "seed.txt"), "seed\n")
    await execFileAsync("git", ["add", "-A"], { cwd: directory })
    await execFileAsync("git", ["commit", "-m", "chore: seed"], {
      cwd: directory,
    })

    await writeFile(path.join(directory, "mine.txt"), "mine\n")
    await writeFile(path.join(directory, "operators.txt"), "not mine\n")
    // out-of-band widening: everything is staged before the tool runs
    await execFileAsync("git", ["add", "-A"], { cwd: directory })

    await createControlledCommit({
      cwd: directory,
      files: ["mine.txt"],
      message: "feat: only mine",
    })

    const committed = await execFileAsync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      { cwd: directory },
    )
    expect(committed.stdout.trim().split("\n")).toEqual(["mine.txt"])
    // the operator's file is untouched — still staged, never published
    const staged = await execFileAsync(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: directory },
    )
    expect(staged.stdout.trim()).toBe("operators.txt")
  })

  it("commits a conflict resolution during a real merge (unbound-shape fallback)", async () => {
    // Real git: `commit -m msg -- <files>` is rejected mid-merge, so the pathspec fix must
    // fall back to the unbound shape or the operator's conflict-resolution commit hard-fails.
    const directory = await createRepo()
    await writeFile(path.join(directory, "f.txt"), "base\n")
    await execFileAsync("git", ["add", "-A"], { cwd: directory })
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: directory })
    await execFileAsync("git", ["checkout", "-b", "feat"], { cwd: directory })
    await writeFile(path.join(directory, "f.txt"), "feat\n")
    await execFileAsync("git", ["commit", "-am", "feat"], { cwd: directory })
    await execFileAsync("git", ["checkout", "master"], {
      cwd: directory,
    }).catch(() =>
      execFileAsync("git", ["checkout", "main"], { cwd: directory }),
    )
    await writeFile(path.join(directory, "f.txt"), "main\n")
    await execFileAsync("git", ["commit", "-am", "main"], { cwd: directory })
    // conflicting merge, then resolve
    await execFileAsync("git", ["merge", "feat"], { cwd: directory }).catch(
      () => undefined,
    )
    await writeFile(path.join(directory, "f.txt"), "resolved\n")

    const result = await createControlledCommit({
      cwd: directory,
      files: ["f.txt"],
      message: "fix: resolve conflict",
    })
    expect(result.commitMessage).toBe("fix: resolve conflict")

    // the merge is concluded (no MERGE_HEAD) and the commit landed
    await expect(
      execFileAsync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], {
        cwd: directory,
      }),
    ).rejects.toThrow()
    const parents = await execFileAsync(
      "git",
      ["show", "--no-patch", "--format=%P", "HEAD"],
      { cwd: directory },
    )
    expect(parents.stdout.trim().split(" ")).toHaveLength(2) // a real merge commit
  })

  it("surfaces repository hook failures", async () => {
    const directory = await createRepo()

    await writeFile(path.join(directory, "note.txt"), "blocked\n")
    await mkdir(path.join(directory, ".git", "hooks"), { recursive: true })
    await writeFile(
      path.join(directory, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\nprintf 'blocked by hook' >&2\nexit 1\n",
    )
    await chmod(path.join(directory, ".git", "hooks", "pre-commit"), 0o755)

    await expect(
      createControlledCommit({
        cwd: directory,
        files: ["note.txt"],
        message: "fix: surface hook error",
      }),
    ).rejects.toThrow(/blocked by hook/i)
  })
})
