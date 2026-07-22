import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createBranch } from "../../../src/modules/commit/create-branch.js"

const execFileAsync = promisify(execFile)

const createdDirs: string[] = []

/**
 * §7.2 mandatory fixture: init + user config + an INITIAL COMMIT (git
 * branch fails on an unborn HEAD) + the CAPTURED symbolic HEAD (the
 * default branch name is configurable — never hardcode master/main).
 */
async function createRepoWithCommit(): Promise<{
  cwd: string
  initialHead: string
}> {
  const cwd = await mkdtemp(path.join(tmpdir(), "av-opencode-create-branch-"))
  createdDirs.push(cwd)
  await execFileAsync("git", ["init"], { cwd })
  await execFileAsync("git", ["config", "user.email", "dev@example.com"], {
    cwd,
  })
  await execFileAsync("git", ["config", "user.name", "Dev User"], { cwd })
  await writeFile(path.join(cwd, "README.md"), "seed\n")
  await execFileAsync("git", ["add", "README.md"], { cwd })
  await execFileAsync("git", ["commit", "-m", "chore: seed"], { cwd })
  const head = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], {
    cwd,
  })
  return { cwd, initialHead: head.stdout.trim() }
}

async function currentHead(cwd: string): Promise<string> {
  const head = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], {
    cwd,
  })
  return head.stdout.trim()
}

async function branchList(cwd: string, pattern: string): Promise<string> {
  const list = await execFileAsync("git", ["branch", "--list", pattern], {
    cwd,
  })
  return list.stdout.trim()
}

describe("createBranch integration (real git)", () => {
  afterEach(async () => {
    for (const dir of createdDirs) {
      await rm(dir, { recursive: true, force: true })
    }
    createdDirs.length = 0
  })

  it("AC-7: creates and switches to the composed branch", async () => {
    const { cwd } = await createRepoWithCommit()
    const result = await createBranch({
      cwd,
      type: "feature",
      description: "inc 1 demo",
    })
    expect(result).toEqual({
      name: "feature/inc-1-demo",
      created: true,
      checkedOut: true,
    })
    expect(await branchList(cwd, "feature/inc-1-demo")).not.toBe("")
    expect(await currentHead(cwd)).toBe("feature/inc-1-demo")
  })

  it("AC-8: checkout:false creates the branch and leaves HEAD untouched", async () => {
    const { cwd, initialHead } = await createRepoWithCommit()
    const result = await createBranch({
      cwd,
      type: "fix",
      description: "stay put",
      checkout: false,
    })
    expect(result.checkedOut).toBe(false)
    expect(await branchList(cwd, "fix/stay-put")).not.toBe("")
    expect(await currentHead(cwd)).toBe(initialHead)
  })

  it("AC-9: a second call with the same segments rejects with git's already-exists error", async () => {
    const { cwd } = await createRepoWithCommit()
    await createBranch({
      cwd,
      type: "feature",
      description: "dup",
      checkout: false,
    })
    await expect(
      createBranch({
        cwd,
        type: "feature",
        description: "dup",
        checkout: false,
      }),
    ).rejects.toThrow(/already exists/)
  })

  it("AC-10: invalid input creates nothing", async () => {
    const { cwd } = await createRepoWithCommit()
    await expect(
      createBranch({ cwd, type: "feat", description: "x" }),
    ).rejects.toThrow("create_branch: segment 'type' violates rule S1")
    expect(await branchList(cwd, "feat/*")).toBe("")
    expect(await branchList(cwd, "*x*")).toBe("")
  })
})
