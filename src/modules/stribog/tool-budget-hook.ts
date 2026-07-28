import { isAbsolute, resolve } from "node:path"
import {
  bareCommitDenialMessage,
  hasExplicitCommitFiles,
  unbudgetedCommitPathMessage,
} from "../_shared/commit-staging-scope.js"
import { isMutatingGitCommand } from "../_shared/mutating-git.js"
import {
  STRIBOG_AGENT_KEY,
  CORE_BUILTINS,
  STRIBOG_EDIT_BUDGET,
  isImmutableDeny,
  matchesExtraToolsPattern,
} from "./stribog.metadata.js"

const TOOL_DENIED = "STRIBOG_TOOL_DENIED"
const SCOPE_VIOLATION = "STRIBOG_SCOPE_VIOLATION"
const SECRET_DENIED = "STRIBOG_SECRET_DENIED"
const GIT_DENIED = "STRIBOG_GIT_DENIED"

// Bash secret-GENERATION tripwire (minter != actuator). Stribog's bash is otherwise a trusted host
// shell — general sub-command restriction (e.g. rm) is a deliberately deferred host-trust item, but
// TREE-mutating git is NO LONGER deferred: it is denied below (the 2026-06-18 role-discipline-eval
// footgun where a dispatched executor ran `git checkout` and moved the operator's worktree off
// master). Secret generation, however, is a hard security invariant the actuator must not cross: the
// 2026-06-16 eval caught both candidate models minting a JWT secret via bash (`node -e
// "...randomBytes..."`, `npm exec -- node -e "...randomBytes..."`). This pattern denies the natural
// secret-gen primitives — defense-in-depth BEHIND the hardened stribog.md refusal, NOT an
// adversarial sandbox (a determined model can still obfuscate; the prompt is the primary control,
// and the real boundary remains that secrets are minted by zmora-setup and never injected here).
// Tuned to match generation intent (random*/openssl rand/uuid/urandom/keygen/python-secrets), not
// incidental words like `Math.random()`.
const SECRET_GEN_BASH =
  /\bopenssl\s+(rand|genrsa|genpkey|ecparam)\b|\buuidgen\b|\/dev\/urandom\b|\brandom(bytes|uuid|fill)\b|\bsecrets\.token|\bos\.urandom\b|\buuid4\b|\bgpg\s+--(gen|full-gen)|\bssh-keygen\b/i

// Two families of denied tools that need REDIRECT guidance, not the generic "return the ESCALATE
// result" (the eval 2026-06-16 collision: a model hit one of these, got STRIBOG_TOOL_DENIED, and
// ESCALATEd instead of doing the task). They are STILL denied — the allow-list is unchanged and the
// tool never runs; only the guidance in the denial message changes. Matched on a dash-normalized
// lowercase id (opencode 1.17.3 can preserve dashes in tool ids).
//
// SKILL-META: skill/workflow-activation tools (superpowers `skill`, pantheon `load_appverk_skill`,
// `activate_skill`). A leaf actuator has no skill system; a "load a skill first" nudge does not
// apply — ignore it and CONTINUE.
const SKILL_META_TOOL = /(^|_)skills?($|_)/
// EDIT-EQUIVALENT: non-serena native editors a model may prefer over `edit`/`write` — OpenAI's
// `apply_patch` and the `str_replace*` editors. These cannot be cleanly per-file budgeted here
// (apply_patch can touch many files in one call), so they stay DENIED — but the guidance REDIRECTS
// to a budgeted editor, never escalate. (serena is handled separately in step 2c: it is an accepted
// toolset, with its single-file edits budgeted.) Genuinely out-of-lane immutable tools
// (shell/dispatch/recipe/secret-mint) do NOT match this and keep the ESCALATE guidance.
const EDIT_EQUIVALENT_TOOL = /(^|_)apply_?patch($|_)|str_replace/

// SERENA — an ACCEPTED code-intelligence toolset for Stribog (user decision 2026-06-16). Allowed in
// full EXCEPT: (a) the shell escape (`execute_shell_command` — Stribog runs ops via bash, never an
// MCP shell), and (b) inherently MULTI-file edits (`rename_symbol`/`safe_delete_symbol` rewrite
// references across files, exceeding the 2-file mechanical scope). Its SINGLE-file code edits are
// allowed but BUDGETED against the same STRIBOG_EDIT_BUDGET as edit/write (keyed on resolved
// `relative_path`). Read/navigation/memory tools are allowed, unbudgeted. Matched on the
// dash-normalized lowercase id.
const SERENA_PREFIX = /^serena_/
const SERENA_SHELL = /(^|_)(execute_shell(_command)?|shell(_command)?)$/
const SERENA_EDIT_MULTI = /(rename_symbol|safe_delete_symbol)$/
const SERENA_EDIT_SINGLE =
  /(create_text_file|replace_content|replace_regex|replace_symbol_body|insert_(after|before)_symbol)$/

/** Shared denial message redirecting a model from a non-budgetable editor (apply_patch/str_replace)
 *  to a budget-tracked editor. Mentions serena because it is now an accepted Stribog editor too. */
function editRedirectMessage(raw: string): string {
  return (
    `${TOOL_DENIED}: tool "${raw}" is not a budget-tracked Stribog editor. Make file changes with ` +
    `the \`edit\`/\`write\` tools (or serena's edit tools) instead — they ARE available to you and ` +
    `count toward your ${STRIBOG_EDIT_BUDGET}-file budget. Retry the change with one of those — do ` +
    `NOT return ESCALATE for this.`
  )
}

export interface StribogToolHookDeps {
  /** Resolve a session's agent key. Returns undefined when unknown (→ fail-open). */
  resolveAgent: (sessionID: string) => Promise<string | undefined>
  /**
   * Config-granted extraTools patterns (already validated by validateExtraToolsPattern).
   * A SEPARATE dynamic source layered on top of CORE_BUILTINS: for a confirmed `stribog`
   * session, a tool matching one of these (and not immutably denied) is allowed in the same
   * trust class as bash (no edit budget). Absent/empty ⇒ allow-list is CORE_BUILTINS only.
   */
  extraPatterns?: string[]
  /**
   * Root that relative paths resolve against — the session worktree, threaded from the plugin's
   * `PluginInput` (`worktree ?? directory`), mirroring `makeVelesPlanningWriteGate`. It MUST be
   * the same base `av_commit` stages with (`cwd: context.worktree ?? context.directory`), or the
   * edit budget and the commit's `files` would key on different origins and the membership check
   * would compare unrelated paths. Defaults to `process.cwd()`.
   */
  worktree?: string
}

export interface StribogToolHookInput {
  tool: string
  sessionID: string
  callID: string
}

export interface StribogToolHookOutput {
  args: {
    filePath?: unknown
    command?: unknown
    relative_path?: unknown
    path?: unknown
    files?: unknown
  }
}

/** The `tool.execute.before` handler signature this factory produces. */
export type StribogToolHook = (
  input: StribogToolHookInput,
  output: StribogToolHookOutput,
) => Promise<void>

export interface StribogToolHookHandle {
  /** The `tool.execute.before` handler enforcing the allow-list and edit budget. */
  hook: StribogToolHook
  /** Drop a session's edit-budget state. Invoked from the plugin's `session.deleted` handler. */
  clearSession: (sessionID: string) => void
}

/**
 * Build the `tool.execute.before` handler enforcing, for a session positively attributed as
 * `stribog`: (1) the tool-name allow-list — CORE_BUILTINS plus any config-granted extraTools
 * pattern, with the immutable capability-deny set winning over everything except the named
 * commit-module carve-outs at step 2d (the sanctioned publish chain) — and (2) the edit
 * budget (at most STRIBOG_EDIT_BUDGET distinct files via edit/write). The budget binds ONLY native
 * edit/write; a native edit/write whose filePath is missing or non-absolute is REFUSED (fail-closed)
 * since it cannot be keyed into the per-file budget. Write-capable extraTools are not budgeted — they
 * are denied upstream by the isImmutableDeny capability floor (step 3), never reaching the budget.
 *
 * `extraPatterns` defaults to `[]` (strict: CORE_BUILTINS only). The plugin wiring in `index.ts`
 * reads `agents.stribog.extraTools` and passes it in, so when that key is unconfigured the list is
 * empty and the extraTools allow-branch is a no-op — the boundary stays strict (fail-safe).
 *
 * Fail-open by construction for the ATTRIBUTION axis: non-stribog/unknown sessions and any
 * internal/attribution error pass the call through. Only the intended denials throw — the two
 * TOOL_DENIED branches (immutable capability-deny; outside-allow-list) and the SCOPE_VIOLATION
 * branch (edit budget exhausted OR a non-absolute edit/write filePath) — their markers re-thrown
 * past the internal-error guard so they reach the model as a tool-error part.
 *
 * ORDER IS LOAD-BEARING (§3.3). The handler:
 *   (1) Pre-filters the 6 non-edit core builtins WITHOUT attribution (CORE_BUILTINS-only — adding
 *       extraPatterns here would skip the attribution gate and leak the conditional allow to every
 *       session, since the hook fails open for non-stribog).
 *   (2) Resolves attribution and FAILS OPEN for non-stribog / unresolved sessions.
 *   (2c) (confirmed stribog only) serena family handling — single-file editors budgeted, reads
 *       unbudgeted (labeled "(2c)" in the body).
 *   (2d) (confirmed stribog only) commit-module publish-chain carve-out —
 *       `create_pr`/`create_branch`/`av_commit` early-returns (attribution-gated, unbudgeted;
 *       the sanctioned executor chain create_branch → av_commit → create_pr, 2026-07-22
 *       decision) — BEFORE steps 3-4, which would otherwise deny them (`create_` verb at
 *       step 3; allow-list at step 4).
 *   (3) THEN (confirmed stribog only) applies isImmutableDeny — gated behind attribution so a
 *       legitimate `execute_recipe` (zmora-setup) / `dispatch_*` (Perun/Veles) on a NON-stribog
 *       session, or during its own attribution-unresolved window, is never denied here.
 *   (4) Allows core builtins (edit/write fall through to the budget; the rest already returned at
 *       step 1) or a configured extraPattern match; otherwise denies.
 *   (5) Enforces the edit budget for edit/write — and REFUSES (fail-closed) a native edit/write
 *       whose filePath is missing/non-absolute, since such a call cannot be bound to the budget.
 *
 * RAW vs LOWERCASE split: CORE_BUILTINS membership and the edit/write budget are matched against
 * the RAW runtime id; a lowercased `denyKey` is used ONLY for isImmutableDeny + extraPattern
 * matching. This keeps capital `Edit` DENIED (not a raw builtin, not edit/write, not immutable,
 * not an extra pattern) while `Execute_Recipe`/`TASK` are still caught by isImmutableDeny.
 *
 * Per-session edit-path state is owned by this factory's closure (mirroring
 * `BackgroundTaskStore`, constructed once per plugin factory), so its lifetime is bound to the
 * plugin instance rather than the module/process. Each `makeStribogToolHook` call gets a fresh
 * map; tests achieve isolation by constructing a fresh hook (no module-global reset needed).
 * The returned `clearSession` is what the plugin's `session.deleted` handler calls.
 */
export function makeStribogToolHook(
  deps: StribogToolHookDeps,
): StribogToolHookHandle {
  /** Single resolution base for the budget keys AND the av_commit membership check. */
  const worktree = deps.worktree ?? process.cwd()
  /** Per-session set of distinct, resolved absolute paths modified via edit/write. */
  const editedPaths = new Map<string, Set<string>>()

  function pathsFor(sessionID: string): Set<string> {
    let set = editedPaths.get(sessionID)
    if (set === undefined) {
      set = new Set<string>()
      editedPaths.set(sessionID, set)
    }
    return set
  }

  /** Charge one resolved absolute path against the per-session edit budget. Shared by native
   *  edit/write (step 5) and serena single-file edits (step 2c) so a file edited via EITHER counts
   *  once and the 2-file blast-radius bound holds across both. Throws SCOPE_VIOLATION when a NEW
   *  path would exceed STRIBOG_EDIT_BUDGET; re-editing an already-charged path is always allowed. */
  function consumeFileBudget(sessionID: string, path: string): void {
    const set = pathsFor(sessionID)
    if (!set.has(path) && set.size >= STRIBOG_EDIT_BUDGET) {
      const alreadyModified = [...set].join(", ")
      throw new Error(
        `${SCOPE_VIOLATION}: edit budget exhausted (${STRIBOG_EDIT_BUDGET} distinct files ` +
          `already modified: ${alreadyModified}; refused: ${path}). This task exceeds Stribog's ` +
          "scope. Return the ESCALATE result now, listing the files you already touched in `reason`.",
      )
    }
    set.add(path)
  }

  const extraPatterns = deps.extraPatterns ?? []

  const hook: StribogToolHook = async (input, output) => {
    try {
      // `raw` is the exact runtime id opencode emits (lowercase in practice). The RAW id drives
      // CORE_BUILTINS membership and the edit/write classification; a lowercased `denyKey` (below)
      // drives ONLY isImmutableDeny + extraPattern matching. See the factory docblock for why.
      const raw = input.tool
      const isEditWrite = raw === "edit" || raw === "write"

      // (1) Pre-filter — read/glob/grep ONLY. These are allow-listed, not edit/write, and have
      // nothing to enforce, so skip the (full-transcript) attribution call. `bash` is deliberately
      // NOT pre-filtered here any more: it must be attributed so a stribog session's command can be
      // inspected for secret generation (step 2b). Do NOT add extraPatterns here — that would skip
      // the attribution gate below and leak the conditional allow to every (non-stribog) session.
      if (!isEditWrite && raw !== "bash" && CORE_BUILTINS.has(raw)) return

      // (2) Attribution gate — every denial below is gated on a CONFIRMED stribog session. We fail
      // open for other/undefined agents AND, by being before the deny, for stribog's siblings whose
      // own legitimate ids (execute_recipe / dispatch_*) would otherwise trip isImmutableDeny.
      const agent = await deps.resolveAgent(input.sessionID)
      if (agent !== STRIBOG_AGENT_KEY) return // pass-through for other/undefined agents

      // ---- confirmed stribog from here ----

      // (2b) Bash secret-generation tripwire. bash is an allow-listed builtin (it does not reach
      // the deny branches below — CORE_BUILTINS.has("bash") is true, and it is not edit/write), so
      // it would otherwise pass unconditionally. The ONE thing it must not do is MINT a secret
      // (minter != actuator). Deny the natural secret-gen commands; every other bash command passes
      // (the host-shell trust boundary is unchanged). The SECRET_DENIED marker re-throws past the
      // internal-error guard, same as the other markers.
      if (raw === "bash") {
        const command =
          typeof output.args?.command === "string" ? output.args.command : ""
        if (SECRET_GEN_BASH.test(command)) {
          throw new Error(
            `${SECRET_DENIED}: this command generates a secret/credential value, which is NOT ` +
              `Stribog's job — minting belongs to zmora-setup (minter != actuator). Do not mint, ` +
              `write, or echo a secret. Return the ESCALATE result and state that the value must ` +
              `be provided (or minted by zmora-setup) before you can actuate.`,
          )
        }
        if (isMutatingGitCommand(command)) {
          throw new Error(
            `${GIT_DENIED}: this command mutates the git working tree/branch ` +
              `(checkout/switch/reset/restore/clean/stash/rebase/merge/cherry-pick/worktree or ` +
              `branch -d/-D), which Stribog — a leaf actuator — must never do (it would move or ` +
              `rewrite the operator's worktree). Read-only git (status/log/diff/blame/show) is ` +
              `allowed. To create and switch to a convention-valid branch, use the ` +
              `create_branch tool — do NOT ESCALATE for branch creation. For any other ` +
              `branch/tree operation, return the ESCALATE result.`,
          )
        }
        return // bash otherwise allowed — host-shell trust boundary unchanged
      }

      // (2c) Serena — an accepted code-intelligence toolset for Stribog. Handled BEFORE the
      // immutable floor (step 3) because serena's edits would otherwise be denied there. Deny only
      // the shell escape and inherently multi-file edits; BUDGET single-file edits (shared budget
      // with edit/write); allow read/navigation/memory. Attribution-gated (step 2), so non-stribog
      // serena calls already passed through above.
      const norm = raw.toLowerCase().replace(/-/g, "_")
      if (SERENA_PREFIX.test(norm)) {
        if (SERENA_SHELL.test(norm)) {
          throw new Error(
            `${TOOL_DENIED}: tool "${raw}" is a serena shell escape — Stribog runs operations via ` +
              `bash, not an MCP shell. If the task genuinely needs it, return the ESCALATE result.`,
          )
        }
        if (SERENA_EDIT_MULTI.test(norm)) {
          throw new Error(
            `${TOOL_DENIED}: tool "${raw}" rewrites symbol references across multiple files, which ` +
              `exceeds Stribog's ${STRIBOG_EDIT_BUDGET}-file mechanical scope. Make the change in ` +
              `at most ${STRIBOG_EDIT_BUDGET} files with edit/write or a single-file serena edit, ` +
              `or return the ESCALATE result.`,
          )
        }
        if (SERENA_EDIT_SINGLE.test(norm)) {
          const rel = output.args?.relative_path ?? output.args?.path
          if (typeof rel !== "string" || rel.length === 0) {
            // Fail-closed (CWE-117: state by type, do not echo the value): a serena edit with no
            // bindable path cannot be budgeted, so refuse rather than pass it unaccounted.
            throw new Error(
              `${SCOPE_VIOLATION}: serena edit refused — no \`relative_path\` to bind to the edit ` +
                "budget. This task exceeds Stribog's scope. Return the ESCALATE result now.",
            )
          }
          consumeFileBudget(input.sessionID, resolve(worktree, rel))
          return // budgeted serena single-file edit — allowed
        }
        return // serena read / navigation / memory — allowed, unbudgeted
      }

      // (2d) commit-module publish-chain carve-out (see the factory docblock's order map).
      // create_pr — the sanctioned publish path (validated, argv-only, never force; push + PR
      // in one audited plugin tool — docs/specs/create-pr-tool.md). The bash mutating-git
      // tripwire and the commit plugin's block-push gate are unchanged; this early-return
      // exempts the tool from BOTH the `create_` verb of the isImmutableDeny floor (step 3)
      // AND the step-4 allow-list gate — which no extraTools config could grant instead
      // (validateExtraToolsPattern statically rejects `create_`-verb ids and `create_`-prefixed
      // globs; a broader covering glob like `cr*` passes config validation but the step-3
      // isImmutableDeny floor still wins over extraPatterns at runtime).
      // Unbudgeted: not an edit/write tool.
      if (norm === "create_pr") return

      // create_branch — the sanctioned branch path (convention-validated, argv-only, no
      // shell; same-commit checkout — docs/specs/create-branch-tool-2.md §5.3). The bash
      // mutating-git tripwire (git checkout denial) is unchanged; this early-return exempts
      // the plugin tool from both the `create_` verb of the isImmutableDeny floor (step 3)
      // and the step-4 allow-list gate (extraTools cannot grant `create_`-verb ids).
      // Unbudgeted: not an edit/write tool.
      if (norm === "create_branch") return

      // av_commit — the sanctioned commit path (controlled-commit: validated, staged-scope,
      // argv-only — src/modules/commit/). Executor-chain doctrine decision (2026-07-22):
      // attributed executors complete the full self-serve publish chain
      // create_branch → av_commit → create_pr. av_commit is NOT floor-denied (no `create_`
      // verb; `commit` is not a deny capability) — without this return it would fall only to
      // the step-4 allow-list denial (not in CORE_BUILTINS). Bash `git commit` stays blocked
      // by the commit plugin. Unbudgeted: not an edit/write tool.
      //
      // FAIL-CLOSED on staging scope: a bare av_commit falls back to `git add -A`
      // (controlled-commit.ts), so it is refused here — mirroring how an edit/write with no
      // bindable filePath is refused. The executor must name the paths it edited.
      // Scope is bound twice: the shared predicate rejects whole-tree pathspecs ("." / ":/" /
      // globs / traversal), and every named path must be one this session actually edited —
      // the edit budget is Stribog's authoritative blast radius, so a commit may not reach
      // past it.
      if (norm === "av_commit") {
        const files: unknown = output.args?.files
        if (!hasExplicitCommitFiles(files)) {
          throw new Error(bareCommitDenialMessage(SCOPE_VIOLATION, "Stribog"))
        }
        // EXACT membership, resolved on the same basis the budget itself uses
        // (`resolve(worktree, ...)` — the injected worktree, the same base av_commit stages
        // with). Never a suffix compare: `a.ts` must not satisfy an edited `/repo/src/a.ts`,
        // and a directory is rejected for free because it is never an edited file path.
        const edited = pathsFor(input.sessionID)
        for (const file of files) {
          if (!edited.has(resolve(worktree, file.trim()))) {
            throw new Error(
              unbudgetedCommitPathMessage(SCOPE_VIOLATION, file.trim(), [
                ...edited,
              ]),
            )
          }
        }
        return
      }

      const denyKey = raw.toLowerCase() // lowercased copy used ONLY for deny + extraPattern match

      // (3) Immutable capability-deny wins over any extraPattern (incl. a permissive glob). This is
      // defense-in-depth: the minter≠actuator invariant is held independently by execute_recipe's
      // own caller-gate. Attribution-gated (step 2) so it cannot fire for non-stribog callers.
      if (isImmutableDeny(denyKey)) {
        // An immutable-denied tool that is merely a non-serena alternate EDITOR (a `str_replace*`
        // editor caught here by the `replace` verb) must redirect to a budgeted editor, not
        // escalate — same intent as the apply_patch branch below. The tool stays DENIED; only the
        // guidance differs. (serena editors never reach here — they are handled in step 2c.)
        // Dangerous immutable tools (shell/dispatch/recipe/secret-mint) fall through to the generic
        // ESCALATE message.
        if (EDIT_EQUIVALENT_TOOL.test(denyKey.replace(/-/g, "_"))) {
          throw new Error(editRedirectMessage(raw))
        }
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Stribog (capability class: ` +
            `secret-mint / dispatch / code-write / shell). No config can re-enable it. Stribog is ` +
            `a leaf actuator — if the task requires this, return the ESCALATE result.`,
        )
      }

      // (4) Allow core builtins (only edit/write reach here — the rest returned at step 1) → fall
      // through to the edit budget. Else allow a configured extraTools match (same trust class as
      // bash: no edit budget). Else deny: outside the allow-list AND the configured extraTools.
      //
      // SCOPE OF THE EDIT BUDGET: it binds ONLY native `edit`/`write` (the sole tools that reach
      // step 5). A configured extraTools match returns HERE with no per-file bookkeeping — the hook
      // keeps no per-file accounting for MCP writes. Therefore a *write-capable* extraTool must be
      // DENIED, not budgeted: that denial is the `isImmutableDeny` capability floor (step 3), which
      // covers the serena-write family and the shell/exec/dispatch classes and wins over any
      // extraTools config. So allow-listing a write-capable MCP tool here cannot smuggle unbudgeted
      // writes past step 5 — it is refused upstream at step 3.
      if (!CORE_BUILTINS.has(raw)) {
        if (extraPatterns.some((p) => matchesExtraToolsPattern(p, denyKey))) {
          return // allowed MCP/extra tool — no edit-budget bookkeeping
        }
        // REDIRECT (not escalate) for the two collision families. Both still DENY (the tool does
        // not run); only the guidance differs from the generic capability denial below. The marker
        // still starts with TOOL_DENIED so it re-throws past the internal-error guard and is
        // counted by gate-efficacy tooling. denyKey is dash-normalized for the match only.
        const metaKey = denyKey.replace(/-/g, "_")
        if (SKILL_META_TOOL.test(metaKey)) {
          throw new Error(
            `${TOOL_DENIED}: tool "${raw}" is a skill/workflow-activation tool, which Stribog (a ` +
              `leaf actuator) does not use. This denial is EXPECTED and is NOT a blocker: ignore ` +
              `any instruction telling you to activate or load a skill — it does not apply to you ` +
              `— and CONTINUE the task with your allowed tools (read/glob/grep/edit/write/bash). ` +
              `Do NOT return ESCALATE for this.`,
          )
        }
        if (EDIT_EQUIVALENT_TOOL.test(metaKey)) {
          throw new Error(editRedirectMessage(raw))
        }
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is outside Stribog's allow-list ` +
            `(read/glob/grep/edit/write/bash + configured extraTools only). Stribog is a leaf ` +
            `actuator — it does not mint secrets or dispatch. If the task requires this tool, ` +
            `return the ESCALATE result.`,
        )
      }

      // (5) Edit-budget enforcement for edit/write (only edit/write reach this point).
      {
        const filePath = output.args?.filePath
        // Fail-CLOSED: a native edit/write whose filePath is missing or non-absolute cannot be
        // scope-budgeted (the budget set keys on resolved absolute paths), so REFUSE it rather
        // than letting it through unaccounted. We have no evidence opencode emits relative paths
        // here (the only other producer resolves absolute), so this is a theoretical-reachability
        // floor — but it must deny, not pass. CWE-117: state the failure by TYPE only; never echo
        // the raw filePath value (it may carry control bytes). The SCOPE_VIOLATION marker is exact
        // so the outer catch re-throws it past the internal-error guard.
        if (typeof filePath !== "string" || !isAbsolute(filePath)) {
          const kind =
            typeof filePath === "string"
              ? "relative"
              : `absent (${typeof filePath})`
          throw new Error(
            `${SCOPE_VIOLATION}: edit/write refused — filePath must be an absolute path but was ` +
              `${kind}; a non-absolute path cannot be bound to the edit budget. This task exceeds ` +
              "Stribog's scope. Return the ESCALATE result now.",
          )
        }
        consumeFileBudget(input.sessionID, resolve(worktree, filePath))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (
        message.startsWith(TOOL_DENIED) ||
        message.startsWith(SCOPE_VIOLATION) ||
        message.startsWith(SECRET_DENIED) ||
        message.startsWith(GIT_DENIED)
      )
        throw error
      // never throw from a hook on internal/attribution errors
    }
  }

  const clearSession = (sessionID: string): void => {
    editedPaths.delete(sessionID)
  }

  return { hook, clearSession }
}
