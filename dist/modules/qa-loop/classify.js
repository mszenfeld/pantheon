const MUTATING_VERB = /\b(POST|PUT|PATCH|DELETE)\b/;
const DB_WRITE = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+\w|CREATE\s+TABLE|UPSERT|TRUNCATE)\b/i;
const WRITE_STEP = /\b(create|delete|update|insert|write|mutate|persist|save)s?\b/i;
const BLOCKED = /\b(reject(ed|s)?|block(ed|s)?|den(y|ied|ies)|forbidden|unauthor(ized|ised)|must\s+not|should\s+not|no\s+(state\s+change|row|change)|401|403|4\d\d\b)/i;
const NEGATIVE_HINT = /\b(reject|block|deny|denied|forbidden|unauthor|invalid|must\s+not|should\s+not|negative)\b/i;
const SANITY_HINT = /\b(smoke|sanity|baseline|health\s*check|healthcheck|ping)\b/i;
function classifyScenario(block) {
  const mutating = MUTATING_VERB.test(block) || DB_WRITE.test(block) || WRITE_STEP.test(block);
  const blocked = BLOCKED.test(block);
  let kind = "feature";
  if (NEGATIVE_HINT.test(block) || blocked) kind = "negative";
  else if (SANITY_HINT.test(block)) kind = "sanity";
  const expectsSuccess = !(kind === "negative" && blocked);
  return { kind, mutating, expectsSuccess };
}
export {
  classifyScenario
};
