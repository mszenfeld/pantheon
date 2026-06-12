import { describe, expect, it } from "vitest"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"

describe("STRIBOG_TOOLS", () => {
  it("grants the structured read + edit/write tools", () => {
    expect(STRIBOG_TOOLS).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep", "Edit", "Write"]),
    )
  })

  it("grants the actuator Bash verbs (docker / make / package managers / curl)", () => {
    for (const t of [
      "Bash(docker:*)",
      "Bash(docker compose:*)",
      "Bash(make:*)",
      "Bash(npm:*)",
      "Bash(pnpm:*)",
      "Bash(bun:*)",
      "Bash(uv:*)",
      "Bash(curl:*)",
    ]) {
      expect(STRIBOG_TOOLS).toContain(t)
    }
  })

  it("scopes git to read-only verbs only (no mutating git)", () => {
    const gitTools = STRIBOG_TOOLS.filter((t) => t.includes("git"))
    expect(gitTools.length).toBeGreaterThan(0)
    for (const t of gitTools) {
      expect(t).toMatch(/git --no-pager (log|blame|status|diff)/)
    }
    const MUTATING_GIT =
      /git[^)]*\b(revert|reset|push|checkout|clean|commit|rm)\b/
    expect(STRIBOG_TOOLS.filter((t) => MUTATING_GIT.test(t))).toEqual([])
  })

  it("excludes minting, fan-out, interactive, and rm (separation + scope)", () => {
    for (const t of [
      "execute_recipe",
      "interactive_bash",
      "dispatch_parallel",
      "Task",
      "Bash(rm:*)",
    ]) {
      expect(STRIBOG_TOOLS).not.toContain(t)
    }
  })

  it("has exactly the expected number of entries (guards against silent additions)", () => {
    expect(STRIBOG_TOOLS).toHaveLength(17)
  })
})
