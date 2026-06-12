import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  applyModelOverride,
  captureUserModels,
  registerKnownSlug,
  getKnownSlugs,
  getUnknownAgentDiagnostics,
  __resetKnownSlugsForTests,
  type ModelConfigLike,
} from "../../../src/modules/_shared/apply-model-override.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("applyModelOverride", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    __resetKnownSlugsForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-model-override-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
    __resetKnownSlugsForTests()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  it("applies the override to a single agent key when slug==key", () => {
    writeUserGlobal(
      `{ "agents": { "triglav": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    const config: ModelConfigLike = { agent: { triglav: {} } }
    applyModelOverride(config, "triglav", "triglav")
    expect(config.agent!.triglav!.model).toBe("anthropic/claude-opus-4-7")
  })

  it("maps a slug to a different display-name key (veles → 'Veles - Planner')", () => {
    writeUserGlobal(
      `{ "agents": { "veles": { "model": "anthropic/claude-sonnet-4-6" } } }`,
    )
    const config: ModelConfigLike = { agent: { "Veles - Planner": {} } }
    applyModelOverride(config, "veles", "Veles - Planner")
    expect(config.agent!["Veles - Planner"]!.model).toBe(
      "anthropic/claude-sonnet-4-6",
    )
  })

  it("fans one slug out to multiple keys (zmora → zmora-fe/be/setup)", () => {
    writeUserGlobal(
      `{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`,
    )
    const config: ModelConfigLike = {
      agent: { "zmora-fe": {}, "zmora-be": {}, "zmora-setup": {} },
    }
    applyModelOverride(config, "zmora", ["zmora-fe", "zmora-be", "zmora-setup"])
    expect(config.agent!["zmora-fe"]!.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.agent!["zmora-be"]!.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.agent!["zmora-setup"]!.model).toBe(
      "anthropic/claude-sonnet-4-6",
    )
  })

  it("leaves model unset when no override and no default", () => {
    const config: ModelConfigLike = { agent: { triglav: {} } }
    applyModelOverride(config, "triglav", "triglav")
    expect(config.agent!.triglav!.model).toBeUndefined()
  })

  it("falls back to the default model when no override is present", () => {
    const config: ModelConfigLike = { agent: { stribog: {} } }
    applyModelOverride(config, "stribog", "stribog", "openai/gpt-5.4")
    expect(config.agent!.stribog!.model).toBe("openai/gpt-5.4")
  })

  it("override wins over the default model", () => {
    writeUserGlobal(
      `{ "agents": { "stribog": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    const config: ModelConfigLike = { agent: { stribog: {} } }
    applyModelOverride(config, "stribog", "stribog", "openai/gpt-5.4")
    expect(config.agent!.stribog!.model).toBe("anthropic/claude-opus-4-7")
  })

  it("registers the slug regardless of whether an override exists", () => {
    applyModelOverride({ agent: { triglav: {} } }, "triglav", "triglav")
    applyModelOverride({ agent: { perun: {} } }, "perun", "perun")
    expect(getKnownSlugs()).toEqual(["perun", "triglav"])
  })

  it("does not throw when a mapped key is missing from config.agent", () => {
    const config: ModelConfigLike = { agent: {} }
    writeUserGlobal(
      `{ "agents": { "triglav": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    expect(() => applyModelOverride(config, "triglav", "triglav")).not.toThrow()
  })

  it("does not throw when config.agent is undefined", () => {
    const config: ModelConfigLike = {}
    writeUserGlobal(
      `{ "agents": { "triglav": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    expect(() => applyModelOverride(config, "triglav", "triglav")).not.toThrow()
  })

  // M11 precedence contract: opencode.json `agent.<name>.model` > pantheon.json
  // > harness default. The user model arrives via the `userModels` snapshot a
  // module takes (captureUserModels) BEFORE its wholesale replace.
  describe("opencode.json precedence (M11)", () => {
    it("user opencode.json model wins over a pantheon.json override", () => {
      writeUserGlobal(
        `{ "agents": { "stribog": { "model": "anthropic/claude-opus-4-7" } } }`,
      )
      const config: ModelConfigLike = { agent: { stribog: {} } }
      const userModels = new Map([["stribog", "openrouter/openai/gpt-5.5"]])
      applyModelOverride(
        config,
        "stribog",
        "stribog",
        "openai/gpt-5.4",
        userModels,
      )
      expect(config.agent!.stribog!.model).toBe("openrouter/openai/gpt-5.5")
    })

    it("user opencode.json model wins over the harness default", () => {
      const config: ModelConfigLike = { agent: { stribog: {} } }
      const userModels = new Map([["stribog", "anthropic/claude-sonnet-4-6"]])
      applyModelOverride(
        config,
        "stribog",
        "stribog",
        "openai/gpt-5.4",
        userModels,
      )
      expect(config.agent!.stribog!.model).toBe("anthropic/claude-sonnet-4-6")
    })

    it("falls back to pantheon override when no user model was captured", () => {
      writeUserGlobal(
        `{ "agents": { "triglav": { "model": "anthropic/claude-opus-4-7" } } }`,
      )
      const config: ModelConfigLike = { agent: { triglav: {} } }
      applyModelOverride(config, "triglav", "triglav", undefined, new Map())
      expect(config.agent!.triglav!.model).toBe("anthropic/claude-opus-4-7")
    })

    it("falls back to the harness default when neither user nor override is set", () => {
      const config: ModelConfigLike = { agent: { stribog: {} } }
      applyModelOverride(
        config,
        "stribog",
        "stribog",
        "openai/gpt-5.4",
        new Map(),
      )
      expect(config.agent!.stribog!.model).toBe("openai/gpt-5.4")
    })

    it("resolves precedence per key for a fanned-out slug (zmora)", () => {
      // User pins only zmora-be; pantheon overrides the slug. zmora-be keeps the
      // user value, the other two take the override.
      writeUserGlobal(
        `{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`,
      )
      const config: ModelConfigLike = {
        agent: { "zmora-fe": {}, "zmora-be": {}, "zmora-setup": {} },
      }
      const userModels = new Map([["zmora-be", "anthropic/claude-opus-4-7"]])
      applyModelOverride(
        config,
        "zmora",
        ["zmora-fe", "zmora-be", "zmora-setup"],
        undefined,
        userModels,
      )
      expect(config.agent!["zmora-be"]!.model).toBe("anthropic/claude-opus-4-7")
      expect(config.agent!["zmora-fe"]!.model).toBe(
        "anthropic/claude-sonnet-4-6",
      )
      expect(config.agent!["zmora-setup"]!.model).toBe(
        "anthropic/claude-sonnet-4-6",
      )
    })
  })
})

describe("captureUserModels", () => {
  it("snapshots a single key's pre-existing model", () => {
    const config: ModelConfigLike = {
      agent: { stribog: { model: "anthropic/claude-opus-4-7" } },
    }
    expect(captureUserModels(config, "stribog")).toEqual(
      new Map([["stribog", "anthropic/claude-opus-4-7"]]),
    )
  })

  it("snapshots only keys that actually carry a model", () => {
    const config: ModelConfigLike = {
      agent: {
        "zmora-fe": { model: "anthropic/claude-sonnet-4-6" },
        "zmora-be": {},
        "zmora-setup": { model: "openai/gpt-5.4" },
      },
    }
    const captured = captureUserModels(config, [
      "zmora-fe",
      "zmora-be",
      "zmora-setup",
    ])
    expect(captured).toEqual(
      new Map([
        ["zmora-fe", "anthropic/claude-sonnet-4-6"],
        ["zmora-setup", "openai/gpt-5.4"],
      ]),
    )
  })

  it("returns an empty map when no keys carry a model", () => {
    const config: ModelConfigLike = { agent: { stribog: {} } }
    expect(captureUserModels(config, "stribog").size).toBe(0)
  })

  it("returns an empty map when config.agent is undefined", () => {
    expect(captureUserModels({}, "stribog").size).toBe(0)
  })

  it("ignores an empty-string model", () => {
    const config: ModelConfigLike = { agent: { stribog: { model: "" } } }
    expect(captureUserModels(config, "stribog").size).toBe(0)
  })
})

describe("getUnknownAgentDiagnostics", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    __resetKnownSlugsForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-unknown-slug-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
    __resetKnownSlugsForTests()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  it("returns no diagnostics when every configured agent is a known slug", () => {
    writeUserGlobal(
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    registerKnownSlug("perun")
    expect(getUnknownAgentDiagnostics()).toEqual([])
  })

  it("flags an unknown slug (typo) with the known-slug list", () => {
    writeUserGlobal(
      `{ "agents": { "strigob": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    registerKnownSlug("perun")
    registerKnownSlug("stribog")
    const diagnostics = getUnknownAgentDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toBe(
      `[pantheon] unknown agent "strigob" — known: perun, stribog`,
    )
  })

  it("flags a display-name typo even when the matching slug is known", () => {
    // `veles` is the slug; `Veles - Planner` is the display name. A user who
    // writes the display name into pantheon.json is silently ignored today —
    // this is exactly the M6 failure mode.
    writeUserGlobal(
      `{ "agents": { "Veles - Planner": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    registerKnownSlug("veles")
    const diagnostics = getUnknownAgentDiagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toBe(
      `[pantheon] unknown agent "Veles - Planner" — known: veles`,
    )
  })

  it("flags multiple unknown slugs", () => {
    writeUserGlobal(
      `{ "agents": { "perun": { "model": "a/b" }, "foo": { "model": "a/b" }, "bar": { "model": "a/b" } } }`,
    )
    registerKnownSlug("perun")
    const diagnostics = getUnknownAgentDiagnostics()
    expect(diagnostics).toContain(
      `[pantheon] unknown agent "foo" — known: perun`,
    )
    expect(diagnostics).toContain(
      `[pantheon] unknown agent "bar" — known: perun`,
    )
    expect(diagnostics).toHaveLength(2)
  })

  it("returns no diagnostics when pantheon.json is absent (empty config)", () => {
    registerKnownSlug("perun")
    expect(getUnknownAgentDiagnostics()).toEqual([])
  })
})
