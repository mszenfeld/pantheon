import { describe, expect, it } from "vitest"
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  stribogSpecialistInfo,
} from "../../../src/modules/stribog/stribog.metadata.js"
import {
  STRIBOG_EDIT_BUDGET,
  CORE_BUILTINS,
  STRIBOG_DENIED_TOOLS,
  IMMUTABLE_DENY_NAMED,
  isImmutableDeny,
  validateExtraToolsPattern,
  matchesExtraToolsPattern,
} from "../../../src/modules/stribog/stribog.metadata.js"
import { DISPATCH_TOOL_NAMES } from "../../../src/modules/coordinator/dispatch-tool-names.js"

describe("stribogSpecialistInfo", () => {
  it("uses the bare 'stribog' key and subagent mode", () => {
    expect(STRIBOG_AGENT_KEY).toBe("stribog")
    expect(stribogSpecialistInfo.name).toBe("stribog")
    expect(stribogSpecialistInfo.mode).toBe("subagent")
  })

  it("leaves the unrendered category/cost fields unset (no dead routing metadata)", () => {
    // category/cost have no renderer in buildPerunPrompt; they are intentionally
    // omitted so they cannot advertise a routing signal Perun never sees. The
    // model tier is configured via pantheon.json, not this field.
    expect(stribogSpecialistInfo.metadata.category).toBeUndefined()
    expect(stribogSpecialistInfo.metadata.cost).toBeUndefined()
  })

  it("routes AWAY from secrets and feature work (avoid-when)", () => {
    const avoid =
      stribogSpecialistInfo.metadata.avoidWhen?.join(" ").toLowerCase() ?? ""
    expect(avoid).toContain("secret")
    expect(avoid).toMatch(/feature|main executor/)
  })

  it("routes TOWARD env/config work via the prompt-facing fields", () => {
    // These three fields render verbatim into Perun's routing prompt
    // (buildUseAvoidSection / buildKeyTriggersSection / buildDelegationTable),
    // so blanking any of them would silently de-route stribog. Lock them.
    const { useWhen, keyTrigger, triggers } = stribogSpecialistInfo.metadata

    // useWhen: must be non-empty and describe the env/config doer domain.
    expect(useWhen?.length ?? 0).toBeGreaterThan(0)
    const use = useWhen?.join(" ").toLowerCase() ?? ""
    expect(use).toMatch(/docker|service|environment|config/i)

    // keyTrigger: must be present and name the agent it dispatches to.
    expect(keyTrigger).toBeTruthy()
    expect(keyTrigger ?? "").toContain("stribog")

    // triggers: at least the two delegation rows (env ops + mechanical change).
    expect(triggers.length).toBeGreaterThanOrEqual(2)
    for (const t of triggers) {
      expect(t.domain).toBeTruthy()
      expect(t.trigger).toBeTruthy()
    }
  })

  it("defaults to a valid <provider>/<model> identifier", () => {
    expect(DEFAULT_STRIBOG_MODEL).toMatch(
      /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/,
    )
  })

  it("pins the edit budget at 2", () => {
    expect(STRIBOG_EDIT_BUDGET).toBe(2)
  })

  it("allow-lists exactly the lowercase runtime core builtins the hook enforces", () => {
    expect([...CORE_BUILTINS].sort()).toEqual([
      "bash",
      "edit",
      "glob",
      "grep",
      "read",
      "write",
    ])
  })

  it("denies the non-allow-listed structured tools natively (default-allow opt-out)", () => {
    // Minimum named deny set must be present (the dispatch family + minter + leaf),
    // plus the pre-existing native opt-outs. Asserted as a superset, not equated, so
    // adding further denies does not break this test.
    expect(STRIBOG_DENIED_TOOLS).toMatchObject({
      task: false,
      execute_recipe: false,
      dispatch_parallel: false,
      dispatch_background: false,
      poll_background: false,
      wait_background: false,
      todowrite: false,
      webfetch: false,
      websearch: false,
    })
  })

  it("keeps IMMUTABLE_DENY_NAMED a subset of STRIBOG_DENIED_TOOLS keys (declarative agrees with enforcement)", () => {
    const denyMapKeys = new Set(Object.keys(STRIBOG_DENIED_TOOLS))
    for (const id of IMMUTABLE_DENY_NAMED) {
      expect(denyMapKeys.has(id)).toBe(true)
    }
  })
})

describe("isImmutableDeny — capability-aware deny set", () => {
  it("denies every id in the capability corpus (named + capability-class)", () => {
    const corpus = [
      "serena_execute_shell_command",
      "serena_write_memory",
      "serena_create_text_file",
      "serena_replace_content",
      "serena_replace_symbol_body",
      "serena_insert_after_symbol",
      "serena_insert_before_symbol",
      "serena_rename_symbol",
      "serena_delete_memory",
      "serena_safe_delete_symbol",
      "serena_edit_memory",
      "execute_recipe",
      "task",
      "dispatch_parallel",
      "dispatch_background",
      "poll_background",
      "wait_background",
      "EXECUTE_RECIPE".toLowerCase(),
      "SERENA_EXECUTE_SHELL_COMMAND".toLowerCase(),
    ]
    for (const id of corpus) {
      expect(isImmutableDeny(id)).toBe(true)
    }
  })

  it("does NOT over-deny the core builtins or benign read-only third-party tools", () => {
    const allowed = [
      "read",
      "glob",
      "grep",
      "edit",
      "write",
      "bash",
      "supabase_execute_sql",
      "supabase_execute-sql",
      "context7_resolve-library-id",
    ]
    for (const id of allowed) {
      expect(isImmutableDeny(id)).toBe(false)
    }
  })

  it("pins each of the four dispatch literals into IMMUTABLE_DENY_NAMED", () => {
    for (const name of DISPATCH_TOOL_NAMES) {
      expect(IMMUTABLE_DENY_NAMED.has(name)).toBe(true)
    }
  })
})

describe("validateExtraToolsPattern", () => {
  it("rejects bad shapes, bare star, and globs/exacts that lexically cover a denied id/class", () => {
    const rejected = [
      "CamelCase",
      "with space",
      "*",
      "execute_recipe",
      "execute_*", // glob prefix "execute_" is a strict prefix of denied id execute_recipe
      "dispatch_*", // glob prefix "dispatch_" matches the dispatch capability class
      "*shell*", // leading/embedded * fails the shape rule
    ]
    for (const pattern of rejected) {
      expect(validateExtraToolsPattern(pattern).valid).toBe(false)
    }
  })

  it("accepts safe prefix globs and exact ids", () => {
    const accepted = [
      "supabase_*",
      "context7_*",
      "supabase_execute_sql",
      "context7_resolve-library-id",
    ]
    for (const pattern of accepted) {
      expect(validateExtraToolsPattern(pattern).valid).toBe(true)
    }
  })

  // KNOWN GAP (reported to Group B/C owners). The plan's validateExtraToolsPattern
  // tests only the glob's PREFIX against IMMUTABLE_DENY_{NAMED,PATTERNS}. The serena
  // server-key prefix "serena_" matches none of them, so `serena_*` is currently
  // ACCEPTED here even though it would glob over denied serena children
  // (serena_write_memory, serena_execute_shell_command, serena_find_symbol — all
  // isImmutableDeny === true; see the curated SERENA_READ_TOOLS list in
  // src/modules/plan/allowed-tools.ts which exists precisely because serena mixes
  // read + denied-capability tools). No regex- or prefix-content rule can separate
  // {reject serena_*} from {accept supabase_*, context7_*} given the provided deny
  // set, so closing this needs an explicit "mixed-capability server prefix" policy
  // (or grant-time enforcement via isImmutableDeny, which already denies the unsafe
  // children regardless). Group A does NOT invent that policy. Documents current
  // behavior + the unresolved requirement instead of silently dropping it.
  it("documents that serena_* is NOT yet rejected by the prefix-only validator (current behavior)", () => {
    expect(validateExtraToolsPattern("serena_*").valid).toBe(true)
  })
  it.todo(
    "should reject serena_* — needs a mixed-capability server-prefix policy (Group B/C)",
  )
})

describe("matchesExtraToolsPattern", () => {
  it("matches an exact id only when equal", () => {
    expect(
      matchesExtraToolsPattern("supabase_execute_sql", "supabase_execute_sql"),
    ).toBe(true)
    expect(
      matchesExtraToolsPattern("supabase_execute_sql", "supabase_execute_dml"),
    ).toBe(false)
  })

  it("matches a glob by prefix", () => {
    expect(matchesExtraToolsPattern("supabase_*", "supabase_execute_sql")).toBe(
      true,
    )
    expect(matchesExtraToolsPattern("supabase_*", "supabase_")).toBe(true)
    expect(matchesExtraToolsPattern("supabase_*", "context7_resolve")).toBe(
      false,
    )
  })
})
