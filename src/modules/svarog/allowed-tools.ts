// DECLARED allow-list for Svarog, rendered into the agent's prompt frontmatter (`allowed-tools:`).
// NOT the enforcement point: opencode 1.17.3 `config.agent.svarog.tools` is honored but
// DEFAULT-ALLOW, and the real boundary is the `tool.execute.before` hook in tool-budget-hook.ts
// (allow-by-default with the isImmutableDeny floor + serena carve-out + secret tripwire). serena
// editors, `get_diagnostics_for_file`, and `skill`/`load_appverk_skill` are HOOK-allowed and are
// deliberately NOT listed here (mirrors Stribog keeping serena hook-only). Bash `git commit`/`push`
// are globally blocked by the commit plugin; Svarog stops at READY and never commits.
// create_pr is HOOK-allowed (publish-path carve-out in tool-budget-hook.ts), not listed here.
// create_branch is HOOK-allowed (branch-path carve-out in tool-budget-hook.ts), not listed here.

const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit"]

const EXECUTOR_BASH_TOOLS = [
  "Bash(docker:*)",
  "Bash(docker compose:*)",
  "Bash(make:*)",
  "Bash(npm:*)",
  "Bash(pnpm:*)",
  "Bash(bun:*)",
  "Bash(uv:*)",
  "Bash(curl:*)",
]

const READONLY_GIT_TOOLS = [
  "Bash(git --no-pager log:*)",
  "Bash(git --no-pager blame:*)",
  "Bash(git --no-pager status:*)",
  "Bash(git --no-pager diff:*)",
]

export const SVAROG_TOOLS: readonly string[] = [
  ...STRUCTURED_TOOLS,
  ...EXECUTOR_BASH_TOOLS,
  ...READONLY_GIT_TOOLS,
]
