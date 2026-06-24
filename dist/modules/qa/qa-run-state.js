const MAX_DIALOG_ROUNDS = 3;
const EMPTY_DECLARED_ENV = /* @__PURE__ */ new Set();
function makeEmptyRecord(plan = []) {
  return {
    plan,
    dialogRound: 0,
    dialogRoundInProgress: false,
    recipeAttempts: /* @__PURE__ */ new Map(),
    declaredEnv: /* @__PURE__ */ new Set()
  };
}
class QaRunState {
  #map = /* @__PURE__ */ new Map();
  storePlan(parentID, bindings) {
    const existing = this.#map.get(parentID);
    if (existing !== void 0) {
      existing.plan = bindings;
      return;
    }
    this.#map.set(parentID, makeEmptyRecord(bindings));
  }
  getBindings(parentID) {
    return this.#map.get(parentID)?.plan;
  }
  /**
   * Record env-var NAMES the plan declares as required (the `env` argument of a
   * `preflight` call). Merged into the run's declared-env set, which
   * `record_input` consults to exempt plan-declared prerequisites from the
   * credential-prefix denylist. Idempotent, and materialises the run record if
   * absent so a `preflight` that runs before any other state write still
   * persists (the documented flow runs preflight BEFORE the paste dialog).
   */
  addDeclaredEnv(parentID, names) {
    let r = this.#map.get(parentID);
    if (r === void 0) {
      r = makeEmptyRecord();
      this.#map.set(parentID, r);
    }
    for (const name of names) r.declaredEnv.add(name);
  }
  /**
   * Names recorded via `addDeclaredEnv` for this run (an empty set when the
   * parent has no record). Read by `record_input`'s denylist exemption.
   */
  getDeclaredEnv(parentID) {
    return this.#map.get(parentID)?.declaredEnv ?? EMPTY_DECLARED_ENV;
  }
  getDialogRound(parentID) {
    return this.#map.get(parentID)?.dialogRound ?? 0;
  }
  incrementDialogRound(parentID) {
    let r = this.#map.get(parentID);
    if (r === void 0) {
      r = makeEmptyRecord();
      this.#map.set(parentID, r);
    }
    r.dialogRound++;
    return r.dialogRound;
  }
  /**
   * Increment the dialog round counter exactly once per logical round —
   * the first `record_input` call after either run start or the previous
   * round being ended by `endDialogRound`. Subsequent calls within the
   * same round return the current counter without incrementing it.
   *
   * Returns the dialog round number the caller is now part of. Callers
   * compare against `MAX_DIALOG_ROUNDS` to decide whether to refuse the
   * write.
   */
  incrementDialogRoundOnFirstInput(parentID) {
    let r = this.#map.get(parentID);
    if (r === void 0) {
      r = makeEmptyRecord();
      this.#map.set(parentID, r);
    }
    if (!r.dialogRoundInProgress) {
      r.dialogRound++;
      r.dialogRoundInProgress = true;
    }
    return r.dialogRound;
  }
  /**
   * Mark the current dialog round as ended. The next `record_input` call
   * will start a new round (and increment the counter). Called by
   * `execute_recipe` because re-dispatching to zmora-setup is the natural
   * signal that the round has concluded.
   *
   * No-op when no round is in progress or the parent has no state. Safe
   * to call repeatedly.
   */
  endDialogRound(parentID) {
    const r = this.#map.get(parentID);
    if (r === void 0) return;
    r.dialogRoundInProgress = false;
  }
  getRecipeAttempts(parentID, bindingName) {
    return this.#map.get(parentID)?.recipeAttempts.get(bindingName) ?? 0;
  }
  incrementRecipeAttempt(parentID, bindingName) {
    let r = this.#map.get(parentID);
    if (r === void 0) {
      r = makeEmptyRecord();
      this.#map.set(parentID, r);
    }
    const next = (r.recipeAttempts.get(bindingName) ?? 0) + 1;
    r.recipeAttempts.set(bindingName, next);
    return next;
  }
  clearRun(parentID) {
    this.#map.delete(parentID);
  }
}
export {
  MAX_DIALOG_ROUNDS,
  QaRunState
};
