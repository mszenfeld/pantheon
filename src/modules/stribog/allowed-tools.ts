// DECLARED allow-list for the Stribog light-execution agent, rendered into the agent's
// prompt frontmatter (`allowed-tools:`). IMPORTANT: the frontmatter list is NOT the enforcement
// point. A binary check on opencode 1.17.3 found `config.agent.stribog.tools` is honored but
// DEFAULT-ALLOW (a tool absent from the map still executes), so it does not gate non-listed
// tools either. The REAL runtime boundary is the `tool.execute.before` hook in
// `tool-budget-hook.ts`: for an attributed `stribog` session it allows the core builtins
// {read,glob,grep,edit,write,bash} plus any configured `agents.stribog.extraTools` pattern,
// denies the immutable capability set (isImmutableDeny) and everything else (→ STRIBOG_TOOL_DENIED),
// and caps distinct edit/write files at STRIBOG_EDIT_BUDGET (→ STRIBOG_SCOPE_VIOLATION). This array is
// the declaration the prompt + the hook's CORE_BUILTINS set are kept in sync with — treat it as a
// declaration, NOT the gate. EXCLUSIONS the HOOK enforces (not "absent → uncallable"):
//   - no `execute_recipe`                 → the hook denies it, so Stribog cannot
//     value-hide-mint secrets (minter != actuator; that stays with zmora-setup). The QA
//     `zmora-` binding gate also never injects a minted value into a stribog session.
//   - no dispatch/`Task`                  → the hook denies it; Stribog is a leaf.
//   - no `interactive_bash`               → not ported in v1; long-running services run
//     detached via plain Bash (`docker compose up -d`, `<cmd> &`).
//   - serena IS accepted (code-intelligence) → the hook ALLOWS it (step 2c), EXCEPT the shell
//     escape (`execute_shell_command`) and whole-repo edits (`rename_symbol`/`safe_delete_symbol`);
//     serena single-file edits are charged to the SAME 2-file budget as edit/write.
// The hook allows `bash` at the TOOL-NAME level but DOES inspect one thing: it denies secret-
// GENERATION commands (`STRIBOG_SECRET_DENIED` — openssl rand, `node -e …randomBytes`, uuidgen,
// /dev/urandom, ssh-keygen, …), the hard minter≠actuator invariant. Otherwise the `Bash(docker:*)`-
// style scoping below is declarative: at runtime Stribog's bash is a full host shell (only
// `git commit` is globally blocked, by the commit plugin). General bash-verb restriction (no
// `rm`/mutating-git) remains a documented follow-up under the accepted host-env trust boundary
// (make/npm/docker run repo-controlled code with the operator's env). Edit recovery is NOT
// `git revert`/`reset` — it is the Perun scratch-ref snapshot (Phase 2).

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

export const STRIBOG_TOOLS: readonly string[] = [
  ...STRUCTURED_TOOLS,
  ...ACTUATOR_BASH_TOOLS,
  ...READONLY_GIT_TOOLS,
]
