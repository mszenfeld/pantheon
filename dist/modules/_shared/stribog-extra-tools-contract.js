import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js";
const STRIBOG_AGENT_KEY = "stribog";
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
  // Mutation/DDL/privilege verbs as a WHOLE segment, order-agnostic: verb in a non-final segment
  // (`write_*`, `*_delete_*`) OR verb as the trailing segment (`*_delete`, `supabase_rows_delete`).
  // The split anchor (`verb_` | `_verb$`) is load-bearing: it MUST NOT match the bare single-segment
  // ids `edit`/`write` — those are CORE_BUILTINS that have to fall through this deny floor to the
  // edit-budget path in tool-budget-hook.ts. `(^|_)verb(_|$)` would wrongly match bare edit/write
  // and brick Stribog's only side-effect tools. See NOTE above for scope.
  /(^|_)(write|create|replace|insert|rename|delete|move|edit|update|upsert|drop|truncate|alter|grant)_|_(write|create|replace|insert|rename|delete|move|edit|update|upsert|drop|truncate|alter|grant)$/i,
  /_(memory|symbol|symbol_body|content|text_file)$/i
  // serena write-targets (`content` = serena_replace_content)
];
function isImmutableDeny(normalizedId) {
  const sep = normalizedId.replace(/-/g, "_");
  return IMMUTABLE_DENY_NAMED.has(sep) || IMMUTABLE_DENY_PATTERNS.some((rx) => rx.test(sep));
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
export {
  IMMUTABLE_DENY_NAMED,
  IMMUTABLE_DENY_PATTERNS,
  STRIBOG_AGENT_KEY,
  isImmutableDeny,
  matchesExtraToolsPattern,
  validateExtraToolsPattern
};
