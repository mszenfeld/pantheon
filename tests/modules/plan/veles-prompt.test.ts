import { describe, expect, it } from "vitest"
import { buildVelesPrompt } from "../../../src/modules/plan/prompt.js"

describe("buildVelesPrompt", () => {
  const prompt = buildVelesPrompt()

  it("assembles frontmatter with name, mode all, and the exact allow-list", () => {
    expect(prompt).toContain("name: Veles - Planner")
    expect(prompt).toContain("mode: all")
    // Pin the rendered allow-list against a LITERAL (not reconstructed from
    // VELES_TOOLS) so an unintended reorder or membership change fails HERE.
    // Concrete membership/absence/subset invariants live in allowed-tools.test.ts.
    expect(prompt).toContain(
      "allowed-tools: serena_find_symbol, serena_find_referencing_symbols, serena_get_symbols_overview, serena_search_for_pattern, serena_find_file, serena_list_dir, serena_read_file, Read, Glob, Grep, Write, Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), skill, question, sequential_thinking_sequentialthinking",
    )
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
    // Depth/logistics: sequential-thinking trigger (Lever E, demoted to MAY per RUNG-1 —
    // ST invoked only 1/3 and the skill prose carried depth/ordering without it)
    expect(prompt).toContain("you MAY use")
    expect(prompt).toContain("cross-scenario interactions")
    // R1 echo (2026-06-05): tests corroborate, never the oracle
    expect(prompt).toContain("never the oracle")
    // R-A (2026-06-05): surface-coverage anchor, scoped to the ≥2-status matrix condition.
    // Two contiguous substrings (the wrapped bullet can't be matched as one span):
    // the surface phrase proves the edit; the opener proves it lives in the ≥2-status bullet.
    expect(prompt).toContain("per changed external surface named in the Changes Summary")
    expect(prompt).toContain('names ≥2 statuses, the `## Coverage Matrix` has one row per such')
  })
})
