import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import {
  NATIVE_BUILTINS,
  getDefaultAgent,
  setDefaultAgent,
} from "../../../src/modules/agent-roster/index.js"

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
