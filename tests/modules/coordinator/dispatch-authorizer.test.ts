import { describe, expect, it } from "vitest"

import { authorizeDispatchCaller } from "../../../src/modules/coordinator/dispatch-authorizer.js"

describe("authorizeDispatchCaller", () => {
  it("allows Perun to dispatch registered specialist targets", () => {
    expect(() =>
      authorizeDispatchCaller("Perun - Coordinator", ["zmora-be", "triglav"]),
    ).not.toThrow()
  })

  it("allows Veles to dispatch only the read-only explorer", () => {
    expect(() => authorizeDispatchCaller("Veles - Planner", ["triglav"])).not.toThrow()
    expect(() => authorizeDispatchCaller("Veles - Planner", ["svarog"])).toThrow(
      "may dispatch only read-only targets",
    )
  })

  it("rejects an unauthorized or self-dispatching caller", () => {
    expect(() => authorizeDispatchCaller("zmora-be", ["triglav"])).toThrow(
      "restricted to Perun - Coordinator",
    )
    expect(() => authorizeDispatchCaller("Perun - Coordinator", ["Perun - Coordinator"])).toThrow(
      "cannot dispatch itself",
    )
  })
})
