// src/index.ts
import path2 from "path";
import { fileURLToPath } from "url";

// ../skill-utils/dist/index.js
import { readFileSync } from "fs";
import path from "path";
import { tool } from "@opencode-ai/plugin";
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
    moduleDirectory: moduleDirectory2,
    mode = "primary"
  } = options;
  const packagedAgentPath = path.resolve(moduleDirectory2, "agent-prompt.md");
  const sourceAgentPath = path.resolve(
    moduleDirectory2,
    "../src/agent-prompt.md"
  );
  const packagedCommandPath = path.resolve(
    moduleDirectory2,
    `commands/${commandName}.md`
  );
  const sourceCommandPath = path.resolve(
    moduleDirectory2,
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

// src/index.ts
var moduleDirectory = path2.dirname(fileURLToPath(import.meta.url));
var AppVerkFrontendDeveloperPlugin = createSkillPlugin({
  namespace: "frontend",
  agentName: "frontend-developer",
  commandName: "frontend",
  agentDescription: "Expert TypeScript + React developer enforcing AppVerk coding standards, TDD workflow, and stack-specific patterns.",
  commandDescription: "TypeScript + React development workflow enforcing coding standards, TDD, and stack-specific patterns.",
  loadSkill: null,
  availableSkills: [],
  moduleDirectory
});
var index_default = AppVerkFrontendDeveloperPlugin;
export {
  AppVerkFrontendDeveloperPlugin,
  index_default as default
};
