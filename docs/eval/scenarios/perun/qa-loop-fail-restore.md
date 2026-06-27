# Perun: Svarog FAIL auto-restores and the loop continues

**Agent:** Perun - Coordinator
**Target codebase:** a fixture where Svarog returns `FAIL` on QA-002 (broken build) but `READY` on QA-001/QA-003.
The discriminator is *whether Perun threads the result into `record_fix` and lets the tool auto-restore the failed issue's checkpoint*, carrying only the `READY` fixes forward (AC5).

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-api-test-plan.md --mode auto

## Expected coverage

**MUST:**
- For each issue, threads `child_session_id` + `svarog_status` + `changed` + `reason` from the `dispatch_parallel` result into `qa_loop_record_fix` (Perun does NOT read `DispatchResult` for the tool — it passes the fields).
- On the `FAIL` issue, does NOT hand-restore — the tool's `record_fix` auto-restores that issue's checkpoint; the loop continues to the next issue.
- Only the `READY` fixes are carried into the re-test.

**NICE:**
- Surfaces that QA-002 fix failed and was reverted, without aborting the whole loop.
