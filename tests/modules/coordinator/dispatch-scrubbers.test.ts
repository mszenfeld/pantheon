import { describe, expect, it } from "vitest"

import { normalizeDispatchResults } from "../../../src/modules/coordinator/dispatch-scrubbers.js"

describe("normalizeDispatchResults", () => {
  it("removes internal variant suffixes from result names and errors", () => {
    const results = normalizeDispatchResults([
      {
        name: "zmora-be",
        status: "error",
        result: "",
        duration_ms: 0,
        error: "zmora-be failed",
      },
    ])

    expect(results[0]).toMatchObject({ name: "zmora", error: "zmora failed" })
  })
})
