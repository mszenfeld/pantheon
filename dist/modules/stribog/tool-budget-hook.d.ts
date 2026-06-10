interface StribogToolHookDeps {
    /** Resolve a session's agent key. Returns undefined when unknown (→ fail-open). */
    resolveAgent: (sessionID: string) => Promise<string | undefined>;
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
 * `stribog`: (1) the tool-name allow-list (deny anything outside STRIBOG_ALLOWED_TOOL_IDS),
 * and (2) the edit budget (at most STRIBOG_EDIT_BUDGET distinct files via edit/write).
 *
 * Fail-open by construction: non-stribog/unknown sessions and any internal/attribution error
 * pass the call through. Only the two intended denials throw (their markers re-thrown past the
 * internal-error guard so they reach the model as a tool-error part).
 *
 * Per-session edit-path state is owned by this factory's closure (mirroring
 * `BackgroundTaskStore`, constructed once per plugin factory), so its lifetime is bound to the
 * plugin instance rather than the module/process. Each `makeStribogToolHook` call gets a fresh
 * map; tests achieve isolation by constructing a fresh hook (no module-global reset needed).
 * The returned `clearSession` is what the plugin's `session.deleted` handler calls.
 */
declare function makeStribogToolHook(deps: StribogToolHookDeps): StribogToolHookHandle;

export { type StribogToolHook, type StribogToolHookDeps, type StribogToolHookHandle, type StribogToolHookInput, type StribogToolHookOutput, makeStribogToolHook };
