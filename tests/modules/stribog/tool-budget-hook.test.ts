import { beforeEach, describe, expect, it } from "vitest"
import {
  makeStribogToolHook,
  clearStribogSession,
  __resetStribogStateForTests,
} from "../../../src/modules/stribog/tool-budget-hook.js"
import { STRIBOG_EDIT_BUDGET } from "../../../src/modules/stribog/stribog.metadata.js"

const STRIBOG = "stribog"
const hook = (agent: string | undefined) => makeStribogToolHook({ resolveAgent: async () => agent })
const input = (tool: string, sessionID = "s1") => ({ tool, sessionID, callID: "c" })
const out = (filePath?: string) => ({ args: filePath === undefined ? {} : { filePath } })

describe("stribog tool-budget hook", () => {
  beforeEach(() => __resetStribogStateForTests())

  it("passes through for a non-stribog session (fail-open)", async () => {
    await expect(hook("Perun - Coordinator")(input("execute_recipe"), out())).resolves.toBeUndefined()
  })

  it("passes through for an unknown/undefined agent (fail-open)", async () => {
    await expect(hook(undefined)(input("execute_recipe"), out())).resolves.toBeUndefined()
  })

  it("denies a non-allow-listed tool for a stribog session", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("execute_recipe"), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    await expect(h(input("task"), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    await expect(h(input("webfetch"), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
  })

  it("allows read/glob/grep/bash for a stribog session", async () => {
    const h = hook(STRIBOG)
    for (const t of ["read", "glob", "grep", "bash"]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
  })

  it("matches lowercase runtime ids only (capital Edit is NOT allow-listed)", async () => {
    await expect(hook(STRIBOG)(input("Edit"), out("/repo/a.ts"))).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
  })

  it("allows up to the budget of distinct files, then denies the next", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("write"), out("/repo/a.ts"))).resolves.toBeUndefined()
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(/STRIBOG_SCOPE_VIOLATION/)
    expect(STRIBOG_EDIT_BUDGET).toBe(2)
  })

  it("keeps allowing edits to already-touched files after the budget is reached", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(h(input("edit"), out("/repo/a.ts"))).resolves.toBeUndefined()
  })

  it("counts the same file via edit and write as one path", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/a.ts"))
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(/STRIBOG_SCOPE_VIOLATION/)
  })

  it("normalizes lexical spellings of the same absolute path (counts once)", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/./a.ts"))
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
  })

  it("does not count the refused path", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(/STRIBOG_SCOPE_VIOLATION/)
    await expect(h(input("edit"), out("/repo/a.ts"))).resolves.toBeUndefined()
  })

  it("fails open on missing/relative filePath (no throw, not counted)", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("write"), out())).resolves.toBeUndefined()
    await expect(h(input("edit"), out("relative.ts"))).resolves.toBeUndefined()
    await h(input("write"), out("/repo/a.ts"))
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
  })

  it("fails open when attribution throws", async () => {
    const h = makeStribogToolHook({ resolveAgent: async () => { throw new Error("boom") } })
    await expect(h(input("execute_recipe"), out())).resolves.toBeUndefined()
  })

  it("isolates budgets per session", async () => {
    const h = hook(STRIBOG)
    await h(input("write", "s1"), out("/repo/a.ts"))
    await h(input("edit", "s1"), out("/repo/b.ts"))
    await expect(h(input("write", "s2"), out("/repo/c.ts"))).resolves.toBeUndefined()
  })

  it("clearStribogSession resets a session's budget", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    clearStribogSession("s1")
    await expect(h(input("write"), out("/repo/c.ts"))).resolves.toBeUndefined()
  })

  it("the scope-violation message includes the budget number", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      new RegExp(`${STRIBOG_EDIT_BUDGET} distinct files`),
    )
  })
})
