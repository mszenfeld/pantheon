// src/index.ts
import { readFileSync } from "fs";
import path from "path";
import { tool } from "@opencode-ai/plugin";

// src/category-prefix-mapping.ts
var CATEGORY_PREFIX_MAPPING = {
  Security: "SEC",
  Performance: "PERF",
  Architecture: "ARCH",
  Maintainability: "MAINT",
  Documentation: "DOC",
  Testing: "QA"
};
var VALID_PREFIXES = Object.values(CATEGORY_PREFIX_MAPPING);
var VALID_CATEGORIES = Object.keys(CATEGORY_PREFIX_MAPPING);

// ../../src/modules/_shared/session-identity.ts
var COORDINATOR_AGENT_NAME = "Perun - Coordinator";
async function getSessionAgent(sessionID, client) {
  try {
    const res = await client.session.messages({ path: { id: sessionID } });
    const msgs = res.data ?? [];
    const firstUser = msgs.find((m) => m.info?.role === "user")?.info;
    return firstUser?.agent;
  } catch {
    return void 0;
  }
}
var sessionAgentCache = /* @__PURE__ */ new Map();
var inFlight = /* @__PURE__ */ new Map();
var NEGATIVE_CACHE_AFTER_MISSES = 3;
var NEGATIVE_CACHE_TTL_MS = 5e3;
var missCounts = /* @__PURE__ */ new Map();
var negativeCacheUntil = /* @__PURE__ */ new Map();
async function getSessionAgentCached(sessionID, client) {
  const cached = sessionAgentCache.get(sessionID);
  if (cached !== void 0) return cached;
  const suppressUntil = negativeCacheUntil.get(sessionID);
  if (suppressUntil !== void 0) {
    if (suppressUntil > Date.now()) return void 0;
    negativeCacheUntil.delete(sessionID);
  }
  const pending = inFlight.get(sessionID);
  if (pending !== void 0) return pending;
  const promise = (async () => {
    const agent = await getSessionAgent(sessionID, client);
    if (agent !== void 0) {
      sessionAgentCache.set(sessionID, agent);
      missCounts.delete(sessionID);
      negativeCacheUntil.delete(sessionID);
    } else {
      const misses = (missCounts.get(sessionID) ?? 0) + 1;
      missCounts.set(sessionID, misses);
      if (misses >= NEGATIVE_CACHE_AFTER_MISSES) {
        negativeCacheUntil.set(sessionID, Date.now() + NEGATIVE_CACHE_TTL_MS);
        missCounts.delete(sessionID);
      }
    }
    return agent;
  })();
  inFlight.set(sessionID, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(sessionID) === promise) inFlight.delete(sessionID);
  }
}
function forgetSessionAgent(sessionID) {
  sessionAgentCache.delete(sessionID);
  inFlight.delete(sessionID);
  missCounts.delete(sessionID);
  negativeCacheUntil.delete(sessionID);
}
async function isCoordinatorSession(sessionID, client) {
  return await getSessionAgentCached(sessionID, client) === COORDINATOR_AGENT_NAME;
}

// ../../src/modules/_shared/coordinator-bash-policy.ts
function parseAllowedBashPrograms(frontmatter) {
  const out = [];
  const re = /Bash\(([^:)]+):\*\)/g;
  let m;
  while ((m = re.exec(frontmatter)) !== null) {
    const prog = m[1];
    if (prog !== void 0) out.push(prog.trim());
  }
  return out;
}
var COMPOUND = /(\|\||&&|;|\||&|[\r\n]|`|\$\(|<|>|(?<![\w./-])(?:bash|sh|eval)\b)/;
function isCompoundCommand(command) {
  return COMPOUND.test(command.trim());
}
function classifyCoordinatorBash(command, allowedPrograms) {
  const trimmed = command.trim();
  if (isCompoundCommand(trimmed)) return { allowed: false, program: null };
  const program = trimmed.split(/\s+/)[0] ?? "";
  return { allowed: allowedPrograms.includes(program), program };
}
function buildViolationError(info) {
  const payload = JSON.stringify({
    marker: "COORDINATOR_POLICY_VIOLATION",
    ...info
  });
  const subject = info.command ? isCompoundCommand(info.command) ? "a compound command" : `\`${info.command.split(/\s+/)[0]}\`` : info.skill ? `skill \`${info.skill}\`` : "that";
  return new Error(
    `${payload}
The coordinator may not run ${subject}. Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`
  );
}

// src/index.ts
function loadFile(packaged, source) {
  try {
    return readFileSync(packaged, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        return readFileSync(source, "utf8");
      } catch (innerError) {
        throw new Error(
          `Failed to load plugin template. Attempted paths: ${packaged}, ${source}. Original error: ${innerError.message}`,
          { cause: innerError }
        );
      }
    }
    throw new Error(
      `Failed to load plugin template. Attempted path: ${packaged}. Original error: ${error.message}`,
      { cause: error }
    );
  }
}
function createLazyFileLoader(packaged, source) {
  let cached;
  return () => {
    if (cached === void 0) {
      cached = loadFile(packaged, source);
    }
    return cached;
  };
}
function createSkillPlugin(options) {
  const {
    namespace,
    agentName,
    commandName,
    agentDescription,
    commandDescription,
    loadSkill,
    availableSkills,
    moduleDirectory,
    mode = "primary"
  } = options;
  const packagedAgentPath = path.resolve(moduleDirectory, "agent-prompt.md");
  const sourceAgentPath = path.resolve(
    moduleDirectory,
    "../src/agent-prompt.md"
  );
  const packagedCommandPath = path.resolve(
    moduleDirectory,
    `commands/${commandName}.md`
  );
  const sourceCommandPath = path.resolve(
    moduleDirectory,
    `../src/commands/${commandName}.md`
  );
  const getAgentPrompt = createLazyFileLoader(
    packagedAgentPath,
    sourceAgentPath
  );
  const getCommandTemplate = createLazyFileLoader(
    packagedCommandPath,
    sourceCommandPath
  );
  const plugin = {
    config: async (config) => {
      config.agent = config.agent ?? {};
      config.agent[agentName] = {
        description: agentDescription,
        get prompt() {
          return getAgentPrompt();
        },
        mode
      };
      config.command = config.command ?? {};
      config.command[commandName] = {
        description: commandDescription,
        get template() {
          return getCommandTemplate();
        },
        agent: agentName
      };
    }
  };
  if (loadSkill) {
    plugin.tool = {
      [`load_${namespace}_skill`]: tool({
        description: `Load a ${namespace} development skill by name. Returns the full markdown content of the skill's rules and patterns.`,
        args: {
          name: tool.schema.string().describe(`Skill name: ${availableSkills.join(", ")}`)
        },
        async execute(args) {
          return loadSkill(args.name);
        }
      })
    };
  }
  return async () => plugin;
}
export {
  CATEGORY_PREFIX_MAPPING,
  COORDINATOR_AGENT_NAME,
  VALID_CATEGORIES,
  VALID_PREFIXES,
  buildViolationError,
  classifyCoordinatorBash,
  createSkillPlugin,
  forgetSessionAgent,
  getSessionAgent,
  getSessionAgentCached,
  isCompoundCommand,
  isCoordinatorSession,
  parseAllowedBashPrograms
};
