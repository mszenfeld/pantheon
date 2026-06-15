import { isAbsolute, resolve } from "node:path"
import {
  STRIBOG_AGENT_KEY,
  CORE_BUILTINS,
  STRIBOG_EDIT_BUDGET,
  isImmutableDeny,
  matchesExtraToolsPattern,
} from "./stribog.metadata.js"

const TOOL_DENIED = "STRIBOG_TOOL_DENIED"
const SCOPE_VIOLATION = "STRIBOG_SCOPE_VIOLATION"

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
}

export interface StribogToolHookInput {
  tool: string
  sessionID: string
  callID: string
}

export interface StribogToolHookOutput {
  args: { filePath?: unknown }
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
 * pattern, with the immutable capability-deny set winning over everything — and (2) the edit
 * budget (at most STRIBOG_EDIT_BUDGET distinct files via edit/write).
 *
 * `extraPatterns` defaults to `[]` (strict: CORE_BUILTINS only). It is populated from
 * `agents.stribog.extraTools` by the plugin wiring in `index.ts`; until that wiring lands the
 * extraTools allow-branch is inert and the boundary stays strict (fail-safe).
 *
 * Fail-open by construction: non-stribog/unknown sessions and any internal/attribution error
 * pass the call through. Only the two intended denials throw (their markers re-thrown past the
 * internal-error guard so they reach the model as a tool-error part).
 *
 * ORDER IS LOAD-BEARING (§3.3). The handler:
 *   (1) Pre-filters the 6 non-edit core builtins WITHOUT attribution (CORE_BUILTINS-only — adding
 *       extraPatterns here would skip the attribution gate and leak the conditional allow to every
 *       session, since the hook fails open for non-stribog).
 *   (2) Resolves attribution and FAILS OPEN for non-stribog / unresolved sessions.
 *   (3) THEN (confirmed stribog only) applies isImmutableDeny — gated behind attribution so a
 *       legitimate `execute_recipe` (zmora-setup) / `dispatch_*` (Perun/Veles) on a NON-stribog
 *       session, or during its own attribution-unresolved window, is never denied here.
 *   (4) Allows core builtins (edit/write fall through to the budget; the rest already returned at
 *       step 1) or a configured extraPattern match; otherwise denies.
 *   (5) Enforces the edit budget for edit/write.
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

  const extraPatterns = deps.extraPatterns ?? []

  const hook: StribogToolHook = async (input, output) => {
    try {
      // `raw` is the exact runtime id opencode emits (lowercase in practice). The RAW id drives
      // CORE_BUILTINS membership and the edit/write classification; a lowercased `denyKey` (below)
      // drives ONLY isImmutableDeny + extraPattern matching. See the factory docblock for why.
      const raw = input.tool
      const isEditWrite = raw === "edit" || raw === "write"

      // (1) Pre-filter — CORE_BUILTINS-ONLY. The 6 non-edit core builtins (read/glob/grep/bash)
      // always pass for a stribog session and are a no-op for everyone else, so there is nothing
      // to attribute: skip the (full-transcript) attribution call entirely, mirroring
      // coordinator-policy's `tool!=="bash"` bail. Do NOT add extraPatterns here — that would skip
      // the attribution gate below and leak the conditional allow to every (non-stribog) session.
      if (!isEditWrite && CORE_BUILTINS.has(raw)) return

      // (2) Attribution gate — every denial below is gated on a CONFIRMED stribog session. We fail
      // open for other/undefined agents AND, by being before the deny, for stribog's siblings whose
      // own legitimate ids (execute_recipe / dispatch_*) would otherwise trip isImmutableDeny.
      const agent = await deps.resolveAgent(input.sessionID)
      if (agent !== STRIBOG_AGENT_KEY) return // pass-through for other/undefined agents

      // ---- confirmed stribog from here ----
      const denyKey = raw.toLowerCase() // lowercased copy used ONLY for deny + extraPattern match

      // (3) Immutable capability-deny wins over any extraPattern (incl. a permissive glob). This is
      // defense-in-depth: the minter≠actuator invariant is held independently by execute_recipe's
      // own caller-gate. Attribution-gated (step 2) so it cannot fire for non-stribog callers.
      if (isImmutableDeny(denyKey)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is immutably denied for Stribog (capability class: ` +
            `secret-mint / dispatch / code-write / shell). No config can re-enable it. Stribog is ` +
            `a leaf actuator — if the task requires this, return the ESCALATE result.`,
        )
      }

      // (4) Allow core builtins (only edit/write reach here — the rest returned at step 1) → fall
      // through to the edit budget. Else allow a configured extraTools match (same trust class as
      // bash: no edit budget). Else deny: outside the allow-list AND the configured extraTools.
      if (!CORE_BUILTINS.has(raw)) {
        if (extraPatterns.some((p) => matchesExtraToolsPattern(p, denyKey))) {
          return // allowed MCP/extra tool — no edit-budget bookkeeping
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
        if (typeof filePath !== "string" || !isAbsolute(filePath)) return // fail-open: missing/relative
        const path = resolve(filePath)
        const set = pathsFor(input.sessionID)
        if (!set.has(path) && set.size >= STRIBOG_EDIT_BUDGET) {
          const alreadyModified = [...set].join(", ")
          throw new Error(
            `${SCOPE_VIOLATION}: edit budget exhausted (${STRIBOG_EDIT_BUDGET} distinct files ` +
              `already modified: ${alreadyModified}; refused: ${path}). This task exceeds ` +
              `Stribog's scope. Return the ESCALATE result now, listing the files you already ` +
              "touched in `reason`.",
          )
        }
        set.add(path)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (
        message.startsWith(TOOL_DENIED) ||
        message.startsWith(SCOPE_VIOLATION)
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
