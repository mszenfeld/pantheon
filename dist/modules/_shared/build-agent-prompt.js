import { loadModuleAsset } from "./load-asset.js";
function buildAgentPrompt(info, tools, assetUrl, assetName) {
  const frontmatter = [
    "---",
    `name: ${info.name}`,
    `description: ${info.description}`,
    `mode: ${info.mode}`,
    `allowed-tools: ${tools.join(", ")}`,
    "---"
  ].join("\n");
  const body = loadModuleAsset(assetUrl, assetName);
  return `${frontmatter}

${body}`;
}
export {
  buildAgentPrompt
};
