// Canonical names of the coordinator's DISPATCH tools — the subset of
// `PERUN_TOOLS` that fan work out to specialist sessions (as opposed to the
// pure local helpers `assign_issue_ids` / `compute_waves`). Veles opts INTO
// exactly these via its `AgentConfig.tools` boolean map (see
// `src/modules/plan/index.ts`); enabling a name the coordinator never
// registered is a silent no-op that disables Veles's dispatch.
//
// Kept in a dependency-free file (no SDK / dispatch-runtime imports) so the
// `plan` module can import the canonical names WITHOUT pulling in the whole
// coordinator tool graph. `coordinator/index.ts` re-exports this and asserts
// every name is a member of `PERUN_TOOLS` (which is itself sync-tested against
// perun.md's `allowed-tools`), so a rename on either side fails a test instead
// of silently un-wiring Veles. See AGENTS.md "Plugin-tool enforcement model".
export const DISPATCH_TOOL_NAMES = [
  "dispatch_parallel",
  "dispatch_background",
  "poll_background",
  "wait_background",
] as const

export type DispatchToolName = (typeof DISPATCH_TOOL_NAMES)[number]
