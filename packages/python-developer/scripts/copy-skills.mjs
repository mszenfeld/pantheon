import { fileURLToPath } from "node:url"
import path from "node:path"
import { copyAssets } from "../../../scripts/copy-assets.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))

copyAssets(
  [
    { from: "src/skills", to: "dist/skills", type: "dir" },
    {
      from: "src/agent-prompt.md",
      to: "dist/agent-prompt.md",
      required: false,
    },
    {
      from: "src/commands/python.md",
      to: "dist/commands/python.md",
      required: false,
    },
  ],
  path.resolve(root, ".."),
)
