import { describe, it, expect, beforeEach } from "vitest"
import { QaRunState } from "../../../src/modules/qa/qa-run-state.js"
import type { ParsedBinding } from "../../../src/modules/qa/binding-parser.js"

const fakeBinding: ParsedBinding = {
  name: "QA_BIND_TOKEN",
  type: "secret",
  description: "test",
  inputs: ["X"],
  egress: "$X",
  recipe: 'curl "$X"',
}

describe("QaRunState", () => {
  let state: QaRunState
  beforeEach(() => {
    state = new QaRunState()
  })

  it("returns undefined when parent not initialized", () => {
    expect(state.getBindings("p1")).toBeUndefined()
    expect(state.getDialogRound("p1")).toBe(0)
    expect(state.getRecipeAttempts("p1", "QA_BIND_TOKEN")).toBe(0)
  })

  it("storePlan + getBindings round-trip", () => {
    state.storePlan("p1", [fakeBinding])
    const result = state.getBindings("p1")
    expect(result).toHaveLength(1)
    expect(result?.[0]?.name).toBe("QA_BIND_TOKEN")
  })

  it("increment + read dialog round", () => {
    expect(state.incrementDialogRound("p1")).toBe(1)
    expect(state.incrementDialogRound("p1")).toBe(2)
    expect(state.getDialogRound("p1")).toBe(2)
  })

  it("increment + read per-binding recipe attempts", () => {
    expect(state.incrementRecipeAttempt("p1", "QA_BIND_TOKEN")).toBe(1)
    expect(state.incrementRecipeAttempt("p1", "QA_BIND_TOKEN")).toBe(2)
    expect(state.getRecipeAttempts("p1", "QA_BIND_TOKEN")).toBe(2)
    expect(state.getRecipeAttempts("p1", "OTHER")).toBe(0)
  })

  it("clearRun removes all state for a parent", () => {
    state.storePlan("p1", [fakeBinding])
    state.incrementDialogRound("p1")
    state.incrementRecipeAttempt("p1", "QA_BIND_TOKEN")
    state.addDeclaredEnv("p1", ["SUPABASE_URL"])
    state.clearRun("p1")
    expect(state.getBindings("p1")).toBeUndefined()
    expect(state.getDialogRound("p1")).toBe(0)
    expect(state.getRecipeAttempts("p1", "QA_BIND_TOKEN")).toBe(0)
    expect(state.getDeclaredEnv("p1").has("SUPABASE_URL")).toBe(false)
  })

  describe("declared-env (preflight-sourced denylist exemption)", () => {
    it("returns an empty set for an uninitialised parent", () => {
      expect(state.getDeclaredEnv("never-touched").size).toBe(0)
    })

    it("addDeclaredEnv + getDeclaredEnv round-trip, merging across calls", () => {
      state.addDeclaredEnv("p1", ["SUPABASE_URL", "SUPABASE_ANON_KEY"])
      state.addDeclaredEnv("p1", ["DATABASE_URL", "SUPABASE_URL"]) // dup ignored
      const declared = state.getDeclaredEnv("p1")
      expect([...declared].sort()).toEqual([
        "DATABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_URL",
      ])
    })

    it("materialises a record when called before storePlan, without clobbering a later plan", () => {
      state.addDeclaredEnv("p1", ["SUPABASE_URL"])
      // getBindings on the freshly-materialised record is the empty-plan default.
      expect(state.getBindings("p1")).toEqual([])
      state.storePlan("p1", [fakeBinding])
      // storePlan must not wipe the already-declared env names.
      expect(state.getBindings("p1")).toHaveLength(1)
      expect(state.getDeclaredEnv("p1").has("SUPABASE_URL")).toBe(true)
    })

    it("scopes declared names per parent", () => {
      state.addDeclaredEnv("p1", ["SUPABASE_URL"])
      expect(state.getDeclaredEnv("p2").has("SUPABASE_URL")).toBe(false)
    })
  })

  describe("dialog round on-first-input semantics", () => {
    it("increments only once per round, regardless of how many pairs land", () => {
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
      expect(state.getDialogRound("p1")).toBe(1)
    })

    it("re-arms after endDialogRound", () => {
      state.incrementDialogRoundOnFirstInput("p1") // round 1
      state.endDialogRound("p1")
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(2)
      state.endDialogRound("p1")
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(3)
    })

    it("creates a fresh record when called before storePlan", () => {
      expect(state.incrementDialogRoundOnFirstInput("never-planned")).toBe(1)
      // No plan was stored, so `getBindings` returns an empty bindings
      // array (the freshly-materialised record's default). It must not be
      // an opaque sentinel — Perun-style callers iterate it directly.
      expect(state.getBindings("never-planned")).toEqual([])
    })

    it("endDialogRound is a no-op when nothing in progress", () => {
      // Should not throw and should not create a record.
      state.endDialogRound("p1")
      expect(state.getDialogRound("p1")).toBe(0)
    })

    it("clearRun resets the dialog round counter and in-progress flag", () => {
      state.incrementDialogRoundOnFirstInput("p1")
      state.clearRun("p1")
      expect(state.getDialogRound("p1")).toBe(0)
      // Next call starts at round 1 again.
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
    })
  })
})
