function providerIdOf(model) {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(0, slash);
}
function isProviderConfigured(config, providerId) {
  const disabled = config.disabled_providers;
  if (Array.isArray(disabled) && disabled.includes(providerId)) return false;
  const enabled = config.enabled_providers;
  if (Array.isArray(enabled) && enabled.length > 0 && !enabled.includes(providerId))
    return false;
  const providers = config.provider;
  if (providers === null || typeof providers !== "object") return false;
  return Object.prototype.hasOwnProperty.call(providers, providerId);
}
export {
  isProviderConfigured,
  providerIdOf
};
