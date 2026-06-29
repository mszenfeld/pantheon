# Perun: checkpoint-integrity abort

**Agent:** Perun - Coordinator
**Target codebase:** a fixture where a `READY` reports `changed[]` but its `refs/svarog/ckpt/<id>` is missing.
The discriminator is *whether Perun honors the tool's `checkpoint-integrity` stop* — stopping without auto-restoring the untrusted ref and surfacing it (AC14), rather than continuing blindly.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-orders-test-plan.md --mode auto

## Expected coverage

**MUST:**
- When `qa_loop_record_fix` returns `{ stop_cause: "checkpoint-integrity" }`, Perun STOPS the loop and goes to Phase 3 FINAL — it does NOT auto-restore the missing/stale ref or keep dispatching.
- Surfaces the checkpoint-integrity stop to the user.
- `qa_loop_finalize` reports `Stopped`.

**NICE:**
- Recommends `qa_loop_undo` for total recovery.
- Does not guess or re-dispatch the orphaned issue.
