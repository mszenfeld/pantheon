import { describe, expect, it } from "vitest"
import { makeStribogToolHook } from "../../../src/modules/stribog/tool-budget-hook.js"
import { STRIBOG_EDIT_BUDGET } from "../../../src/modules/stribog/stribog.metadata.js"

const STRIBOG = "stribog"
// Each call builds a fresh factory handle (fresh closure-scoped edit-path map),
// which is what gives per-test isolation now that state is no longer module-global.
const hook = (agent: string | undefined) =>
  makeStribogToolHook({ resolveAgent: async () => agent }).hook
const input = (tool: string, sessionID = "s1") => ({
  tool,
  sessionID,
  callID: "c",
})
const out = (filePath?: string) => ({
  args: filePath === undefined ? {} : { filePath },
})

describe("stribog tool-budget hook", () => {
  it("passes through for a non-stribog session (fail-open)", async () => {
    await expect(
      hook("Perun - Coordinator")(input("execute_recipe"), out()),
    ).resolves.toBeUndefined()
  })

  it("passes through for an unknown/undefined agent (fail-open)", async () => {
    await expect(
      hook(undefined)(input("execute_recipe"), out()),
    ).resolves.toBeUndefined()
  })

  it("denies a non-allow-listed tool for a stribog session", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("execute_recipe"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    await expect(h(input("task"), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    await expect(h(input("webfetch"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    // Degenerate inputs: empty and arbitrary-unknown ids are absent from the allow-list too.
    await expect(h(input(""), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    await expect(h(input("some_unknown_tool"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
  })

  it("allows read/glob/grep/bash for a stribog session", async () => {
    const h = hook(STRIBOG)
    for (const t of ["read", "glob", "grep", "bash"]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
  })

  it("skips attribution (no resolveAgent call) for allow-listed non-edit/write tools", async () => {
    // Cheap pre-filter, mirroring coordinator-policy's tool!=="bash" bail: read/glob/grep/bash
    // are allow-listed AND not edit/write, so the hook has nothing to enforce and must NOT pay
    // for the (full-transcript) attribution call.
    let calls = 0
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        calls++
        return STRIBOG
      },
    })
    for (const t of ["read", "glob", "grep", "bash"]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
    expect(calls).toBe(0)
  })

  it("still attributes deny-candidates and edit/write (pre-filter does not skip them)", async () => {
    // A tool outside the allow-list (must be resolvable to DENY for stribog) and edit/write
    // (must be resolvable to enforce the budget) still call resolveAgent.
    let calls = 0
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        calls++
        return STRIBOG
      },
    })
    await expect(h(input("execute_recipe"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    await expect(h(input("write"), out("/repo/a.ts"))).resolves.toBeUndefined()
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    expect(calls).toBe(3)
  })

  it("matches lowercase runtime ids only (capital Edit is NOT allow-listed)", async () => {
    await expect(
      hook(STRIBOG)(input("Edit"), out("/repo/a.ts")),
    ).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
  })

  it("allows up to the budget of distinct files, then denies the next", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("write"), out("/repo/a.ts"))).resolves.toBeUndefined()
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
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
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
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
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
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
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        throw new Error("boom")
      },
    })
    await expect(h(input("execute_recipe"), out())).resolves.toBeUndefined()
  })

  it("isolates budgets per session", async () => {
    const h = hook(STRIBOG)
    await h(input("write", "s1"), out("/repo/a.ts"))
    await h(input("edit", "s1"), out("/repo/b.ts"))
    await expect(
      h(input("write", "s2"), out("/repo/c.ts")),
    ).resolves.toBeUndefined()
  })

  it("clearSession resets a session's budget", async () => {
    const { hook: h, clearSession } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
    })
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    clearSession("s1")
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
