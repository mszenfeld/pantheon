import { execFile } from "node:child_process"
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createControlledCommit } from "../../../src/modules/commit/controlled-commit.js"
import { createCommitScopeSnapshot } from "../../../src/modules/commit/git-scope-snapshot.js"
import type { CommitAuthorization } from "../../../src/modules/commit/perun-commit-consent.js"

const execFileAsync = promisify(execFile)
const temporaryRepositories: string[] = []

async function createRepo(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "av-opencode-commit-"))

  await execFileAsync("git", ["init"], { cwd: directory })
  await execFileAsync("git", ["config", "user.email", "dev@example.com"], {
    cwd: directory,
  })
  await execFileAsync("git", ["config", "user.name", "Dev User"], {
    cwd: directory,
  })
  // A fixture must not depend on the developer's gpg-agent: with a global `commit.gpgsign=true`
  // every commit here would block on pinentry and fail the suite when the agent is cold.
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
    cwd: directory,
  })
  temporaryRepositories.push(directory)

  return directory
}

async function gitOutput(directory: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: directory })
  return result.stdout
}

describe("createControlledCommit", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRepositories.splice(0).map((directory: string): Promise<void> =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })
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

  it.each([
    ["rebase-merge", async (directory: string): Promise<void> => {
      await mkdir(path.join(directory, ".git", "rebase-merge"))
    }],
    ["rebase-apply", async (directory: string): Promise<void> => {
      await mkdir(path.join(directory, ".git", "rebase-apply"))
    }],
    ["revert", async (directory: string): Promise<void> => {
      const head = (await gitOutput(directory, ["rev-parse", "HEAD"])).trim()
      await execFileAsync("git", ["update-ref", "REVERT_HEAD", head], {
        cwd: directory,
      })
    }],
  ])(
    "leaves an active %s operation unchanged when denying a Perun commit",
    async (
      operation: string,
      setOperationState: (directory: string) => Promise<void>,
    ) => {
      const directory = await createRepo()
      await writeFile(path.join(directory, "seed.txt"), "seed\n")
      await execFileAsync("git", ["add", "seed.txt"], { cwd: directory })
      await execFileAsync("git", ["commit", "-m", "chore: seed"], {
        cwd: directory,
      })
      await writeFile(path.join(directory, "note.txt"), "note\n")
      await setOperationState(directory)

      const before = await Promise.all([
        gitOutput(directory, ["rev-parse", "HEAD"]),
        gitOutput(directory, ["status", "--porcelain=v1"]),
        gitOutput(directory, ["diff", "--cached"]),
        gitOutput(directory, ["diff"]),
      ])

      await expect(
        createControlledCommit({
          cwd: directory,
          files: ["note.txt"],
          message: "fix: resolve operation",
          scopePolicy: "perun-exact",
        }),
      ).rejects.toThrow(operation === "revert" ? /revert is active/i : /rebase is active/i)

      await expect(
        Promise.all([
          gitOutput(directory, ["rev-parse", "HEAD"]),
          gitOutput(directory, ["status", "--porcelain=v1"]),
          gitOutput(directory, ["diff", "--cached"]),
          gitOutput(directory, ["diff"]),
        ]),
      ).resolves.toEqual(before)
      if (operation === "revert") {
        await expect(
          execFileAsync("git", ["rev-parse", "-q", "--verify", "REVERT_HEAD"], {
            cwd: directory,
          }),
        ).resolves.toBeDefined()
      }
    },
  )
})

describe("createControlledCommit (integration: Perun exact scopes over real git)", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRepositories.splice(0).map((directory: string): Promise<void> =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  /** Seed a commit so deletions and renames have a HEAD to be recorded against. */
  async function seedRepo(): Promise<string> {
    const directory = await createRepo()
    await mkdir(path.join(directory, "dir"), { recursive: true })
    await writeFile(path.join(directory, "note.txt"), "one\n")
    await writeFile(path.join(directory, "gone.txt"), "bye\n")
    await writeFile(path.join(directory, "dir", "orig.txt"), "moved\n")
    await execFileAsync("git", ["add", "-A"], { cwd: directory })
    await execFileAsync("git", ["commit", "-m", "chore: seed"], {
      cwd: directory,
    })
    return directory
  }

  async function nameStatus(directory: string): Promise<string> {
    return gitOutput(directory, ["log", "-1", "--name-status", "--format="])
  }

  it("commits an already-staged deletion named in the exact scope", async () => {
    const directory = await seedRepo()
    await execFileAsync("git", ["rm", "-q", "gone.txt"], { cwd: directory })

    await createControlledCommit({
      cwd: directory,
      message: "chore: drop gone.txt",
      files: ["gone.txt"],
      scopePolicy: "perun-exact",
    })

    expect(await nameStatus(directory)).toContain("D\tgone.txt")
  })

  it("commits an unstaged deletion named in the exact scope", async () => {
    const directory = await seedRepo()
    await rm(path.join(directory, "gone.txt"))

    await createControlledCommit({
      cwd: directory,
      message: "chore: drop gone.txt",
      files: ["gone.txt"],
      scopePolicy: "perun-exact",
    })

    expect(await nameStatus(directory)).toContain("D\tgone.txt")
  })

  it("commits a staged rename when both halves are named", async () => {
    const directory = await seedRepo()
    await execFileAsync(
      "git",
      ["mv", path.join("dir", "orig.txt"), path.join("dir", "renamed.txt")],
      { cwd: directory },
    )

    await createControlledCommit({
      cwd: directory,
      message: "refactor: rename orig to renamed",
      files: ["dir/renamed.txt", "dir/orig.txt"],
      scopePolicy: "perun-exact",
    })

    const recorded = await gitOutput(directory, [
      "log",
      "-1",
      "--name-status",
      "--find-renames",
      "--format=",
    ])
    expect(recorded).toContain("dir/orig.txt")
    expect(recorded).toContain("dir/renamed.txt")
    await expect(
      gitOutput(directory, ["status", "--porcelain"]),
    ).resolves.toBe("")
  })

  it("refuses a rename scope that names only one half", async () => {
    const directory = await seedRepo()
    await execFileAsync(
      "git",
      ["mv", path.join("dir", "orig.txt"), path.join("dir", "renamed.txt")],
      { cwd: directory },
    )

    await expect(
      createControlledCommit({
        cwd: directory,
        message: "refactor: rename orig to renamed",
        files: ["dir/renamed.txt"],
        scopePolicy: "perun-exact",
        }),
    ).rejects.toThrow(/rename must be authorized as a whole/i)
    // Nothing was committed: the seed commit is still HEAD.
    await expect(
      gitOutput(directory, ["log", "--oneline", "--format=%s"]),
    ).resolves.toBe("chore: seed\n")
  })

  it("commits the whole authorized snapshot through the consent flow", async () => {
    const directory = await seedRepo()
    await writeFile(path.join(directory, "note.txt"), "two\n")
    await writeFile(path.join(directory, "fresh.txt"), "new\n")
    await execFileAsync("git", ["rm", "-q", "gone.txt"], { cwd: directory })

    const snapshot = await createCommitScopeSnapshot(directory)
    const authorization: CommitAuthorization = {
      token: "token",
      sessionId: "session",
      message: "feat: consent scope",
      snapshot,
      state: "pending",
      expiresAt: Number.MAX_SAFE_INTEGER,
    }

    const result = await createControlledCommit({
      cwd: directory,
      message: "feat: consent scope",
      scopePolicy: "perun-exact",
      authorization,
    })

    expect(result.commitMessage).toContain("feat: consent scope")
    const recorded = await nameStatus(directory)
    expect(recorded).toContain("M\tnote.txt")
    expect(recorded).toContain("A\tfresh.txt")
    expect(recorded).toContain("D\tgone.txt")
    await expect(
      gitOutput(directory, ["status", "--porcelain"]),
    ).resolves.toBe("")
  })

  it("refuses an authorization whose snapshot no longer matches the worktree", async () => {
    const directory = await seedRepo()
    await writeFile(path.join(directory, "note.txt"), "two\n")
    const snapshot = await createCommitScopeSnapshot(directory)
    await writeFile(path.join(directory, "drifted.txt"), "late\n")

    await expect(
      createControlledCommit({
        cwd: directory,
        message: "feat: consent scope",
        scopePolicy: "perun-exact",
        authorization: {
          token: "token",
          sessionId: "session",
          message: "feat: consent scope",
          snapshot,
          state: "pending",
          expiresAt: Number.MAX_SAFE_INTEGER,
        },
      }),
    ).rejects.toThrow(/selected Git scope changed before staging/i)
  })
})
