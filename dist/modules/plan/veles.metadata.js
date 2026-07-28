const VELES_AGENT_KEY = "Veles - Planner";
const VELES_DESCRIPTION = "Planning specialist: authors feature specs, implementation plans, and QA test plans from a diff or request. Dispatches read-only helpers (triglav) and returns a saved artefact \u2014 it does not execute the planned work.";
const velesSpecialistInfo = {
  name: VELES_AGENT_KEY,
  mode: "all",
  description: VELES_DESCRIPTION,
  metadata: {
    keyTrigger: "No durable planning artefact exists for the requested work \u2192 dispatch `veles` to author a feature spec, implementation plan, or QA test plan before execution",
    useWhen: [
      "No feature spec exists and the user wants to design a feature",
      "No implementation plan exists and the user wants to plan work from an approved spec or request",
      "No QA plan exists and the user wants to run QA",
      "User asks to plan any of the above from a diff/request"
    ],
    avoidWhen: [
      "A current feature spec already exists in docs/specs/ for the topic",
      "A current implementation plan already exists in docs/plans/ for the topic",
      "A current QA plan already exists in docs/testing/plans/",
      "The task is execution, not planning (dispatch stribog / svarog instead)"
    ],
    triggers: [
      {
        domain: "Planning",
        trigger: "Author a feature spec from a request or diff"
      },
      {
        domain: "Planning",
        trigger: "Author an implementation plan from an approved spec or request"
      },
      {
        domain: "Planning",
        trigger: "Author a QA test plan from a diff or request"
      }
    ]
  }
};
export {
  VELES_AGENT_KEY,
  VELES_DESCRIPTION,
  velesSpecialistInfo
};
