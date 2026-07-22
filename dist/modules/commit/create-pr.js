import { defaultGitRunner } from "./controlled-commit.js";
import {
  defaultGhRunner,
  githubPrProvider
} from "./github-pr-provider.js";
import { detectProvider } from "./pr-provider.js";
function ruleError(field, ruleId, slug, value) {
  return new Error(
    `create_pr: field '${field}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}`
  );
}
const TITLE_CONTROL = /[\x00-\x1F\x7F-\x9F]/;
const BODY_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
function validateTitle(rawTitle) {
  const title = rawTitle.trim();
  if (title.length === 0) throw ruleError("title", "T1", "empty-title", title);
  if ([...title].length > 256)
    throw ruleError("title", "T2", "max-length-256-chars", title);
  if (TITLE_CONTROL.test(title))
    throw ruleError("title", "T3", "control-characters", title);
  return title;
}
function validateTaskId(rawTaskId) {
  if (rawTaskId === void 0) return void 0;
  const taskId = rawTaskId.trim();
  if (taskId.length === 0) return void 0;
  if (!/^[A-Za-z0-9._-]+$/.test(taskId))
    throw ruleError("taskId", "K1", "invalid-characters", taskId);
  if (taskId.startsWith("-")) throw ruleError("taskId", "K2", "leading-dash", taskId);
  return taskId;
}
function resolveBody(body, taskId) {
  if (taskId === void 0) return body ?? "";
  if (body === void 0 || body.trim() === "") return `Refs: ${taskId}`;
  return `${body.trimEnd()}

Refs: ${taskId}`;
}
function validateBody(resolvedBody) {
  if (Buffer.byteLength(resolvedBody, "utf8") > 64e3)
    throw ruleError("body", "B1", "max-length-64000-bytes", resolvedBody);
  if (BODY_CONTROL.test(resolvedBody))
    throw ruleError("body", "B2", "control-characters", resolvedBody);
  return resolvedBody;
}
function validateRef(field, rawValue) {
  const value = rawValue.trim();
  if (value.length === 0 || !/^[A-Za-z0-9._/-]+$/.test(value))
    throw ruleError(field, "R1", "invalid-characters", value);
  if (value.startsWith("-")) throw ruleError(field, "R2", "leading-dash", value);
  if (value.includes("..")) throw ruleError(field, "R3", "dot-dot", value);
  const componentViolation = value.includes("//") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"));
  if (componentViolation) throw ruleError(field, "R4", "component-rules", value);
  if (Buffer.byteLength(value, "utf8") > 240)
    throw ruleError(field, "R5", "max-length-240-bytes", value);
  return value;
}
async function createPr(input) {
  const title = validateTitle(input.title);
  const taskId = validateTaskId(input.taskId);
  const body = validateBody(resolveBody(input.body, taskId));
  const baseProvided = input.base !== void 0 && input.base.trim() !== "";
  const providedBase = baseProvided ? validateRef("base", input.base) : void 0;
  const runGit = input.runGit ?? defaultGitRunner;
  const draft = input.draft ?? false;
  const headResult = await runGit(input.cwd, ["branch", "--show-current"]);
  if (headResult.exitCode !== 0) {
    throw new Error(
      headResult.stderr.trim() || headResult.stdout.trim() || "git branch --show-current failed."
    );
  }
  const head = headResult.stdout.trim();
  if (head === "") {
    throw new Error(
      "create_pr: HEAD is detached \u2014 check out a branch first (use create_branch)."
    );
  }
  let base;
  if (providedBase !== void 0) {
    base = providedBase;
  } else {
    const baseResult = await runGit(input.cwd, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD"
    ]);
    if (baseResult.exitCode !== 0) {
      throw new Error(
        "create_pr: cannot resolve the default branch of 'origin' \u2014 pass 'base' explicitly or run: git remote set-head origin --auto"
      );
    }
    base = baseResult.stdout.trim().replace(/^origin\//, "");
  }
  validateRef("head", head);
  if (head === base) {
    throw new Error(
      `create_pr: refusing to push and open a PR from the base branch '${base}' \u2014 create a feature branch first (use create_branch).`
    );
  }
  let provider = input.provider;
  if (provider === void 0) {
    const originResult = await runGit(input.cwd, ["remote", "get-url", "origin"]);
    if (originResult.exitCode !== 0) {
      throw new Error("create_pr: no 'origin' remote is configured.");
    }
    const originUrl = originResult.stdout.trim();
    if (detectProvider(originUrl) !== "github") {
      throw new Error(
        `create_pr: unsupported git host for PR creation (supported: github.com). origin: ${JSON.stringify(originUrl)}`
      );
    }
    provider = githubPrProvider(input.runGh ?? defaultGhRunner);
  }
  const pushResult = await runGit(input.cwd, ["push", "-u", "origin", head]);
  if (pushResult.exitCode !== 0) {
    throw new Error(
      pushResult.stderr.trim() || pushResult.stdout.trim() || "git push failed."
    );
  }
  try {
    const { url } = await provider.createPullRequest({
      cwd: input.cwd,
      head,
      base,
      title,
      body,
      draft
    });
    return { head, base, pushed: true, prCreated: true, draft, url };
  } catch (error) {
    const prError = error instanceof Error ? error.message : String(error);
    return { head, base, pushed: true, prCreated: false, draft, prError };
  }
}
export {
  createPr
};
