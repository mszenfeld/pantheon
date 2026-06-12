import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { makePreflightHandler } from "../../../src/modules/qa/preflight.js"

function makeDeps(processEnv: Record<string, string | undefined> = {}) {
  const store = new BindingsStore()
  // Perun is a root session: resolveParentID returns undefined → handler falls
  // back to ctx.sessionID, exactly as the real wiring does.
  const handler = makePreflightHandler({
    store,
    resolveParentID: async () => undefined,
    processEnv,
  })
  return { store, handler }
}

const ctx = { sessionID: "perun1" } as const

describe("preflight handler", () => {
  it("returns ok when every env name is set in the process env", async () => {
    const { handler } = makeDeps({
      TEST_USER_EMAIL: "a@b.c",
      BASE_URL: "http://localhost:8000",
    })
    const result = await handler({ env: ["TEST_USER_EMAIL", "BASE_URL"] }, ctx)
    expect(result).toEqual({ status: "ok" })
  })

  it("treats a name bound in the store (user-paste) as present, even when absent from process env", async () => {
    const { store, handler } = makeDeps({})
    store.writeBinding(
      "perun1",
      "TEST_USER_EMAIL",
      "a@b.c",
      "secret",
      "user-paste",
      { declaredInput: true },
    )
    const result = await handler({ env: ["TEST_USER_EMAIL"] }, ctx)
    expect(result).toEqual({ status: "ok" })
  })

  it("reports names absent from BOTH the store and the process env as missing", async () => {
    const { handler } = makeDeps({ TEST_USER_EMAIL: "a@b.c" })
    const result = await handler(
      { env: ["TEST_USER_EMAIL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] },
      ctx,
    )
    expect(result).toEqual({
      status: "missing",
      missing: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    })
  })

  it("treats an empty-string env value as missing (not merely undefined)", async () => {
    const { handler } = makeDeps({ EMPTY: "" })
    const result = await handler({ env: ["EMPTY"] }, ctx)
    expect(result).toEqual({ status: "missing", missing: ["EMPTY"] })
  })

  it("dedupes repeated names so a duplicate is reported at most once", async () => {
    const { handler } = makeDeps({})
    const result = await handler({ env: ["X", "X", "X"] }, ctx)
    expect(result).toEqual({ status: "missing", missing: ["X"] })
  })

  it("returns ok for an empty env list (nothing to verify)", async () => {
    const { handler } = makeDeps({})
    const result = await handler({ env: [] }, ctx)
    expect(result).toEqual({ status: "ok" })
  })
})
