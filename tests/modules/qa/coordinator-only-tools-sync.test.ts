import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { AppVerkPlanPlugin } from "../../../src/modules/plan/index.js"
import { AppVerkExplorePlugin } from "../../../src/modules/explore/index.js"
import { AppVerkStribogPlugin } from "../../../src/modules/stribog/index.js"
import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"
import { clearAgentMetadataRegistry } from "../../../src/modules/agent-registry/index.js"

// REGRESSION GUARD for the `isCoordinatorCaller` open-world default.
//
// caller-gate.ts treats "not in the dispatch registry" as "is the coordinator
// (Perun)", so `parse_plan` / `record_input` / `preflight` are gated open for
// any session that ISN'T a registered specialist. That registry-negative is
// safe ONLY while the convention holds that no agent other than Perun is
// granted these three coordinator-only QA tools. Nothing in the runtime gate
// enforces that convention — a future agent definition that enables one of the
// three would silently widen access. This test locks the convention from the
// DECLARATIVE side (agent-tool grants), so a misconfiguration is caught at
// test time even though the per-agent tools map is inert on opencode 1.15.10.
//
// The invariant: the set {parse_plan, record_input, preflight} appears as an
// ENABLED tool for Perun ONLY. Every other agent definition — the three
// zmora-* variants, Veles, Triglav, Stribog, and any agent added later — must
// leave all three absent or explicitly false. We iterate over DISCOVERED agent
// definitions (markdown frontmatter + programmatic config.agent maps) rather
// than a hard-coded roster, so a newly-added agent is covered automatically.

const COORDINATOR_ONLY_QA_TOOLS = [
  "parse_plan",
  "record_input",
  "preflight",
] as const

const here = path.dirname(fileURLToPath(import.meta.url))
const AGENTS_DIR = path.resolve(here, "../../../src/agents")

// Minimal fake plugin input. The config() callbacks we drive only read config
// + pantheon config; none touch the client during config synthesis. resolve to
// a no-op client so the factory bodies (metadata registration, store setup) run
// without a live OpenCode server.
const fakeInput = {
  client: {
    session: { get: async () => ({ data: { parentID: undefined } }) },
    tui: { showToast: async () => undefined },
  },
} as never

/** Parse a markdown agent file's frontmatter `allowed-tools:` line into a set of
 *  granted tool names. Mirrors the scan in perun-tools-sync.test.ts. */
function allowedToolsOf(markdown: string): Set<string> {
  const line = markdown.match(/^allowed-tools:\s*(.+)$/m)?.[1] ?? ""
  return new Set(
    line
      .split(",")
      .map((t) => t.trim())
      // Drop any Bash(...)-style scoping; the three QA tools are bare names.
      .filter((t) => t.length > 0),
  )
}

/** True iff a programmatic config.agent[...].tools map ENABLES `toolName`. A
 *  missing key or an explicit `false` both count as "not enabled". */
function enablesTool(
  tools: Record<string, unknown> | undefined,
  toolName: string,
): boolean {
  return tools?.[toolName] === true
}

/** Run a plugin's config() callback against a fresh fake config and return the
 *  synthesized config.agent map (agentKey -> AgentConfig). */
async function agentMapFromPlugin(
  plugin: typeof AppVerkQAPlugin,
): Promise<Record<string, { tools?: Record<string, unknown> }>> {
  const instance = await plugin(fakeInput)
  const config: {
    agent?: Record<string, { tools?: Record<string, unknown> }>
  } = {}
  await instance.config?.(config as never)
  return config.agent ?? {}
}

afterEach(() => {
  clearAgentMetadataRegistry()
})

describe("coordinator-only QA tools are granted to Perun only", () => {
  it("grants all three coordinator-only QA tools to Perun in its markdown frontmatter", () => {
    const md = readFileSync(path.join(AGENTS_DIR, "perun.md"), "utf8")
    const granted = allowedToolsOf(md)
    for (const t of COORDINATOR_ONLY_QA_TOOLS) {
      expect(granted, `perun.md allowed-tools must grant ${t}`).toContain(t)
    }
  })

  it("grants none of the three to any OTHER markdown agent definition", () => {
    const mdFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"))
    for (const file of mdFiles) {
      if (file === "perun.md") continue
      const granted = allowedToolsOf(
        readFileSync(path.join(AGENTS_DIR, file), "utf8"),
      )
      for (const t of COORDINATOR_ONLY_QA_TOOLS) {
        expect(
          granted.has(t),
          `${file} must NOT grant the coordinator-only QA tool ${t}`,
        ).toBe(false)
      }
    }
  })

  it("leaves the three absent/false on every programmatically-registered agent (zmora-*, Veles, Triglav, Stribog)", async () => {
    // Drive every Pantheon plugin that registers a non-Perun agent. The
    // coordinator plugin is intentionally excluded: Perun's grant lives in the
    // markdown frontmatter asserted above, and its config() pulls in default-
    // agent / prompt machinery irrelevant to this invariant.
    const agentMaps = await Promise.all([
      agentMapFromPlugin(AppVerkQAPlugin),
      agentMapFromPlugin(AppVerkPlanPlugin),
      agentMapFromPlugin(AppVerkExplorePlugin),
      agentMapFromPlugin(AppVerkStribogPlugin),
    ])

    let discoveredAgents = 0
    for (const agents of agentMaps) {
      for (const [agentKey, agentConfig] of Object.entries(agents)) {
        // The coordinator key never appears in these plugins, but guard anyway:
        // if a feature plugin ever re-registers Perun, skip it (its grant is the
        // sanctioned one, covered by the markdown test above).
        if (agentKey === COORDINATOR_AGENT) continue
        discoveredAgents += 1
        for (const t of COORDINATOR_ONLY_QA_TOOLS) {
          expect(
            enablesTool(agentConfig.tools, t),
            `${agentKey} must NOT enable the coordinator-only QA tool ${t}`,
          ).toBe(false)
        }
      }
    }

    // Sanity: the discovery actually found agents (zmora-fe/-be/-setup, Veles,
    // Triglav, Stribog = 6). If a future refactor makes the maps come back
    // empty, this catches a silently-vacuous assertion.
    expect(discoveredAgents).toBeGreaterThanOrEqual(6)
  })
})
