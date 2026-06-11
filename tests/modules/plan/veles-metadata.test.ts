import { describe, expect, it } from "vitest"
import {
  VELES_AGENT_KEY,
  velesSpecialistInfo,
} from "../../../src/modules/plan/veles.metadata.js"

describe("velesSpecialistInfo", () => {
  it("is keyed 'Veles - Planner' (display/dispatch name) and is mode all", () => {
    expect(VELES_AGENT_KEY).toBe("Veles - Planner")
    expect(velesSpecialistInfo.name).toBe("Veles - Planner")
    expect(velesSpecialistInfo.mode).toBe("all")
  })
  it("carries a planning trigger and keyTrigger that render into Perun's prompt", () => {
    expect(velesSpecialistInfo.metadata.triggers.length).toBeGreaterThan(0)
    expect(velesSpecialistInfo.metadata.keyTrigger).toBeDefined()
  })

  it("leaves the unrendered category/cost fields unset (no dead routing metadata)", () => {
    // category/cost have no renderer in buildPerunPrompt; they are intentionally
    // omitted so they cannot advertise a routing signal Perun never sees.
    expect(velesSpecialistInfo.metadata.category).toBeUndefined()
    expect(velesSpecialistInfo.metadata.cost).toBeUndefined()
  })
})
