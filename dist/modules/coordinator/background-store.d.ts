interface BackgroundTask {
    id: string;
    childSessionId: string;
    parentSessionId: string;
    agent: string;
    startedAt: number;
}
/**
 * In-memory registry of running background tasks, keyed by task id and scoped
 * by parent session. Holds the parent->child mapping only — no results, no
 * proactive completion detection (status is derived at collect time by polling
 * the child session). Constructed once per coordinator plugin factory and shared
 * by the three background tools.
 */
declare class BackgroundTaskStore {
    private readonly tasks;
    register(task: BackgroundTask): void;
    get(id: string): BackgroundTask | undefined;
    listByParent(parentSessionId: string): BackgroundTask[];
    /**
     * Count this parent's *active* (registered-but-not-yet-collected) tasks.
     * The store holds no liveness state, so this counts every registered entry —
     * tasks that are still running AND tasks that finished but were never
     * collected. Collection (a successful `poll_background` or any
     * `wait_background` terminal outcome) calls `remove(id)`, so a completed task
     * stops counting the moment its result is retrieved. This is the number the
     * per-parent `BACKGROUND_MAX_CONCURRENT` cap is checked against: it bounds
     * uncollected fan-out (cost-DoS), not strictly concurrent execution.
     */
    countActiveByParent(parentSessionId: string): number;
    remove(id: string): void;
    removeByChild(childSessionId: string): void;
    clearParent(parentSessionId: string): void;
}

export { type BackgroundTask, BackgroundTaskStore };
