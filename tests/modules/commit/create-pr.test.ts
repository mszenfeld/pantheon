import { describe, expect, it } from "vitest"
import { detectProvider } from "../../../src/modules/commit/pr-provider.js"
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
    // These stop at the not-yet-implemented guard phase, NOT at validation:
    const { runGit } = recordingGitRunner()
    await expect(
      createPr({ cwd: "/t", title: "a".repeat(256), runGit }),
    ).rejects.toThrow(/guards not implemented/)
    await expect(
      createPr({ cwd: "/t", title: "ok", body: "x".repeat(64_000), runGit }),
    ).rejects.toThrow(/guards not implemented/)
    await expect(
      createPr({ cwd: "/t", title: "ok", base: "a".repeat(240), runGit }),
    ).rejects.toThrow(/guards not implemented/)
    await expect(
      createPr({ cwd: "/t", title: "ok", base: "release/2026.07", runGit }),
    ).rejects.toThrow(/guards not implemented/)
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
