import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import {
  NATIVE_BUILTINS,
  getDefaultAgent,
  setDefaultAgent,
  applyRosterPolicy,
} from "../../../src/modules/agent-roster/index.js"

type Entry = { mode?: string; hidden?: boolean; model?: string; description?: string }

function cfg(
  agent: Record<string, Entry>,
  extra: Record<string, unknown> = {},
): Config {
  return { agent, ...extra } as unknown as Config
}

function entry(config: Config, key: string): Entry {
  const map = config.agent as Record<string, Entry>
  expect(map[key], `expected agent "${key}" to exist`).toBeDefined()
  return map[key] as Entry
}

describe("agent-roster: applyRosterPolicy", () => {
  it("hides a pre-existing key, sets hidden:true, preserves other fields", () => {
    const config = cfg({ "user-agent": { mode: "primary", model: "x/y", description: "d" } })
    applyRosterPolicy(config, new Set(["user-agent"]))
    const e = entry(config, "user-agent")
    expect(e.hidden).toBe(true)
    expect(e.mode).toBe("primary")
    expect(e.model).toBe("x/y")
    expect(e.description).toBe("d")
  })

  it("does not touch a non-pre-existing (registered) agent", () => {
    const config = cfg({ "Perun - Coordinator": { mode: "primary" } })
    applyRosterPolicy(config, new Set())
    expect(entry(config, "Perun - Coordinator").hidden).toBeUndefined()
    expect(entry(config, "Perun - Coordinator").mode).toBe("primary")
  })

  it("backstop hides native build/plan even when absent from the map", () => {
    const config = cfg({})
    applyRosterPolicy(config, new Set())
    expect(entry(config, "build").hidden).toBe(true)
    expect(entry(config, "plan").hidden).toBe(true)
  })

  it("backstop preserves existing fields on a user-authored native", () => {
    const config = cfg({ build: { model: "x/y" } })
    applyRosterPolicy(config, new Set(["build"]))
    expect(entry(config, "build").hidden).toBe(true)
    expect(entry(config, "build").model).toBe("x/y")
  })

  it("hides a pre-existing mode:'all' user agent (keeps its mode)", () => {
    const config = cfg({ "user-all": { mode: "all" } })
    applyRosterPolicy(config, new Set(["user-all"]))
    expect(entry(config, "user-all").hidden).toBe(true)
    expect(entry(config, "user-all").mode).toBe("all")
  })

  it("skips a pre-existing key that is already hidden", () => {
    const config = cfg({ u: { mode: "subagent", hidden: true } })
    applyRosterPolicy(config, new Set(["u"]))
    expect(entry(config, "u").hidden).toBe(true)
    expect(entry(config, "u").mode).toBe("subagent")
  })

  it("repoints default_agent to Perun when unset", () => {
    const config = cfg({ "Perun - Coordinator": { mode: "primary" } })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
  })

  it("leaves a valid (visible primary) default_agent unchanged", () => {
    const config = cfg(
      { "Perun - Coordinator": { mode: "primary" }, "frontend-developer": { mode: "primary" } },
      { default_agent: "frontend-developer" },
    )
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("frontend-developer")
  })

  it("repoints away from a now-hidden default_agent, preferring Perun", () => {
    const config = cfg(
      { "Perun - Coordinator": { mode: "primary" }, old: { mode: "primary" } },
      { default_agent: "old" },
    )
    applyRosterPolicy(config, new Set(["old"]))
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
  })

  it("repoints a default_agent pointing to a non-existent key", () => {
    const config = cfg({ "Perun - Coordinator": { mode: "primary" } }, { default_agent: "ghost" })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
  })

  it("falls back to the sorted-first visible primary when Perun is absent", () => {
    const config = cfg({ zeta: { mode: "primary" }, alpha: { mode: "primary" } })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("alpha")
  })

  it("falls back to a visible mode:'all' agent when no primary exists (no Perun)", () => {
    // Mirrors the picker filter (mode!=="subagent" && !hidden): a mode:"all"
    // agent like Veles is a visible session target the fallback MUST accept.
    const config = cfg({ "Veles - Planner": { mode: "all" } })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("Veles - Planner")
  })

  it("repoints away from a hidden default_agent to a visible mode:'all' agent", () => {
    const config = cfg(
      { "Veles - Planner": { mode: "all" }, old: { mode: "primary" } },
      { default_agent: "old" },
    )
    applyRosterPolicy(config, new Set(["old"]))
    expect(getDefaultAgent(config)).toBe("Veles - Planner")
  })

  it("never picks a subagent agent as the default", () => {
    const config = cfg({ helper: { mode: "subagent" } })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBeUndefined()
  })

  it("never picks a mode:undefined agent as the default", () => {
    const config = cfg({ "no-mode": {} })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBeUndefined()
  })

  it("does not throw when config.agent is undefined and still applies the backstop", () => {
    const config = {} as Config
    applyRosterPolicy(config, new Set())
    expect(entry(config, "build").hidden).toBe(true)
  })

  it("is idempotent: a second call with the same preExisting changes nothing", () => {
    const config = cfg({ u: { mode: "primary", model: "m" } })
    applyRosterPolicy(config, new Set(["u"]))
    const snapshot = JSON.stringify(config)
    applyRosterPolicy(config, new Set(["u"]))
    expect(JSON.stringify(config)).toBe(snapshot)
  })
})

describe("agent-roster: constants & default_agent accessors", () => {
  it("lists the visible-primary native built-ins", () => {
    expect([...NATIVE_BUILTINS]).toEqual(["build", "plan"])
  })

  it("reads an unset default_agent as undefined", () => {
    const config = {} as Config
    expect(getDefaultAgent(config)).toBeUndefined()
  })

  it("round-trips default_agent through the typed accessors", () => {
    const config = {} as Config
    setDefaultAgent(config, "Perun - Coordinator")
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
    expect((config as { default_agent?: string }).default_agent).toBe(
      "Perun - Coordinator",
    )
  })
})
