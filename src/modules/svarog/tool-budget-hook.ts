import { isImmutableDeny } from "../_shared/stribog-extra-tools-contract.js"
import { isMutatingGitCommand } from "../_shared/mutating-git.js"
import { SVAROG_AGENT_KEY, SVAROG_SERENA_EDITORS } from "./svarog.metadata.js"

const TOOL_DENIED = "SVAROG_TOOL_DENIED"
const SECRET_DENIED = "SVAROG_SECRET_DENIED"
const GIT_DENIED = "SVAROG_GIT_DENIED"

// Bash secret-GENERATION tripwire (minter != actuator) — same invariant as Stribog. Defense-in-depth
// behind the hardened svarog.md refusal; the real boundary is that secrets are minted by zmora-setup
// and never injected here. Tuned to generation intent, not incidental words like `Math.random()`.
const SECRET_GEN_BASH =
  /\bopenssl\s+(rand|genrsa|genpkey|ecparam)\b|\buuidgen\b|\/dev\/urandom\b|\brandom(bytes|uuid|fill)\b|\bsecrets\.token|\bos\.urandom\b|\buuid4\b|\bgpg\s+--(gen|full-gen)|\bssh-keygen\b/i

// Pure-read builtins with nothing to enforce — passed through WITHOUT attribution (resolving the
// agent is a full-transcript call; skip it for tools that leak nothing and have no deny path).
const PREFILTER_READS: ReadonlySet<string> = new Set(["read", "glob", "grep"])

// Native tools that mutate the working tree -> trigger the one-time recovery checkpoint (a serena
// editor also triggers it, matched via SVAROG_SERENA_EDITORS). `patch`/`apply_patch` are opencode's
// native patch tools: GPT-class models edit almost exclusively through `apply_patch`, so omitting it
// left the recovery checkpoint NEVER firing for those models (an eval on openai/gpt-5.5 produced 0
// checkpoints across 12 runs). Matched case-insensitively against `norm` at the call site.
const MUTATING_NATIVE: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "multiedit",
  "patch",
  "apply_patch",
])

export interface SvarogToolHookDeps {
  /** Resolve a session's agent key. Returns undefined when unknown (-> fail-open). */
  resolveAgent: (sessionID: string) => Promise<string | undefined>
  /** Best-effort recovery snapshot, invoked on the first mutating tool (edit/write/multiedit or a
   *  serena editor) and retried on the next one if it throws — so it runs at most once successfully
   *  per session. Failures are swallowed — the checkpoint is a recovery aid, never a gate. Omit in
   *  tests that do not exercise it. */
  createCheckpoint?: (sessionID: string) => void
}

export interface SvarogToolHookInput {
  tool: string
  sessionID: string
  callID: string
}

export interface SvarogToolHookOutput {
  args: { command?: unknown; filePath?: unknown }
}

export type SvarogToolHook = (
  input: SvarogToolHookInput,
  output: SvarogToolHookOutput,
) => Promise<void>

export interface SvarogToolHookHandle {
  /** The tool.execute.before handler (allow/deny gate + one-time recovery checkpoint). */
  hook: SvarogToolHook
  /** Drop a session's "checkpoint created" marker. Called from the plugin's session.deleted. */
  clearSession: (sessionID: string) => void
}

/**
 * Build the `tool.execute.before` handler for Svarog. Unlike Stribog this is ALLOW-by-default
 * with a DENY FLOOR and NO edit budget (Svarog is the multi-file executor). Order is load-bearing:
 *   (1) pre-filter read/glob/grep without attribution;
 *   (2) attribution gate — fail OPEN for non-svarog / unresolved sessions;
 *   (2a) auto-create the recovery checkpoint ONCE before the first mutating tool (best-effort);
 *   (2b) bash secret-generation tripwire -> SECRET_DENIED;
 *   (2c) serena-EDITOR carve-out (allowed BEFORE the floor, which would otherwise deny them);
 *   (3) explicit `question` deny (headless leaf -> ESCALATE; no isImmutableDeny pattern covers it);
 *   (3b) network-egress deny — `webfetch`/`websearch` (leaf in-tree executor);
 *   (3c) publish/branch carve-out — `create_pr`/`create_branch` early-returns (the spec-mandated
 *       sanctioned publish chain; 2026-07-22 executor-chain decision) allowed BEFORE the floor's
 *       `create_` verb would deny them. `av_commit` needs no carve-out here: it is not
 *       floor-denied and falls to the allow-by-default at (5);
 *   (4) the shared isImmutableDeny floor, REUSED UNCHANGED (shell / dispatch / recipe / DB-mutation /
 *       serena memory-write). The carve-outs at (2c)/(3c) are the only reasons the legit serena
 *       editors and the publish tools pass;
 *   (5) everything else -> ALLOW (edit/write/multiedit, serena reads + diagnostics, skill, ...).
 * Fail-open on the attribution axis and on any internal error; only intended denials throw.
 */
export function makeSvarogToolHook(
  deps: SvarogToolHookDeps,
): SvarogToolHookHandle {
  /** Sessions for which the one-time recovery checkpoint has already been created. */
  const checkpointed = new Set<string>()

  const hook: SvarogToolHook = async (input, output) => {
    try {
      const raw = input.tool
      // (1) pure reads — nothing to enforce, skip the attribution call.
      if (PREFILTER_READS.has(raw)) return

      // (2) attribution — fail open for other/undefined agents.
      const agent = await deps.resolveAgent(input.sessionID)
      if (agent !== SVAROG_AGENT_KEY) return

      // ---- confirmed svarog from here ----
      const norm = raw.toLowerCase().replace(/-/g, "_")

      // (2a) Auto-create the recovery checkpoint on the FIRST mutating tool (marked only after a
      // successful snapshot, so a transient / born-HEAD failure retries on the next mutating tool
      // instead of latching the session with no recovery point). Best-effort: a checkpoint failure
      // must NEVER block the edit (recovery aid, not a gate). Restore is MANUAL (Option C) — on FAIL
      // the operator enumerates the deterministic ref (`git for-each-ref refs/svarog/ckpt/`) and runs
      // restoreCheckpoint. Mutating = native edit/write/multiedit OR a serena editor.
      const mutating =
        MUTATING_NATIVE.has(norm) || SVAROG_SERENA_EDITORS.test(norm)
      if (
        mutating &&
        deps.createCheckpoint &&
        !checkpointed.has(input.sessionID)
      ) {
        try {
          deps.createCheckpoint(input.sessionID)
          // Mark ONLY after a successful snapshot, so a transient failure (or a born-HEAD
          // repo) lets the NEXT mutating tool retry instead of silently latching the session
          // as "checkpointed" with no recovery point for the rest of the turn.
          checkpointed.add(input.sessionID)
        } catch {
          // best-effort; a checkpoint failure must not throw from the hook (recovery aid, not a gate)
        }
      }

      // (2b) bash tripwires. Every other bash command passes (host-shell trust) EXCEPT (i) secret
      // GENERATION (minter != actuator) and (ii) a TREE-mutating git command. The git carve-out
      // closes a 2026-06-18 role-discipline-eval footgun: a dispatched executor ran
      // `git checkout feature/global-skills`, silently moving the operator's worktree off `master`
      // and breaking the build. Svarog is an in-tree leaf — it inspects state (read-only git is
      // allowed) but must never switch/rewrite the tree.
      if (raw === "bash") {
        const command =
          typeof output.args?.command === "string" ? output.args.command : ""
        if (SECRET_GEN_BASH.test(command)) {
          throw new Error(
            `${SECRET_DENIED}: this command generates a secret/credential value, which is NOT ` +
              `Svarog's job — minting belongs to zmora-setup (minter != actuator). Do not mint, ` +
              `write, or echo a secret. Return the ESCALATE result and state the value must be ` +
              `provided (or minted by zmora-setup).`,
          )
        }
        if (isMutatingGitCommand(command)) {
          throw new Error(
            `${GIT_DENIED}: this command mutates the git working tree/branch ` +
              `(checkout/switch/reset/restore/clean/stash/rebase/merge/cherry-pick/worktree or ` +
              `branch -d/-D), which Svarog — an in-tree leaf executor — must never do (it would ` +
              `move or rewrite the operator's worktree). Read-only git ` +
              `(status/log/diff/blame/show) is allowed. To create and switch to a ` +
              `convention-valid branch, use the create_branch tool — do NOT ESCALATE for ` +
              `branch creation. For any other branch/tree operation, return the ESCALATE ` +
              `result.`,
          )
        }
        return
      }

      // (2c) serena-editor carve-out — allowed BEFORE the floor (the floor's mutation-verb /
      // `_symbol` / `_content` / `_text_file` patterns would otherwise deny these refactor editors).
      // Memory writes (`_memory`) and the shell escape are NOT in the carve-out, so they fall to (4).
      if (SVAROG_SERENA_EDITORS.test(norm)) return

      // (3) headless leaf: `question` is denied (no isImmutableDeny pattern covers it).
      if (norm === "question") {
        throw new Error(
          `${TOOL_DENIED}: Svarog runs headless and has no \`question\` tool. A task that needs a ` +
            `decision is an ESCALATE, not a question — return the ESCALATE result with the open ` +
            `question in \`reason\`.`,
        )
      }

      // (3b) headless leaf: no network egress. Svarog is an in-tree executor; webfetch/websearch
      // are denied (Stribog parity). The deny-map is default-ALLOW, so this runtime check is the
      // load-bearing boundary — without it an action-biased model + an injected file would have a
      // native exfil channel the floor never inspects. (`curl` stays allowed as the sanctioned
      // Manual-QA-gate egress; this only removes the zero-friction native fetch tools.)
      if (norm === "webfetch" || norm === "websearch") {
        throw new Error(
          `${TOOL_DENIED}: Svarog is a leaf in-tree executor with no network egress (\`${raw}\` ` +
            `denied). If the task genuinely needs external data, return the ESCALATE result.`,
        )
      }

      // (3c) publish/branch carve-out.
      // create_pr — the sanctioned publish path (validated, argv-only, never force;
      // docs/specs/create-pr-tool.md). The bash mutating-git tripwire is unchanged; this
      // early-return only lets the plugin tool through the `create_` verb of the
      // isImmutableDeny floor (step 4).
      if (norm === "create_pr") return

      // create_branch — the sanctioned branch path (convention-validated, argv-only, no
      // shell; same-commit checkout — docs/specs/create-branch-tool-2.md §5.3). The bash
      // mutating-git tripwire is unchanged; this early-return only lets the plugin tool
      // through the `create_` verb of the isImmutableDeny floor (step 4).
      if (norm === "create_branch") return

      // (4) shared immutable floor, reused unchanged: shell-escape, dispatch/task, execute_recipe,
      // DB/DDL mutation verbs, serena `_memory` writes. (Bare `edit`/`write` are exempt by design;
      // they reach step 5 and are allowed.)
      if (isImmutableDeny(norm)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Svarog (capability class: ` +
            `secret-mint / dispatch / shell / DB-mutation / serena-memory-write). Svarog is a leaf ` +
            `executor — if the task requires this, return the ESCALATE result.`,
        )
      }

      // (5) allow-by-default: the multi-file editors, serena reads + diagnostics, skill loading, etc.
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (
        message.startsWith(TOOL_DENIED) ||
        message.startsWith(SECRET_DENIED) ||
        message.startsWith(GIT_DENIED)
      )
        throw error
      // never throw from a hook on internal / attribution errors (fail-open)
    }
  }

  const clearSession = (sessionID: string): void => {
    checkpointed.delete(sessionID)
  }

  return { hook, clearSession }
}
