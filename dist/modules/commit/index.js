import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { classifyBashCommand } from "./bash-policy.js";
import { createControlledCommit } from "./controlled-commit.js";
import { createPr } from "./create-pr.js";
const COMMIT_COMMAND_DESCRIPTION = "Create a git commit with the AppVerk commit workflow";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const packagedCommandPath = path.resolve(
  moduleDirectory,
  "../../commands/commit.md"
);
const sourceCommandPath = path.resolve(
  moduleDirectory,
  "../../../src/commands/commit.md"
);
const isDevEnvironment = import.meta.url.includes("/src/");
function loadCommitCommandTemplate() {
  if (isDevEnvironment) {
    return readFileSync(sourceCommandPath, "utf8");
  }
  return readFileSync(packagedCommandPath, "utf8");
}
const AppVerkCommitPlugin = async () => {
  const commitTemplate = loadCommitCommandTemplate();
  return {
    config: async (config) => {
      config.command = config.command ?? {};
      config.command.commit = {
        description: COMMIT_COMMAND_DESCRIPTION,
        template: commitTemplate
      };
    },
    tool: {
      av_commit: tool({
        description: "Create a commit through the AppVerk commit workflow",
        args: {
          message: tool.schema.string().describe("The Conventional Commit message to create"),
          files: tool.schema.array(tool.schema.string()).optional().describe("Optional file paths to stage before committing"),
          taskId: tool.schema.string().optional().describe("Optional task ID appended as a Refs footer")
        },
        async execute(args, context) {
          const result = await createControlledCommit({
            cwd: context.worktree ?? context.directory,
            message: args.message,
            files: args.files ?? [],
            taskId: args.taskId
          });
          return JSON.stringify(result, null, 2);
        }
      }),
      create_pr: tool({
        description: "Push the current branch to origin and open a pull request through the AppVerk workflow",
        args: {
          title: tool.schema.string().describe("Pull request title"),
          body: tool.schema.string().optional().describe("Pull request description (markdown)"),
          base: tool.schema.string().optional().describe("Base branch; defaults to the origin default branch"),
          draft: tool.schema.boolean().optional().describe("Create the PR as a draft (default: ready for review)"),
          taskId: tool.schema.string().optional().describe("Optional task ID appended to the body as a Refs footer")
        },
        async execute(args, context) {
          const result = await createPr({
            cwd: context.worktree ?? context.directory,
            title: args.title,
            body: args.body,
            base: args.base,
            draft: args.draft ?? false,
            taskId: args.taskId
          });
          return JSON.stringify(result, null, 2);
        }
      })
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") {
        return;
      }
      const command = String(output.args.command ?? "");
      const decision = classifyBashCommand(command);
      if (decision === "block-direct-commit") {
        throw new Error("Direct git commit is blocked. Use /commit instead.");
      }
      if (decision === "block-push") {
        throw new Error(
          "git push is blocked by the AppVerk commit plugin. Use the `create_pr` tool to publish the current branch and open a pull request."
        );
      }
    }
  };
};
var commit_default = AppVerkCommitPlugin;
export {
  AppVerkCommitPlugin,
  commit_default as default
};
