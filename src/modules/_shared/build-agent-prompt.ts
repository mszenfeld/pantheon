import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"
import { loadModuleAsset } from "./load-asset.js"

/**
 * Assembles a specialist agent's full prompt: a YAML frontmatter block built
 * from the agent's registered metadata, followed by the agent's markdown body.
 *
 * Extracted from the three byte-identical per-agent builders
 * (`stribog/prompt.ts`, `explore/prompt.ts`, `plan/prompt.ts`) so that
 * absorbing a new specialist — the dominant migration move — is a one-line
 * call rather than another hand-copied builder that has to be kept in lockstep.
 *
 * Asset resolution intentionally rides the CALLER's location: `loadModuleAsset`
 * resolves `assetName` relative to `assetUrl` (the caller's `import.meta.url`),
 * NOT relative to this `_shared/` file. So `stribog.md` stays a sibling of
 * `stribog/prompt.ts` and is found in both dev (src) and prod (dist) layouts.
 * Pass `import.meta.url` from the caller — never this module's URL.
 *
 * The frontmatter draws `name`/`description`/`mode` from `info` (a
 * `SpecialistInfo`, already the source of truth at registration) and the
 * `allowed-tools` line from `tools`. The values are build-time constants from
 * each agent's `*.metadata.ts` / `allowed-tools.ts` — trusted, not
 * runtime/config-derived — so they are rendered verbatim. Untrusted-output
 * neutralization (`neutralizeUntrustedOutput`) deliberately is NOT applied
 * here: it is a sink-specific transform for attacker-controlled specialist
 * results and would mangle legitimate frontmatter (e.g. en/em dashes are fine,
 * but it HTML-escapes `<`/`>` and strips control bytes). If a future agent ever
 * sources these strings from `pantheon.json`, sanitize at THAT ingestion edge
 * (in `pantheon-config/`), not in this trusted renderer.
 *
 * @param info      Specialist metadata supplying `name`, `description`, `mode`.
 * @param tools     Declared allow-list rendered into the `allowed-tools:` line.
 * @param assetUrl  The caller's `import.meta.url` (asset is resolved against it).
 * @param assetName Markdown body filename, sibling of the caller (e.g. `stribog.md`).
 */
export function buildAgentPrompt(
  info: SpecialistInfo,
  tools: readonly string[],
  assetUrl: string,
  assetName: string,
): string {
  const frontmatter = [
    "---",
    `name: ${info.name}`,
    `description: ${info.description}`,
    `mode: ${info.mode}`,
    `allowed-tools: ${tools.join(", ")}`,
    "---",
  ].join("\n")
  const body = loadModuleAsset(assetUrl, assetName)
  return `${frontmatter}\n\n${body}`
}
