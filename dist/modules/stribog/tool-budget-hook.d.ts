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
/** Drop a session's edit-budget state. Invoked from the plugin's `session.deleted` handler. */
declare function clearStribogSession(sessionID: string): void;
/** Test-only: clear all per-session state. */
declare function __resetStribogStateForTests(): void;
/**
 * Build the `tool.execute.before` handler enforcing, for a session positively attributed as
 * `stribog`: (1) the tool-name allow-list (deny anything outside STRIBOG_ALLOWED_TOOL_IDS),
 * and (2) the edit budget (at most STRIBOG_EDIT_BUDGET distinct files via edit/write).
 *
 * Fail-open by construction: non-stribog/unknown sessions and any internal/attribution error
 * pass the call through. Only the two intended denials throw (their markers re-thrown past the
 * internal-error guard so they reach the model as a tool-error part).
 */
declare function makeStribogToolHook(deps: StribogToolHookDeps): (input: StribogToolHookInput, output: StribogToolHookOutput) => Promise<void>;

export { type StribogToolHookDeps, type StribogToolHookInput, type StribogToolHookOutput, __resetStribogStateForTests, clearStribogSession, makeStribogToolHook };
