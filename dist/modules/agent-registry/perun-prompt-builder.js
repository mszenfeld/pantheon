const PERUN_PLACEHOLDERS = [
  "SPECIALISTS_TABLE",
  "KEY_TRIGGERS",
  "DELEGATION_TABLE",
  "DISPATCHABLE_ALLOWLIST"
];
function byName(a, b) {
  return a.name.localeCompare(b.name);
}
function buildDispatchableAllowlistSentence(allowlist) {
  if (allowlist.length === 0) {
    return "No `mode: all` agent is dispatchable \u2014 every dispatch target must be a strict `subagent`.";
  }
  const quoted = allowlist.map((n) => `\`${n}\``);
  const single = quoted.length === 1;
  const list = single ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  const noun = single ? "agent" : "agents";
  const verb = single ? "is" : "are";
  return `The only \`mode: all\` ${noun} Perun may dispatch \u2014 and only as the primary coordinator \u2014 ${verb} ${list}; every other dispatch target must be a strict \`subagent\`. This is the no-plan branch's mechanism (Workflow 1 Step 1).`;
}
function buildSpecialistsTable(registry) {
  if (registry.length === 0) return "";
  const rows = [...registry].sort(byName).map((a) => `| \`${a.name}\` | ${a.mode} | ${a.description} |`);
  return ["| Name | Mode | Purpose |", "|---|---|---|", ...rows].join("\n");
}
function buildKeyTriggersSection(registry) {
  const withTrigger = [...registry].sort(byName).filter((a) => a.metadata.keyTrigger !== void 0);
  if (withTrigger.length === 0) return "";
  const bullets = withTrigger.map((a) => `- ${a.metadata.keyTrigger}`);
  return ["### Key Triggers (check BEFORE classification):", "", ...bullets].join("\n");
}
function buildDelegationTable(registry) {
  const rows = [];
  for (const agent of [...registry].sort(byName)) {
    for (const t of agent.metadata.triggers) {
      rows.push(`| ${t.domain} | \`${agent.name}\` | ${t.trigger} |`);
    }
  }
  if (rows.length === 0) return "";
  return [
    "### Delegation Table:",
    "",
    "| Domain | Agent | Trigger |",
    "|---|---|---|",
    ...rows
  ].join("\n");
}
function buildUseAvoidSection(agentName, registry) {
  const agent = registry.find((a) => a.name === agentName);
  if (agent === void 0) {
    throw new Error(`Unknown agent in placeholder: ${agentName}`);
  }
  const useWhen = agent.metadata.useWhen ?? [];
  const avoidWhen = agent.metadata.avoidWhen ?? [];
  if (useWhen.length === 0 && avoidWhen.length === 0) return "";
  const lines = [`### Use \`${agentName}\` when:`];
  for (const u of useWhen) lines.push(`- ${u}`);
  if (avoidWhen.length > 0) {
    lines.push("", `### Avoid \`${agentName}\` when:`);
    for (const a of avoidWhen) lines.push(`- ${a}`);
  }
  return lines.join("\n");
}
function buildWorkflowContribution(agentName, registry) {
  const agent = registry.find((a) => a.name === agentName);
  if (agent === void 0) {
    throw new Error(`Unknown agent in placeholder: ${agentName}`);
  }
  return agent.metadata.workflowContribution ?? "";
}
function buildPerunPrompt(template, registry, options = {}) {
  const sections = {
    SPECIALISTS_TABLE: buildSpecialistsTable(registry),
    KEY_TRIGGERS: buildKeyTriggersSection(registry),
    DELEGATION_TABLE: buildDelegationTable(registry),
    DISPATCHABLE_ALLOWLIST: options.dispatchableAllowlist === void 0 ? "" : buildDispatchableAllowlistSentence(options.dispatchableAllowlist)
  };
  let out = template;
  for (const key of PERUN_PLACEHOLDERS) {
    out = out.replaceAll(`{${key}}`, sections[key]);
  }
  out = out.replace(
    /\{USE_AVOID:([A-Za-z0-9_-]+)\}/g,
    (_match, name) => buildUseAvoidSection(name, registry)
  );
  out = out.replace(
    /\{WORKFLOW:([A-Za-z0-9_-]+)\}/g,
    (_match, name) => buildWorkflowContribution(name, registry)
  );
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}
export {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildDispatchableAllowlistSentence,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
  buildWorkflowContribution
};
