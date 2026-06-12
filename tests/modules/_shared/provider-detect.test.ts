import { describe, expect, it } from "vitest"
import {
  isProviderConfigured,
  providerIdOf,
  type ProviderConfigLike,
} from "../../../src/modules/_shared/provider-detect.js"

describe("providerIdOf", () => {
  it("extracts the provider id before the first slash", () => {
    expect(providerIdOf("openai/gpt-5.4")).toBe("openai")
    expect(providerIdOf("anthropic/claude-opus-4-7")).toBe("anthropic")
  })

  it("keeps a model id intact when there is no slash", () => {
    expect(providerIdOf("gpt-5.4")).toBe("gpt-5.4")
  })

  it("splits only on the first slash", () => {
    expect(providerIdOf("opencode/some/nested")).toBe("opencode")
  })
})

describe("isProviderConfigured", () => {
  it("returns true when the provider is wired under config.provider", () => {
    const config: ProviderConfigLike = {
      provider: { openai: {}, anthropic: {} },
    }
    expect(isProviderConfigured(config, "openai")).toBe(true)
  })

  it("returns false when the provider key is absent from config.provider", () => {
    expect(
      isProviderConfigured({ provider: { anthropic: {} } }, "openai"),
    ).toBe(false)
  })

  it("returns false when there is no provider map", () => {
    expect(isProviderConfigured({}, "openai")).toBe(false)
  })

  it("returns false for a null provider map (malformed config)", () => {
    expect(isProviderConfigured({ provider: null } as never, "openai")).toBe(
      false,
    )
  })

  it("returns false when the provider is in disabled_providers (even if configured)", () => {
    const config: ProviderConfigLike = {
      provider: { openai: {} },
      disabled_providers: ["openai"],
    }
    expect(isProviderConfigured(config, "openai")).toBe(false)
  })

  it("returns false when a non-empty enabled_providers omits the provider", () => {
    const config: ProviderConfigLike = {
      provider: { openai: {} },
      enabled_providers: ["anthropic"],
    }
    expect(isProviderConfigured(config, "openai")).toBe(false)
  })

  it("returns true when enabled_providers explicitly lists the provider", () => {
    const config: ProviderConfigLike = {
      provider: { openai: {} },
      enabled_providers: ["openai", "anthropic"],
    }
    expect(isProviderConfigured(config, "openai")).toBe(true)
  })

  it("ignores an empty enabled_providers list (treated as no allow-list)", () => {
    const config: ProviderConfigLike = {
      provider: { openai: {} },
      enabled_providers: [],
    }
    expect(isProviderConfigured(config, "openai")).toBe(true)
  })
})
