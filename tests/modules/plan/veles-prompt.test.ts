import { describe, expect, it } from "vitest"
import { buildVelesPrompt } from "../../../src/modules/plan/prompt.js"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"

describe("buildVelesPrompt", () => {
  const prompt = buildVelesPrompt()

  it("assembles frontmatter with name, mode all, and the exact allow-list", () => {
    expect(prompt).toContain("name: Veles - Planner")
    expect(prompt).toContain("mode: all")
    expect(prompt).toContain(`allowed-tools: ${VELES_TOOLS.join(", ")}`)
  })
  it("pins the load-bearing planner directives", () => {
    expect(prompt).toContain("You are **Veles**")
    expect(prompt).toContain("do not execute")
    expect(prompt).toContain("qa-plan-authoring")
    expect(prompt).toContain("triglav")
    expect(prompt).toContain('"plan_path"')
    expect(prompt).toContain('"status"')
    expect(prompt).toContain('"timeout"')
    expect(prompt).toContain('"fe_count"')
    expect(prompt).toContain('"be_count"')
    expect(prompt).toContain('"setup_prereqs"')
    expect(prompt).toContain('"topic"')
    expect(prompt).toContain("(reserved)")
    // v5 gate + Section D (ST decomposition aid)
    expect(prompt).toContain("Wrong-but-confident is worse than honestly-unverified")
    expect(prompt).toContain("(unverified — confirm at run time)")
    expect(prompt).toContain("read-then-cite beats")
    expect(prompt).toContain("targeted refute pass")
    expect(prompt).toContain("sequential_thinking_sequentialthinking")
    expect(prompt).toContain("proceed with native decomposition")
    // Phase-1 defect-grounding additions (preserve the three assertions above)
    expect(prompt).toContain("Blockers / Findings")
    expect(prompt).toContain("A discovered defect never shrinks coverage")
  })
})
