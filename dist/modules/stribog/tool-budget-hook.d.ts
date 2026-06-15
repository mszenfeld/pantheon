interface StribogToolHookDeps {
    /** Resolve a session's agent key. Returns undefined when unknown (→ fail-open). */
    resolveAgent: (sessionID: string) => Promise<string | undefined>;
    /**
     * Config-granted extraTools patterns (already validated by validateExtraToolsPattern).
     * A SEPARATE dynamic source layered on top of CORE_BUILTINS: for a confirmed `stribog`
     * session, a tool matching one of these (and not immutably denied) is allowed in the same
     * trust class as bash (no edit budget). Absent/empty ⇒ allow-list is CORE_BUILTINS only.
     */
    extraPatterns?: string[];
}
interface StribogToolHookInput {
    tool: string;
    sessionID: string;
    callID: string;
}
interface StribogToolHookOutput {
    args: {
        filePath?: unknown;
    };
}
/** The `tool.execute.before` handler signature this factory produces. */
type StribogToolHook = (input: StribogToolHookInput, output: StribogToolHookOutput) => Promise<void>;
interface StribogToolHookHandle {
    /** The `tool.execute.before` handler enforcing the allow-list and edit budget. */
    hook: StribogToolHook;
    /** Drop a session's edit-budget state. Invoked from the plugin's `session.deleted` handler. */
    clearSession: (sessionID: string) => void;
}
/**
 * Build the `tool.execute.before` handler enforcing, for a session positively attributed as
 * `stribog`: (1) the tool-name allow-list — CORE_BUILTINS plus any config-granted extraTools
 * pattern, with the immutable capability-deny set winning over everything — and (2) the edit
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
declare function makeStribogToolHook(deps: StribogToolHookDeps): StribogToolHookHandle;

export { type StribogToolHook, type StribogToolHookDeps, type StribogToolHookHandle, type StribogToolHookInput, type StribogToolHookOutput, makeStribogToolHook };
