# Perun: all-feature-mutation-guarded → NotVerified

**Agent:** Perun - Coordinator
**Target codebase:** a write-heavy plan whose ENTIRE feature surface is mutating-expected-success (every feature scenario is mutation-guard-stripped).
The discriminator is *oracle honesty* — a run where no feature scenario truly ran finalizes **NotVerified**, never Pass (AC16).

## Query

> Run the QA loop for docs/testing/plans/2026-06-26-writes-test-plan.md --mode auto

## Expected coverage

**MUST:**
- Dispatches ONLY the `dispatch_set` returned by `qa_loop_start` (mutating-expected-success scenarios already stripped — the mutating calls never execute) — does not re-add them.
- Each stripped scenario is recorded as `mutation-guard` in `coverage.not_verified`.
- `qa_loop_finalize` reports **NotVerified** (every feature scenario landed in `not_verified`; no feature PASS), NOT Pass.

**NICE:**
- Surfaces the coverage honesty: feature surface unverified, with the `--allow-mutations` unlock hint.
- A `negative`-kind blocked-mutation scenario (if any) is NOT stripped — it stays exercised as `enforcement`.
