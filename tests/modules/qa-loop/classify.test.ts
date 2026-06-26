import { describe, it, expect } from "vitest"
import { classifyScenario } from "../../../src/modules/qa-loop/classify.js"

describe("classifyScenario — kind taxonomy (§5)", () => {
  it("classifies a negative scenario (asserts rejection/blocked)", () => {
    const block =
      "BE-03: Reject unauthorized DELETE\nExpect the DELETE to be blocked (403), no state change."
    const r = classifyScenario(block)
    expect(r.kind).toBe("negative")
  })

  it("classifies a sanity/smoke scenario", () => {
    const block = "BE-02: Smoke — GET /health returns 200 (baseline sanity check)."
    const r = classifyScenario(block)
    expect(r.kind).toBe("sanity")
  })

  it("classifies a feature scenario by default", () => {
    const block = "FE-01: User can submit the new contact form and see a success toast."
    const r = classifyScenario(block)
    expect(r.kind).toBe("feature")
  })
})

describe("classifyScenario — mutation detection (§7)", () => {
  it("flags an HTTP POST as mutating", () => {
    const r = classifyScenario("BE-04: POST /api/orders creates an order, expect 201.")
    expect(r.mutating).toBe(true)
  })

  it("flags PUT/PATCH/DELETE as mutating", () => {
    expect(classifyScenario("BE: PUT /api/x").mutating).toBe(true)
    expect(classifyScenario("BE: PATCH /api/x").mutating).toBe(true)
    expect(classifyScenario("BE: DELETE /api/x").mutating).toBe(true)
  })

  it("flags a DB write step as mutating", () => {
    const r = classifyScenario("BE-05: INSERT INTO orders, then verify the row exists.")
    expect(r.mutating).toBe(true)
  })

  it("treats a read-only GET as non-mutating", () => {
    const r = classifyScenario("BE-06: GET /api/orders returns the list, expect 200.")
    expect(r.mutating).toBe(false)
  })
})

describe("classifyScenario — expected-outcome rule (§7, AC19/AC20)", () => {
  it("a mutating scenario expected to SUCCEED -> expectsSuccess true (strippable)", () => {
    const r = classifyScenario("BE-04: POST /api/orders creates an order, expect 201.")
    expect(r.mutating).toBe(true)
    expect(r.expectsSuccess).toBe(true)
  })

  it("a negative mutating scenario asserting BLOCKED -> expectsSuccess false (NOT stripped)", () => {
    const r = classifyScenario(
      "BE-03: Unauthorized POST /api/orders must be rejected (403), no row created.",
    )
    expect(r.mutating).toBe(true)
    expect(r.expectsSuccess).toBe(false)
  })

  it("a non-mutating scenario is expectsSuccess true regardless of kind", () => {
    const r = classifyScenario("BE-06: GET /api/orders returns 200.")
    expect(r.expectsSuccess).toBe(true)
  })
})
