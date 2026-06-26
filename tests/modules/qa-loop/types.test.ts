import { describe, it, expectTypeOf } from "vitest"
import type {
  Sidecar, ScenarioRecord, IssueRecord, FixRecord, IterationRecord, Coverage,
  ScenarioKind, IssueStatus, SvarogStatus, IterationPhase, StopCause, RunResult, Mode, SeverityFloor,
} from "../../../src/modules/qa-loop/types.js"

describe("qa-loop sidecar contract", () => {
  it("exposes the load-bearing field names", () => {
    expectTypeOf<Sidecar["version"]>().toEqualTypeOf<1>()
    expectTypeOf<Sidecar["budgets"]["dispatch_count_total"]>().toEqualTypeOf<number>()
    expectTypeOf<Sidecar["budgets"]["iteration"]>().toEqualTypeOf<number>()
    expectTypeOf<Sidecar["result"]>().toEqualTypeOf<RunResult | null>()
    expectTypeOf<Sidecar["scenarios"]>().toEqualTypeOf<Record<string, ScenarioRecord>>()
    expectTypeOf<Sidecar["issues"]>().toEqualTypeOf<Record<string, IssueRecord>>()
    expectTypeOf<Sidecar["iterations"]>().toEqualTypeOf<IterationRecord[]>()
    expectTypeOf<IterationRecord["dispatches_this_iter"]>().toEqualTypeOf<number>()
    expectTypeOf<IssueRecord["fix"]>().toEqualTypeOf<FixRecord>()
    expectTypeOf<FixRecord["child_session_id"]>().toEqualTypeOf<string | null>()
    expectTypeOf<Coverage["not_verified"]["mutation-guard"]>().toEqualTypeOf<number>()
  })
  it("constrains the unions to their spec values", () => {
    expectTypeOf<ScenarioKind>().toEqualTypeOf<"feature" | "sanity" | "negative">()
    expectTypeOf<SvarogStatus>().toEqualTypeOf<"READY" | "FAIL" | "ESCALATE">()
    expectTypeOf<RunResult>().toEqualTypeOf<"Pass" | "Fail" | "BudgetExhausted" | "Stopped" | "NotVerified">()
    expectTypeOf<Mode>().toEqualTypeOf<"approve" | "auto" | "step">()
    expectTypeOf<SeverityFloor>().toEqualTypeOf<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">()
    expectTypeOf<IssueStatus>().toEqualTypeOf<"open" | "fix-attempted" | "fix-failed" | "deferred" | "fixed">()
    expectTypeOf<IterationPhase>().toEqualTypeOf<"selecting" | "awaiting_fix_gate" | "fixing" | "awaiting_retest_gate" | "retested" | "evaluated">()
    expectTypeOf<StopCause>().toEqualTypeOf<"zero-failure" | "regression" | "no-progress" | "all-deferred" | "max-iterations" | "max-dispatches" | "time-budget" | "user-abort" | "plan-tamper" | "checkpoint-integrity">()
  })
})
