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
declare function isMutatingGitCommand(command: string): boolean;

export { isMutatingGitCommand };
