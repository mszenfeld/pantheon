import type { SpecialistInfo } from "./agent-metadata.js"

export const PERUN_PLACEHOLDERS = [
  "SPECIALISTS_TABLE",
  "KEY_TRIGGERS",
  "DELEGATION_TABLE",
  "DISPATCHABLE_ALLOWLIST",
] as const

/**
 * Caller-supplied values that `buildPerunPrompt` cannot derive from the
 * specialist registry alone. `dispatchableAllowlist` is the set of `mode: "all"`
 * agent names Perun may dispatch — it lives in `coordinator/dispatch.ts`
 * (`DISPATCHABLE_ALL_AGENTS`) which is downstream of this library, so it is
 * threaded in at render time rather than imported (which would invert the
 * `coordinator → agent-registry` layering). When omitted, the
 * `{DISPATCHABLE_ALLOWLIST}` placeholder renders to "" like any empty section.
 */
export interface PerunPromptOptions {
  dispatchableAllowlist?: readonly string[]
}

function byName(a: SpecialistInfo, b: SpecialistInfo): number {
  return a.name.localeCompare(b.name)
}

/**
 * Render the single sentence that names the Perun-dispatchable `mode: "all"`
 * allowlist, derived from the live constant rather than hand-written in prose.
 * The constant currently holds exactly one entry (the Veles planner); the
 * grammar adapts if it ever holds zero or several. Used both for Perun's prompt
 * (the `{DISPATCHABLE_ALLOWLIST}` placeholder) and — via the same exported
 * helper — for the coordinator's dispatch-tool descriptions, so the allowlist
 * is stated in exactly one place. Each name is rendered verbatim inside
 * backticks so a test can assert the constant appears literally in the render.
 */
export function buildDispatchableAllowlistSentence(
  allowlist: readonly string[],
): string {
  if (allowlist.length === 0) {
    return "No `mode: all` agent is dispatchable — every dispatch target must be a strict `subagent`."
  }
  const quoted = allowlist.map((n) => `\`${n}\``)
  const single = quoted.length === 1
  const list = single
    ? quoted[0]
    : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
  const noun = single ? "agent" : "agents"
  const verb = single ? "is" : "are"
  return (
    `The only \`mode: all\` ${noun} Perun may dispatch — and only as the primary ` +
    `coordinator — ${verb} ${list}; every other dispatch target must be a strict ` +
    `\`subagent\`. This is the no-plan branch's mechanism (Workflow 1 Step 1).`
  )
}

export function buildSpecialistsTable(registry: SpecialistInfo[]): string {
  if (registry.length === 0) return ""
  const rows = [...registry]
    .sort(byName)
    .map((a) => `| \`${a.name}\` | ${a.mode} | ${a.description} |`)
  return ["| Name | Mode | Purpose |", "|---|---|---|", ...rows].join("\n")
}

export function buildKeyTriggersSection(registry: SpecialistInfo[]): string {
  const withTrigger = [...registry]
    .sort(byName)
    .filter((a) => a.metadata.keyTrigger !== undefined)
  if (withTrigger.length === 0) return ""
  const bullets = withTrigger.map((a) => `- ${a.metadata.keyTrigger}`)
  return [
    "### Key Triggers (check BEFORE classification):",
    "",
    ...bullets,
  ].join("\n")
}

export function buildDelegationTable(registry: SpecialistInfo[]): string {
  const rows: string[] = []
  for (const agent of [...registry].sort(byName)) {
    for (const t of agent.metadata.triggers) {
      rows.push(`| ${t.domain} | \`${agent.name}\` | ${t.trigger} |`)
    }
  }
  if (rows.length === 0) return ""
  return [
    "### Delegation Table:",
    "",
    "| Domain | Agent | Trigger |",
    "|---|---|---|",
    ...rows,
  ].join("\n")
}

export function buildUseAvoidSection(
  agentName: string,
  registry: SpecialistInfo[],
): string {
  const agent = registry.find((a) => a.name === agentName)
  if (agent === undefined) {
    throw new Error(`Unknown agent in placeholder: ${agentName}`)
  }
  const useWhen = agent.metadata.useWhen ?? []
  const avoidWhen = agent.metadata.avoidWhen ?? []
  if (useWhen.length === 0 && avoidWhen.length === 0) return ""
  const lines: string[] = [`### Use \`${agentName}\` when:`]
  for (const u of useWhen) lines.push(`- ${u}`)
  if (avoidWhen.length > 0) {
    lines.push("", `### Avoid \`${agentName}\` when:`)
    for (const a of avoidWhen) lines.push(`- ${a}`)
  }
  return lines.join("\n")
}

/**
 * Render an agent's free-form `workflowContribution` block (the `{WORKFLOW:<name>}`
 * placeholder). Throws on an unknown target — mirrors `buildUseAvoidSection`, so a
 * placeholder naming a non-registered agent fails loudly at render time rather than
 * leaving a stray token. An agent without a contribution renders to "".
 */
export function buildWorkflowContribution(
  agentName: string,
  registry: SpecialistInfo[],
): string {
  const agent = registry.find((a) => a.name === agentName)
  if (agent === undefined) {
    throw new Error(`Unknown agent in placeholder: ${agentName}`)
  }
  return agent.metadata.workflowContribution ?? ""
}

export function buildPerunPrompt(
  template: string,
  registry: SpecialistInfo[],
  options: PerunPromptOptions = {},
): string {
  const sections: Record<(typeof PERUN_PLACEHOLDERS)[number], string> = {
    SPECIALISTS_TABLE: buildSpecialistsTable(registry),
    KEY_TRIGGERS: buildKeyTriggersSection(registry),
    DELEGATION_TABLE: buildDelegationTable(registry),
    DISPATCHABLE_ALLOWLIST:
      options.dispatchableAllowlist === undefined
        ? ""
        : buildDispatchableAllowlistSentence(options.dispatchableAllowlist),
  }
  let out = template
  for (const key of PERUN_PLACEHOLDERS) {
    out = out.replaceAll(`{${key}}`, sections[key])
  }
  out = out.replace(/\{USE_AVOID:([A-Za-z0-9_-]+)\}/g, (_match, name: string) =>
    buildUseAvoidSection(name, registry),
  )
  out = out.replace(/\{WORKFLOW:([A-Za-z0-9_-]+)\}/g, (_match, name: string) =>
    buildWorkflowContribution(name, registry),
  )
  // Collapse blank-line runs left when a section renders to "" (e.g. an empty
  // KEY_TRIGGERS/DELEGATION_TABLE in 1A) so placeholder removal never leaves a
  // 3+ newline gap. Safe: the template authors no triple-newline runs itself.
  out = out.replace(/\n{3,}/g, "\n\n")
  return out
}
