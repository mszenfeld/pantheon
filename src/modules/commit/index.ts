import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { classifyBashCommand } from "./bash-policy.js"
import { createBranch } from "./create-branch.js"
import { createControlledCommit } from "./controlled-commit.js"
import { createPr } from "./create-pr.js"

const COMMIT_COMMAND_DESCRIPTION =
  "Create a git commit with the AppVerk commit workflow"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const packagedCommandPath = path.resolve(
  moduleDirectory,
  "../../commands/commit.md",
)
const sourceCommandPath = path.resolve(
  moduleDirectory,
  "../../../src/commands/commit.md",
)
const isDevEnvironment = import.meta.url.includes("/src/")

function loadCommitCommandTemplate(): string {
  if (isDevEnvironment) {
    return readFileSync(sourceCommandPath, "utf8")
  }
  return readFileSync(packagedCommandPath, "utf8")
}

export const AppVerkCommitPlugin: Plugin = async () => {
  // Read the ~5KB markdown template once at plugin construction so the
  // exposed config is a plain serializable object (no getter, no surprise
  // I/O when something JSON.stringifies or spreads the config).
  const commitTemplate = loadCommitCommandTemplate()

  return {
    config: async (config) => {
      config.command = config.command ?? {}
      config.command.commit = {
        description: COMMIT_COMMAND_DESCRIPTION,
        template: commitTemplate,
      }
    },
    tool: {
      av_commit: tool({
        description: "Create a commit through the AppVerk commit workflow",
        args: {
          message: tool.schema
            .string()
            .describe("The Conventional Commit message to create"),
          files: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Optional file paths to stage before committing"),
          taskId: tool.schema
            .string()
            .optional()
            .describe("Optional task ID appended as a Refs footer"),
        },
        async execute(args, context) {
          const result = await createControlledCommit({
            cwd: context.worktree ?? context.directory,
            message: args.message,
            files: args.files ?? [],
            taskId: args.taskId,
          })

          return JSON.stringify(result, null, 2)
        },
      }),
      create_pr: tool({
        description:
          "Push the current branch to origin and open a pull request through the AppVerk workflow",
        args: {
          title: tool.schema.string().describe("Pull request title"),
          body: tool.schema
            .string()
            .optional()
            .describe("Pull request description (markdown)"),
          base: tool.schema
            .string()
            .optional()
            .describe("Base branch; defaults to the origin default branch"),
          draft: tool.schema
            .boolean()
            .optional()
            .describe("Create the PR as a draft (default: ready for review)"),
          taskId: tool.schema
            .string()
            .optional()
            .describe("Optional task ID appended to the body as a Refs footer"),
        },
        async execute(args, context) {
          const result = await createPr({
            cwd: context.worktree ?? context.directory,
            title: args.title,
            body: args.body,
            base: args.base,
            draft: args.draft ?? false,
            taskId: args.taskId,
          })
          return JSON.stringify(result, null, 2)
        },
      }),
      create_branch: tool({
        description:
          "Create (and by default switch to) a convention-validated git branch from type/id/description segments",
        args: {
          type: tool.schema
            .string()
            .describe(
              "Branch type — one of: feature, fix, hotfix, release, docs, chore, refactor (validated in-tool)",
            ),
          id: tool.schema
            .string()
            .optional()
            .describe("Optional task/ticket id, e.g. INC-212 (never rewritten)"),
          description: tool.schema
            .string()
            .describe(
              "Short plain-English or kebab-case description; whitespace becomes dashes",
            ),
          checkout: tool.schema
            .boolean()
            .optional()
            .describe("Switch to the new branch after creating it (default: true)"),
        },
        async execute(args, context) {
          const result = await createBranch({
            cwd: context.worktree ?? context.directory,
            type: args.type,
            id: args.id,
            description: args.description,
            checkout: args.checkout ?? true,
          })
          return JSON.stringify(result, null, 2)
        },
      }),
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") {
        return
      }

      const command = String(output.args.command ?? "")
      const decision = classifyBashCommand(command)

      if (decision === "block-direct-commit") {
        throw new Error("Direct git commit is blocked. Use /commit instead.")
      }

      if (decision === "block-push") {
        throw new Error(
          "git push is blocked by the AppVerk commit plugin. Use the `create_pr` tool to " +
            "publish the current branch and open a pull request.",
        )
      }
    },
  }
}

export default AppVerkCommitPlugin
