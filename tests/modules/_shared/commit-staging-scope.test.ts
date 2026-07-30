import { describe, expect, it } from "vitest"
import {
  bareCommitDenialMessage,
  directoryCommitDenialMessage,
  findDirectoryPath,
  formatCommitPath,
  hasExplicitCommitFiles,
  isScopedCommitPath,
  unbudgetedCommitPathMessage,
} from "../../../src/modules/_shared/commit-staging-scope.js"

describe("commit staging scope", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["src/note.ts", false],
    [[], false],
    [["src/note.ts", ""], false],
    [[""], false],
    [["."], false],
    [["./"], false],
    [["/"], false],
    [[":/"], false],
    [[":(top)src/note.ts"], false],
    [["*"], false],
    [["**"], false],
    [[":(glob)**"], false],
    [["*.ts"], false],
    [["src/?.ts"], false],
    [["src/[ab].ts"], false],
    [["../outside.ts"], false],
    [["src/../note.ts"], false],
    [[" note.ts"], false],
    [["note.ts "], false],
    [["\tnote.ts\t"], false],
    [["note\n.ts"], false],
    [["note\u0085.ts"], false],
    [["src/note.ts"], true],
    [["./src/note.ts"], true],
    [["deleted-note.ts"], true],
    [["old-name.ts", "new-name.ts"], true],
    [["note.ts", "./note.ts"], true],
    [["note.ts", "note.ts"], true],
    [["src"], true],
  ])("recognizes lexical scope %#", (files: unknown, expected: boolean) => {
    expect(hasExplicitCommitFiles(files)).toBe(expected)
  })

  it.each([
    [".."],
    ["../"],
    ["./."],
    [":/"],
    ["**"],
    ["src/*"],
    ["src/.."],
    [":(top)src/note.ts"],
    [":(literal)src/note.ts"],
    ["\tnote.ts"],
    ["note.ts\r"],
    ["note\u0000.ts"],
    ["note\u001f.ts"],
    ["note\u0007.ts"],
    ["note\u001b.ts"],
    ["note\u007f.ts"],
    ["note\u009f.ts"],
  ])("rejects additional unsafe lexical path %#", (path: string) => {
    expect(isScopedCommitPath(path)).toBe(false)
  })

  it("keeps directory detection separate from lexical shape validation", () => {
    expect(isScopedCommitPath("src")).toBe(true)
    expect(findDirectoryPath(["src", "deleted.ts"], (path: string): boolean => path === "src")).toBe("src")
    expect(findDirectoryPath(["deleted.ts"], (): boolean => false)).toBeUndefined()
  })

  it("JSON-escapes path-bearing denial values", () => {
    const unsafe = "bad\u0085\n\u001b[31m"
    const formatted = '"bad\\u0085\\n\\u001b[31m"'

    expect(formatCommitPath(unsafe)).toBe(formatted)
    expect(formatCommitPath(unsafe)).not.toContain(unsafe)
    expect(directoryCommitDenialMessage("SCOPE", "agent", unsafe)).toContain(formatted)
    expect(unbudgetedCommitPathMessage("SCOPE", unsafe, [unsafe])).toContain(
      `named ${formatted}`,
    )
    expect(unbudgetedCommitPathMessage("SCOPE", "safe.ts", [unsafe])).toContain(
      `edited: ${formatted}`,
    )
    expect(bareCommitDenialMessage("SCOPE", "agent")).toContain("SCOPE")
  })
})
