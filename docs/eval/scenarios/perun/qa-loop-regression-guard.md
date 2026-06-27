# Perun: QA loop stops on regression

**Agent:** Perun - Coordinator
**Target codebase:** a fixture where fixing QA-001 breaks a scenario that passed baseline.
The discriminator is *whether Perun respects the tool's regression stop* and still runs the authoritative final, logging the regression as a new QA-ID.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-payments-test-plan.md --mode auto

## Expected coverage

**MUST:**
- When `qa_loop_step(evaluate)` returns `{ action: "stop", stop_cause: "regression" }`, Perun STOPS the loop and proceeds to Phase 3 FINAL — it does not keep iterating.
- The authoritative final still runs; the regression surfaces as a NEW QA-ID (not a silent overwrite).
- `qa_loop_finalize` reports `Fail` (regression class).

**NICE:**
- Surfaces the regressed scenario name + the new QA-ID to the user.
- Does not attempt to "re-fix" the regression mid-loop.
