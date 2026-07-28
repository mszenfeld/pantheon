import { VELES_ARTIFACT_TOOL_NAMES } from "./artifact-tool-names.js"

// Built-in tool allow-list for the Veles planning agent (emitted into the
// prompt frontmatter). Coordinator dispatch tools are NOT listed here — they
// are enabled via the `AgentConfig.tools` boolean map in index.ts (mirrors QA's
// execute_recipe opt-in), derived from the coordinator's canonical
// `DISPATCH_TOOL_NAMES` so the names can't drift. Veles's own planning-artifact
// tools are listed because the prompt instructs the planner to call them. The
// git/gh/command/date/mkdir Bash tokens are the BROAD forms that
// are exact members of the /qa:create-plan command's allow-list, so the shared
// qa-plan-authoring skill's allowed-tools are an exact subset of both callers.

const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file",
]

const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Write"]

const BASH_TOOLS = [
  "Bash(gh:*)",
  "Bash(git:*)",
  "Bash(command:*)",
  "Bash(date:*)",
  "Bash(mkdir:*)",
]

const HARNESS_TOOLS = ["skill", "question"]

// MCP reasoning aid — Veles-only (Section D). Optional MAY-use decomposition tool;
// the token is inert unless a sequential-thinking server is enabled in config.mcp.
const MCP_REASONING_TOOLS = ["sequential_thinking_sequentialthinking"]

export const VELES_TOOLS: string[] = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_TOOLS,
  ...BASH_TOOLS,
  ...HARNESS_TOOLS,
  ...VELES_ARTIFACT_TOOL_NAMES,
  ...MCP_REASONING_TOOLS,
]
