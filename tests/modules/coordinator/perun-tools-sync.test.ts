import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  PERUN_CROSS_MODULE_TOOLS,
  PERUN_TOOLS,
} from "../../../src/modules/coordinator/index.js"
import { QA_LOOP_TOOL_NAMES } from "../../../src/modules/qa-loop/index.js"
import { AppVerkCommitPlugin } from "../../../src/modules/commit/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")

function parseAllowedToolsFrontmatter(markdown: string): Set<string> {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const frontmatterContent = frontmatter?.[1] ?? ""
  const allowedTools = frontmatterContent.match(/^allowed-tools:\s*(.*)$/m)?.[1]
  if (allowedTools === undefined) {
    throw new Error("perun.md frontmatter must declare allowed-tools.")
  }

  const tokens = allowedTools.split(",").map((tool: string): string => tool.trim())
  if (tokens.some((tool: string): boolean => tool === "")) {
    throw new Error("perun.md allowed-tools must not contain empty entries.")
  }
  return new Set(tokens)
}

describe("Perun tool sync", () => {
  it("lists every coordinator-owned and cross-module tool in perun.md allowed-tools", () => {
    const allowedTools = parseAllowedToolsFrontmatter(readFileSync(PERUN_MD, "utf8"))
    for (const tool of [...PERUN_TOOLS, ...PERUN_CROSS_MODULE_TOOLS]) {
      expect(allowedTools.has(tool)).toBe(true)
    }
  })

  it("binds every cross-module grant to a tool the commit plugin really registers", async () => {
    // A hand-copied literal is only defense in depth if it is pinned to the other module's actual
    // tool ids — otherwise a rename there silently turns Perun's grant into a dead string.
    const commitPlugin = await AppVerkCommitPlugin({} as never)
    const registered = new Set(Object.keys(commitPlugin.tool ?? {}))

    for (const tool of PERUN_CROSS_MODULE_TOOLS) {
      expect(registered.has(tool)).toBe(true)
    }
    // The publication tools exist in the same module and are deliberately NOT granted to Perun.
    expect(registered.has("create_pr")).toBe(true)
    expect(registered.has("create_branch")).toBe(true)
    expect([...PERUN_CROSS_MODULE_TOOLS]).not.toContain("create_pr")
    expect([...PERUN_CROSS_MODULE_TOOLS]).not.toContain("create_branch")
  })

  it("declares all Perun commit-consent tools as cross-module grants", () => {
    expect(PERUN_CROSS_MODULE_TOOLS).toEqual([
      "av_commit",
      "prepare_perun_commit_scope",
      "authorize_perun_commit_scope",
    ])
    expect(PERUN_TOOLS).not.toContain("av_commit")
  })

  it("does not accept a containing allowed-tools token as a grant", () => {
    const allowedTools = parseAllowedToolsFrontmatter(
      "---\nallowed-tools: prefix_av_commit_suffix\n---\n",
    )

    expect(allowedTools.has("av_commit")).toBe(false)
  })

  it("includes the three background tools", () => {
    expect(PERUN_TOOLS).toEqual(
      expect.arrayContaining([
        "dispatch_background",
        "poll_background",
        "wait_background",
      ]),
    )
  })

  it("includes all six qa-loop tool names", () => {
    expect(PERUN_TOOLS).toEqual(
      expect.arrayContaining([...QA_LOOP_TOOL_NAMES]),
    )
  })
})
