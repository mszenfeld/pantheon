import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const GH_MISSING_MESSAGE = "GitHub CLI (gh) is not installed \u2014 install it (`brew install gh` or your platform's equivalent), then authenticate with `gh auth login`.";
const defaultGhRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("gh", args, { cwd });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error;
    if (failure.code === "ENOENT") throw failure;
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: typeof failure.code === "number" ? failure.code : 1
    };
  }
};
const PR_URL_LINE = /^https:\/\/\S+$/;
function githubPrProvider(runGh = defaultGhRunner) {
  return {
    name: "github",
    async createPullRequest(input) {
      const args = [
        "pr",
        "create",
        `--title=${input.title}`,
        `--body=${input.body}`,
        `--base=${input.base}`,
        `--head=${input.head}`
      ];
      if (input.draft) args.push("--draft");
      let result;
      try {
        result = await runGh(input.cwd, args);
      } catch (error) {
        const failure = error;
        if (failure.code === "ENOENT") throw new Error(GH_MISSING_MESSAGE);
        throw failure;
      }
      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() || result.stdout.trim() || "gh pr create failed."
        );
      }
      const url = result.stdout.split("\n").filter((line) => PR_URL_LINE.test(line)).at(-1);
      if (url === void 0) {
        throw new Error(
          `gh pr create returned no PR URL.
stdout: ${result.stdout}
stderr: ${result.stderr}`
        );
      }
      return { url };
    }
  };
}
export {
  GH_MISSING_MESSAGE,
  defaultGhRunner,
  githubPrProvider
};
