import { describe, expect, it } from "vitest"
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  stribogSpecialistInfo,
} from "../../../src/modules/stribog/stribog.metadata.js"

describe("stribogSpecialistInfo", () => {
  it("uses the bare 'stribog' key and subagent mode", () => {
    expect(STRIBOG_AGENT_KEY).toBe("stribog")
    expect(stribogSpecialistInfo.name).toBe("stribog")
    expect(stribogSpecialistInfo.mode).toBe("subagent")
  })

  it("is a CHEAP specialist", () => {
    expect(stribogSpecialistInfo.metadata.category).toBe("specialist")
    expect(stribogSpecialistInfo.metadata.cost).toBe("CHEAP")
  })

  it("routes AWAY from secrets and feature work (avoid-when)", () => {
    const avoid = stribogSpecialistInfo.metadata.avoidWhen?.join(" ").toLowerCase() ?? ""
    expect(avoid).toContain("secret")
    expect(avoid).toMatch(/feature|main executor/)
  })

  it("defaults to a valid <provider>/<model> identifier", () => {
    expect(DEFAULT_STRIBOG_MODEL).toMatch(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/)
  })
})
