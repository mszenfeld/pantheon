interface ProviderConfigLike {
    provider?: Record<string, unknown>;
    disabled_providers?: string[];
    enabled_providers?: string[];
}
/** The provider id embedded in a `provider/model` string (the part before the
 *  first `/`). Returns the whole string when there is no slash. */
declare function providerIdOf(model: string): string;
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
declare function isProviderConfigured(config: ProviderConfigLike, providerId: string): boolean;

export { type ProviderConfigLike, isProviderConfigured, providerIdOf };
