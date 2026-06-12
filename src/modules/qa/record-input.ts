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

    // A name the plan declares as a recipe input is authorised by the
    // consented plan (its egress is validated and surfaced at consent time),
    // so it is exempt from the credential-PREFIX denylist — process-control
    // names (PATH, LD_*, …) stay denied regardless. This lets the user paste
    // legitimate inputs like SUPABASE_URL / SUPABASE_ANON_KEY in chat instead
    // of being forced to export them and restart.
    const declaredInputs = new Set(
      (deps.state.getBindings(parentID) ?? []).flatMap((b) => b.inputs),
    )
    const declaredInput = declaredInputs.has(args.name)

    const write = deps.store.writeBinding(
      parentID,
      args.name,
      args.value,
      "secret",
      "user-paste",
      { declaredInput },
    )
    if (write.status === "ok") return { status: "ok" }
    if (write.status === "duplicate") return { status: "ok" }
    return { status: "rejected", reason: write.reason }
  }
}
