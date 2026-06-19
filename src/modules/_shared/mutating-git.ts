/**
 * Detects whether a bash command invokes a TREE- or BRANCH-mutating `git`
 * subcommand. Used by the svarog/stribog `tool.execute.before` hooks to deny the
 * one thing a leaf executor must never do to its host repo: switch/rewrite the
 * working tree. A 2026-06-18 Perun role-discipline eval caught a dispatched
 * specialist running `git checkout feature/global-skills`, which silently moved
 * the operator's worktree off `master` and broke the build — the executors' bash
 * was "host-shell trust" with mutating-git a deliberately deferred item.
 *
 * Scope (intentionally tight, mirroring the MoA recommendation): the destructive
 * working-tree / branch verbs only. Read-only verbs (`status`/`log`/`diff`/
 * `blame`/`show`/`rev-parse`, plain `branch` listing) PASS — an executor
 * legitimately inspects state. This is DEFENSE-IN-DEPTH behind the prompt, not an
 * adversarial sandbox: a determined model can obfuscate (subshells, aliases,
 * wrappers). It narrows the single most-likely worktree-corrupting reflex.
 */

/** Subcommands that always mutate the working tree / refs. */
const MUTATING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "checkout",
  "switch",
  "reset",
  "restore",
  "clean",
  "stash",
  "rebase",
  "merge",
  "cherry-pick",
  "worktree",
])

/** Git global options that consume the FOLLOWING token as their argument (so the
 *  subcommand scanner must skip two tokens, not one). The `=`-joined forms
 *  (`--git-dir=…`) are a single token and handled by the generic option skip. */
const GLOBAL_OPTS_WITH_ARG: ReadonlySet<string> = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
])

/** Benign leading words / env-assignments that precede the real program. */
function programIndex(tokens: string[]): number {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === undefined) break
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++ // FOO=bar env assignment
      continue
    }
    if (
      t === "sudo" ||
      t === "command" ||
      t === "nohup" ||
      t === "env" ||
      t === "time"
    ) {
      i++
      continue
    }
    break
  }
  return i
}

/** First non-option token after `git` is the subcommand; skip global options. */
function subcommandOf(tokens: string[], gitIdx: number): number {
  let i = gitIdx + 1
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === undefined) break
    if (t.startsWith("-")) {
      i += GLOBAL_OPTS_WITH_ARG.has(t) ? 2 : 1
      continue
    }
    break
  }
  return i
}

export function isMutatingGitCommand(command: string): boolean {
  // Examine each shell-separated segment independently so `git status && git
  // checkout x` is caught on its second invocation.
  for (const segment of command.split(/&&|\|\||[;|&\n]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const pi = programIndex(tokens)
    if (tokens[pi] !== "git") continue // git must be the invoked program, not an argument

    const si = subcommandOf(tokens, pi)
    const sub = tokens[si]
    if (sub === undefined) continue
    if (MUTATING_SUBCOMMANDS.has(sub)) return true
    // `branch` is read-only when listing; mutating only on delete.
    if (sub === "branch") {
      const rest = tokens.slice(si + 1)
      if (rest.some((t) => t === "-d" || t === "-D" || t === "--delete"))
        return true
    }
  }
  return false
}
