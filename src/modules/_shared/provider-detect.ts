// Advisory-only provider probe for the harness's ONE pinned default
// (`DEFAULT_STRIBOG_MODEL = "openai/gpt-5.4"`). A fresh install on the
// opencode-subscription / Anthropic-only path has no `openai` provider, so
// unconditionally pinning that default produces a stribog whose dispatch fails
// at model resolution. This probe lets the caller fall back to the session
// default (leave the model unset) when the required provider is absent — never
// a security control, only a "don't pin an unresolvable model" guard.
//
// Structural ConfigLike (rather than the SDK `Config` type) keeps the probe
// decoupled from the exact SDK shape; we only read the three fields that decide
// whether a provider is usable. opencode is default-ALLOW for providers, so a
// provider counts as available unless the user explicitly turned it off.
//
// Two positive signals feed the probe:
//   1. `config.provider` — providers the user declared in opencode.json;
//   2. opencode's auth.json — providers wired via `opencode auth login`
//      (OAuth or API key). These are auto-loaded by the server and NEVER
//      appear under `config.provider`, so without this leg the probe
//      false-negatived on the most common setup path and unpinned the
//      default for users whose provider worked fine. Same approach as
//      oh-my-openagent's opencode-provider-auth module.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export interface ProviderConfigLike {
  // `config.provider` is "Custom provider configurations and model overrides"
  // (SDK `Config.provider`). A provider key being present here is the strongest
  // locally-available signal at config-assembly time that the provider is wired
  // (custom base URL, key, or model overrides). Auto-loaded providers (env/auth)
  // may NOT appear here, so absence is treated as advisory — see isProviderConfigured.
  provider?: Record<string, unknown>
  // SDK `Config.disabled_providers` — "Disable providers that are loaded
  // automatically". An entry here is an explicit, authoritative opt-OUT.
  disabled_providers?: string[]
  // SDK `Config.enabled_providers` — "When set, ONLY these providers will be
  // enabled. All other providers will be ignored." A non-empty allow-list that
  // omits the provider is an explicit opt-OUT.
  enabled_providers?: string[]
}

/** The provider id embedded in a `provider/model` string (the part before the
 *  first `/`). Returns the whole string when there is no slash. */
export function providerIdOf(model: string): string {
  const slash = model.indexOf("/")
  return slash === -1 ? model : model.slice(0, slash)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** opencode's auth store: `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`. */
function defaultAuthFilePath(): string {
  const dataDir =
    process.env["XDG_DATA_HOME"] ?? path.join(homedir(), ".local", "share")
  return path.join(dataDir, "opencode", "auth.json")
}

/**
 * Provider ids with an entry in opencode's auth.json (`opencode auth login`).
 * An entry counts when it is a record with a string `type` ("oauth", "api",
 * ...) — the shape the opencode CLI writes. Any read/parse failure degrades to
 * an empty set: the probe then behaves exactly as it did before this signal
 * existed (advisory-only, never throws into the config hook).
 */
export function loadAuthConfiguredProviders(
  authFilePath: string = defaultAuthFilePath(),
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(authFilePath, "utf-8"))
    if (!isRecord(parsed)) return new Set()
    const ids = new Set<string>()
    for (const [providerId, entry] of Object.entries(parsed)) {
      if (isRecord(entry) && typeof entry["type"] === "string") {
        ids.add(providerId)
      }
    }
    return ids
  } catch {
    return new Set()
  }
}

/**
 * Best-effort: is the given provider id usable for this config?
 *
 * Authoritative NO cases (the user explicitly excluded it):
 *   - it appears in `disabled_providers`;
 *   - `enabled_providers` is a non-empty allow-list that omits it.
 *
 * Otherwise we treat it as available IF the user wired it under
 * `config.provider` OR it has an auth.json entry (`opencode auth login`).
 * Env-key-only providers (e.g. a bare OPENAI_API_KEY) still need not appear
 * in either, so a double absence is NOT conclusive — but for the harness's
 * single pinned default the safe degraded action is to NOT pin (fall back to
 * the session default) and surface a one-time toast, which this enables.
 */
export function isProviderConfigured(
  config: ProviderConfigLike,
  providerId: string,
  authProviders: ReadonlySet<string> = loadAuthConfiguredProviders(),
): boolean {
  const disabled = config.disabled_providers
  if (Array.isArray(disabled) && disabled.includes(providerId)) return false

  const enabled = config.enabled_providers
  if (
    Array.isArray(enabled) &&
    enabled.length > 0 &&
    !enabled.includes(providerId)
  )
    return false

  const providers = config.provider
  if (
    providers !== null &&
    typeof providers === "object" &&
    Object.prototype.hasOwnProperty.call(providers, providerId)
  )
    return true

  return authProviders.has(providerId)
}
