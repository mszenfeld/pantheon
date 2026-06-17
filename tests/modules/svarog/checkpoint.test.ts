import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createCheckpoint,
  restoreCheckpoint,
} from "../../../src/modules/svarog/checkpoint.js"

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()

describe("svarog checkpoint", () => {
  let repo: string
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "svarog-repo-"))
    git(repo, ["init", "-q"])
    git(repo, ["config", "user.email", "t@example.com"])
    git(repo, ["config", "user.name", "t"])
    writeFileSync(path.join(repo, "tracked.txt"), "v1\n")
    git(repo, ["add", "-A"])
    git(repo, ["commit", "-q", "-m", "init"])
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("captures an untracked file, leaves the tree intact, and restores a botched edit", () => {
    writeFileSync(path.join(repo, "feature.txt"), "new\n") // untracked, Svarog-created
    writeFileSync(path.join(repo, "tracked.txt"), "v2\n") // edited
    const ref = createCheckpoint(repo, "s1")

    // checkpoint captured the untracked file...
    expect(git(repo, ["ls-tree", "-r", "--name-only", ref]).split("\n")).toContain(
      "feature.txt",
    )
    // ...and create left the working tree untouched
    expect(readFileSync(path.join(repo, "tracked.txt"), "utf-8")).toBe("v2\n")

    // botched edit + a brand-new orphan file
    writeFileSync(path.join(repo, "tracked.txt"), "BROKEN\n")
    writeFileSync(path.join(repo, "orphan.txt"), "garbage\n")
    restoreCheckpoint(repo, ref)

    expect(readFileSync(path.join(repo, "tracked.txt"), "utf-8")).toBe("v2\n") // restored
    expect(existsSync(path.join(repo, "orphan.txt"))).toBe(false) // orphan removed
    expect(existsSync(path.join(repo, "feature.txt"))).toBe(true) // checkpoint file kept
    // index rebuilt to HEAD: the restored tracked edit shows UNSTAGED, not staged
    expect(git(repo, ["diff", "--cached", "--name-only"])).toBe("")
  })

  it("returns a non-empty ref even on a clean tree", () => {
    const ref = createCheckpoint(repo, "s2")
    expect(git(repo, ["rev-parse", ref])).toMatch(/^[0-9a-f]{40}$/)
  })
})
