import { describe, expect, it } from "vitest"
import { detectProvider, type PrProvider } from "../../../src/modules/commit/pr-provider.js"
import {
  GH_MISSING_MESSAGE,
  githubPrProvider,
} from "../../../src/modules/commit/github-pr-provider.js"
import type { GitResult, GitRunner } from "../../../src/modules/commit/controlled-commit.js"
import { createPr } from "../../../src/modules/commit/create-pr.js"

describe("detectProvider (§5.4 normative vectors)", () => {
  it("recognizes github.com in all three URL shapes, case-insensitively", () => {
    expect(detectProvider("git@github.com:AppVerk/av-opencode-plugins.git")).toBe("github")
    expect(detectProvider("https://github.com/AppVerk/av-opencode-plugins")).toBe("github")
    expect(detectProvider("ssh://git@github.com/AppVerk/x.git")).toBe("github")
    expect(detectProvider("https://GITHUB.COM/a/b.git")).toBe("github")
  })

  it("returns undefined for every non-github / non-https / local shape", () => {
    expect(detectProvider("git@gitlab.com:a/b.git")).toBeUndefined()
    expect(detectProvider("https://github.enterprise.corp/a/b")).toBeUndefined()
    expect(detectProvider("file:///tmp/bare-remote.git")).toBeUndefined()
    expect(detectProvider("/tmp/bare-remote.git")).toBeUndefined()
    expect(detectProvider("http://github.com/a/b")).toBeUndefined()
  })

  it("does NOT trim: the raw-trailing-newline vector is a caller-path row (AC-2)", () => {
    expect(detectProvider("git@github.com:AppVerk/av-opencode-plugins.git\n")).toBeUndefined()
  })
})

interface FakeCall {
  cwd: string
  args: string[]
}

function fakeGhRunner(result: GitResult): { runGh: GitRunner; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const runGh: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args: [...args] })
    return result
  }
  return { runGh, calls }
}

const PR_INPUT = {
  cwd: "/tmp/fake",
  head: "feature/INC-212-x",
  base: "master",
  title: "feat: x",
  body: "line one\n\nRefs: INC-212",
  draft: false,
}

describe("githubPrProvider (gh argv contract, AC-9/AC-10)", () => {
  it("invokes gh once with --flag=value tokens and extracts the last matching URL line", async () => {
    const { runGh, calls } = fakeGhRunner({
      stdout: "Creating pull request…\nhttps://github.com/AppVerk/x/pull/7\n",
      stderr: "",
      exitCode: 0,
    })
    const { url } = await githubPrProvider(runGh).createPullRequest(PR_INPUT)
    expect(url).toBe("https://github.com/AppVerk/x/pull/7")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      "pr",
      "create",
      "--title=feat: x",
      "--body=line one\n\nRefs: INC-212",
      "--base=master",
      "--head=feature/INC-212-x",
    ])
  })

  it("appends --draft iff draft is true", async () => {
    const { runGh, calls } = fakeGhRunner({
      stdout: "https://github.com/AppVerk/x/pull/8\n",
      stderr: "",
      exitCode: 0,
    })
    await githubPrProvider(runGh).createPullRequest({ ...PR_INPUT, draft: true })
    expect(calls[0]?.args.at(-1)).toBe("--draft")
  })

  it("keeps the last URL when several lines match (scan all lines, keep last match)", async () => {
    const { runGh } = fakeGhRunner({
      stdout: "https://github.com/first\nsome text\nhttps://github.com/AppVerk/x/pull/9\ntrailing note\n",
      stderr: "",
      exitCode: 0,
    })
    const { url } = await githubPrProvider(runGh).createPullRequest(PR_INPUT)
    expect(url).toBe("https://github.com/AppVerk/x/pull/9")
  })

  it("treats a no-URL stdout as a provider failure (FR-7 → FR-8 path)", async () => {
    const { runGh } = fakeGhRunner({ stdout: "done\n", stderr: "", exitCode: 0 })
    await expect(githubPrProvider(runGh).createPullRequest(PR_INPUT)).rejects.toThrow(
      /returned no PR URL/,
    )
  })

  it("propagates gh's stderr on non-zero exit", async () => {
    const { runGh } = fakeGhRunner({
      stdout: "",
      stderr: "a pull request for branch already exists: https://github.com/AppVerk/x/pull/7\n",
      exitCode: 1,
    })
    await expect(githubPrProvider(runGh).createPullRequest(PR_INPUT)).rejects.toThrow(
      /already exists/,
    )
  })

  it("maps a thrown spawn ENOENT to the FR-9 install message (AC-8)", async () => {
    const enoent = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })
    const runGh: GitRunner = async () => {
      throw enoent
    }
    await expect(githubPrProvider(runGh).createPullRequest(PR_INPUT)).rejects.toThrow(
      GH_MISSING_MESSAGE,
    )
  })
})

function recordingGitRunner(
  responses: Partial<Record<string, GitResult>> = {},
): { runGit: GitRunner; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const runGit: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args: [...args] })
    return responses[args[0] ?? ""] ?? { stdout: "", stderr: "", exitCode: 0 }
  }
  return { runGit, calls }
}

describe("createPr parameter validation (AC-1: zero spawns, normative template)", () => {
  async function rejectsWith(
    args: Partial<Parameters<typeof createPr>[0]>,
    pattern: RegExp,
  ) {
    const { runGit, calls } = recordingGitRunner()
    await expect(
      createPr({ cwd: "/tmp/fake", title: "ok", runGit, ...args }),
    ).rejects.toThrow(pattern)
    expect(calls).toHaveLength(0)
  }

  it("rejects every rule with the exact template (field, ruleId, slug, JSON value)", async () => {
    await rejectsWith({ title: "   " }, /^create_pr: field 'title' violates rule T1 \(empty-title\): ""$/)
    await rejectsWith({ title: "a".repeat(257) }, /rule T2 \(max-length-256-chars\)/)
    await rejectsWith({ title: "two\nlines" }, /rule T3 \(control-characters\)/)
    await rejectsWith({ taskId: "INC 212" }, /field 'taskId' violates rule K1 \(invalid-characters\): "INC 212"/)
    await rejectsWith({ taskId: "-x" }, /field 'taskId' violates rule K2 \(leading-dash\): "-x"/)
    await rejectsWith({ body: "x".repeat(64_001) }, /field 'body' violates rule B1 \(max-length-64000-bytes\)/)
    await rejectsWith({ body: "nul\x00byte" }, /rule B2 \(control-characters\)/)
    await rejectsWith({ body: "esc\x1Bbyte" }, /rule B2 \(control-characters\)/)
    await rejectsWith({ base: "a b" }, /field 'base' violates rule R1 \(invalid-characters\): "a b"/)
    await rejectsWith({ base: "-d" }, /field 'base' violates rule R2 \(leading-dash\): "-d"/)
    await rejectsWith({ base: "a..b" }, /field 'base' violates rule R3 \(dot-dot\): "a\.\.b"/)
    await rejectsWith({ base: "a//b" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "/a" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "a/" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "a/.h" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "x.lock" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "x." }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "a".repeat(241) }, /rule R5 \(max-length-240-bytes\)/)
  })

  it("evaluation order is title → taskId → body → base; first failing rule reported", async () => {
    // multi-violation input: bad title AND bad base — title wins
    await rejectsWith({ title: "", base: "a b" }, /field 'title' violates rule T1/)
    // bad taskId AND bad body — taskId wins (B1 validates the resolved body, taskId first)
    await rejectsWith({ taskId: "bad id", body: "x".repeat(64_001) }, /field 'taskId' violates rule K1/)
  })

  it("accepts the boundary vectors without a validation throw", async () => {
    // These pass validation and proceed to G1; an empty recording runner returns
    // stdout "" for `branch --show-current`, so head resolves to "" (detached HEAD).
    const { runGit } = recordingGitRunner()
    await expect(
      createPr({ cwd: "/t", title: "a".repeat(256), runGit }),
    ).rejects.toThrow(/HEAD is detached/)
    await expect(
      createPr({ cwd: "/t", title: "ok", body: "x".repeat(64_000), runGit }),
    ).rejects.toThrow(/HEAD is detached/)
    await expect(
      createPr({ cwd: "/t", title: "ok", base: "a".repeat(240), runGit }),
    ).rejects.toThrow(/HEAD is detached/)
    await expect(
      createPr({ cwd: "/t", title: "ok", base: "release/2026.07", runGit }),
    ).rejects.toThrow(/HEAD is detached/)
  })

  it("resolves the Refs footer per §5.2 Normalization", async () => {
    // Whitespace-only body + taskId → "Refs: <id>" (no leading blank lines): B1/B2 must
    // validate that resolved value, so an oversized taskId-only body still trips B1.
    await rejectsWith(
      { body: "   ", taskId: "A".repeat(64_001) },
      /field 'taskId' violates rule K1|field 'body' violates rule B1/,
    )
  })
})

const HAPPY_GIT: Partial<Record<string, GitResult>> = {
  branch: { stdout: "feature/INC-212-x\n", stderr: "", exitCode: 0 },
  "symbolic-ref": { stdout: "origin/master\n", stderr: "", exitCode: 0 },
  remote: {
    stdout: "git@github.com:AppVerk/av-opencode-plugins.git\n", // trailing newline: FR-5 trims
    stderr: "",
    exitCode: 0,
  },
  push: { stdout: "", stderr: "", exitCode: 0 },
}

function happyGhRunner(): { runGh: GitRunner; calls: FakeCall[] } {
  return fakeGhRunner({
    stdout: "https://github.com/AppVerk/x/pull/7\n",
    stderr: "",
    exitCode: 0,
  })
}

describe("createPr orchestration (AC-3…AC-7)", () => {
  it("AC-3: happy path — detection exercised, exact git sequence, exact result", async () => {
    const { runGit, calls } = recordingGitRunner(HAPPY_GIT)
    const { runGh } = happyGhRunner()
    const result = await createPr({ cwd: "/repo", title: "feat: x", runGit, runGh })
    expect(calls.map((c) => c.args)).toEqual([
      ["branch", "--show-current"],
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      ["remote", "get-url", "origin"],
      ["push", "-u", "origin", "feature/INC-212-x"],
    ])
    expect(result).toEqual({
      head: "feature/INC-212-x",
      base: "master",
      pushed: true,
      prCreated: true,
      draft: false,
      url: "https://github.com/AppVerk/x/pull/7",
    })
  })

  it("AC-4: explicit base skips symbolic-ref; whitespace-only base is treated as omitted", async () => {
    const explicit = recordingGitRunner(HAPPY_GIT)
    await createPr({
      cwd: "/repo",
      title: "t",
      base: "develop",
      runGit: explicit.runGit,
      runGh: happyGhRunner().runGh,
    })
    expect(explicit.calls.map((c) => c.args[0])).toEqual(["branch", "remote", "push"])

    const whitespace = recordingGitRunner(HAPPY_GIT)
    const result = await createPr({
      cwd: "/repo",
      title: "t",
      base: "   ",
      runGit: whitespace.runGit,
      runGh: happyGhRunner().runGh,
    })
    expect(whitespace.calls.map((c) => c.args[0])).toContain("symbolic-ref")
    expect(result.base).toBe("master")
  })

  it("AC-5: every guard throws its message and no push is ever recorded", async () => {
    const cases: Array<{
      responses: Partial<Record<string, GitResult>>
      pattern: RegExp
      base?: string
    }> = [
      {
        responses: { ...HAPPY_GIT, branch: { stdout: "\n", stderr: "", exitCode: 0 } },
        pattern: /HEAD is detached — check out a branch first \(use create_branch\)/,
      },
      {
        responses: HAPPY_GIT,
        base: "feature/INC-212-x", // equals head
        pattern: /refusing to push and open a PR from the base branch 'feature\/INC-212-x'/,
      },
      {
        responses: { ...HAPPY_GIT, remote: { stdout: "", stderr: "no origin", exitCode: 2 } },
        pattern: /no 'origin' remote is configured/,
      },
      {
        responses: {
          ...HAPPY_GIT,
          remote: { stdout: "git@gitlab.com:a/b.git\n", stderr: "", exitCode: 0 },
        },
        pattern: /unsupported git host for PR creation \(supported: github\.com\)/,
      },
      {
        responses: {
          ...HAPPY_GIT,
          "symbolic-ref": { stdout: "", stderr: "fatal", exitCode: 1 },
        },
        pattern: /cannot resolve the default branch of 'origin' — pass 'base' explicitly or run: git remote set-head origin --auto/,
      },
    ]
    for (const testCase of cases) {
      const { runGit, calls } = recordingGitRunner(testCase.responses)
      await expect(
        createPr({ cwd: "/repo", title: "t", base: testCase.base, runGit }),
      ).rejects.toThrow(testCase.pattern)
      expect(calls.map((c) => c.args[0])).not.toContain("push")
    }
  })

  it("AC-6: push failure propagates git stderr and the provider is never invoked", async () => {
    const { runGit } = recordingGitRunner({
      ...HAPPY_GIT,
      push: { stdout: "", stderr: "remote: permission denied\n", exitCode: 128 },
    })
    const gh = happyGhRunner()
    await expect(
      createPr({ cwd: "/repo", title: "t", runGit, runGh: gh.runGh }),
    ).rejects.toThrow(/permission denied/)
    expect(gh.calls).toHaveLength(0)
  })

  it("AC-7: provider failure after a successful push resolves to a partial result", async () => {
    const { runGit, calls } = recordingGitRunner(HAPPY_GIT)
    const failingProvider: PrProvider = {
      name: "fake",
      async createPullRequest() {
        throw new Error("a pull request already exists: https://github.com/AppVerk/x/pull/7")
      },
    }
    const result = await createPr({
      cwd: "/repo",
      title: "t",
      runGit,
      provider: failingProvider,
    })
    expect(result).toEqual({
      head: "feature/INC-212-x",
      base: "master",
      pushed: true,
      prCreated: false,
      draft: false,
      prError: "a pull request already exists: https://github.com/AppVerk/x/pull/7",
    })
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(1)
    // FR-5 injection rule: detection (remote get-url) is skipped entirely
    expect(calls.map((c) => c.args[0])).not.toContain("remote")
  })

  it("FR-9 end-to-end: missing gh binary yields the install-message partial result", async () => {
    const { runGit } = recordingGitRunner(HAPPY_GIT)
    const enoentRunGh: GitRunner = async () => {
      throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })
    }
    const result = await createPr({ cwd: "/repo", title: "t", runGit, runGh: enoentRunGh })
    expect(result.pushed).toBe(true)
    expect(result.prCreated).toBe(false)
    expect(result.prError).toBe(GH_MISSING_MESSAGE)
  })

  it("AC-10: draft echoes through the result and the gh argv", async () => {
    const { runGit } = recordingGitRunner(HAPPY_GIT)
    const gh = happyGhRunner()
    const result = await createPr({
      cwd: "/repo",
      title: "t",
      draft: true,
      runGit,
      runGh: gh.runGh,
    })
    expect(result.draft).toBe(true)
    expect(gh.calls[0]?.args.at(-1)).toBe("--draft")
  })
})
