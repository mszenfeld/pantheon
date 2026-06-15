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
      "run_task", // *_task trailing leaf-dispatch segment (the /(^|_)task$/ pattern)
      "EXECUTE_RECIPE".toLowerCase(),
      "SERENA_EXECUTE_SHELL_COMMAND".toLowerCase(),
    ]
    for (const id of corpus) {
      expect(isImmutableDeny(id)).toBe(true)
    }
  })

  it("denies the kebab-case forms opencode 1.17.3 preserves (dash-segmented dangerous ids)", () => {
    // opencode keeps dashes in serverKey_toolName, so these are the on-the-wire ids for
    // serena/dispatch/data-MCP write+shell+dispatch tools. Each MUST normalize to its
    // underscore form and hit the deny floor — otherwise a broad glob grant lets them ALLOW.
    const kebab = [
      "serena_execute-shell-command",
      "serena_write-memory",
      "serena_replace-symbol-body",
      "serena_replace-content",
      "serena_create-text-file",
      "serena_insert-after-symbol",
      "serena_insert-before-symbol",
      "serena_rename-symbol",
      "serena_delete-memory",
      "serena_edit-memory",
      "serena_safe-delete-symbol",
      "supabase_delete-rows",
      "supabase_insert-rows",
      "supabase_create-table",
      "execute-recipe",
      "dispatch-parallel",
      "run-task",
    ]
    for (const id of kebab) {
      expect(isImmutableDeny(id)).toBe(true)
    }
  })

  it("intentionally denies a data-MCP's structured row-mutation tools (use supabase_execute_sql instead)", () => {
    // The mutation-verb pattern is server-agnostic, so structured DB write tools are caught.
    // This is by design — the supported DB-fixture path is the SQL-string tool, not these.
    for (const id of [
      "supabase_insert_rows",
      "supabase_delete_rows",
      "supabase_create_table",
    ]) {
      expect(isImmutableDeny(id)).toBe(true)
    }
  })

  // MAINT-002 — capability-floor ALLOW ceiling (the positive half of the corpus).
  // The deny tests above pin what MUST be blocked; this pins what MUST stay allowed,
  // so the floor reads as a DELIBERATE allowlist boundary, not an accidental hole.
  // The danger is asymmetric coverage: a corpus that only enumerated denied ids could
  // not tell "intentionally allowed" from "missed verb" — which is how the SEC-001 gap
  // hid. Each entry here is a looks-mutating-but-benign id whose leading/non-final
  // segment is an UNLISTED (non-mutation) verb — get/read/list/execute/resolve — that
  // the floor passes ON PURPOSE. Adding any of these verbs to IMMUTABLE_DENY_PATTERNS
  // (or widening the bare-edit/write exemption) must fail HERE.
  it("does NOT over-deny the core builtins, the SQL path, or non-mutation-verb tools (capability-floor ceiling)", () => {
    const allowed = [
      // CORE_BUILTINS — bare `edit`/`write` are mutation verbs but, as the whole
      // single-segment id, MUST stay allowed here: the deny floor uses the split
      // anchor `verb_ | _verb$` precisely so these fall through to the edit-budget
      // path. A `(^|_)verb(_|$)` form would brick Stribog's only side-effect tools.
      "read",
      "glob",
      "grep",
      "edit",
      "write",
      "bash",
      // SQL-string fixture path — `execute` is deliberately not a mutation verb.
      "supabase_execute_sql",
      "supabase_execute-sql",
      // Read-verb MCP tools — `get`/`read`/`list` are NOT in the mutation-verb set, so
      // these pass the floor by design. Pinning the read-side (not only `execute`/`list`)
      // proves the allowlist floor is intentional: a future edit that mis-classifies a
      // read verb as mutating (e.g. folding `read`/`get` into the verb alternation) breaks
      // here, not silently in production where it would brick Stribog's read tools.
      "supabase_get_row",
      "supabase_read_table",
      "serena_get_symbols_overview", // read tool; suffix `overview` is not a write-target
      "supabase_list_tables",
      "context7_resolve-library-id",
    ]
    for (const id of allowed) {
      expect(isImmutableDeny(id)).toBe(false)
    }
    // Floor boundary, made explicit: a read VERB does not buy a pass when the SUFFIX is a
    // serena write-target. `serena_read_memory` is DENIED by the `_(memory|symbol|…)$` rule
    // (verb-agnostic — any `*_memory` is a serena write surface), even though `read` itself
    // is benign. Pinning this guards the suffix rule against a "but it's only a read" edit.
    expect(isImmutableDeny("serena_read_memory")).toBe(true)
  })

  it("denies the extended verb set as whole segments, order-agnostic (update/upsert/DDL/grant + verb-after-noun)", () => {
    // SEC-003: the mutation-verb floor was extended (update/upsert/drop/truncate/
    // alter/grant) and made order-agnostic so a verb that is the TRAILING segment
    // (`supabase_rows_delete`) is caught, not only verb-prefixed ids. Whole-segment
    // anchoring still permits the SQL fixture path (`execute` is not a verb).
    const denied = [
      "supabase_update_rows", // `update` now a mutation verb
      "supabase_upsert_rows", // `upsert` now a mutation verb
      "supabase_drop_table", // DDL
      "supabase_truncate_table", // DDL
      "supabase_alter_table", // DDL
      "supabase_grant_role", // privilege grant
      "supabase_rows_delete", // verb-after-noun: trailing-segment verb
      "supabase_rows_update", // verb-after-noun: trailing-segment verb
      "supabase_drop-table", // kebab form, dash-normalized then denied
      "supabase_rows-delete", // kebab verb-after-noun
    ]
    for (const id of denied) {
      expect(isImmutableDeny(id)).toBe(true)
    }
    // Guard the load-bearing exemption alongside, so a future regex edit that
    // re-breaks bare edit/write or the SQL path fails right here.
    expect(isImmutableDeny("supabase_execute_sql")).toBe(false)
    expect(isImmutableDeny("edit")).toBe(false)
    expect(isImmutableDeny("write")).toBe(false)
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
      "write_*", // glob prefix "write_" matches the mutation-verb capability class
      "replace_*", // glob prefix "replace_" matches the mutation-verb capability class
      "*shell*", // leading/embedded * fails the shape rule
      "supabase_delete_rows", // exact id caught by isImmutableDeny — config-load now agrees with runtime
      "serena_write_memory", // exact id caught by isImmutableDeny (mutation verb + memory suffix)
      "supabase_delete-rows", // kebab exact: dash-normalized in isImmutableDeny, so config-load rejects it too
      "serena_write-memory", // kebab exact: same dangerous tool, dash-form on the opencode wire
      "supabase_update_rows", // SEC-003: `update` now a mutation verb → exact id rejected
      "supabase_upsert_rows", // SEC-003: `upsert` now a mutation verb → exact id rejected
      "supabase_rows_delete", // SEC-003: trailing-segment verb (order-agnostic) → rejected
      "update_*", // SEC-003: glob prefix "update_" matches the extended mutation-verb class
      "grant_*", // SEC-003: glob prefix "grant_" matches the extended mutation-verb class
    ]
    for (const pattern of rejected) {
      expect(validateExtraToolsPattern(pattern).valid).toBe(false)
    }
  })

  it("accepts safe prefix globs and exact ids (the SQL path + read-only DB tools)", () => {
    const accepted = [
      "supabase_*",
      "context7_*",
      "supabase_execute_sql", // `execute` is not a mutation verb → allowed exact id
      "supabase_list_tables", // read-only, no verb segment
      "context7_resolve-library-id",
    ]
    for (const pattern of accepted) {
      expect(validateExtraToolsPattern(pattern).valid).toBe(true)
    }
  })

  // §3.5 honest split (INTENDED behavior, not a gap): config-load validation is
  // BEST-EFFORT. A broad glob like `serena_*` is ACCEPTED here on purpose — its prefix
  // "serena_" contains no shell/write/dispatch marker and is not a prefix of any named
  // denied id, so no static rule can prove it dangerous without an unsanctioned
  // server-key registry (and no regex separates {reject serena_*} from {accept
  // supabase_*}). The danger of serena_*'s children is caught at RUNTIME by the hook's
  // isImmutableDeny floor — serena_write_memory / serena_execute_shell_command etc. are
  // all denied (see the capability-corpus test above). The hook is the authoritative
  // boundary; config-load only fail-fasts the statically-decidable subset.
  it("accepts serena_* at config-load (danger is in the children, denied at the hook — §3.5)", () => {
    expect(validateExtraToolsPattern("serena_*").valid).toBe(true)
  })
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
