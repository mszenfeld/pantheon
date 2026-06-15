import { describe, expect, it } from "vitest"
import { validateConfigFile } from "../../../src/modules/pantheon-config/schema.js"

describe("validateConfigFile", () => {
  it("accepts a valid full config", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.config).toEqual({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.errors).toEqual([])
  })

  it("accepts an empty object as empty config", () => {
    const result = validateConfigFile({})
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors).toEqual([])
  })

  it("accepts an empty agents map", () => {
    const result = validateConfigFile({ agents: {} })
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors).toEqual([])
  })

  it("rejects non-object top level", () => {
    const result = validateConfigFile("nope")
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors[0]).toMatch(/top-level must be object/i)
  })

  it("rejects model without slash", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "no-slash-here" } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model "no-slash-here"/)
  })

  it("accepts aggregator-prefixed model strings (e.g. openrouter)", () => {
    // OpenRouter and similar aggregators publish models under a nested path
    // like `openrouter/openai/gpt-5.5`. The schema must accept these even
    // though they contain more than one slash.
    const result = validateConfigFile({
      agents: {
        perun: { model: "openrouter/openai/gpt-5.5" },
        zmora: { model: "openrouter/anthropic/claude-3.5-sonnet" },
      },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "openrouter/openai/gpt-5.5" },
      zmora: { model: "openrouter/anthropic/claude-3.5-sonnet" },
    })
    expect(result.errors).toEqual([])
  })

  it("rejects empty segments in multi-slash paths", () => {
    // CWE-117 protection — empty segments would produce ambiguous identifiers
    // and may indicate malformed input. Allowed structure: 2+ non-empty
    // segments separated by single slashes.
    const cases = ["a//b", "/leading", "trailing/", "a/b/", "//"]
    for (const model of cases) {
      const result = validateConfigFile({
        agents: { perun: { model } },
      })
      expect(result.config.agents, `should reject ${model}`).toEqual({})
      expect(result.errors[0], `should reject ${model}`).toMatch(
        /invalid model/,
      )
    }
  })

  it("rejects models containing control characters or whitespace (CWE-117)", () => {
    // The `[A-Za-z0-9._-]` allow-list intentionally excludes ESC, newlines,
    // BiDi marks, zero-width chars, and tabs — none of which appear in real
    // OpenCode model identifiers but all of which could corrupt downstream
    // TUI logs if allowed through.
    const cases = [
      "anthropic/claude\x1b[31m-opus",
      "anthropic/claude\nopus",
      "anthropic/claude‮opus",
      "anthropic/claude opus",
      "anthropic/claude\topus",
    ]
    for (const model of cases) {
      const result = validateConfigFile({
        agents: { perun: { model } },
      })
      expect(
        result.config.agents,
        `should reject ${JSON.stringify(model)}`,
      ).toEqual({})
      expect(
        result.errors[0],
        `should reject ${JSON.stringify(model)}`,
      ).toMatch(/invalid model/)
    }
  })

  it("rejects non-string model", () => {
    const result = validateConfigFile({
      agents: { perun: { model: 42 } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model/)
  })

  it("preserves valid agents alongside invalid ones", () => {
    const result = validateConfigFile({
      agents: {
        perun: { model: "anthropic/claude-opus-4-7" },
        broken: { model: "no-slash" },
      },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors).toHaveLength(1)
  })

  it("silently skips unknown top-level sections (forward-compatible per docs)", () => {
    const result = validateConfigFile({ dispatch: { maxParallel: 4 } })
    expect(result.config).toEqual({ agents: {} })
    // Per docs/configuring-agents.md FAQ, unknown sections are ignored
    // without surfacing to the user — `errors[]` triggers a warning toast,
    // and a documented forward-compat feature must not produce a warning.
    expect(result.errors).toEqual([])
  })

  it("silently skips unknown top-level sections alongside valid agents", () => {
    const result = validateConfigFile({
      dispatch: { maxParallel: 4 },
      logging: { level: "debug" },
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors).toEqual([])
  })

  it("warns on unknown field under agent but keeps model", () => {
    const result = validateConfigFile({
      agents: {
        perun: { model: "anthropic/claude-opus-4-7", temperature: 0.5 },
      },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(
      result.errors.some((e) =>
        /unknown field "agents\.perun\.temperature"/.test(e),
      ),
    ).toBe(true)
  })

  it("includes sourcePath in error messages when provided", () => {
    const result = validateConfigFile("nope", "/etc/example.json")
    expect(result.errors[0]).toContain("/etc/example.json")
  })

  it("neutralizes ANSI/control bytes in agent names and unknown field names (CWE-117)", () => {
    // JSON allows any Unicode string as an object key. Without neutralization
    // at the source, a malicious pantheon.json could inject ANSI escape
    // sequences, C0/C1 control bytes, BiDi overrides, or zero-width chars
    // through `Object.entries(agents)` keys directly into `errors[]`, which
    // is forwarded to console.error and `client.tui.showToast`. The lookup
    // against KNOWN_AGENT_FIELDS must still use the raw key — only the
    // rendered form is neutralized.
    const result = validateConfigFile({
      agents: {
        // ESC[31m (red) + BiDi RLO + zero-width space inside the agent name
        "evil\x1b[31m‮agent​": "not-an-object",
      },
    })
    const joined = result.errors.join("\n")
    expect(joined).not.toMatch(/\x1b/)
    expect(joined).not.toMatch(/[‪-‮⁦-⁩]/)
    expect(joined).not.toMatch(/[​-‍﻿]/)
    expect(joined).toMatch(/agents\.evilagent must be object/)
  })

  it("neutralizes control bytes in unknown field names (CWE-117)", () => {
    const result = validateConfigFile({
      agents: {
        perun: {
          model: "anthropic/claude-opus-4-7",
          // ESC sequence inside the field name
          "temp\x1b[31merature": 0.5,
        },
      },
    })
    const joined = result.errors.join("\n")
    expect(joined).not.toMatch(/\x1b/)
    expect(joined).toMatch(/unknown field "agents\.perun\.temperature"/)
  })

  it("neutralizes control bytes in invalid model values (CWE-117)", () => {
    // String models that fail MODEL_REGEX still get echoed back in the error
    // message — neutralize the rendered form so they cannot smuggle ANSI
    // sequences through the validation reporter.
    const result = validateConfigFile({
      agents: { perun: { model: "bad\x1b[31mmodel" } },
    })
    const joined = result.errors.join("\n")
    expect(joined).not.toMatch(/\x1b/)
    expect(joined).toMatch(/invalid model "badmodel"/)
  })

  it("truncates oversized model strings in the error message (CWE-117)", () => {
    // A hostile pantheon.json can stuff a multi-megabyte string into
    // `agent.model`. Even after neutralization the rendered form would flood
    // `console.error` and make the warning toast unreadable, so the renderer
    // caps the shown value at MAX_SHOWN_LEN (120 chars) with a trailing
    // ellipsis.
    const oversized = "x".repeat(10_000)
    const result = validateConfigFile({
      agents: { perun: { model: oversized } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0]!
    // The error must contain `invalid model "<cap>…"` — the cap is 120 chars
    // of 'x' plus the ellipsis, so the rendered field is bounded.
    expect(msg).toMatch(/invalid model "x{120}…"/)
    // Sanity: the whole error line must not contain anywhere near the full
    // 10k bytes of payload.
    expect(msg.length).toBeLessThan(500)
  })

  it("neutralizes and truncates non-string model with hostile toString (CWE-117)", () => {
    // JSONC permits structured values where a string is expected. A non-string
    // `model` reaches the `String(model)` coercion, which runs a
    // caller-supplied `toString` — that's an attacker-controlled bytes source.
    // The neutralizer must apply to the non-string branch too, and the result
    // must still be capped.
    const hostile = {
      toString: () => `\x1b[31mEVIL${"A".repeat(10_000)}`,
    }
    const result = validateConfigFile({
      agents: { perun: { model: hostile } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors).toHaveLength(1)
    const msg = result.errors[0]!
    // ESC byte must be stripped.
    expect(msg).not.toMatch(/\x1b/)
    // The "EVIL" payload survives (it is printable ASCII) but the appended
    // 10k 'A' characters must be capped — so the rendered form ends with the
    // ellipsis, not raw bytes.
    expect(msg).toMatch(/invalid model "EVILA{116}…"/)
    expect(msg.length).toBeLessThan(500)
  })
})

describe("validateConfigFile – extraTools", () => {
  // §3.2 HEADLINE: extraTools-only agent (no model) must NOT be dropped
  it("stores stribog with only extraTools (no model) — guard for §3.2 store-fix", () => {
    const result = validateConfigFile({
      agents: { stribog: { extraTools: ["supabase_*"] } },
    })
    expect(result.config.agents.stribog).toEqual({ extraTools: ["supabase_*"] })
    expect(result.errors).toEqual([])
  })

  it("stores both model and extraTools when both are provided", () => {
    const result = validateConfigFile({
      agents: {
        stribog: {
          model: "openai/gpt-5.4",
          extraTools: ["supabase_*", "supabase_execute_sql"],
        },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      model: "openai/gpt-5.4",
      extraTools: ["supabase_*", "supabase_execute_sql"],
    })
    expect(result.errors).toEqual([])
  })

  it("existing model-only snapshots remain unchanged (model stored without extraTools key)", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.config.agents.perun).toEqual({
      model: "anthropic/claude-opus-4-7",
    })
    expect(result.errors).toEqual([])
  })

  // Valid pattern: serena_* — accepted at schema time (runtime denies children)
  it("accepts serena_* as a valid extraTools entry (broad glob is runtime-only concern)", () => {
    const result = validateConfigFile({
      agents: { stribog: { extraTools: ["serena_*"] } },
    })
    expect(result.config.agents.stribog).toEqual({ extraTools: ["serena_*"] })
    expect(result.errors).toEqual([])
  })

  // Invalid entries dropped, valid siblings kept, errors recorded
  it("drops CamelCase entry, keeps valid sibling, pushes error", () => {
    const result = validateConfigFile({
      agents: {
        stribog: { extraTools: ["CamelCase", "supabase_execute_sql"] },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      extraTools: ["supabase_execute_sql"],
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/CamelCase/)
  })

  it("drops entry with a space, keeps valid sibling, pushes error", () => {
    const result = validateConfigFile({
      agents: {
        stribog: { extraTools: ["with space", "supabase_execute_sql"] },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      extraTools: ["supabase_execute_sql"],
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/with space/)
  })

  it("drops execute_recipe (denied id), keeps valid sibling, pushes error", () => {
    const result = validateConfigFile({
      agents: {
        stribog: { extraTools: ["execute_recipe", "supabase_execute_sql"] },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      extraTools: ["supabase_execute_sql"],
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/execute_recipe/)
  })

  it("drops execute_* glob (covers denied id), keeps valid sibling, pushes error", () => {
    const result = validateConfigFile({
      agents: {
        stribog: { extraTools: ["execute_*", "supabase_execute_sql"] },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      extraTools: ["supabase_execute_sql"],
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/execute_\*/)
  })

  it("drops supabase_delete_rows (exact denied by capability), keeps valid sibling, pushes error", () => {
    const result = validateConfigFile({
      agents: {
        stribog: {
          extraTools: ["supabase_delete_rows", "supabase_execute_sql"],
        },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      extraTools: ["supabase_execute_sql"],
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/supabase_delete_rows/)
  })

  it("errors when extraTools is not an array", () => {
    const result = validateConfigFile({
      agents: { stribog: { extraTools: "supabase_*" } },
    })
    expect(result.config.agents.stribog).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/extraTools.*array/i)
  })

  it("emits diagnostic/warning when non-stribog agent uses extraTools", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7", extraTools: ["supabase_*"] } },
    })
    // extraTools on non-stribog should be warned about
    expect(
      result.errors.some((e) => /extraTools/.test(e) && /perun/.test(e)),
    ).toBe(true)
    // ...and extraTools must NOT be smuggled into the stored non-stribog agent shape.
    expect(result.config.agents.perun).toEqual({
      model: "anthropic/claude-opus-4-7",
    })
  })

  it("stores nothing for an empty extraTools array (no model) and emits no error", () => {
    const result = validateConfigFile({
      agents: { stribog: { extraTools: [] } },
    })
    expect(result.config.agents.stribog).toBeUndefined()
    expect(result.errors).toEqual([])
  })

  it("stores nothing when every extraTools entry is invalid, but records each error", () => {
    const result = validateConfigFile({
      agents: { stribog: { extraTools: ["CamelCase", "execute_recipe"] } },
    })
    expect(result.config.agents.stribog).toBeUndefined()
    expect(result.errors).toHaveLength(2)
  })

  it("drops a non-string entry, keeps the valid sibling, pushes an error", () => {
    const result = validateConfigFile({
      agents: {
        stribog: { extraTools: [42, "supabase_execute_sql"] },
      },
    })
    expect(result.config.agents.stribog).toEqual({
      extraTools: ["supabase_execute_sql"],
    })
    expect(result.errors).toHaveLength(1)
  })
})
