import { describe, it, expect } from "vitest"
import { SessionAgentRegistry } from "../../../src/modules/_shared/session-agent-registry.js"
import { makeCallerGate } from "../../../src/modules/qa/caller-gate.js"

const SETUP_KEY = "zmora-setup"

function gateWith(entries: Array<[string, string]>) {
  const registry = new SessionAgentRegistry()
  for (const [id, agent] of entries) registry.register(id, agent)
  return makeCallerGate({ registry, setupAgentKey: SETUP_KEY })
}

describe("makeCallerGate — isSetupCaller (execute_recipe minter gate)", () => {
  it("allows a session registered as zmora-setup", () => {
    const gate = gateWith([["setup-child", SETUP_KEY]])
    expect(gate.isSetupCaller("setup-child")).toBe(true)
  })
  it("denies zmora-fe and zmora-be", () => {
    const gate = gateWith([
      ["fe-child", "zmora-fe"],
      ["be-child", "zmora-be"],
    ])
    expect(gate.isSetupCaller("fe-child")).toBe(false)
    expect(gate.isSetupCaller("be-child")).toBe(false)
  })
  it("denies a registry miss (fail-closed — only positive zmora-setup passes)", () => {
    const gate = gateWith([])
    expect(gate.isSetupCaller("unknown-session")).toBe(false)
  })
})

describe("makeCallerGate — isCoordinatorCaller (Perun-only tools, registry-negative)", () => {
  it("allows a registry miss (Perun is never a dispatched child — incl. turn-1)", () => {
    const gate = gateWith([])
    expect(gate.isCoordinatorCaller("perun-session")).toBe(true)
  })
  it("denies any registered specialist", () => {
    const gate = gateWith([
      ["fe-child", "zmora-fe"],
      ["be-child", "zmora-be"],
      ["setup-child", SETUP_KEY],
      ["x-child", "some-other-specialist"],
    ])
    expect(gate.isCoordinatorCaller("fe-child")).toBe(false)
    expect(gate.isCoordinatorCaller("be-child")).toBe(false)
    expect(gate.isCoordinatorCaller("setup-child")).toBe(false)
    expect(gate.isCoordinatorCaller("x-child")).toBe(false)
  })
})
