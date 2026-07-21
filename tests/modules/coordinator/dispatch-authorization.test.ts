import { describe, expect, it } from "vitest"

import { authorizeDispatchCaller } from "../../../src/modules/coordinator/dispatch.js"

describe("authorizeDispatchCaller", () => {
  it("allows only Perun to dispatch arbitrary registered subagents", () => {
    expect(() => authorizeDispatchCaller("Perun - Coordinator", ["zmora-be"])).not.toThrow()
    expect(() => authorizeDispatchCaller("zmora-be", ["triglav"])).toThrow(
      "restricted to Perun - Coordinator",
    )
  })

  it("allows Veles to dispatch only the approved read-only explorer", () => {
    expect(() => authorizeDispatchCaller("Veles - Planner", ["triglav"])).not.toThrow()
    expect(() => authorizeDispatchCaller("Veles - Planner", ["svarog"])).toThrow(
      "may dispatch only read-only targets",
    )
    expect(() => authorizeDispatchCaller("Veles - Planner", ["Veles - Planner"])).toThrow(
      "may dispatch only read-only targets",
    )
  })
})
