import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  isProviderConfigured,
  loadAuthConfiguredProviders,
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
  // These cases isolate the config.provider leg, so the auth.json signal is
  // pinned to an explicit empty set — without it the default parameter reads
  // the developer's REAL auth.json and the "absent" cases flip on any machine
  // that has run `opencode auth login`.
  const noAuth: ReadonlySet<string> = new Set()

  it("returns true when the provider is wired under config.provider", () => {
    const config: ProviderConfigLike = {
      provider: { openai: {}, anthropic: {} },
    }
    expect(isProviderConfigured(config, "openai", noAuth)).toBe(true)
  })

  it("returns false when the provider key is absent from config.provider", () => {
    expect(
      isProviderConfigured({ provider: { anthropic: {} } }, "openai", noAuth),
    ).toBe(false)
  })

  it("returns false when there is no provider map", () => {
    expect(isProviderConfigured({}, "openai", noAuth)).toBe(false)
  })

  it("returns false for a null provider map (malformed config)", () => {
    expect(
      isProviderConfigured({ provider: null } as never, "openai", noAuth),
    ).toBe(false)
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

/**
 * Providers wired via `opencode auth login` (OAuth or API key) live in
 * opencode's auth.json, NOT in `config.provider` — the original probe was
 * blind to them, so a fresh `opencode auth login openai` still tripped the
 * "provider not configured" degraded path and silently unpinned stribog's
 * default. These tests pin the auth.json signal.
 */
describe("loadAuthConfiguredProviders", () => {
  let tmpAuthDir: string

  beforeEach(() => {
    tmpAuthDir = mkdtempSync(path.join(tmpdir(), "pantheon-auth-"))
  })

  afterEach(() => {
    rmSync(tmpAuthDir, { recursive: true, force: true })
  })

  function writeAuthFile(content: string): string {
    const file = path.join(tmpAuthDir, "auth.json")
    writeFileSync(file, content)
    return file
  }

  it("collects provider ids that have a typed auth entry", () => {
    const file = writeAuthFile(
      JSON.stringify({
        openai: { type: "oauth", access: "tok" },
        openrouter: { type: "api", key: "sk-x" },
      }),
    )
    expect(loadAuthConfiguredProviders(file)).toEqual(
      new Set(["openai", "openrouter"]),
    )
  })

  it("skips entries that are not records or lack a string type", () => {
    const file = writeAuthFile(
      JSON.stringify({
        openai: { type: "oauth" },
        broken: "not-a-record",
        typeless: { key: "sk-x" },
      }),
    )
    expect(loadAuthConfiguredProviders(file)).toEqual(new Set(["openai"]))
  })

  it("returns an empty set when the file is missing", () => {
    expect(
      loadAuthConfiguredProviders(path.join(tmpAuthDir, "absent.json")),
    ).toEqual(new Set())
  })

  it("returns an empty set when the file is corrupt JSON", () => {
    const file = writeAuthFile("{ not json")
    expect(loadAuthConfiguredProviders(file)).toEqual(new Set())
  })

  it("returns an empty set when the top-level value is not a record", () => {
    const file = writeAuthFile(`["openai"]`)
    expect(loadAuthConfiguredProviders(file)).toEqual(new Set())
  })
})

describe("isProviderConfigured — auth.json signal", () => {
  it("returns true when the provider is auth-configured but absent from config.provider", () => {
    const config: ProviderConfigLike = { provider: { ollama: {} } }
    expect(isProviderConfigured(config, "openai", new Set(["openai"]))).toBe(
      true,
    )
  })

  it("returns true via auth even when there is no provider map at all", () => {
    expect(isProviderConfigured({}, "openai", new Set(["openai"]))).toBe(true)
  })

  it("disabled_providers wins over an auth entry (explicit opt-out)", () => {
    const config: ProviderConfigLike = { disabled_providers: ["openai"] }
    expect(isProviderConfigured(config, "openai", new Set(["openai"]))).toBe(
      false,
    )
  })

  it("a non-empty enabled_providers omitting the provider wins over an auth entry", () => {
    const config: ProviderConfigLike = { enabled_providers: ["anthropic"] }
    expect(isProviderConfigured(config, "openai", new Set(["openai"]))).toBe(
      false,
    )
  })

  it("returns false when neither config.provider nor auth knows the provider", () => {
    const config: ProviderConfigLike = { provider: { ollama: {} } }
    expect(isProviderConfigured(config, "openai", new Set(["google"]))).toBe(
      false,
    )
  })

  it("resolves the default auth.json path under XDG_DATA_HOME/opencode", () => {
    const tmpData = mkdtempSync(path.join(tmpdir(), "pantheon-xdg-"))
    const origXdg = process.env["XDG_DATA_HOME"]
    try {
      process.env["XDG_DATA_HOME"] = tmpData
      const dir = path.join(tmpData, "opencode")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        path.join(dir, "auth.json"),
        JSON.stringify({ openai: { type: "oauth" } }),
      )
      // No explicit auth set: the default leg must read the XDG location.
      expect(isProviderConfigured({}, "openai")).toBe(true)
    } finally {
      if (origXdg === undefined) delete process.env["XDG_DATA_HOME"]
      else process.env["XDG_DATA_HOME"] = origXdg
      rmSync(tmpData, { recursive: true, force: true })
    }
  })
})
