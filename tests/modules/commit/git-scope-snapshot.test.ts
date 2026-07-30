import { describe, expect, it } from "vitest"
import { parsePorcelainV2 } from "../../../src/modules/commit/git-scope-snapshot.js"

describe("parsePorcelainV2", () => {
  it("keeps a rename atomic and labels deletions", () => {
    const records = [
      "2 R. N... 100644 100644 100644 abc abc R100 renamed.ts",
      "original.ts",
      "1 D. N... 100644 000000 000000 abc 000000 deleted.ts",
    ].join("\0") + "\0"

    expect(parsePorcelainV2(records)).toEqual([
      expect.objectContaining({ status: "deleted", path: "deleted.ts" }),
      expect.objectContaining({
        status: "renamed",
        path: "renamed.ts",
        renameFrom: "original.ts",
      }),
    ])
  })

  it("fails closed on malformed records", () => {
    expect((): void => {
      parsePorcelainV2("x unsafe\0")
    }).toThrow(/malformed porcelain v2/i)
  })
})
