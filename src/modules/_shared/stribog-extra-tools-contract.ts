/**
 * Neutral shared leaf for the Stribog extraTools / immutable-deny CONTRACT.
 *
 * Extracted from `stribog/stribog.metadata.ts` so the load-time config layer
 * (`pantheon-config/schema.ts`) and the runtime tool hook
 * (`stribog/tool-budget-hook.ts`) depend on the SAME testable contract WITHOUT
 * the generic "pure" config layer importing the stribog feature module (ARCH-001
 * — inverted DIP). Mirrors `coordinator/dispatch-tool-names.ts`: a dependency-light
 * leaf both sides can import.
 *
 * Dependency direction: this file imports ONLY `DISPATCH_TOOL_NAMES` from the
 * coordinator leaf (leaf→leaf, no cycle). It MUST NOT import from `../stribog/`
 * or `../pantheon-config/`. `stribog.metadata.ts` re-exports every symbol here so
 * existing consumers keep importing the contract from `stribog.metadata.js`
 * unchanged.
 */

import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js"

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
export const STRIBOG_AGENT_KEY = "stribog" as const

/** Immutable deny — capability-aware, no config can re-enable. Named ids: minter + leaf-dispatch family.
 *  Invariant (locked by metadata.test.ts): IMMUTABLE_DENY_NAMED ⊆ keys(STRIBOG_DENIED_TOOLS). */
export const IMMUTABLE_DENY_NAMED: ReadonlySet<string> = new Set([
  "execute_recipe",
  "task", // opencode-native leaf dispatch; NOT in DISPATCH_TOOL_NAMES, so explicit
  ...DISPATCH_TOOL_NAMES,
])

/** Capability-class deny patterns (segment-anchored; matched against the normalized lowercase id).
 *  Prefix/server-key agnostic so serena_*, serena2_*, etc. are all covered.
 *
 *  NOTE on the mutation-verb pattern — true scope (NOT exhaustive): it denies a KNOWN, ENUMERATED
 *  set of write verbs (write/create/replace/insert/rename/delete/move/edit/update/upsert plus the
 *  DDL verbs drop/truncate/alter and the privilege verb grant) when they appear as a WHOLE segment
 *  of the id (order-agnostic — see the split-anchor note on the pattern below for why bare
 *  single-segment `edit`/`write` are exempt), so both `serena_write_memory` and a verb-after-noun
 *  id like `supabase_rows_delete` are caught. It is deliberately NOT a complete blocklist of every
 *  write-capable tool and does NOT "catch any write-capable MCP": a tool whose mutating segment is
 *  not in the verb set (or expresses mutation without one of these verbs) passes this floor. The
 *  REAL control for data-MCP writes is the least-privilege DB role the operator configures (spec
 *  decision: least-privilege, not an exhaustive verb list); this pattern is cheap defense-in-depth.
 *
 *  Because the set is server-agnostic, it also denies a data-MCP's structured row-mutation tools
 *  (supabase_insert_rows, supabase_delete_rows, supabase_update_rows, …). That is intended: the
 *  supported DB-fixture mutation path is `supabase_execute_sql` (a SQL string — `execute` is NOT a
 *  mutation verb, so it passes). Grant `supabase_execute_sql` (exact, or via the `supabase_*` glob)
 *  — not the structured verb-named write tools. Over-denial is the safe failure mode for a security
 *  floor; the false-negative direction (letting a shell/code-write through) is not. */
export const IMMUTABLE_DENY_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|_)execute_shell(_command)?$/i,
  /(^|_)shell(_command)?$/i,
  /(^|_)dispatch(_|$)/i,
  /(^|_)recipe(_|$)/i,
  /^task(_|$)/i, // task_* and bare task
  /(^|_)task$/i, // *_task — trailing leaf-dispatch segment (§3.4 `*_task`)
  // Mutation/DDL/privilege verbs as a WHOLE segment, order-agnostic: verb in a non-final segment
  // (`write_*`, `*_delete_*`) OR verb as the trailing segment (`*_delete`, `supabase_rows_delete`).
  // The split anchor (`verb_` | `_verb$`) is load-bearing: it MUST NOT match the bare single-segment
  // ids `edit`/`write` — those are CORE_BUILTINS that have to fall through this deny floor to the
  // edit-budget path in tool-budget-hook.ts. `(^|_)verb(_|$)` would wrongly match bare edit/write
  // and brick Stribog's only side-effect tools. See NOTE above for scope.
  /(^|_)(write|create|replace|insert|rename|delete|move|edit|update|upsert|drop|truncate|alter|grant)_|_(write|create|replace|insert|rename|delete|move|edit|update|upsert|drop|truncate|alter|grant)$/i,
  /_(memory|symbol|symbol_body|content|text_file)$/i, // serena write-targets (`content` = serena_replace_content)
]

/** True if a normalized (lowercase) tool id is immutably denied (named OR capability-class).
 *
 *  Separator normalization (`-`→`_`): opencode 1.17.3 PRESERVES dashes in MCP ids
 *  (`serverKey_toolName`), but the named set and IMMUTABLE_DENY_PATTERNS are all
 *  underscore-segmented. Without this, kebab-case dangerous ids
 *  (serena_execute-shell-command, serena_write-memory, supabase_delete-rows, …) would
 *  slip past every pattern under a broad glob grant and ALLOW. Scoped to the DENY check
 *  ONLY — the extraTools match (matchesExtraToolsPattern) and the edit-budget paths stay
 *  on the raw id, so a granted dash-form id still matches its grant verbatim. */
export function isImmutableDeny(normalizedId: string): boolean {
  const sep = normalizedId.replace(/-/g, "_")
  return (
    IMMUTABLE_DENY_NAMED.has(sep) ||
    IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(sep))
  )
}

/** Validate one extraTools entry. Returns {valid:true} or {valid:false,error}. */
export function validateExtraToolsPattern(
  pattern: string,
): { valid: true } | { valid: false; error: string } {
  if (!/^[a-z0-9_-]+\*?$/.test(pattern)) {
    return {
      valid: false,
      error: "must be lowercase alnum/_/-, optional single trailing *",
    }
  }
  if (pattern === "*") return { valid: false, error: "bare * not allowed" }
  // Exact id: reject if statically denied (named OR capability-class), so config-load agrees with
  // the runtime hook floor — no silent config-pass-then-runtime-deny (e.g. `supabase_delete_rows`).
  if (!pattern.endsWith("*") && isImmutableDeny(pattern)) {
    return { valid: false, error: `denied id: ${pattern}` }
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    // Glob: reject only statically-provable collisions. Broad globs (serena_*) are accepted here
    // per §3.5; their dangerous children are denied at runtime by isImmutableDeny.
    for (const deniedId of IMMUTABLE_DENY_NAMED) {
      if (deniedId.startsWith(prefix)) {
        return {
          valid: false,
          error: `glob ${pattern} would cover denied id ${deniedId}`,
        }
      }
    }
    if (IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(prefix))) {
      return {
        valid: false,
        error: `glob ${pattern} prefix matches a denied capability class`,
      }
    }
  }
  return { valid: true }
}

/** Match a validated pattern (glob or exact) against a normalized id. */
export function matchesExtraToolsPattern(
  pattern: string,
  normalizedId: string,
): boolean {
  return pattern.endsWith("*")
    ? normalizedId.startsWith(pattern.slice(0, -1))
    : normalizedId === pattern
}
