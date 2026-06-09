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

  it("routes TOWARD env/config work via the prompt-facing fields", () => {
    // These three fields render verbatim into Perun's routing prompt
    // (buildUseAvoidSection / buildKeyTriggersSection / buildDelegationTable),
    // so blanking any of them would silently de-route stribog. Lock them.
    const { useWhen, keyTrigger, triggers } = stribogSpecialistInfo.metadata

    // useWhen: must be non-empty and describe the env/config doer domain.
    expect(useWhen?.length ?? 0).toBeGreaterThan(0)
    const use = useWhen?.join(" ").toLowerCase() ?? ""
    expect(use).toMatch(/docker|service|environment|config/i)

    // keyTrigger: must be present and name the agent it dispatches to.
    expect(keyTrigger).toBeTruthy()
    expect(keyTrigger ?? "").toContain("stribog")

    // triggers: at least the two delegation rows (env ops + mechanical change).
    expect(triggers.length).toBeGreaterThanOrEqual(2)
    for (const t of triggers) {
      expect(t.domain).toBeTruthy()
      expect(t.trigger).toBeTruthy()
    }
  })

  it("defaults to a valid <provider>/<model> identifier", () => {
    expect(DEFAULT_STRIBOG_MODEL).toMatch(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/)
  })
})
