import { classifyScenario } from "./classify.js";
const SEED_MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Seed\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im;
const TEARDOWN_MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?\*\*Teardown\s*\(\s*psql\s*\/\s*sqlite3\s*\)\s*:\*\*/im;
const LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1"]);
function baseUrlIsLocal(planText) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(planText);
  if (!fm) return false;
  const m = /^base-url:\s*(.+)$/im.exec(fm[1]);
  if (!m) return false;
  const raw = m[1].trim().replace(/^["']|["']$/g, "");
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
    return LOCAL_HOSTS.has(host);
  } catch {
    return false;
  }
}
function teardownSpan(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TEARDOWN_MARKER.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let k = start + 1;
  while (k < lines.length && lines[k].trim() === "") k++;
  if (k >= lines.length || !/^\s*```/.test(lines[k])) return null;
  let end = k + 1;
  while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
  if (end >= lines.length) return null;
  return { start, end };
}
function splitTeardown(block) {
  const lines = block.split("\n");
  const span = teardownSpan(lines);
  if (!span) return { teardown: null, body: block };
  return {
    teardown: lines.slice(span.start, span.end + 1).join("\n").trim(),
    body: [...lines.slice(0, span.start), ...lines.slice(span.end + 1)].join("\n")
  };
}
function extractTeardown(block) {
  return splitTeardown(block).teardown;
}
function classifyBodyExcludingTeardown(block) {
  return splitTeardown(block).body;
}
function teardownHasLiteralDsn(block) {
  return /(?:psql|sqlite3)\b[^\n]*?\b[a-z][a-z0-9+.-]*:\/\/(?!\s*\$)/i.test(block);
}
function classifyForDispatch(block, opts) {
  const isSeedWrite = SEED_MARKER.test(block);
  const { teardown, body } = splitTeardown(block);
  const { kind, mutating, expectsSuccess } = classifyScenario(body);
  const gatedMutation = isSeedWrite || mutating && expectsSuccess;
  const autoReverting = gatedMutation && teardown !== null && opts.targetIsLocal;
  const stripped = gatedMutation && !autoReverting && !opts.allowMutations;
  return {
    kind,
    mutating,
    isSeedWrite,
    teardownBlock: teardown,
    gatedMutation,
    autoReverting,
    stripped
  };
}
export {
  SEED_MARKER,
  TEARDOWN_MARKER,
  baseUrlIsLocal,
  classifyBodyExcludingTeardown,
  classifyForDispatch,
  extractTeardown,
  splitTeardown,
  teardownHasLiteralDsn
};
