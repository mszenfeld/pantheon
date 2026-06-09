// Allow-list for the Stribog light-execution agent. This is the REAL security
// boundary: OpenCode's allow-list is deny-by-default, so anything not listed is
// not callable. Notable EXCLUSIONS (load-bearing):
//   - no `execute_recipe` / serena-write  → Stribog cannot value-hide-mint
//     secrets (minter != actuator; that stays with zmora-setup).
//   - no `interactive_bash`               → not ported in v1; long-running
//     services run detached via plain Bash (`docker compose up -d`, `<cmd> &`).
//   - no dispatch/`Task`                  → Stribog is a leaf; it never fans out.
//   - `git` is read-only and `rm` is absent → edit recovery is the Perun
//     scratch-ref snapshot (Phase 2), NOT `git revert`/`reset`.
// Per AGENTS.md, Bash token-matching is defense-in-depth, not a sandbox: it
// cannot inspect flag values, and make/npm/docker run repo-controlled code with
// the operator's env. That trust boundary is accepted and documented in the spec.

const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"]

const ACTUATOR_BASH_TOOLS = [
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

export const STRIBOG_TOOLS: string[] = [
  ...STRUCTURED_TOOLS,
  ...ACTUATOR_BASH_TOOLS,
  ...READONLY_GIT_TOOLS,
]
