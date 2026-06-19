const TRIGLAV_AGENT_KEY = "triglav";
const TRIGLAV_DESCRIPTION = "Read-only codebase explorer: maps structure, finds definitions/references/patterns via serena LSP (Grep/Glob fallback). Returns a synthesized answer, not edits.";
const triglavSpecialistInfo = {
  name: TRIGLAV_AGENT_KEY,
  mode: "subagent",
  description: TRIGLAV_DESCRIPTION,
  metadata: {
    keyTrigger: "2+ modules / unfamiliar area, or reviewing the changes/diff on a branch \u2192 fire `triglav` before planning",
    useWhen: [
      "Multiple search angles needed",
      "Unfamiliar module structure",
      "Cross-layer pattern discovery",
      "User asks where/how something works in the codebase",
      "User asks to review or summarize the changes/diff on a branch"
    ],
    avoidWhen: [
      "You already know the exact file/location",
      "A single keyword/grep suffices",
      "The target was just shown in this conversation"
    ],
    triggers: [
      {
        domain: "Code exploration",
        trigger: "Find definitions, references, structure, and patterns in the local codebase"
      },
      {
        domain: "Branch / diff review",
        trigger: "Review or summarize the changes on a branch (the diff vs base) before planning or testing"
      }
    ]
  }
};
export {
  TRIGLAV_AGENT_KEY,
  TRIGLAV_DESCRIPTION,
  triglavSpecialistInfo
};
