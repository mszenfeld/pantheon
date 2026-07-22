import { describe, expect, it } from "vitest"
import {
  createControlledCommit,
  type GitResult,
  type GitRunner,
} from "../../../src/modules/commit/controlled-commit.js"

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
})
