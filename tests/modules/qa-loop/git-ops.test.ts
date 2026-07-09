import { describe, it, expect, beforeEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  capturePreLoopRef,
  refExists,
  restoreFailRef,
  undoToPreLoop,
  antiHardcodeDiff,
} from "../../../src/modules/qa-loop/git-ops.js"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function initRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "qa-loop-git-"))
  git(cwd, ["init", "-q"])
  git(cwd, ["config", "user.email", "t@t.t"])
  git(cwd, ["config", "user.name", "t"])
  writeFileSync(join(cwd, "a.txt"), "v1")
  git(cwd, ["add", "-A"])
  git(cwd, ["commit", "-q", "-m", "init"])
  return cwd
}

let cwd: string
beforeEach(() => {
  cwd = initRepo()
})

describe("capturePreLoopRef / refExists / undoToPreLoop", () => {
  it("captures refs/qa-loop/pre/<run> including dirty work and undo restores it", () => {
    writeFileSync(join(cwd, "a.txt"), "dirty-pre")
    const ref = capturePreLoopRef(cwd, "qa-loop-demo-1")
    expect(ref).toBe("refs/qa-loop/pre/qa-loop-demo-1")
    expect(refExists(cwd, ref)).toBe(true)

    // loop edits the tree
    writeFileSync(join(cwd, "a.txt"), "loop-edited")
    writeFileSync(join(cwd, "new.txt"), "loop-created")

    undoToPreLoop(cwd, ref)
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("dirty-pre") // back to pre-loop dirty state
    expect(existsSync(join(cwd, "new.txt"))).toBe(false) // loop-created file removed
  })

  it("refExists is false for a never-captured ref", () => {
    expect(refExists(cwd, "refs/qa-loop/pre/never")).toBe(false)
  })
})

describe("restoreFailRef wraps restoreCheckpoint (cumulative-safe FAIL restore)", () => {
  it("reverts only this issue's edit to the checkpoint tree", () => {
    // a prior READY fix landed
    writeFileSync(join(cwd, "a.txt"), "prior-ready-fix")
    // checkpoint taken BEFORE issue-N's edit (contains the prior fix)
    const ckptRef = capturePreLoopRef(cwd, "ckpt-sesN")
    // issue-N edits + creates
    writeFileSync(join(cwd, "a.txt"), "issueN-broken")
    writeFileSync(join(cwd, "issueN.txt"), "issueN-created")

    restoreFailRef(cwd, ckptRef)
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("prior-ready-fix") // prior fix preserved
    expect(existsSync(join(cwd, "issueN.txt"))).toBe(false) // issue-N's created file removed
  })
})

describe("antiHardcodeDiff (§6, best-effort, non-blocking)", () => {
  it("flags an added literal that exactly matches a BE scenario payload value", () => {
    // checkpoint pre-edit
    const ckptRef = capturePreLoopRef(cwd, "ckpt-hc")
    // the fix hardcodes the test's expected payload value
    writeFileSync(join(cwd, "a.txt"), 'return { total: "EXPECTED-42" }')

    const warnings = antiHardcodeDiff(cwd, ckptRef, ["a.txt"], ['"EXPECTED-42"'])
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain("EXPECTED-42")
  })

  it("returns no warnings when no added literal matches a payload", () => {
    const ckptRef = capturePreLoopRef(cwd, "ckpt-clean")
    writeFileSync(join(cwd, "a.txt"), "const x = computeRealValue()")

    const warnings = antiHardcodeDiff(cwd, ckptRef, ["a.txt"], ['"EXPECTED-42"'])
    expect(warnings).toEqual([])
  })

  it("skips changed[] entries that are not plain in-tree paths", () => {
    const ckptRef = capturePreLoopRef(cwd, "ckpt-sec")
    writeFileSync(join(cwd, "a.txt"), 'return "EXPECTED-42"')
    // flag-like, pathspec-magic, and traversal entries are all skipped → no warnings and no throw,
    // even though a.txt on disk DOES contain the payload literal.
    const skipped = antiHardcodeDiff(cwd, ckptRef, ["-x", ":(glob)**", "../escape.txt"], ['"EXPECTED-42"'])
    expect(skipped).toEqual([])
    // a plain in-tree path is still diffed normally — the guard is surgical.
    const real = antiHardcodeDiff(cwd, ckptRef, ["a.txt"], ['"EXPECTED-42"'])
    expect(real.length).toBe(1)
  })
})
