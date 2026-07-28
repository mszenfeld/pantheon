import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/**
 * Registered agent name for the Veles planning specialist — also its dispatch
 * identifier (used by `DISPATCHABLE_ALL_AGENTS` and Perun's no-plan dispatch).
 *
 * Mirrors Perun's "Name - Role" display-name convention (see
 * `coordinator/index.ts`): OpenCode has no separate display field, so the
 * `config.agent` KEY is what the TUI shows in the /agents picker, status bar,
 * and session label. Use space-dash-space — NEVER parentheses, which break the
 * `x-opencode-agent-name` HTTP header.
 *
 * NOTE: this is distinct from the pantheon.json config slug, which stays
 * lowercase `agents.veles.model` (read literally in `plan/index.ts`), exactly
 * as Perun's display key "Perun - Coordinator" pairs with `agents.perun`.
 */
export const VELES_AGENT_KEY = "Veles - Planner" as const

export const VELES_DESCRIPTION =
  "Planning specialist: authors feature specs, implementation plans, and QA test plans from a diff or request. Dispatches read-only helpers (triglav) and returns a saved artefact — it does not execute the planned work."

export const velesSpecialistInfo: SpecialistInfo = {
  name: VELES_AGENT_KEY,
  mode: "all",
  description: VELES_DESCRIPTION,
  metadata: {
    keyTrigger:
      "No durable planning artefact exists for the requested work → dispatch `veles` to author a feature spec, implementation plan, or QA test plan before execution",
    useWhen: [
      "No feature spec exists and the user wants to design a feature",
      "No implementation plan exists and the user wants to plan work from an approved spec or request",
      "No QA plan exists and the user wants to run QA",
      "User asks to plan any of the above from a diff/request",
    ],
    avoidWhen: [
      "A current feature spec already exists in docs/specs/ for the topic",
      "A current implementation plan already exists in docs/plans/ for the topic",
      "A current QA plan already exists in docs/testing/plans/",
      "The task is execution, not planning (dispatch stribog / svarog instead)",
    ],
    triggers: [
      {
        domain: "Planning",
        trigger: "Author a feature spec from a request or diff",
      },
      {
        domain: "Planning",
        trigger: "Author an implementation plan from an approved spec or request",
      },
      {
        domain: "Planning",
        trigger: "Author a QA test plan from a diff or request",
      },
    ],
  },
}
