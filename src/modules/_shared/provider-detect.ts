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

/**
 * Best-effort: is the given provider id usable for this config?
 *
 * Authoritative NO cases (the user explicitly excluded it):
 *   - it appears in `disabled_providers`;
 *   - `enabled_providers` is a non-empty allow-list that omits it.
 *
 * Otherwise we treat it as available IF the user wired it under
 * `config.provider`. Auto-loaded providers (env keys / OAuth) need not appear
 * there, so a bare absence is NOT conclusive — but for the harness's single
 * pinned default the safe degraded action is to NOT pin (fall back to the
 * session default) and surface a one-time toast, which this enables.
 */
export function isProviderConfigured(
  config: ProviderConfigLike,
  providerId: string,
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
  if (providers === null || typeof providers !== "object") return false
  return Object.prototype.hasOwnProperty.call(providers, providerId)
}
