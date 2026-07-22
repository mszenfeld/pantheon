import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CreateBranchInput } from "../../../src/modules/commit/create-branch.js"

const createBranchMock = vi.fn(async (input: CreateBranchInput) => ({
  name: "feature/x",
  created: true as const,
  checkedOut: input.checkout ?? true,
}))

vi.mock("../../../src/modules/commit/create-branch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/modules/commit/create-branch.js")>()),
  createBranch: (input: CreateBranchInput) => createBranchMock(input),
}))

const { AppVerkCommitPlugin } = await import("../../../src/modules/commit/index.js")

type SchemaLike = { safeParse: (value: unknown) => { success: boolean } }

describe("create_branch wrapper registration (AC-13)", () => {
  beforeEach(() => {
    createBranchMock.mockClear()
  })

  it("exposes exactly type/id/description/checkout — no cwd/runGit leakage", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const toolDef = plugin.tool?.create_branch as
      | { args: Record<string, unknown> }
      | undefined
    expect(toolDef).toBeDefined()
    expect(Object.keys(toolDef?.args ?? {}).sort()).toEqual([
      "checkout",
      "description",
      "id",
      "type",
    ])
  })

  it("type is a plain string schema, not a schema-level enum (FR-1/NFR-4)", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const toolDef = plugin.tool?.create_branch as unknown as { args: Record<string, SchemaLike> }
    // An out-of-enum value must PASS the schema so it reaches the S1
    // TypeScript error (the normative template) instead of a schema reject.
    const typeSchema = toolDef.args.type
    expect(typeSchema).toBeDefined()
    expect(typeSchema?.safeParse("feat").success).toBe(true)
  })

  it("resolves cwd as worktree ?? directory, defaults checkout to true, returns pretty JSON", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const toolDef = plugin.tool?.create_branch as {
      execute: (args: object, context: object) => Promise<string>
    }

    const withWorktree = await toolDef.execute(
      { type: "feature", description: "x" },
      { worktree: "/wt", directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[0]?.[0]?.cwd).toBe("/wt")
    expect(createBranchMock.mock.calls[0]?.[0]?.checkout).toBe(true)
    expect(JSON.parse(withWorktree)).toMatchObject({ created: true })
    expect(withWorktree).toBe(
      JSON.stringify(await createBranchMock.mock.results[0]?.value, null, 2),
    )

    await toolDef.execute(
      { type: "feature", description: "x" },
      { directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[1]?.[0]?.cwd).toBe("/dir")

    await toolDef.execute(
      { type: "feature", description: "x", checkout: false },
      { directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[2]?.[0]?.checkout).toBe(false)

    // AC-13: explicitly-undefined checkout defaults to true at the wrapper seam,
    // same as omitted (a `"checkout" in args` rewrite would break this case).
    await toolDef.execute(
      { type: "feature", description: "x", checkout: undefined },
      { directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[3]?.[0]?.checkout).toBe(true)
  })
})
