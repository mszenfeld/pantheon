import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CreatePrInput } from "../../../src/modules/commit/create-pr.js"

const createPrMock = vi.fn(async (input: CreatePrInput) => ({
  head: "feature/x",
  base: "master",
  pushed: true,
  prCreated: true,
  draft: input.draft ?? false,
  url: "https://github.com/AppVerk/x/pull/1",
}))

vi.mock("../../../src/modules/commit/create-pr.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/modules/commit/create-pr.js")
  >()),
  createPr: (input: CreatePrInput) => createPrMock(input),
}))

const { AppVerkCommitPlugin } =
  await import("../../../src/modules/commit/index.js")

describe("create_pr wrapper registration (AC-16)", () => {
  beforeEach(() => {
    createPrMock.mockClear()
  })

  it("exposes exactly title/body/base/draft/taskId — no cwd/runGit/runGh/provider leakage", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.create_pr as
      | { args: Record<string, unknown> }
      | undefined
    expect(tool).toBeDefined()
    expect(Object.keys(tool?.args ?? {}).sort()).toEqual([
      "base",
      "body",
      "draft",
      "taskId",
      "title",
    ])
  })

  it("resolves cwd as worktree ?? directory and returns pretty JSON", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.create_pr as {
      execute: (args: object, context: object) => Promise<string>
    }

    const withWorktree = await tool.execute(
      { title: "t" },
      { worktree: "/wt", directory: "/dir" },
    )
    expect(createPrMock.mock.calls[0]?.[0]?.cwd).toBe("/wt")
    expect(JSON.parse(withWorktree)).toMatchObject({ prCreated: true })
    expect(withWorktree).toBe(
      JSON.stringify(await createPrMock.mock.results[0]?.value, null, 2),
    )

    await tool.execute({ title: "t" }, { directory: "/dir" })
    expect(createPrMock.mock.calls[1]?.[0]?.cwd).toBe("/dir")
  })

  it("defaults draft to false when omitted", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.create_pr as {
      execute: (args: object, context: object) => Promise<string>
    }
    await tool.execute({ title: "t" }, { directory: "/dir" })
    expect(createPrMock.mock.calls[0]?.[0]?.draft).toBe(false)
  })
})
