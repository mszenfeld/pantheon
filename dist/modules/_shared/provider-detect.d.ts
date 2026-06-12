interface ProviderConfigLike {
    provider?: Record<string, unknown>;
    disabled_providers?: string[];
    enabled_providers?: string[];
}
/** The provider id embedded in a `provider/model` string (the part before the
 *  first `/`). Returns the whole string when there is no slash. */
declare function providerIdOf(model: string): string;
/**
 * Provider ids with an entry in opencode's auth.json (`opencode auth login`).
 * An entry counts when it is a record with a string `type` ("oauth", "api",
 * ...) — the shape the opencode CLI writes. Any read/parse failure degrades to
 * an empty set: the probe then behaves exactly as it did before this signal
 * existed (advisory-only, never throws into the config hook).
 */
declare function loadAuthConfiguredProviders(authFilePath?: string): Set<string>;
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
declare function isProviderConfigured(config: ProviderConfigLike, providerId: string, authProviders?: ReadonlySet<string>): boolean;

export { type ProviderConfigLike, isProviderConfigured, loadAuthConfiguredProviders, providerIdOf };
