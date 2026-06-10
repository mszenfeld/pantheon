const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"];
const ACTUATOR_BASH_TOOLS = [
  "Bash(docker:*)",
  "Bash(docker compose:*)",
  "Bash(make:*)",
  "Bash(npm:*)",
  "Bash(pnpm:*)",
  "Bash(bun:*)",
  "Bash(uv:*)",
  "Bash(curl:*)"
];
const READONLY_GIT_TOOLS = [
  "Bash(git --no-pager log:*)",
  "Bash(git --no-pager blame:*)",
  "Bash(git --no-pager status:*)",
  "Bash(git --no-pager diff:*)"
];
const STRIBOG_TOOLS = [
  ...STRUCTURED_TOOLS,
  ...ACTUATOR_BASH_TOOLS,
  ...READONLY_GIT_TOOLS
];
export {
  STRIBOG_TOOLS
};
