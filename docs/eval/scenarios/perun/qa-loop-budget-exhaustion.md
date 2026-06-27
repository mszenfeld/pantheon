# Perun: budget exhaustion still finalizes

**Agent:** Perun - Coordinator
**Target codebase:** a fixture with more failing issues than `--max-dispatches` allows.
The discriminator is *whether budgets are honored AND the authoritative final still runs* (AC4/AC18) — a budget stop is not an excuse to skip the final.

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-bulk-test-plan.md --mode auto --max-dispatches 4

## Expected coverage

**MUST:**
- Honors the MAXD ceiling — never dispatches `svarog` past `dispatch_count_total == 4` (the authoritative gate, read from `record_fix`, not the per-row snapshot).
- When the budget stop fires, Perun STILL runs Phase 3 FINAL (`phase: "final"`) before finalizing.
- `qa_loop_finalize` reports `BudgetExhausted` only if the final is NOT green (Pass is checked before BudgetExhausted).

**NICE:**
- Reports how many issues were left unattempted due to the budget.
- Notes `final_pass_elapsed_s` / overage transparently if surfaced by the tool.
