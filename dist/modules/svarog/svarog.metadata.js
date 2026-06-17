const SVAROG_AGENT_KEY = "svarog";
const DEFAULT_SVAROG_MODEL = "openai/gpt-5.4";
const SVAROG_DESCRIPTION = "Heavy/main code executor: implements a multi-file feature or refactor from a plan or task \u2014 writes code test-first, runs the full suite/build, and returns a verified diff with a recoverable checkpoint. Stops at READY (does not commit). NOT for trivial 1-2 file mechanical changes (use stribog), secrets (use zmora-setup), or work needing an unsettled design decision (plan with veles).";
const SVAROG_SERENA_EDITORS = /(create_text_file|replace_content|replace_regex|replace_symbol_body|insert_(after|before)_symbol|rename_symbol|safe_delete_symbol)$/;
const SVAROG_DENIED_TOOLS = {
  task: false,
  execute_recipe: false,
  dispatch_parallel: false,
  dispatch_background: false,
  poll_background: false,
  wait_background: false,
  question: false
};
const svarogSpecialistInfo = {
  name: SVAROG_AGENT_KEY,
  mode: "subagent",
  description: SVAROG_DESCRIPTION,
  metadata: {
    keyTrigger: "A multi-file feature/refactor to implement from a plan -> dispatch `svarog`",
    useWhen: [
      "Implement a planned feature across multiple files (write code, run the full test suite)",
      "Carry out a multi-file or cross-symbol refactor that is already designed",
      "Apply a Veles plan end-to-end and return a verified diff"
    ],
    avoidWhen: [
      "A trivial 1-2 file mechanical change or environment bring-up (use stribog)",
      "Producing or refreshing a secret/credential value (use zmora-setup)",
      "The design/approach is unsettled or ambiguous (plan with veles first)"
    ],
    triggers: [
      {
        domain: "Feature implementation",
        trigger: "Build a planned multi-file feature, verify with the full suite, return a diff"
      },
      {
        domain: "Refactor",
        trigger: "Carry out a designed multi-file / cross-symbol refactor and verify it"
      }
    ],
    workflowContribution: "For multi-file feature/refactor work that needs the full toolset (edit many files, run the suite), dispatch `svarog` (the heavy/main executor). For a trivial 1-2 file mechanical change or environment bring-up, use `stribog`; if the design is unsettled, plan with `veles` first. Svarog stops at READY with a verified diff and does not commit -- review the diff, then the user runs `/commit`."
  }
};
export {
  DEFAULT_SVAROG_MODEL,
  SVAROG_AGENT_KEY,
  SVAROG_DENIED_TOOLS,
  SVAROG_DESCRIPTION,
  SVAROG_SERENA_EDITORS,
  svarogSpecialistInfo
};
