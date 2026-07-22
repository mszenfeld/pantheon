import { describe, expect, it } from "vitest"
import { makeStribogToolHook } from "../../../src/modules/stribog/tool-budget-hook.js"
import { STRIBOG_EDIT_BUDGET } from "../../../src/modules/stribog/stribog.metadata.js"

const STRIBOG = "stribog"
// Each call builds a fresh factory handle (fresh closure-scoped edit-path map),
// which is what gives per-test isolation now that state is no longer module-global.
const hook = (agent: string | undefined) =>
  makeStribogToolHook({ resolveAgent: async () => agent }).hook
const input = (tool: string, sessionID = "s1") => ({
  tool,
  sessionID,
  callID: "c",
})
const out = (filePath?: string) => ({
  args: filePath === undefined ? {} : { filePath },
})

describe("stribog tool-budget hook", () => {
  it("passes through for a non-stribog session (fail-open)", async () => {
    await expect(
      hook("Perun - Coordinator")(input("execute_recipe"), out()),
    ).resolves.toBeUndefined()
  })

  it("passes through for an unknown/undefined agent (fail-open)", async () => {
    await expect(
      hook(undefined)(input("execute_recipe"), out()),
    ).resolves.toBeUndefined()
  })

  it("denies a non-allow-listed tool for a stribog session", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("execute_recipe"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    await expect(h(input("task"), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    await expect(h(input("webfetch"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    // Degenerate inputs: empty and arbitrary-unknown ids are absent from the allow-list too.
    await expect(h(input(""), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    await expect(h(input("some_unknown_tool"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
  })

  it("allows read/glob/grep/bash for a stribog session", async () => {
    const h = hook(STRIBOG)
    for (const t of ["read", "glob", "grep", "bash"]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
  })

  it("denies tree/branch-mutating git via bash; allows read-only git", async () => {
    const h = hook(STRIBOG)
    for (const cmd of [
      "git checkout feature/global-skills", // the eval-incident command
      "git reset --hard HEAD",
      "git switch main",
      "git -C /repo worktree add /tmp/wt HEAD",
      "git branch -D stale",
    ]) {
      await expect(
        h(input("bash"), { args: { command: cmd } }),
      ).rejects.toThrow("STRIBOG_GIT_DENIED")
    }
    // read-only git stays allowed — an executor legitimately inspects state.
    for (const cmd of [
      "git status",
      "git --no-pager log --oneline -5",
      "git diff --stat",
    ]) {
      await expect(
        h(input("bash"), { args: { command: cmd } }),
      ).resolves.toBeUndefined()
    }
  })

  it("skips attribution (no resolveAgent call) for read/glob/grep (bash is now attributed)", async () => {
    // Cheap pre-filter: read/glob/grep are allow-listed, not edit/write, and have nothing to
    // enforce, so the hook must NOT pay for the (full-transcript) attribution call. bash is NO
    // LONGER in this set — it must be attributed so a stribog session's command can be inspected
    // for secret-generation (the minter != actuator tripwire below).
    let calls = 0
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        calls++
        return STRIBOG
      },
    })
    for (const t of ["read", "glob", "grep"]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
    expect(calls).toBe(0)
    // bash DOES attribute now (one call), then passes for a benign command.
    await expect(h(input("bash"), out())).resolves.toBeUndefined()
    expect(calls).toBe(1)
  })

  it("still attributes deny-candidates and edit/write (pre-filter does not skip them)", async () => {
    // A tool outside the allow-list (must be resolvable to DENY for stribog) and edit/write
    // (must be resolvable to enforce the budget) still call resolveAgent.
    let calls = 0
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        calls++
        return STRIBOG
      },
    })
    await expect(h(input("execute_recipe"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    await expect(h(input("write"), out("/repo/a.ts"))).resolves.toBeUndefined()
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    expect(calls).toBe(3)
  })

  it("matches lowercase runtime ids only (capital Edit is NOT allow-listed)", async () => {
    await expect(
      hook(STRIBOG)(input("Edit"), out("/repo/a.ts")),
    ).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
  })

  it("denies capital/cased non-builtin ids whose lowercase form is immutably denied", async () => {
    // Raw id is not in CORE_BUILTINS and not edit/write → not pre-filtered; the lowercased
    // denyKey is caught by isImmutableDeny. Both the named ids and a capability-class id.
    const h = hook(STRIBOG)
    // non-serena immutable ids (serena code-edits are now an accepted, budgeted toolset — see the
    // dedicated serena describe — so they are no longer valid "immutable-denied" examples here).
    for (const t of ["Execute_Recipe", "TASK", "Supabase_Delete_Rows"]) {
      await expect(h(input(t), out())).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    }
  })

  it("gates the immutable-deny throw behind attribution (legit for non-stribog callers)", async () => {
    // execute_recipe is legitimate for zmora-setup and dispatch_* for Perun/Veles. The deny
    // must NOT fire before attribution resolves to stribog — so a non-stribog session, and an
    // unresolved one, both pass an otherwise-denied id (fail-open).
    await expect(
      hook("Perun - Coordinator")(input("execute_recipe"), out()),
    ).resolves.toBeUndefined()
    await expect(
      hook(undefined)(input("serena_replace_symbol_body"), out()),
    ).resolves.toBeUndefined()
  })

  it("does not attribute read/glob/grep but does attribute bash + pattern-candidates", async () => {
    // Pre-filter is read/glob/grep-only now: those skip resolveAgent; bash (secret-gen tripwire)
    // and a would-be extraTools candidate (supabase_execute_sql) must reach attribution.
    let calls = 0
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        calls++
        return STRIBOG
      },
    })
    for (const t of ["read", "glob", "grep"]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
    expect(calls).toBe(0)
    await expect(h(input("bash"), out())).resolves.toBeUndefined()
    await expect(h(input("supabase_execute_sql"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
    expect(calls).toBe(2)
  })

  it("allows a configured extraTools pattern for stribog (no edit budget consumed)", async () => {
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
      extraPatterns: ["supabase_*"],
    })
    await expect(
      h(input("supabase_execute_sql"), out()),
    ).resolves.toBeUndefined()
    // Same trust class as bash → no edit-budget bookkeeping: exhaust 2 real edit files,
    // then the extra tool still passes (it never counted against the budget).
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(
      h(input("supabase_execute_sql"), out()),
    ).resolves.toBeUndefined()
  })

  it("denies an id outside the allow-list AND the configured extraTools", async () => {
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
      extraPatterns: ["supabase_*"],
    })
    await expect(h(input("context7_resolve"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
  })

  it("lets immutable-deny win over even a permissive extraTools pattern", async () => {
    // A `*`-equivalent broad pattern cannot re-enable a capability-class denial.
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
      extraPatterns: ["supabase_*", "execute_*"],
    })
    await expect(h(input("execute_recipe"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
  })

  it("defaults to a strict allow-list when no extraPatterns are configured", async () => {
    // Production default (index.ts omits extraPatterns until wired): a would-be MCP tool is denied.
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
    })
    await expect(h(input("supabase_execute_sql"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
  })

  it("lets immutable-deny win over an EXACT extraTools pattern of the same id", async () => {
    // Even if a denied id is force-listed exactly, the runtime floor (isImmutableDeny) overrides it.
    // Uses a non-serena immutable id (serena edits are now an accepted, budgeted toolset).
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
      extraPatterns: ["supabase_delete_rows"],
    })
    await expect(h(input("supabase_delete_rows"), out())).rejects.toThrow(
      /STRIBOG_TOOL_DENIED/,
    )
  })

  it("allows up to the budget of distinct files, then denies the next", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("write"), out("/repo/a.ts"))).resolves.toBeUndefined()
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
    expect(STRIBOG_EDIT_BUDGET).toBe(2)
  })

  it("keeps allowing edits to already-touched files after the budget is reached", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(h(input("edit"), out("/repo/a.ts"))).resolves.toBeUndefined()
  })

  it("counts the same file via edit and write as one path", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/a.ts"))
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
  })

  it("normalizes lexical spellings of the same absolute path (counts once)", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/./a.ts"))
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
  })

  it("does not count the refused path", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
    await expect(h(input("edit"), out("/repo/a.ts"))).resolves.toBeUndefined()
  })

  it("fails closed on a RELATIVE filePath for edit/write (SCOPE_VIOLATION)", async () => {
    // A non-absolute path cannot be bound to the per-file budget, so it is refused (not passed).
    const h = hook(STRIBOG)
    await expect(h(input("write"), out("a.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
    await expect(h(input("edit"), out("relative.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
  })

  it("fails closed on a MISSING filePath for edit/write (SCOPE_VIOLATION)", async () => {
    const h = hook(STRIBOG)
    await expect(h(input("write"), out())).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
    await expect(h(input("edit"), out())).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
  })

  it("does not echo the raw filePath in the non-absolute denial (CWE-117)", async () => {
    // A control-byte / sentinel-bearing relative path must NOT be interpolated into the message;
    // the hook states the failure by type only.
    const h = hook(STRIBOG)
    await expect(h(input("edit"), out("evil]0;pwn.ts"))).rejects.toThrow(
      // matches the type-only message; must NOT contain the raw "evil…pwn.ts" payload
      /STRIBOG_SCOPE_VIOLATION: edit\/write refused — filePath must be an absolute path but was relative/,
    )
    await expect(h(input("edit"), out("evil]0;pwn.ts"))).rejects.not.toThrow(
      /pwn\.ts/,
    )
  })

  it("does not count a refused non-absolute path against the budget", async () => {
    // The fail-closed denial must not consume budget: after two relative refusals, two distinct
    // ABSOLUTE files still fit under STRIBOG_EDIT_BUDGET (=2).
    const h = hook(STRIBOG)
    await expect(h(input("write"), out("rel-a.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
    await expect(h(input("edit"), out("rel-b.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    )
    await expect(h(input("write"), out("/repo/a.ts"))).resolves.toBeUndefined()
    await expect(h(input("edit"), out("/repo/b.ts"))).resolves.toBeUndefined()
  })

  it("fails open when attribution throws", async () => {
    const { hook: h } = makeStribogToolHook({
      resolveAgent: async () => {
        throw new Error("boom")
      },
    })
    await expect(h(input("execute_recipe"), out())).resolves.toBeUndefined()
  })

  it("isolates budgets per session", async () => {
    const h = hook(STRIBOG)
    await h(input("write", "s1"), out("/repo/a.ts"))
    await h(input("edit", "s1"), out("/repo/b.ts"))
    await expect(
      h(input("write", "s2"), out("/repo/c.ts")),
    ).resolves.toBeUndefined()
  })

  it("clearSession resets a session's budget", async () => {
    const { hook: h, clearSession } = makeStribogToolHook({
      resolveAgent: async () => STRIBOG,
    })
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    clearSession("s1")
    await expect(h(input("write"), out("/repo/c.ts"))).resolves.toBeUndefined()
  })

  it("the scope-violation message includes the budget number", async () => {
    const h = hook(STRIBOG)
    await h(input("write"), out("/repo/a.ts"))
    await h(input("edit"), out("/repo/b.ts"))
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      new RegExp(`${STRIBOG_EDIT_BUDGET} distinct files`),
    )
  })

  it("allows create_pr for a confirmed stribog session (publish-path carve-out)", async () => {
    await expect(hook(STRIBOG)(input("create_pr"), out())).resolves.toBeUndefined()
    await expect(hook(STRIBOG)(input("Create-PR"), out())).resolves.toBeUndefined()
    // floor regression guard (AC-14): dispatch family stays denied
    await expect(hook(STRIBOG)(input("execute_recipe"), out())).rejects.toThrow(
      "STRIBOG_TOOL_DENIED",
    )
  })
})

describe("stribog deny-guidance: skill/edit-alias tools redirect, not escalate", () => {
  // Regression for the superpowers↔allow-list collision (eval 2026-06-16): a "you MUST activate
  // skills" nudge made models call a skill tool, hit STRIBOG_TOOL_DENIED, and ESCALATE instead of
  // doing the task. And gpt-5.4 reaches for `apply_patch` (its native edit tool) → denied →
  // escalated instead of falling back to edit/write. Both must still be DENIED (the tool never
  // runs — the allow-list is unchanged) but the GUIDANCE must say "continue / use edit/write",
  // NOT "return the ESCALATE result". Genuine capability denials keep the ESCALATE guidance.
  const denialOf = async (tool: string) => {
    try {
      await hook(STRIBOG)(input(tool), out())
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    throw new Error(`expected ${tool} to be denied`)
  }

  it("denies skill-activation tools but tells the model to CONTINUE (not escalate)", async () => {
    for (const t of ["skill", "load_appverk_skill", "activate_skill", "load-appverk-skill"]) {
      const msg = await denialOf(t)
      expect(msg).toMatch(/^STRIBOG_TOOL_DENIED/)
      expect(msg).toMatch(/continue/i)
      expect(msg).toMatch(/do not (return )?escalate/i)
      expect(msg).not.toMatch(/return the ESCALATE result/)
    }
  })

  it("denies apply_patch but redirects to edit/write (not escalate)", async () => {
    for (const t of ["apply_patch", "applypatch", "apply-patch"]) {
      const msg = await denialOf(t)
      expect(msg).toMatch(/^STRIBOG_TOOL_DENIED/)
      expect(msg).toMatch(/edit.*write|`edit`\/`write`/i)
      expect(msg).toMatch(/do not (return )?escalate/i)
      expect(msg).not.toMatch(/return the ESCALATE result/)
    }
  })

  it("keeps the ESCALATE guidance for a genuine out-of-lane capability denial", async () => {
    // A real non-allow-listed capability tool (not skill, not edit-alias) must still tell the
    // model to ESCALATE — we are not blanket-suppressing escalation.
    const msg = await denialOf("context7_resolve")
    expect(msg).toMatch(/return the ESCALATE result/)
  })

  it("keeps the ESCALATE guidance for immutable-deny capability tools", async () => {
    const msg = await denialOf("execute_recipe")
    expect(msg).toMatch(/STRIBOG_TOOL_DENIED/)
    expect(msg).toMatch(/ESCALATE/)
  })

  it("keeps ESCALATE guidance for DANGEROUS immutable tools (recipe / dispatch / task)", async () => {
    // The redirect must NOT leak to genuinely out-of-lane capabilities — these keep "escalate".
    for (const t of ["execute_recipe", "task", "dispatch_parallel"]) {
      const msg = await denialOf(t)
      expect(msg).toMatch(/^STRIBOG_TOOL_DENIED/)
      expect(msg).toMatch(/return the ESCALATE result/)
      expect(msg).not.toMatch(/edit`\/`write/)
    }
  })
})

describe("stribog serena toolset (accepted; single-file edits budgeted)", () => {
  // User decision 2026-06-16: serena is an ACCEPTED code-intelligence toolset for Stribog.
  // Allowed in full EXCEPT the shell escape and inherently multi-file edits; its single-file
  // edits are budgeted against the same 2-file limit as edit/write.
  const bashlessOut = (relative_path: string) => ({ args: { relative_path } })

  it("allows serena read/navigation/memory tools", async () => {
    const h = hook(STRIBOG)
    for (const t of [
      "serena_activate_project",
      "serena_find_symbol",
      "serena_get_symbols_overview",
      "serena_read_file",
      "serena_search_for_pattern",
      "serena_list_dir",
      "serena_find_referencing_symbols",
      "serena_write_memory",
    ]) {
      await expect(h(input(t), out())).resolves.toBeUndefined()
    }
  })

  it("allows serena single-file edits and charges them to the edit budget", async () => {
    const h = hook(STRIBOG)
    // two distinct files via serena → allowed
    await expect(
      h(input("serena_create_text_file"), bashlessOut("/repo/a.ts")),
    ).resolves.toBeUndefined()
    await expect(
      h(input("serena_replace_symbol_body"), bashlessOut("/repo/b.ts")),
    ).resolves.toBeUndefined()
    // a third distinct file → over budget
    await expect(
      h(input("serena_replace_content"), bashlessOut("/repo/c.ts")),
    ).rejects.toThrow(/STRIBOG_SCOPE_VIOLATION/)
  })

  it("shares the budget between serena edits and native edit/write (same file counts once)", async () => {
    const h = hook(STRIBOG)
    await h(input("edit"), out("/repo/a.ts")) // file #1 via native edit
    await h(input("serena_replace_content"), bashlessOut("/repo/a.ts")) // same file via serena → no new charge
    await h(input("serena_insert_after_symbol"), bashlessOut("/repo/b.ts")) // file #2 via serena
    await expect(h(input("write"), out("/repo/c.ts"))).rejects.toThrow(
      /STRIBOG_SCOPE_VIOLATION/,
    ) // file #3 → over budget
  })

  it("fails closed on a serena edit with no relative_path (SCOPE_VIOLATION)", async () => {
    await expect(
      hook(STRIBOG)(input("serena_replace_content"), out()),
    ).rejects.toThrow(/STRIBOG_SCOPE_VIOLATION/)
  })

  it("denies the serena shell escape (ESCALATE)", async () => {
    const msg = await (async () => {
      try {
        await hook(STRIBOG)(input("serena_execute_shell_command"), out())
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    })()
    expect(msg).toMatch(/^STRIBOG_TOOL_DENIED/)
    expect(msg).toMatch(/return the ESCALATE result/)
  })

  it("denies inherently MULTI-file serena edits (rename / safe_delete symbol)", async () => {
    for (const t of ["serena_rename_symbol", "serena_safe_delete_symbol"]) {
      await expect(
        hook(STRIBOG)(input(t), bashlessOut("/repo/a.ts")),
      ).rejects.toThrow(/STRIBOG_TOOL_DENIED/)
    }
  })

  it("does not gate serena for a non-stribog session (fail-open)", async () => {
    await expect(
      hook("Perun - Coordinator")(
        input("serena_execute_shell_command"),
        out(),
      ),
    ).resolves.toBeUndefined()
  })
})

describe("stribog bash secret-generation tripwire (minter != actuator)", () => {
  // Eval 2026-06-16 GATE-2 failures: both models minted a JWT secret via bash (kimi
  // `node -e "...randomBytes..."`, gpt-5.4 `npm exec -- node -e "...randomBytes..."`). Stribog's
  // bash is otherwise a trusted host shell (sub-command restriction for rm/git is a separate,
  // deliberately deferred item); secret GENERATION, however, is a hard security invariant the
  // actuator must not cross. This tripwire denies the natural secret-gen commands (defense-in-depth
  // behind the hardened prompt; not an adversarial sandbox). Attribution-gated to stribog.
  const bashOut = (command: string) => ({ args: { command } })
  const SECRET_CMDS = [
    `mkdir -p config && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > /tmp/s.txt`,
    `npm exec -- node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    `node -e "console.log(crypto.randomUUID())"`,
    `openssl rand -hex 32`,
    `openssl genrsa 2048`,
    `uuidgen`,
    `head -c 32 /dev/urandom | base64`,
    `dd if=/dev/urandom bs=32 count=1 | base64`,
    `python3 -c "import secrets; print(secrets.token_hex(32))"`,
    `ssh-keygen -t ed25519 -f /tmp/k -N ''`,
  ]

  it("denies secret-generating bash for a stribog session (STRIBOG_SECRET_DENIED)", async () => {
    for (const c of SECRET_CMDS) {
      await expect(hook(STRIBOG)(input("bash"), bashOut(c))).rejects.toThrow(
        /STRIBOG_SECRET_DENIED/,
      )
    }
  })

  it("the secret-denied guidance routes to zmora-setup and ESCALATE", async () => {
    let msg = ""
    try {
      await hook(STRIBOG)(input("bash"), bashOut("openssl rand -hex 32"))
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toMatch(/^STRIBOG_SECRET_DENIED/)
    expect(msg).toMatch(/zmora-setup/)
    expect(msg).toMatch(/ESCALATE/)
  })

  it("allows ordinary (non-secret) bash for a stribog session", async () => {
    for (const c of [
      "npm start",
      "docker compose up -d",
      "curl -sS http://127.0.0.1:8731",
      "npm test",
      'node -e "console.log(Math.random())"',
      "make build",
    ]) {
      await expect(
        hook(STRIBOG)(input("bash"), bashOut(c)),
      ).resolves.toBeUndefined()
    }
  })

  it("does NOT gate secret-gen bash for a non-stribog session (fail-open)", async () => {
    await expect(
      hook("Perun - Coordinator")(input("bash"), bashOut("openssl rand -hex 32")),
    ).resolves.toBeUndefined()
  })
})
