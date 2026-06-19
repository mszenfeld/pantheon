import { describe, expect, it } from "vitest"
import { isMutatingGitCommand } from "../../../src/modules/_shared/mutating-git.js"

describe("isMutatingGitCommand", () => {
  it("flags tree- and branch-mutating git subcommands", () => {
    for (const cmd of [
      "git checkout feature/global-skills", // the exact eval-incident command
      "git switch main",
      "git reset --hard HEAD",
      "git restore .",
      "git clean -fd",
      "git stash",
      "git rebase main",
      "git merge feature",
      "git cherry-pick abc123",
      "git worktree add /tmp/wt HEAD",
      "git branch -D stale",
      "git branch -d old",
      "git branch --delete old",
    ]) {
      expect(isMutatingGitCommand(cmd), cmd).toBe(true)
    }
  })

  it("passes read-only git (status/log/diff/blame/show/rev-parse, branch listing)", () => {
    for (const cmd of [
      "git status",
      "git log --oneline -10",
      "git --no-pager log",
      "git diff --stat",
      "git blame src/x.ts",
      "git show HEAD",
      "git rev-parse HEAD",
      "git branch --show-current",
      "git branch -a",
      "git branch",
      "git log --grep=checkout", // 'checkout' appears only inside a grep pattern, not as the subcommand
      "git diff -- checkout.ts", // 'checkout' appears only as a pathspec
    ]) {
      expect(isMutatingGitCommand(cmd), cmd).toBe(false)
    }
  })

  it("finds the subcommand past git global options", () => {
    expect(isMutatingGitCommand("git -C /repo checkout main")).toBe(true)
    expect(isMutatingGitCommand("git -c core.pager=cat checkout x")).toBe(true)
    expect(isMutatingGitCommand("git --no-pager reset --hard")).toBe(true)
    expect(isMutatingGitCommand("git -C /repo status")).toBe(false)
  })

  it("examines each command in a compound shell line", () => {
    expect(isMutatingGitCommand("cd /repo && git checkout x")).toBe(true)
    expect(isMutatingGitCommand("git status; git checkout x")).toBe(true)
    expect(isMutatingGitCommand("git fetch && git status")).toBe(false)
  })

  it("treats leading sudo / env-assignment prefixes as still-git", () => {
    expect(isMutatingGitCommand("sudo git reset --hard")).toBe(true)
    expect(isMutatingGitCommand("GIT_DIR=/x git checkout y")).toBe(true)
  })

  it("does not false-positive when 'git' is an argument to another program", () => {
    expect(isMutatingGitCommand("echo git checkout")).toBe(false)
    expect(isMutatingGitCommand("grep -r checkout .")).toBe(false)
    expect(isMutatingGitCommand("bun run test")).toBe(false)
    expect(isMutatingGitCommand("gitfoo checkout")).toBe(false)
  })
})
