import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createPr } from "../../../src/modules/commit/create-pr.js"
import type {
  CreatePullRequestInput,
  PrProvider,
} from "../../../src/modules/commit/pr-provider.js"

const run = promisify(execFile)

function fakeProvider(): {
  provider: PrProvider
  calls: CreatePullRequestInput[]
} {
  const calls: CreatePullRequestInput[] = []
  return {
    calls,
    provider: {
      name: "fake",
      async createPullRequest(input) {
        calls.push(input)
        return { url: "https://example.invalid/pr/1" }
      },
    },
  }
}

describe("createPr (integration: real git, bare origin, injected provider)", () => {
  let work: string
  let bare: string
  let defaultBranch: string

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "create-pr-work-"))
    bare = await mkdtemp(path.join(tmpdir(), "create-pr-origin-"))
    await run("git", ["init", "--bare"], { cwd: bare })
    await run("git", ["init"], { cwd: work })
    await run("git", ["config", "user.email", "test@example.com"], {
      cwd: work,
    })
    await run("git", ["config", "user.name", "Test User"], { cwd: work })
    await writeFile(path.join(work, "README.md"), "hello\n")
    await run("git", ["add", "README.md"], { cwd: work })
    await run("git", ["commit", "-m", "chore: init"], { cwd: work })
    // Never hardcode master/main — init.defaultBranch is configurable (spec §7.2 fixture rule).
    const { stdout } = await run("git", ["branch", "--show-current"], {
      cwd: work,
    })
    defaultBranch = stdout.trim()
    await run("git", ["remote", "add", "origin", bare], { cwd: work })
    await run("git", ["push", "-u", "origin", defaultBranch], { cwd: work })
    await run("git", ["remote", "set-head", "origin", "--auto"], { cwd: work })
  })

  afterEach(async () => {
    await rm(work, { recursive: true, force: true })
    await rm(bare, { recursive: true, force: true })
  })

  it("AC-11: pushes the current branch and hands the resolved default base to the provider", async () => {
    await run("git", ["checkout", "-b", "feature/inc-1"], { cwd: work })
    const { provider, calls } = fakeProvider()

    const result = await createPr({ cwd: work, title: "feat: inc-1", provider })

    expect(result).toEqual({
      head: "feature/inc-1",
      base: defaultBranch,
      pushed: true,
      prCreated: true,
      draft: false,
      url: "https://example.invalid/pr/1",
    })
    const remoteBranches = await run(
      "git",
      ["branch", "--list", "feature/inc-1"],
      {
        cwd: bare,
      },
    )
    expect(remoteBranches.stdout).toContain("feature/inc-1")
    const upstream = await run(
      "git",
      ["rev-parse", "--abbrev-ref", "feature/inc-1@{upstream}"],
      { cwd: work },
    )
    expect(upstream.stdout.trim()).toBe("origin/feature/inc-1")
    expect(calls[0]?.base).toBe(defaultBranch)
    expect(calls[0]?.head).toBe("feature/inc-1")
  })

  it("AC-12: an idempotent re-run pushes as a no-op and invokes the provider again", async () => {
    await run("git", ["checkout", "-b", "feature/inc-2"], { cwd: work })
    const { provider, calls } = fakeProvider()

    const first = await createPr({ cwd: work, title: "feat: inc-2", provider })
    const second = await createPr({ cwd: work, title: "feat: inc-2", provider })

    expect(first.pushed).toBe(true)
    expect(second.pushed).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("AC-13: refuses to publish from the base branch; the bare repo gains no branch", async () => {
    const { provider } = fakeProvider()

    await expect(
      createPr({ cwd: work, title: "feat: nope", provider }),
    ).rejects.toThrow(/refusing to push and open a PR from the base branch/)

    const remoteBranches = await run("git", ["branch", "-a"], { cwd: bare })
    expect(remoteBranches.stdout.trim().split("\n")).toHaveLength(1)
  })
})
