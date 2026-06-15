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
/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
declare const STRIBOG_AGENT_KEY: "stribog";
/** Immutable deny — capability-aware, no config can re-enable. Named ids: minter + leaf-dispatch family.
 *  Invariant (locked by metadata.test.ts): IMMUTABLE_DENY_NAMED ⊆ keys(STRIBOG_DENIED_TOOLS). */
declare const IMMUTABLE_DENY_NAMED: ReadonlySet<string>;
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
declare const IMMUTABLE_DENY_PATTERNS: ReadonlyArray<RegExp>;
/** True if a normalized (lowercase) tool id is immutably denied (named OR capability-class).
 *
 *  Separator normalization (`-`→`_`): opencode 1.17.3 PRESERVES dashes in MCP ids
 *  (`serverKey_toolName`), but the named set and IMMUTABLE_DENY_PATTERNS are all
 *  underscore-segmented. Without this, kebab-case dangerous ids
 *  (serena_execute-shell-command, serena_write-memory, supabase_delete-rows, …) would
 *  slip past every pattern under a broad glob grant and ALLOW. Scoped to the DENY check
 *  ONLY — the extraTools match (matchesExtraToolsPattern) and the edit-budget paths stay
 *  on the raw id, so a granted dash-form id still matches its grant verbatim. */
declare function isImmutableDeny(normalizedId: string): boolean;
/** Validate one extraTools entry. Returns {valid:true} or {valid:false,error}. */
declare function validateExtraToolsPattern(pattern: string): {
    valid: true;
} | {
    valid: false;
    error: string;
};
/** Match a validated pattern (glob or exact) against a normalized id. */
declare function matchesExtraToolsPattern(pattern: string, normalizedId: string): boolean;

export { IMMUTABLE_DENY_NAMED, IMMUTABLE_DENY_PATTERNS, STRIBOG_AGENT_KEY, isImmutableDeny, matchesExtraToolsPattern, validateExtraToolsPattern };
