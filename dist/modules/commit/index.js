import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { classifyBashCommand } from "./bash-policy.js";
import { createControlledCommit } from "./controlled-commit.js";
import { createBranch } from "./create-branch.js";
import { createPr } from "./create-pr.js";
import {
  assertPublicationCaller,
  classifyCommitCaller
} from "./perun-commit-policy.js";
import { createCommitScopeSnapshot } from "./git-scope-snapshot.js";
import { PerunCommitConsentStore } from "./perun-commit-consent.js";
import { isCoordinatorSession } from "../_shared/session-identity.js";
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
const AppVerkCommitPlugin = async (input) => {
  const commitTemplate = loadCommitCommandTemplate();
  const consentEnabled = process.env.APPVERK_PERUN_COMMIT_CONSENT === "enabled";
  const consentStore = new PerunCommitConsentStore();
  async function assertPerunContext(context) {
    const sessionId = context.sessionID;
    if (context.agent !== "Perun - Coordinator" || sessionId === void 0 || sessionId === "" || !await isCoordinatorSession(sessionId, input.client)) {
      throw new Error("Perun commit consent: caller identity is unavailable or unauthorized.");
    }
    return sessionId;
  }
  async function transcript(sessionId) {
    const result = await input.client.session.messages({ path: { id: sessionId } });
    return (result.data ?? []).map((message) => ({
      role: message.info.role,
      text: message.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("")
    }));
  }
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
          message: tool.schema.string().describe(
            "The Conventional Commit message to create (the subject line MUST be in English \u2014 translate first; non-English tokens in the subject are rejected; the body is not checked and may quote non-English text verbatim)"
          ),
          files: tool.schema.array(tool.schema.string()).optional().describe(
            "Optional file paths to stage before committing. Perun must provide the exact changed files to commit; omit only for authorized non-Perun callers."
          ),
          taskId: tool.schema.string().optional().describe("Optional task ID appended as a Refs footer"),
          authorization: tool.schema.string().optional().describe("Single-use Perun authorization from authorize_perun_commit_scope")
        },
        async execute(args, context) {
          const scopePolicy = classifyCommitCaller(context.agent);
          const cwd = context.worktree ?? context.directory;
          if (scopePolicy !== "perun-exact" && args.authorization !== void 0) {
            throw new Error("av_commit: authorization is reserved for Perun.");
          }
          if (scopePolicy === "perun-exact" && consentEnabled) {
            if (args.files !== void 0) throw new Error("av_commit: enabled Perun consent flow does not accept files.");
            if (args.authorization === void 0) throw new Error("av_commit: enabled Perun consent flow requires authorization.");
            const sessionId = await assertPerunContext(context);
            const authorization = consentStore.take(args.authorization, sessionId, args.message);
            try {
              const result2 = await createControlledCommit({ cwd, message: args.message, taskId: args.taskId, scopePolicy, authorization });
              consentStore.consume(authorization, true);
              return JSON.stringify(result2, null, 2);
            } catch (error) {
              consentStore.consume(authorization, false);
              throw error;
            }
          }
          const result = await createControlledCommit({ cwd, message: args.message, files: args.files ?? [], taskId: args.taskId, scopePolicy });
          return JSON.stringify(result, null, 2);
        }
      }),
      prepare_perun_commit_scope: tool({
        description: "Prepare a transcript-bound exact Git commit proposal for Perun",
        args: { message: tool.schema.string().describe("The exact Conventional Commit intent") },
        async execute(args, context) {
          if (!consentEnabled) return JSON.stringify({ status: "disabled" });
          const sessionId = await assertPerunContext(context);
          const snapshot = await createCommitScopeSnapshot(context.worktree ?? context.directory);
          const proposal = consentStore.prepare(sessionId, args.message, snapshot);
          return JSON.stringify({ proposal_id: proposal.id, proposal: proposal.rendered });
        }
      }),
      authorize_perun_commit_scope: tool({
        description: "Authorize the immediately displayed Perun exact commit proposal",
        args: { proposal_id: tool.schema.string().describe("Opaque proposal identifier") },
        async execute(args, context) {
          if (!consentEnabled) return JSON.stringify({ status: "disabled" });
          const sessionId = await assertPerunContext(context);
          const authorization = consentStore.authorize(args.proposal_id, sessionId, await transcript(sessionId));
          return JSON.stringify({ authorization: authorization.token });
        }
      }),
      create_pr: tool({
        description: "Push the current branch to origin and open a pull request through the AppVerk workflow",
        args: {
          title: tool.schema.string().describe(
            "Pull request title (MUST be in English \u2014 translate first; non-English tokens are rejected)"
          ),
          body: tool.schema.string().optional().describe("Pull request description (markdown)"),
          base: tool.schema.string().optional().describe("Base branch; defaults to the origin default branch"),
          draft: tool.schema.boolean().optional().describe("Create the PR as a draft (default: ready for review)"),
          taskId: tool.schema.string().optional().describe("Optional task ID appended to the body as a Refs footer")
        },
        async execute(args, context) {
          assertPublicationCaller(context.agent, "create_pr");
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
      }),
      create_branch: tool({
        description: "Create (and by default switch to) a convention-validated git branch from type/id/description segments",
        args: {
          type: tool.schema.string().describe(
            "Branch type \u2014 one of: feature, fix, hotfix, release, docs, chore, refactor (validated in-tool)"
          ),
          id: tool.schema.string().optional().describe(
            "Optional task/ticket id, e.g. INC-212 (never rewritten)"
          ),
          description: tool.schema.string().describe(
            "Short English description (MUST be in English \u2014 translate first; non-English tokens are rejected); whitespace becomes dashes"
          ),
          checkout: tool.schema.boolean().optional().describe(
            "Switch to the new branch after creating it (default: true)"
          )
        },
        async execute(args, context) {
          assertPublicationCaller(context.agent, "create_branch");
          const result = await createBranch({
            cwd: context.worktree ?? context.directory,
            type: args.type,
            id: args.id,
            description: args.description,
            checkout: args.checkout ?? true
          });
          return JSON.stringify(result, null, 2);
        }
      })
    },
    "tool.execute.before": async (input2, output) => {
      if (input2.tool !== "bash") {
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
    },
    event: async ({ event }) => {
      consentStore.sweep();
      if (event.type === "session.deleted") {
        const sessionId = event.properties?.info?.id;
        if (typeof sessionId === "string") consentStore.clearSession(sessionId);
      }
    }
  };
};
var commit_default = AppVerkCommitPlugin;
export {
  AppVerkCommitPlugin,
  commit_default as default
};
