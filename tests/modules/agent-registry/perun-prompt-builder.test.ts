import { describe, expect, it } from "vitest"
import {
  buildKeyTriggersSection,
  buildSpecialistsTable,
  buildDelegationTable,
  buildUseAvoidSection,
  buildWorkflowContribution,
  buildDispatchableAllowlistSentence,
  buildPerunPrompt,
} from "../../../src/modules/agent-registry/perun-prompt-builder.js"
import type { SpecialistInfo } from "../../../src/modules/agent-registry/agent-metadata.js"

function info(
  over: Partial<SpecialistInfo> & { name: string },
): SpecialistInfo {
  return {
    name: over.name,
    mode: over.mode ?? "subagent",
    description: over.description ?? `${over.name} desc`,
    metadata: over.metadata ?? { triggers: [] },
  }
}

describe("buildSpecialistsTable", () => {
  it("returns empty string for no agents", () => {
    expect(buildSpecialistsTable([])).toBe("")
  })

  it("renders one row", () => {
    const out = buildSpecialistsTable([
      info({ name: "zmora", description: "QA work" }),
    ])
    expect(out).toBe(
      [
        "| Name | Mode | Purpose |",
        "|---|---|---|",
        "| `zmora` | subagent | QA work |",
      ].join("\n"),
    )
  })

  it("renders rows in name-sorted order", () => {
    const out = buildSpecialistsTable([
      info({ name: "zmora", description: "z" }),
      info({ name: "fix-auto", description: "f" }),
    ])
    const lines = out.split("\n")
    expect(lines[2]).toBe("| `fix-auto` | subagent | f |")
    expect(lines[3]).toBe("| `zmora` | subagent | z |")
  })

  it("emits only Name/Mode/Purpose — no Cost column or cost-tier leak", () => {
    // Guards the dead-field fix: cost/category are unrendered, so even when set
    // they must not surface in the specialists table (no Cost column, no
    // FREE/CHEAP/EXPENSIVE prose). If a Cost column is ever added, do it here and
    // re-populate metadata.cost together.
    const out = buildSpecialistsTable([
      info({
        name: "zmora",
        description: "QA work",
        metadata: { cost: "EXPENSIVE", category: "specialist", triggers: [] },
      }),
    ])
    expect(out.split("\n")[0]).toBe("| Name | Mode | Purpose |")
    expect(out).not.toContain("Cost")
    expect(out).not.toMatch(/FREE|CHEAP|EXPENSIVE/)
  })
})

describe("buildKeyTriggersSection", () => {
  it("returns empty string when no agent has a keyTrigger", () => {
    expect(buildKeyTriggersSection([info({ name: "zmora" })])).toBe("")
  })

  it("renders a bullet per agent with a keyTrigger, skipping others", () => {
    const out = buildKeyTriggersSection([
      info({ name: "zmora" }),
      info({
        name: "triglav",
        metadata: { triggers: [], keyTrigger: "user asks where X is" },
      }),
    ])
    expect(out).toBe(
      [
        "### Key Triggers (check BEFORE classification):",
        "",
        "- user asks where X is",
      ].join("\n"),
    )
  })
})

describe("buildDelegationTable", () => {
  it("returns empty string when no agent declares triggers", () => {
    expect(buildDelegationTable([info({ name: "zmora" })])).toBe("")
  })

  it("expands triggers[] into Domain/Agent/Trigger rows", () => {
    const out = buildDelegationTable([
      info({
        name: "triglav",
        metadata: {
          triggers: [
            { domain: "Code search", trigger: "find where X is defined" },
            { domain: "Impact analysis", trigger: "what calls Y" },
          ],
        },
      }),
    ])
    expect(out).toBe(
      [
        "### Delegation Table:",
        "",
        "| Domain | Agent | Trigger |",
        "|---|---|---|",
        "| Code search | `triglav` | find where X is defined |",
        "| Impact analysis | `triglav` | what calls Y |",
      ].join("\n"),
    )
  })
})

const triglav = info({
  name: "triglav",
  metadata: {
    triggers: [],
    useWhen: ["you need to find code", "you need impact analysis"],
    avoidWhen: ["you already know the file"],
  },
})

describe("buildUseAvoidSection", () => {
  it("returns empty string for an agent without useWhen/avoidWhen", () => {
    expect(buildUseAvoidSection("zmora", [info({ name: "zmora" })])).toBe("")
  })

  it("throws for an unknown agent target", () => {
    expect(() =>
      buildUseAvoidSection("ghost", [info({ name: "zmora" })]),
    ).toThrow(/Unknown agent in placeholder: ghost/)
  })

  it("renders use and avoid bullets", () => {
    expect(buildUseAvoidSection("triglav", [triglav])).toBe(
      [
        "### Use `triglav` when:",
        "- you need to find code",
        "- you need impact analysis",
        "",
        "### Avoid `triglav` when:",
        "- you already know the file",
      ].join("\n"),
    )
  })
})

describe("buildWorkflowContribution", () => {
  it("returns empty string for an agent without a workflowContribution", () => {
    expect(buildWorkflowContribution("zmora", [info({ name: "zmora" })])).toBe(
      "",
    )
  })

  it("throws for an unknown agent target", () => {
    expect(() =>
      buildWorkflowContribution("ghost", [info({ name: "zmora" })]),
    ).toThrow(/Unknown agent in placeholder: ghost/)
  })

  it("renders the contribution prose verbatim", () => {
    const withWorkflow = info({
      name: "stribog",
      metadata: {
        triggers: [],
        workflowContribution:
          "### Stribog routing\n\n- prefer for build/deploy actuation",
      },
    })
    expect(buildWorkflowContribution("stribog", [withWorkflow])).toBe(
      "### Stribog routing\n\n- prefer for build/deploy actuation",
    )
  })
})

describe("buildDispatchableAllowlistSentence", () => {
  it("describes the empty allowlist", () => {
    expect(buildDispatchableAllowlistSentence([])).toContain(
      "No `mode: all` agent is dispatchable",
    )
  })

  it("renders a single entry backticked verbatim", () => {
    const out = buildDispatchableAllowlistSentence(["Veles - Planner"])
    expect(out).toContain("`Veles - Planner`")
    expect(out).toContain(" is ")
  })

  it("joins two entries with 'and' and uses a plural verb", () => {
    const out = buildDispatchableAllowlistSentence([
      "Veles - Planner",
      "Mokosh - Archivist",
    ])
    expect(out).toContain("`Veles - Planner` and `Mokosh - Archivist`")
    expect(out).toContain(" are ")
  })

  it("joins three+ entries with a serial comma before the final 'and'", () => {
    const out = buildDispatchableAllowlistSentence(["A", "B", "C"])
    expect(out).toContain("`A`, `B` and `C`")
    expect(out).toContain(" are ")
  })
})

describe("buildPerunPrompt", () => {
  it("substitutes known placeholders", () => {
    const out = buildPerunPrompt("X\n{SPECIALISTS_TABLE}\nY", [
      info({ name: "zmora", description: "QA work" }),
    ])
    expect(out).toContain("| `zmora` | subagent | QA work |")
    expect(out.startsWith("X\n")).toBe(true)
    expect(out.endsWith("\nY")).toBe(true)
  })

  it("leaves an unknown placeholder literal", () => {
    expect(buildPerunPrompt("{UNKNOWN_X}", [])).toBe("{UNKNOWN_X}")
  })

  it("substitutes a lowercase-named per-agent placeholder", () => {
    const out = buildPerunPrompt("{USE_AVOID:triglav}", [triglav])
    expect(out).toContain("### Use `triglav` when:")
    expect(out).not.toContain("{USE_AVOID:triglav}")
  })

  it("throws when a per-agent placeholder targets an unknown agent", () => {
    expect(() => buildPerunPrompt("{USE_AVOID:ghost}", [triglav])).toThrow(
      /Unknown agent in placeholder: ghost/,
    )
  })

  it("renders empty sections to nothing", () => {
    const out = buildPerunPrompt("a{KEY_TRIGGERS}b{DELEGATION_TABLE}c", [
      info({ name: "zmora" }),
    ])
    expect(out).toBe("abc")
  })

  it("collapses blank-line runs left by empty sections", () => {
    const out = buildPerunPrompt(
      "A\n\n{KEY_TRIGGERS}\n\n{DELEGATION_TABLE}\n\nB",
      [info({ name: "zmora" })],
    )
    expect(out).not.toMatch(/\n{3,}/)
    expect(out).toContain("A")
    expect(out).toContain("B")
  })

  it("renders {DISPATCHABLE_ALLOWLIST} from the supplied option", () => {
    const out = buildPerunPrompt("X {DISPATCHABLE_ALLOWLIST} Y", [], {
      dispatchableAllowlist: ["Veles - Planner"],
    })
    expect(out).toContain("`Veles - Planner`")
    expect(out).not.toContain("{DISPATCHABLE_ALLOWLIST}")
  })

  it("renders {DISPATCHABLE_ALLOWLIST} to empty when no allowlist is supplied", () => {
    const out = buildPerunPrompt("X{DISPATCHABLE_ALLOWLIST}Y", [])
    expect(out).toBe("XY")
  })

  it("substitutes a {WORKFLOW:<name>} per-agent placeholder", () => {
    const out = buildPerunPrompt("{WORKFLOW:stribog}", [
      info({
        name: "stribog",
        metadata: {
          triggers: [],
          workflowContribution: "stribog handles actuation",
        },
      }),
    ])
    expect(out).toContain("stribog handles actuation")
    expect(out).not.toContain("{WORKFLOW:stribog}")
  })

  it("throws when a {WORKFLOW:<name>} placeholder targets an unknown agent", () => {
    expect(() => buildPerunPrompt("{WORKFLOW:ghost}", [triglav])).toThrow(
      /Unknown agent in placeholder: ghost/,
    )
  })
})
