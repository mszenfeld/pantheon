import { afterEach, describe, expect, it } from "vitest"
import { buildVelesPrompt } from "../../../src/modules/plan/prompt.js"
import { AppVerkPlanPlugin } from "../../../src/modules/plan/index.js"
import {
  clearDispatchExtensions,
  registerDispatchExtensions,
} from "../../../src/modules/_shared/dispatch-extensions.js"
import { SessionAgentRegistry } from "../../../src/modules/_shared/session-agent-registry.js"

afterEach(() => clearDispatchExtensions())

describe("buildVelesPrompt", () => {
  const prompt = buildVelesPrompt()

  it("assembles frontmatter with name, mode all, and the exact allow-list", () => {
    expect(prompt).toContain("name: Veles - Planner")
    expect(prompt).toContain("mode: all")
    // Pin the rendered allow-list against a LITERAL (not reconstructed from
    // VELES_TOOLS) so an unintended reorder or membership change fails HERE.
    // Concrete membership/absence/subset invariants live in allowed-tools.test.ts.
    expect(prompt).toContain(
      "allowed-tools: serena_find_symbol, serena_find_referencing_symbols, serena_get_symbols_overview, serena_search_for_pattern, serena_find_file, serena_list_dir, serena_read_file, Read, Glob, Grep, Write, Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), skill, question, veles_reserve_planning_path, veles_write_reserved_planning_artifact, sequential_thinking_sequentialthinking",
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
    expect(prompt).toContain(
      "Wrong-but-confident is worse than honestly-unverified",
    )
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
    expect(prompt).toContain(
      "per changed external surface named in the Changes Summary",
    )
    expect(prompt).toContain(
      "names ≥2 statuses OR any changed surface is `provisioning-blocked`",
    )
    expect(prompt).toContain("the `## Coverage Matrix` has one row per such")
    // Provisionable-QA-plans doctrine: the 4th disposition + its evidence guard
    // (keyed on precondition mintability, never on a read interface existing).
    expect(prompt).toContain(
      "un-mintable by curl/psql/sqlite3/Playwright",
    )
    expect(prompt).toContain("never key this on a read interface existing")
  })

  it("hard-stop requires order/branch evidence for envelope + rate-limit (L1)", () => {
    expect(prompt).toContain(
      "the refute is satisfied only when the order/branch evidence is shown",
    )
  })

  it("hard-stop fails a reachable surface dispositioned out-of-scope (L2)", () => {
    expect(prompt).toContain(
      "a reachable changed surface (curl/psql/Playwright interface or effect) dispositioned",
    )
  })

  it("defines direct-user and Perun-headless planning contracts", () => {
    expect(prompt).toContain("## Execution context")
    expect(prompt).toContain("Execution context: perun-headless")
    expect(prompt).toContain("must NOT call `question`")
    expect(prompt).toContain('status: "needs_clarification"')
    expect(prompt).toContain("Mode: Feature spec")
    expect(prompt).toContain("feature-spec-authoring")
    expect(prompt).toContain("Mode: Implementation plan")
    expect(prompt).toContain("implementation-plan-authoring")
    expect(prompt).toContain("Mode: QA test plan")
    expect(prompt).toContain('type: "spec"')
    expect(prompt).toContain('type: "implementation-plan"')
    expect(prompt).toContain('|"qa"')
    expect(prompt).toContain('"needs_clarification"')
    expect(prompt).toContain('"suggested_modes"')
    expect(prompt).toContain("approved: true")
  })

  it("requires reservation-backed writes for specs and implementation plans", () => {
    expect(prompt).toContain("## Collision policy")
    expect(prompt).toContain("veles_reserve_planning_path")
    expect(prompt).toContain("veles_write_reserved_planning_artifact")
    expect(prompt).toContain("Never overwrite an existing durable artefact")
  })

  it("rejects question calls from a headless Veles session but permits direct Veles", async () => {
    const registry = new SessionAgentRegistry()
    registry.registerWithMetadata("headless-veles", "Veles - Planner", {
      headless: true,
    })
    registerDispatchExtensions({ sessionAgentRegistry: registry })
    const client = {
      session: {
        messages: async ({ path }: { path: { id: string } }) => ({
          data: [
            {
              info: {
                role: "user",
                agent: path.id === "headless-veles" ? "Veles - Planner" : "Veles - Planner",
              },
            },
          ],
        }),
      },
      tui: { showToast: async () => {} },
    }
    const hooks = await AppVerkPlanPlugin({ client } as never)
    const gate = hooks["tool.execute.before"]

    await expect(
      gate?.({ tool: "question", sessionID: "headless-veles" } as never, {} as never),
    ).rejects.toThrow("Headless Veles sessions must not call question")
    await expect(
      gate?.({ tool: "question", sessionID: "direct-veles" } as never, {} as never),
    ).resolves.toBeUndefined()
  })
})
