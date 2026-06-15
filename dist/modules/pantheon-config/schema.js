import { neutralizeUntrustedOutput } from "../_shared/sanitize.js";
import {
  STRIBOG_AGENT_KEY,
  validateExtraToolsPattern
} from "../stribog/stribog.metadata.js";
const MODEL_REGEX = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;
const MAX_SHOWN_LEN = 120;
const KNOWN_AGENT_FIELDS = /* @__PURE__ */ new Set(["model", "extraTools"]);
function prefix(sourcePath) {
  return sourcePath !== void 0 ? `[pantheon] ${sourcePath}: ` : "[pantheon] ";
}
function validateConfigFile(raw, sourcePath) {
  const errors = [];
  const result = { agents: {} };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${prefix(sourcePath)}top-level must be object`);
    return { config: result, errors };
  }
  const obj = raw;
  const agents = obj.agents;
  if (agents === void 0) {
    return { config: result, errors };
  }
  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) {
    errors.push(`${prefix(sourcePath)}agents must be object \u2014 ignoring`);
    return { config: result, errors };
  }
  for (const [rawName, agentRaw] of Object.entries(
    agents
  )) {
    const safeName = neutralizeUntrustedOutput(rawName);
    if (agentRaw === null || typeof agentRaw !== "object" || Array.isArray(agentRaw)) {
      errors.push(
        `${prefix(sourcePath)}agents.${safeName} must be object \u2014 ignoring`
      );
      continue;
    }
    const agent = agentRaw;
    for (const rawField of Object.keys(agent)) {
      if (!KNOWN_AGENT_FIELDS.has(rawField)) {
        errors.push(
          `${prefix(sourcePath)}unknown field "agents.${safeName}.${neutralizeUntrustedOutput(rawField)}"`
        );
      }
    }
    let validatedExtraTools;
    const rawExtraTools = agent.extraTools;
    if (rawExtraTools !== void 0) {
      if (rawName !== STRIBOG_AGENT_KEY) {
        errors.push(
          `${prefix(sourcePath)}extraTools on agent "${safeName}" is ignored \u2014 extraTools only affects the stribog agent`
        );
      } else if (!Array.isArray(rawExtraTools)) {
        errors.push(
          `${prefix(sourcePath)}agents.${safeName}.extraTools must be an array of strings \u2014 ignoring extraTools`
        );
      } else {
        const kept = [];
        for (const entry of rawExtraTools) {
          if (typeof entry !== "string") {
            errors.push(
              `${prefix(sourcePath)}agents.${safeName}.extraTools: non-string entry ignored`
            );
            continue;
          }
          const check = validateExtraToolsPattern(entry);
          if (!check.valid) {
            errors.push(
              `${prefix(sourcePath)}agents.${safeName}.extraTools: invalid entry "${neutralizeUntrustedOutput(entry)}" \u2014 ${check.error}`
            );
          } else {
            kept.push(entry);
          }
        }
        if (kept.length > 0) {
          validatedExtraTools = kept;
        }
      }
    }
    const model = agent.model;
    let validatedModel;
    if (model !== void 0) {
      if (typeof model !== "string" || !MODEL_REGEX.test(model)) {
        const raw2 = typeof model === "string" ? model : String(model);
        const cleaned = neutralizeUntrustedOutput(raw2);
        const truncated = cleaned.length > MAX_SHOWN_LEN ? `${cleaned.slice(0, MAX_SHOWN_LEN)}\u2026` : cleaned;
        const shown = `"${truncated}"`;
        errors.push(
          `${prefix(sourcePath)}invalid model ${shown} for agent "${safeName}" \u2014 must match <providerID>/<modelID> (aggregator paths like openrouter/openai/gpt-5.5 are allowed)`
        );
        if (validatedExtraTools !== void 0) {
          result.agents[rawName] = { extraTools: validatedExtraTools };
        }
        continue;
      }
      validatedModel = model;
    }
    if (validatedModel !== void 0 || validatedExtraTools !== void 0) {
      result.agents[rawName] = {
        ...validatedModel !== void 0 ? { model: validatedModel } : {},
        ...validatedExtraTools !== void 0 ? { extraTools: validatedExtraTools } : {}
      };
    }
  }
  return { config: result, errors };
}
export {
  validateConfigFile
};
