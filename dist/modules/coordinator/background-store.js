class BackgroundTaskStore {
  tasks = /* @__PURE__ */ new Map();
  register(task) {
    this.tasks.set(task.id, task);
  }
  get(id) {
    return this.tasks.get(id);
  }
  listByParent(parentSessionId) {
    return [...this.tasks.values()].filter(
      (t) => t.parentSessionId === parentSessionId
    );
  }
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
  countActiveByParent(parentSessionId) {
    return this.listByParent(parentSessionId).length;
  }
  remove(id) {
    this.tasks.delete(id);
  }
  removeByChild(childSessionId) {
    for (const [id, t] of this.tasks) {
      if (t.childSessionId === childSessionId) this.tasks.delete(id);
    }
  }
  clearParent(parentSessionId) {
    for (const [id, t] of this.tasks) {
      if (t.parentSessionId === parentSessionId) this.tasks.delete(id);
    }
  }
}
export {
  BackgroundTaskStore
};
