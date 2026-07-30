import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ControlledCommitInput } from "../../../src/modules/commit/controlled-commit.js"

const createControlledCommitMock = vi.fn(
  async (input: ControlledCommitInput) => ({
    commitMessage: input.message,
    status: "",
  }),
)

vi.mock(
  "../../../src/modules/commit/controlled-commit.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../src/modules/commit/controlled-commit.js")
    >()),
    createControlledCommit: (input: ControlledCommitInput) =>
      createControlledCommitMock(input),
  }),
)

const { AppVerkCommitPlugin } =
  await import("../../../src/modules/commit/index.js")

describe("av_commit wrapper caller policy", () => {
  beforeEach(() => {
    createControlledCommitMock.mockClear()
  })

  it("keeps caller policy private while describing Perun's exact-file requirement", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.av_commit as
      | { args: Record<string, unknown> }
      | undefined

    expect(Object.keys(tool?.args ?? {}).sort()).toEqual([
      "authorization",
      "files",
      "message",
      "taskId",
    ])
    expect((tool?.args.files as { description?: string } | undefined)?.description).toContain(
      "Perun must provide the exact changed files to commit",
    )
  })

  it("selects the internal exact policy only for Perun", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.av_commit as {
      execute: (args: object, context: object) => Promise<string>
    }

    await tool.execute(
      { message: "feat: scope commit", files: ["src/file.ts"] },
      { agent: "Perun - Coordinator", directory: "/dir" },
    )

    expect(createControlledCommitMock).toHaveBeenCalledWith({
      cwd: "/dir",
      message: "feat: scope commit",
      files: ["src/file.ts"],
      taskId: undefined,
      scopePolicy: "perun-exact",
    })
  })

  it("uses generic policy for a known non-Perun caller", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.av_commit as {
      execute: (args: object, context: object) => Promise<string>
    }

    await tool.execute(
      { message: "feat: operator commit", files: ["src/file.ts"] },
      { agent: "svarog", directory: "/dir" },
    )

    expect(createControlledCommitMock).toHaveBeenCalledWith({
      cwd: "/dir",
      message: "feat: operator commit",
      files: ["src/file.ts"],
      taskId: undefined,
      scopePolicy: "generic",
    })
  })

  it("rejects an unresolved caller before invoking the commit implementation", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.av_commit as {
      execute: (args: object, context: object) => Promise<string>
    }

    await expect(
      tool.execute(
        { message: "feat: blocked commit", files: ["src/file.ts"] },
        { directory: "/dir" },
      ),
    ).rejects.toThrow("av_commit: caller identity is unavailable; refusing before mutation.")
    expect(createControlledCommitMock).not.toHaveBeenCalled()
  })
})
