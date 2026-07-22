import { describe, expect, it } from "vitest"
import { detectProvider } from "../../../src/modules/commit/pr-provider.js"
import {
  GH_MISSING_MESSAGE,
  githubPrProvider,
} from "../../../src/modules/commit/github-pr-provider.js"
import type { GitResult, GitRunner } from "../../../src/modules/commit/controlled-commit.js"

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
