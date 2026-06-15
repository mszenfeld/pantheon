import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js";
const STRIBOG_AGENT_KEY = "stribog";
const DEFAULT_STRIBOG_MODEL = "openai/gpt-5.4";
const STRIBOG_DESCRIPTION = "Light execution specialist: performs ONE small, mechanical task with real side effects \u2014 bring up/fix a service, restart, read logs, or a 1\u20132 file config/value change \u2014 then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor). EXPERIMENTAL (Phase 1): no automatic edit-recovery yet \u2014 a botched edit cannot be auto-restored.";
const STRIBOG_EDIT_BUDGET = 2;
const CORE_BUILTINS = /* @__PURE__ */ new Set([
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "bash"
]);
const STRIBOG_DENIED_TOOLS = {
  task: false,
  execute_recipe: false,
  dispatch_parallel: false,
  dispatch_background: false,
  poll_background: false,
  wait_background: false,
  todowrite: false,
  webfetch: false,
  websearch: false
};
const IMMUTABLE_DENY_NAMED = /* @__PURE__ */ new Set([
  "execute_recipe",
  "task",
  // opencode-native leaf dispatch; NOT in DISPATCH_TOOL_NAMES, so explicit
  ...DISPATCH_TOOL_NAMES
]);
const IMMUTABLE_DENY_PATTERNS = [
  /(^|_)execute_shell(_command)?$/i,
  /(^|_)shell(_command)?$/i,
  /(^|_)dispatch(_|$)/i,
  /(^|_)recipe(_|$)/i,
  /^task(_|$)/i,
  // task_* and bare task
  /(^|_)task$/i,
  // *_task — trailing leaf-dispatch segment (§3.4 `*_task`)
  /(^|_)(write|create|replace|insert|rename|delete|move|edit)_/i,
  // mutation verbs — see NOTE above
  /_(memory|symbol|symbol_body|content|text_file)$/i
  // serena write-targets (`content` = serena_replace_content)
];
function isImmutableDeny(normalizedId) {
  return IMMUTABLE_DENY_NAMED.has(normalizedId) || IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(normalizedId));
}
function validateExtraToolsPattern(pattern) {
  if (!/^[a-z0-9_-]+\*?$/.test(pattern)) {
    return {
      valid: false,
      error: "must be lowercase alnum/_/-, optional single trailing *"
    };
  }
  if (pattern === "*") return { valid: false, error: "bare * not allowed" };
  if (!pattern.endsWith("*") && isImmutableDeny(pattern)) {
    return { valid: false, error: `denied id: ${pattern}` };
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    for (const deniedId of IMMUTABLE_DENY_NAMED) {
      if (deniedId.startsWith(prefix)) {
        return {
          valid: false,
          error: `glob ${pattern} would cover denied id ${deniedId}`
        };
      }
    }
    if (IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(prefix))) {
      return {
        valid: false,
        error: `glob ${pattern} prefix matches a denied capability class`
      };
    }
  }
  return { valid: true };
}
function matchesExtraToolsPattern(pattern, normalizedId) {
  return pattern.endsWith("*") ? normalizedId.startsWith(pattern.slice(0, -1)) : normalizedId === pattern;
}
const stribogSpecialistInfo = {
  name: STRIBOG_AGENT_KEY,
  mode: "subagent",
  description: STRIBOG_DESCRIPTION,
  metadata: {
    keyTrigger: "Environment down, or a tiny mechanical change needed \u2192 dispatch `stribog`",
    useWhen: [
      "Bring up / fix a downed environment for QA (docker compose / make / start a service)",
      "A small mechanical change (add a config field, change a value)",
      "Light debugging (read logs, restart, diagnose)"
    ],
    avoidWhen: [
      "Producing or refreshing a secret/credential value (use zmora-setup)",
      "Feature development or any multi-file / architectural change (main executor)",
      "Anything requiring a design decision"
    ],
    triggers: [
      {
        domain: "Environment ops",
        trigger: "Bring up, restart, or fix a service/environment so QA can run against it"
      },
      {
        domain: "Small mechanical change",
        trigger: "Apply a narrow, deterministic edit (config field/value) and verify it"
      }
    ]
  }
};
export {
  CORE_BUILTINS,
  DEFAULT_STRIBOG_MODEL,
  IMMUTABLE_DENY_NAMED,
  IMMUTABLE_DENY_PATTERNS,
  STRIBOG_AGENT_KEY,
  STRIBOG_DENIED_TOOLS,
  STRIBOG_DESCRIPTION,
  STRIBOG_EDIT_BUDGET,
  isImmutableDeny,
  matchesExtraToolsPattern,
  stribogSpecialistInfo,
  validateExtraToolsPattern
};
