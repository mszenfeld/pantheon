import { describe, expect, it } from "vitest"
import {
  authorizePerunExactFiles,
  assertPublicationCaller,
  classifyCommitCaller,
  parsePorcelainV1Status,
  parsePorcelainV1StatusDetailed,
  PUBLICATION_AGENT_IDENTITIES,
} from "../../../src/modules/commit/perun-commit-policy.js"
import { SVAROG_AGENT_KEY } from "../../../src/modules/svarog/svarog.metadata.js"
import { STRIBOG_AGENT_KEY } from "../../../src/modules/stribog/stribog.metadata.js"

describe("Perun commit caller policy", () => {
  it("selects exact scope only for the canonical Perun identity", () => {
    expect(classifyCommitCaller("Perun - Coordinator")).toBe("perun-exact")
  })

  it.each(["svarog", "operator"]) ("keeps known non-Perun caller %s generic", (agent: string) => {
    expect(classifyCommitCaller(agent)).toBe("generic")
  })

  it.each([undefined, null, "", "   "])("rejects unresolved caller identity before mutation", (agent: unknown) => {
    expect((): void => {
      classifyCommitCaller(agent)
    }).toThrow("av_commit: caller identity is unavailable; refusing before mutation.")
  })
})

describe("Perun publication policy", () => {
  it("exports exactly the two canonical executor identities", () => {
    expect(PUBLICATION_AGENT_IDENTITIES).toEqual([
      SVAROG_AGENT_KEY,
      STRIBOG_AGENT_KEY,
    ])
    expect(PUBLICATION_AGENT_IDENTITIES).toHaveLength(2)
  })

  it.each(["create_branch", "create_pr"] as const)(
    "permits only the canonical executors to %s",
    (operation: "create_branch" | "create_pr") => {
      for (const agent of PUBLICATION_AGENT_IDENTITIES) {
        expect((): void => {
          assertPublicationCaller(agent, operation)
        }).not.toThrow()
      }
    },
  )

  it.each(["create_branch", "create_pr"] as const)(
    "rejects every non-publisher from %s",
    (operation: "create_branch" | "create_pr") => {
      for (const agent of [
        "Perun - Coordinator",
        "operator",
        "zmora-fe",
        "Veles - Planner",
        "custom-agent",
        "Svarog",
        " svarog",
        "svarog ",
        undefined,
        null,
        "",
        "   ",
      ]) {
        expect((): void => {
          assertPublicationCaller(agent, operation)
        }).toThrow(
          typeof agent === "string" && agent.trim() === ""
            ? `${operation}: caller identity is unavailable; refusing before mutation.`
            : typeof agent !== "string"
              ? `${operation}: caller identity is unavailable; refusing before mutation.`
              : `${operation}: caller is not authorized.`,
        )
      }
    },
  )
})

describe("NUL-delimited porcelain-v1 status parsing", () => {
  it("collects tracked, untracked, deleted, rename, and copy paths", () => {
    const status = [
      " M modified file.ts",
      "?? untracked-雪.txt",
      "D  deleted.ts",
      "R  renamed destination.ts",
      "renamed source.ts",
      "C  copied destination.ts",
      "copied source.ts",
    ].join("\0") + "\0"

    expect([...parsePorcelainV1Status(status)]).toEqual([
      "modified file.ts",
      "untracked-雪.txt",
      "deleted.ts",
      "renamed destination.ts",
      "renamed source.ts",
      "copied destination.ts",
      "copied source.ts",
    ])
  })

  it.each([
    ["missing NUL terminator", " M modified.ts"],
    ["missing status separator", " Mmodified.ts\0"],
    ["missing rename source", "R  destination.ts\0"],
    ["unsupported ignored record", "!! ignored.ts\0"],
    ["empty pathname", " M \0"],
    ["unchanged entry", "   unchanged.ts\0"],
  ])("rejects malformed %s", (_label: string, status: string) => {
    expect((): void => {
      parsePorcelainV1Status(status)
    }).toThrow(/Perun commit scope: invalid git status record/)
  })
})

describe("Perun exact-file authorization", () => {
  const repositoryRoot = "/work/repository"
  const changedFiles = new Set([
    "modified.ts",
    "untracked.ts",
    "deleted.ts",
    "renamed-from.ts",
    "renamed-to.ts",
  ])

  function authorize(
    files: unknown,
    options: { changed?: ReadonlySet<string>; directories?: readonly string[] } = {},
  ): string[] {
    const directories = new Set(options.directories ?? [])
    return authorizePerunExactFiles({
      files,
      repositoryRoot,
      changedFiles: options.changed ?? changedFiles,
      isDirectory: (path: string): boolean => directories.has(path),
    })
  }

  it("returns canonical argv paths for relative and in-repository absolute files", () => {
    expect(
      authorize(["./modified.ts", "/work/repository/untracked.ts"]),
    ).toEqual(["modified.ts", "untracked.ts"])
  })

  it("allows a status-proven deletion and both sides of a rename", () => {
    expect(authorize(["deleted.ts"])).toEqual(["deleted.ts"])
    expect(authorize(["renamed-from.ts", "renamed-to.ts"])).toEqual([
      "renamed-from.ts",
      "renamed-to.ts",
    ])
  })

  it.each([
    ["outside-root", ["/other/repository/modified.ts"], undefined],
    ["directory", ["directory"], ["/work/repository/directory"]],
    ["duplicate canonical names", ["modified.ts", "./modified.ts"], undefined],
    ["unchanged path", ["not-changed.ts"], undefined],
    ["unproven missing deletion", ["deleted.ts"], undefined, new Set<string>()],
  ])(
    "rejects %s without invoking Git",
    (
      _label: string,
      files: string[],
      directories?: readonly string[],
      changed?: ReadonlySet<string>,
    ) => {
      expect((): void => {
        authorize(files, { directories, changed })
      }).toThrow(/Perun commit scope:/)
    },
  )

  it("JSON-encodes unsafe path values in denials", () => {
    const unsafe = "outside\n\u001b[31m.ts"

    expect((): void => {
      authorize([unsafe])
    }).toThrow(JSON.stringify(unsafe))
  })

  it("requires both halves of a rename, and ignores renames outside the scope", () => {
    const changed = new Set(["renamed.ts", "orig.ts", "modified.ts"])
    const renamePairs = new Map([["renamed.ts", "orig.ts"]])
    const withPairs = (files: unknown): string[] =>
      authorizePerunExactFiles({
        files,
        repositoryRoot,
        changedFiles: changed,
        renamePairs,
        isDirectory: (): boolean => false,
      })

    expect(withPairs(["renamed.ts", "orig.ts"])).toEqual(["renamed.ts", "orig.ts"])
    // A rename that is not part of the requested scope at all stays none of its business.
    expect(withPairs(["modified.ts"])).toEqual(["modified.ts"])
    expect((): void => {
      withPairs(["renamed.ts"])
    }).toThrow(/rename must be authorized as a whole/i)
    expect((): void => {
      withPairs(["orig.ts"])
    }).toThrow(/rename must be authorized as a whole/i)
  })
})

describe("parsePorcelainV1StatusDetailed", () => {
  it("marks a staged deletion as absent from the index", () => {
    const parsed = parsePorcelainV1StatusDetailed("D  gone.txt\0")

    expect([...parsed.changedFiles]).toEqual(["gone.txt"])
    expect([...parsed.indexAbsentFiles]).toEqual(["gone.txt"])
  })

  it("keeps an unstaged deletion stageable — it still has an index entry", () => {
    const parsed = parsePorcelainV1StatusDetailed(" D unstaged.txt\0")

    expect([...parsed.changedFiles]).toEqual(["unstaged.txt"])
    expect([...parsed.indexAbsentFiles]).toEqual([])
  })

  it("pairs a staged rename and marks only its source as index-absent", () => {
    const parsed = parsePorcelainV1StatusDetailed("R  dir/new.txt\0dir/old.txt\0")

    expect([...parsed.changedFiles].sort()).toEqual([
      "dir/new.txt",
      "dir/old.txt",
    ])
    expect([...parsed.indexAbsentFiles]).toEqual(["dir/old.txt"])
    expect(parsed.renamePairs.get("dir/new.txt")).toBe("dir/old.txt")
  })

  it("never marks an unmerged record as index-absent", () => {
    for (const record of ["DD both.txt\0", "UD theirs.txt\0", "AU ours.txt\0"]) {
      const parsed = parsePorcelainV1StatusDetailed(record)

      expect(parsed.changedFiles.size).toBe(1)
      expect([...parsed.indexAbsentFiles]).toEqual([])
    }
  })

  it("treats an untracked file as a plain stageable change", () => {
    const parsed = parsePorcelainV1StatusDetailed("?? fresh.txt\0")

    expect([...parsed.changedFiles]).toEqual(["fresh.txt"])
    expect([...parsed.indexAbsentFiles]).toEqual([])
    expect(parsed.renamePairs.size).toBe(0)
  })

  it("keeps the flat wrapper in sync with the detailed parse", () => {
    const output = "R  dir/new.txt\0dir/old.txt\0 M note.txt\0"

    expect([...parsePorcelainV1Status(output)].sort()).toEqual(
      [...parsePorcelainV1StatusDetailed(output).changedFiles].sort(),
    )
  })
})
