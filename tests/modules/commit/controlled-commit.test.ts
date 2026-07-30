import { describe, expect, it } from "vitest"
import {
  createControlledCommit,
  type GitResult,
  type GitRunner,
} from "../../../src/modules/commit/controlled-commit.js"
import { createCommitScopeSnapshot } from "../../../src/modules/commit/git-scope-snapshot.js"
import type { CommitAuthorization } from "../../../src/modules/commit/perun-commit-consent.js"

interface FakeGitCall {
  cwd: string
  args: string[]
}

interface FakeGitOptions {
  responses?: Partial<Record<string, GitResult>>
  defaultResponse?: GitResult
}

function fakeGitRunner(options: FakeGitOptions = {}): {
  runGit: GitRunner
  calls: FakeGitCall[]
} {
  const calls: FakeGitCall[] = []
  const responses = options.responses ?? {}
  const defaultResponse: GitResult = options.defaultResponse ?? {
    stdout: "",
    stderr: "",
    exitCode: 0,
  }

  const runGit: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args: [...args] })
    // The merge/cherry-pick probe is also a `rev-parse`; key it separately so it does not
    // collide with the work-tree `rev-parse`, and default it to "no merge in progress".
    if (args.includes("MERGE_HEAD") || args.includes("CHERRY_PICK_HEAD")) {
      return responses["merge-check"] ?? { stdout: "", stderr: "", exitCode: 1 }
    }
    if (args.includes("rebase-merge")) {
      return responses["rebase-merge"] ?? {
        stdout: ".git/rebase-merge\n",
        stderr: "",
        exitCode: 0,
      }
    }
    if (args.includes("rebase-apply")) {
      return responses["rebase-apply"] ?? {
        stdout: ".git/rebase-apply\n",
        stderr: "",
        exitCode: 0,
      }
    }
    if (args.includes("REVERT_HEAD")) {
      return responses["revert-check"] ?? { stdout: "", stderr: "", exitCode: 1 }
    }
    if (args.includes("--show-toplevel")) {
      return responses["repository-root"] ?? responses["rev-parse"] ?? defaultResponse
    }
    if (args[0] === "diff" && args.includes("--name-only")) {
      return responses["staged-files"] ?? defaultResponse
    }
    const key = args[0] ?? ""
    return responses[key] ?? defaultResponse
  }

  return { runGit, calls }
}

describe("createControlledCommit (unit, injected git runner)", () => {
  it("orchestrates rev-parse, add, diff, commit, status through the injected runner", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: {
          stdout: "[main abc] feat: add note\n",
          stderr: "",
          exitCode: 0,
        },
        status: { stdout: " M other.txt\n", stderr: "", exitCode: 0 },
      },
    })

    const result = await createControlledCommit({
      cwd: "/tmp/fake-repo",
      files: ["note.txt"],
      message: "feat: add note",
      runGit,
    })

    expect(result.commitMessage).toBe("feat: add note")
    expect(result.status).toBe("M other.txt")
    expect(calls.map((call) => call.args[0])).toEqual([
      "rev-parse", // --is-inside-work-tree
      "add",
      "diff",
      "rev-parse", // MERGE_HEAD probe (no merge)
      "rev-parse", // CHERRY_PICK_HEAD probe (no cherry-pick) → pathspec commit
      "commit",
      "status",
    ])
    const commitCall = calls.find((call) => call.args[0] === "commit")
    // The commit carries the same pathspec as the add: `git commit -m` alone would capture
    // the WHOLE index, so anything staged out-of-band would ride along.
    expect(commitCall?.args).toEqual([
      "commit",
      "-m",
      "feat: add note",
      "--",
      "note.txt",
    ])
    const addCall = calls.find((call) => call.args[0] === "add")
    expect(addCall?.args).toEqual(["add", "--", "note.txt"])
  })

  it("uses git add -A when no files are provided", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "", exitCode: 0 },
        status: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: "/tmp/fake-repo",
      message: "chore: stage everything",
      runGit,
    })

    const addCall = calls.find((call) => call.args[0] === "add")
    expect(addCall?.args).toEqual(["add", "-A"])
  })

  it("falls back to the unbound commit shape during a merge (partial commit impossible)", async () => {
    // git refuses `commit -m msg -- <files>` mid-merge ("cannot do a partial commit during a
    // merge"); the merge already scopes the commit, so the whole-index shape is correct there.
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        "merge-check": { stdout: "abc123\n", stderr: "", exitCode: 0 }, // MERGE_HEAD present
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "", exitCode: 0 },
        status: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: "/tmp/fake-repo",
      files: ["conflicted.txt"],
      message: "fix: resolve conflict",
      runGit,
    })

    const commitCall = calls.find((call) => call.args[0] === "commit")
    expect(commitCall?.args).toEqual(["commit", "-m", "fix: resolve conflict"])
    // staging still uses the named files — only the commit shape changes mid-merge
    const addCall = calls.find((call) => call.args[0] === "add")
    expect(addCall?.args).toEqual(["add", "--", "conflicted.txt"])
  })

  it("throws when the cwd is not a git repository", async () => {
    const { runGit } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "", stderr: "not a repo", exitCode: 128 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/not-a-repo",
        message: "feat: nope",
        runGit,
      }),
    ).rejects.toThrow(/not a git repository/i)
  })

  it("throws when there are no staged changes", async () => {
    const { runGit } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        message: "chore: empty commit",
        runGit,
      }),
    ).rejects.toThrow(/no changes to commit/i)
  })

  it("surfaces commit failure stderr from the injected runner", async () => {
    const { runGit } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "blocked by hook\n", exitCode: 1 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "fix: trigger hook",
        runGit,
      }),
    ).rejects.toThrow(/blocked by hook/i)
  })

  it("validates the commit message and task ID before any Git mutation", async () => {
    const { runGit, calls } = fakeGitRunner()

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "not a conventional commit",
        runGit,
      }),
    ).rejects.toThrow(/conventional commits/i)

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "feat: add note",
        taskId: "TASK-1\nmalformed",
        runGit,
      }),
    ).rejects.toThrow(/task id must not contain newlines/i)

    expect(calls).toEqual([])
  })

  it("refuses a Perun exact scope that is absent, empty, unsafe, or unchanged before staging", async () => {
    const cases: Array<{ files?: string[]; expected: RegExp }> = [
      { expected: /non-empty list/i },
      { files: [], expected: /non-empty list/i },
      { files: ["."], expected: /invalid file path/i },
      { files: ["unchanged.txt"], expected: /not a current repository change/i },
    ]

    for (const { files, expected } of cases) {
      const { runGit, calls } = fakeGitRunner({
        responses: {
          "rev-parse": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
          status: { stdout: "?? note.txt\0", stderr: "", exitCode: 0 },
        },
      })

      await expect(
        createControlledCommit({
          cwd: "/tmp/fake-repo",
          files,
          message: "feat: add note",
          scopePolicy: "perun-exact",
          runGit,
        }),
      ).rejects.toThrow(expected)

      expect(calls.some((call) => call.args[0] === "add")).toBe(false)
    }
  })

  it.each([
    ["rebase-merge", "rebase-merge", /rebase is active/i],
    ["rebase-apply", "rebase-apply", /rebase is active/i],
    ["revert", "revert-check", /revert is active/i],
  ])(
    "rejects Perun commits during %s before inspecting status or mutating",
    async (_label: string, marker: string, expected: RegExp) => {
      const { runGit, calls } = fakeGitRunner({
        responses: {
          "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
          "repository-root": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
          "rebase-merge": { stdout: ".git/rebase-merge\n", stderr: "", exitCode: 0 },
          "rebase-apply": { stdout: ".git/rebase-apply\n", stderr: "", exitCode: 0 },
          "revert-check": { stdout: "abc123\n", stderr: "", exitCode: 0 },
        },
      })
      const inspectedPaths: string[] = []

      await expect(
        createControlledCommit({
          cwd: "/tmp/fake-repo",
          files: ["note.txt"],
          message: "fix: resolve operation",
          scopePolicy: "perun-exact",
          runGit,
          pathExists: (absolutePath: string): boolean => {
            inspectedPaths.push(absolutePath)
            return absolutePath.endsWith(marker)
          },
        }),
      ).rejects.toThrow(expected)

      expect(calls.map((call) => call.args)).toEqual(
        marker === "revert-check"
          ? [
              ["rev-parse", "--is-inside-work-tree"],
              ["rev-parse", "--git-path", "rebase-merge"],
              ["rev-parse", "--git-path", "rebase-apply"],
              ["rev-parse", "-q", "--verify", "REVERT_HEAD"],
            ]
          : marker === "rebase-merge"
            ? [
                ["rev-parse", "--is-inside-work-tree"],
                ["rev-parse", "--git-path", "rebase-merge"],
              ]
            : [
                ["rev-parse", "--is-inside-work-tree"],
                ["rev-parse", "--git-path", "rebase-merge"],
                ["rev-parse", "--git-path", "rebase-apply"],
              ],
      )
      if (marker !== "revert-check") {
        expect(inspectedPaths).toEqual(
          marker === "rebase-merge"
            ? ["/tmp/fake-repo/.git/rebase-merge"]
            : [
                "/tmp/fake-repo/.git/rebase-merge",
                "/tmp/fake-repo/.git/rebase-apply",
              ],
        )
      }
      expect(calls.some((call) => ["status", "add", "diff", "commit"].includes(call.args[0] ?? ""))).toBe(false)
    },
  )

  it("fails closed when Perun sequencer state inspection fails", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        "repository-root": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
        "rebase-merge": { stdout: "", stderr: "failed", exitCode: 1 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "fix: resolve operation",
        scopePolicy: "perun-exact",
        runGit,
      }),
    ).rejects.toThrow(/could not inspect rebase state/i)
    expect(calls.some((call) => ["status", "add", "diff", "commit"].includes(call.args[0] ?? ""))).toBe(false)
  })

  it("does not inspect sequencer state for generic commits", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "", exitCode: 0 },
        status: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: "/tmp/fake-repo",
      message: "fix: generic commit",
      runGit,
    })

    expect(calls.some((call) => call.args.includes("rebase-merge") || call.args.includes("rebase-apply") || call.args.includes("REVERT_HEAD"))).toBe(false)
  })

  it("uses the canonical authorized list for Perun add, staged probe, and commit argv", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
        status: { stdout: "?? note.txt\0", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: "/tmp/fake-repo",
      files: ["./note.txt"],
      message: "feat: add note",
      scopePolicy: "perun-exact",
      runGit,
    })

    expect(calls.find((call) => call.args[0] === "add")?.args).toEqual([
      "add",
      "--",
      "note.txt",
    ])
    expect(calls.find((call) => call.args[0] === "diff")?.args).toEqual([
      "diff",
      "--cached",
      "--quiet",
      "--",
      "note.txt",
    ])
    expect(calls.find((call) => call.args[0] === "commit")?.args).toEqual([
      "commit",
      "-m",
      "feat: add note",
      "--",
      "note.txt",
    ])
  })

  it("does not let unrelated staged entries satisfy the Perun exact staged-change probe", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
        status: { stdout: "?? note.txt\0", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        // The authorized path has no cached change, even though an unrelated entry is staged.
        diff: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "feat: add note",
        scopePolicy: "perun-exact",
        runGit,
      }),
    ).rejects.toThrow(/no changes to commit/i)

    expect(calls.find((call) => call.args[0] === "diff")?.args).toEqual([
      "diff",
      "--cached",
      "--quiet",
      "--",
      "note.txt",
    ])
    expect(calls.some((call) => call.args[0] === "commit")).toBe(false)
  })

  it("refuses a Perun merge whose complete staged set differs from the authorized files", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
        "merge-check": { stdout: "abc123\n", stderr: "", exitCode: 0 },
        status: { stdout: "?? note.txt\0", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        "staged-files": {
          stdout: "note.txt\0unrelated.txt\0",
          stderr: "",
          exitCode: 0,
        },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "fix: resolve conflict",
        scopePolicy: "perun-exact",
        runGit,
      }),
    ).rejects.toThrow(/merge index mismatch/i)

    expect(calls.find((call) => call.args[0] === "diff" && call.args.includes("--name-only"))?.args).toEqual([
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--no-renames",
    ])
    expect(calls.some((call) => call.args[0] === "commit")).toBe(false)
  })

  it("uses the required whole-index commit only after Perun merge staged-set equality", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 },
        "merge-check": { stdout: "abc123\n", stderr: "", exitCode: 0 },
        status: { stdout: "?? note.txt\0", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        "staged-files": { stdout: "note.txt\0", stderr: "", exitCode: 0 },
        commit: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: "/tmp/fake-repo",
      files: ["note.txt"],
      message: "fix: resolve conflict",
      scopePolicy: "perun-exact",
      runGit,
    })

    expect(calls.find((call) => call.args[0] === "commit")?.args).toEqual([
      "commit",
      "-m",
      "fix: resolve conflict",
    ])
  })
})

describe("createControlledCommit (unit, authorized Perun consent flow)", () => {
  const root = process.cwd()
  // porcelain v2 `-z`: one modified file plus one ALREADY-STAGED deletion (index half `D`).
  const porcelainV2 =
    "1 .M N... 100644 100644 100644 1111111 2222222 note.ts\0" +
    "1 D. N... 100644 000000 000000 1111111 0000000 gone.txt\0"

  function authorizedRunner(): { runGit: GitRunner; calls: FakeGitCall[] } {
    return fakeGitRunner({
      responses: {
        "rev-parse": { stdout: `${root}\n`, stderr: "", exitCode: 0 },
        status: { stdout: porcelainV2, stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "[main abc] feat: consent\n", stderr: "", exitCode: 0 },
      },
    })
  }

  async function authorizationFor(runGit: GitRunner): Promise<CommitAuthorization> {
    return {
      token: "token",
      sessionId: "session",
      message: "feat: consent",
      snapshot: await createCommitScopeSnapshot(root, runGit),
      state: "pending",
      expiresAt: 1,
    }
  }

  it("commits the snapshot-derived scope instead of re-validating caller files", async () => {
    const { runGit, calls } = authorizedRunner()

    const result = await createControlledCommit({
      cwd: root,
      message: "feat: consent",
      scopePolicy: "perun-exact",
      authorization: await authorizationFor(runGit),
      runGit,
      pathExists: () => false,
    })

    expect(result.commitMessage).toContain("feat: consent")
    // The caller-supplied exact-file gate must NOT run: it would inspect `files`, which the
    // consent flow never passes, and dead-end every authorized commit.
    expect(
      calls.some((call) => call.args.includes("--porcelain=v1")),
    ).toBe(false)
    // An already-staged deletion cannot be handed to `git add` (the path is in neither the
    // worktree nor the index) but must still reach the commit pathspec.
    expect(calls.find((call) => call.args[0] === "add")?.args).toEqual([
      "add",
      "--",
      "note.ts",
    ])
    expect(calls.find((call) => call.args[0] === "commit")?.args).toEqual([
      "commit",
      "-m",
      "feat: consent",
      "--",
      "gone.txt",
      "note.ts",
    ])
  })

  it("still refuses when a rebase is in progress on the authorized path", async () => {
    const { runGit } = authorizedRunner()
    const authorization = await authorizationFor(runGit)

    await expect(
      createControlledCommit({
        cwd: root,
        message: "feat: consent",
        scopePolicy: "perun-exact",
        authorization,
        runGit,
        pathExists: () => true,
      }),
    ).rejects.toThrow(/rebase is active/i)
  })

  it("skips git add entirely when every authorized path is a git-recorded removal", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: `${root}\n`, stderr: "", exitCode: 0 },
        // porcelain v1 `-z`: a staged deletion only.
        status: { stdout: "D  gone.txt\0", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "[main abc] chore: drop\n", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: root,
      message: "chore: drop gone.txt",
      files: ["gone.txt"],
      scopePolicy: "perun-exact",
      runGit,
    })

    expect(calls.some((call) => call.args[0] === "add")).toBe(false)
    expect(calls.find((call) => call.args[0] === "commit")?.args).toEqual([
      "commit",
      "-m",
      "chore: drop gone.txt",
      "--",
      "gone.txt",
    ])
  })
})
