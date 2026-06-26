import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { hashPlan } from "../../../src/modules/qa-loop/plan-hash.js"

describe("hashPlan", () => {
  it("returns the sha256 hex of the plan text", () => {
    const text = "# Test plan\nFE-01: do a thing\n"
    const expected = createHash("sha256").update(text, "utf8").digest("hex")
    expect(hashPlan(text)).toBe(expected)
  })
  it("is deterministic — same input, same hash", () => {
    const text = "BE-02: assert 200\n"
    expect(hashPlan(text)).toBe(hashPlan(text))
  })
  it("is sensitive — a one-byte change flips the hash (tamper guard)", () => {
    expect(hashPlan("FE-01: a")).not.toBe(hashPlan("FE-01: b"))
  })
  it("produces a 64-char lowercase hex string", () => {
    expect(hashPlan("anything")).toMatch(/^[0-9a-f]{64}$/)
  })
})
