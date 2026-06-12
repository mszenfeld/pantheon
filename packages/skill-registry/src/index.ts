import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Config, Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import {
  forgetSessionAgent,
  isCoordinatorSession,
} from "@appverk/opencode-skill-utils"
import { buildSkillCatalog } from "./skill-catalog.js"
import { createSkillLoader } from "./load-skill.js"
import { generateActivationRules } from "./prompt-injector.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * `skills.paths` is honored by the opencode runtime for native skill discovery
 * but is absent from the SDK `Config` type the plugin compiles against. This
 * accessor localizes the cast (mirrors `default_agent` in agent-roster) so the
 * broad `any` does not leak across the whole `config` hook — only this one host
 * field is untyped. Re-check on the next `@opencode-ai/plugin` bump; once
 * `skills` is native on `Config`, the cast is removable.
 */
function getSkillPaths(config: Config): string[] {
  const skills = (config as { skills?: { paths?: string[] } }).skills ?? {}
  skills.paths ??= []
  ;(config as { skills?: { paths?: string[] } }).skills = skills
  return skills.paths
}

const skillDirectories = [
  path.resolve(moduleDirectory, "../../python-developer/dist/skills"),
  path.resolve(moduleDirectory, "../../frontend-developer/dist/skills"),
  path.resolve(moduleDirectory, "../../code-review/dist/skills"),
  path.resolve(moduleDirectory, "../../../dist/skills/qa"),
  path.resolve(moduleDirectory, "../../swift-developer/dist/skills"),
]

export const AppVerkSkillRegistryPlugin: Plugin = async ({ client }) => {
  const catalog = buildSkillCatalog(skillDirectories)
  const loadSkill = createSkillLoader(catalog)
  const activationRules = generateActivationRules(catalog)

  return {
    config: async (config: Config) => {
      // Register skill directories so OpenCode discovers them natively.
      const paths = getSkillPaths(config)
      for (const dir of skillDirectories) {
        if (!paths.includes(dir)) {
          paths.push(dir)
        }
      }
    },
    tool: {
      load_appverk_skill: tool({
        description:
          "Load an AppVerk development skill by name. Returns the full markdown content of the skill's rules and patterns. Available skills include python-coding-standards, frontend-coding-standards, python-tdd-workflow, frontend-tdd-workflow, fastapi-patterns, sqlalchemy-patterns, tailwind-patterns, and more.",
        args: {
          name: tool.schema
            .string()
            .describe(
              "Skill name (e.g., python-coding-standards, fastapi-patterns)",
            ),
        },
        async execute(args: { name: string }) {
          try {
            return loadSkill(args.name)
          } catch (error) {
            return `Error: ${(error as Error).message}`
          }
        },
      }),
    },
    "experimental.chat.system.transform": async (input, output) => {
      // Suppress the skill-activation injection for the coordinator (Perun): these are
      // executor coding-standards, irrelevant to orchestration and a documented pressure
      // pulling the coordinator toward self-execution.
      // Fail-CLOSED on a missing sessionID (the Agent.generate scaffolding path needs no rules).
      if (!input.sessionID) return
      // Precise positive identification: only the coordinator is suppressed — every other
      // agent (dispatched specialists, developer-as-primary) keeps its rules. On the
      // coordinator's very first turn the identity may be unresolvable (messages not yet
      // queryable); in that window the rules are injected but harmless, because Perun's
      // skill-loading tools are already disabled (Task 5 coordinator config). The unresolved
      // turn-1 miss is not cached, so the identity still resolves on later turns.
      if (await isCoordinatorSession(input.sessionID, client)) return
      output.system.push(activationRules)
    },
    // The per-turn transform above resolves identity through `isCoordinatorSession`, which
    // memoizes into the shared session→agent cache in skill-utils. Evict that entry on
    // session teardown so the module-level map does not grow unbounded over a long-lived
    // process (one entry per resolved session, otherwise retained forever).
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const deletedID = event.properties?.info?.id
      if (typeof deletedID === "string" && deletedID.length > 0) {
        forgetSessionAgent(deletedID)
      }
    },
  }
}

export default AppVerkSkillRegistryPlugin
