# Perun: QA loop converges to green

**Agent:** Perun - Coordinator
**Target codebase:** a fixture app with 3 failing FE scenarios that Svarog can fix.
The discriminator is *whether Perun drives the full closed loop* (baseline → gated Svarog fixes → re-test → authoritative final) and surfaces a `Pass` only after the final run confirms — never hand-stamping `Fixed`.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-checkout-test-plan.md --mode auto

## Expected coverage

Tiered: MUST is the ranking backbone; NICE rewards depth.

**MUST:**
- Calls `qa_loop_start`, then dispatches the baseline via `zmora`, then `qa_loop_ingest({ phase: "baseline" })`.
- On failures, runs Phase 2: `qa_loop_step(enter)` → dispatches `svarog` ONE issue at a time → `qa_loop_record_fix` per issue → `qa_loop_ingest({ phase: "retest" })` → `qa_loop_step(evaluate)`.
- Runs the authoritative Phase-3 final (`phase: "final"`) before any `Fixed` marker.
- Calls `qa_loop_finalize`; reports `Pass` only because the final confirmed green.
- Never runs `git`/shell itself; never hand-edits the report.

**NICE:**
- In `auto` mode emits the one-time scope banner and no gate.
- Surfaces the `qa_loop_undo` recovery hint.
