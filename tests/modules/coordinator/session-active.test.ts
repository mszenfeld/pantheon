import { describe, expect, it, vi } from "vitest"
import { probeSessionActive } from "../../../src/modules/coordinator/session-active.js"

describe("probeSessionActive", () => {
  it("treats an absent probe as inactive (pre-status-gate, message-only)", async () => {
    expect(await probeSessionActive(undefined)).toBe(false)
  })

  it("returns the probe's truthy result (session still active)", async () => {
    const probe = vi.fn(async () => true)
    expect(await probeSessionActive(probe)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("returns the probe's falsy result (session inactive)", async () => {
    const probe = vi.fn(async () => false)
    expect(await probeSessionActive(probe)).toBe(false)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("treats a rejected probe as inactive (broken endpoint degrades, never wedges)", async () => {
    const probe = vi.fn(async () => {
      throw new Error("status endpoint down")
    })
    expect(await probeSessionActive(probe)).toBe(false)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
