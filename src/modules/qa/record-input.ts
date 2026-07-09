import type { BindingsStore } from "./bindings-store.js"
import { MAX_DIALOG_ROUNDS, type QaRunState } from "./qa-run-state.js"

export interface RecordInputHandlerDeps {
  store: BindingsStore
  state: QaRunState
  resolveParentID: (sessionID: string) => Promise<string | undefined>
}

export interface RecordInputArgs {
  name: string
  value: string
}

export type RecordInputResult =
  | { status: "ok" }
  | { status: "updated" }
  | { status: "rejected"; reason: string }

export interface RecordInputContext {
  sessionID: string
  agent?: string
}

export function makeRecordInputHandler(
  deps: RecordInputHandlerDeps,
): (
  args: RecordInputArgs,
  ctx: RecordInputContext,
) => Promise<RecordInputResult> {
  return async (args, ctx) => {
    const parentID =
      (await deps.resolveParentID(ctx.sessionID)) ?? ctx.sessionID

    // Enforce the mid-run dialog round cap deterministically.
    // The spec in `src/agents/perun.md` caps Perun's NAME=value request loop
    // at 3 rounds; counting in code (rather than only in the prompt) means
    // the cap holds even if the LLM miscounts or is jailbroken into trying
    // again. A round is defined as: one or more `record_input` calls between
    // the last `endDialogRound` (signalled by `execute_recipe`) and the next.
    const round = deps.state.incrementDialogRoundOnFirstInput(parentID)
    if (round > MAX_DIALOG_ROUNDS) {
      return {
        status: "rejected",
        reason: `dialog_round_exceeded: max ${MAX_DIALOG_ROUNDS} rounds per QA run`,
      }
    }

    // A name the plan DECLARES is authorised by the consented plan, so it is
    // exempt from the credential-PREFIX denylist — process-control names (PATH,
    // LD_*, …) stay denied regardless (their denylist has no exemption). Two
    // declaration forms count, both surfaced to the user at consent time:
    //   1. a minted binding's `Inputs:` ($VARs its egress-validated recipe
    //      consumes), parsed by `parse_plan`; and
    //   2. a `**Required environment variables:**` NAME, captured when Perun
    //      calls `preflight({ env })` (which runs BEFORE the paste dialog).
    // Form (2) is what lets the user paste a plain prerequisite like
    // SUPABASE_URL / SUPABASE_ANON_KEY / DATABASE_URL in chat — values declared
    // as Required env vars but NOT consumed by any recipe — instead of being
    // forced to export them and restart. Without it the documented
    // "paste in chat, no restart" path is impossible for any credential-prefixed
    // prerequisite. See preflight.ts (the persistence side) and qa-run-state.ts.
    const declaredInputs = new Set(
      (deps.state.getBindings(parentID) ?? []).flatMap((b) => b.inputs),
    )
    const declaredInput =
      declaredInputs.has(args.name) ||
      deps.state.getDeclaredEnv(parentID).has(args.name)

    const write = deps.store.writeBinding(
      parentID,
      args.name,
      args.value,
      "secret",
      "user-paste",
      { declaredInput },
    )
    if (write.status === "ok") return { status: "ok" }
    // A corrected re-paste of an already-recorded name REPLACED the stale
    // value — surfaced distinctly so Perun can confirm the fix landed instead
    // of silently believing the first (bad) value is still live.
    if (write.status === "updated") return { status: "updated" }
    // A byte-identical re-paste is a true no-op; report it as ok (idempotent).
    if (write.status === "duplicate") return { status: "ok" }
    // "immutable" (a paste may not overwrite a minted/pinned value) and "error"
    // both carry a reason and surface as an honest rejection — never as ok.
    return { status: "rejected", reason: write.reason }
  }
}
