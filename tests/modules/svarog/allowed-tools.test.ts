import { describe, expect, it } from "vitest"
import { SVAROG_TOOLS } from "../../../src/modules/svarog/allowed-tools.js"

describe("SVAROG_TOOLS", () => {
  it("includes the multi-file editors and read tools", () => {
    for (const t of ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit"]) {
      expect(SVAROG_TOOLS).toContain(t)
    }
  })

  it("includes the test-runner / build / curl bash verbs", () => {
    for (const t of [
      "Bash(bun:*)",
      "Bash(npm:*)",
      "Bash(pnpm:*)",
      "Bash(uv:*)",
      "Bash(make:*)",
      "Bash(docker:*)",
      "Bash(curl:*)",
    ]) {
      expect(SVAROG_TOOLS).toContain(t)
    }
  })

  it("includes read-only git but NOT git commit/push", () => {
    expect(SVAROG_TOOLS).toContain("Bash(git --no-pager log:*)")
    const joined = SVAROG_TOOLS.join(" ")
    expect(joined).not.toContain("git commit")
    expect(joined).not.toContain("git push")
  })

  it("does not render skill/serena editors into frontmatter (hook-allowed only)", () => {
    const joined = SVAROG_TOOLS.join(" ").toLowerCase()
    expect(joined).not.toContain("serena")
    expect(joined).not.toContain("skill")
  })

  it("is frozen-length so a stray addition trips the guard", () => {
    expect(SVAROG_TOOLS).toHaveLength(18)
  })
})
