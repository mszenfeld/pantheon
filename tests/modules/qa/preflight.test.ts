import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { QaRunState } from "../../../src/modules/qa/qa-run-state.js"
import { makePreflightHandler } from "../../../src/modules/qa/preflight.js"

function makeDeps(processEnv: Record<string, string | undefined> = {}) {
  const store = new BindingsStore()
  const state = new QaRunState()
  // Perun is a root session: resolveParentID returns undefined → handler falls
  // back to ctx.sessionID, exactly as the real wiring does.
  const handler = makePreflightHandler({
    store,
    state,
    resolveParentID: async () => undefined,
    processEnv,
  })
  return { store, state, handler }
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

  it("registers the requested env names as plan-declared for the run (record_input exemption source)", async () => {
    const { state, handler } = makeDeps({})
    // Names are persisted regardless of whether they resolve right now — the
    // point is to authorise the user's subsequent paste of these prerequisites.
    await handler(
      { env: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL"] },
      ctx,
    )
    const declared = state.getDeclaredEnv("perun1")
    expect(declared.has("SUPABASE_URL")).toBe(true)
    expect(declared.has("SUPABASE_ANON_KEY")).toBe(true)
    expect(declared.has("DATABASE_URL")).toBe(true)
    // A name never passed to preflight is NOT exempt.
    expect(declared.has("AWS_SECRET_ACCESS_KEY")).toBe(false)
  })

  it("accumulates declared names across multiple preflight calls (re-run on resume)", async () => {
    const { state, handler } = makeDeps({})
    await handler({ env: ["SUPABASE_URL"] }, ctx)
    await handler({ env: ["DATABASE_URL"] }, ctx)
    const declared = state.getDeclaredEnv("perun1")
    expect(declared.has("SUPABASE_URL")).toBe(true)
    expect(declared.has("DATABASE_URL")).toBe(true)
  })
})
