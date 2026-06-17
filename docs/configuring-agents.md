# Configuring Pantheon Agents

Pantheon agents Perun, Zmora, Triglav, Veles, Stribog, and Svarog can be assigned specific models via a `pantheon.json` configuration file. This document is the canonical reference for that file.

## TL;DR

Create `~/.config/opencode/pantheon.json`:

```jsonc
{
  "agents": {
    "perun":   { "model": "anthropic/claude-opus-4-7" },
    "zmora":   { "model": "anthropic/claude-sonnet-4-6" },
    "triglav": { "model": "opencode/claude-haiku-4-5" },
    "veles":   { "model": "anthropic/claude-opus-4-7" }
  }
}
```

Restart OpenCode. Perun will run on Opus, Zmora on Sonnet, Triglav on Haiku (subscription-routed), Veles on Opus.

## Where the file lives

Pantheon looks in two places, in this order:

1. **User-global:** `~/.config/opencode/pantheon.json` — applies to every project.
2. **Per-project walk-up:** starting at the current working directory, Pantheon checks each ancestor for `<dir>/.opencode/pantheon.json`, walking upward and **stopping at your home directory**. The closest file wins.

### Closest wins (per agent)

If both files exist, they are merged per agent name. The **closer** file's entry replaces the user-global entry for the same agent — but agents only present in the user-global file are still applied.

Example:

```jsonc
// ~/.config/opencode/pantheon.json (user-global)
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-haiku-4-5-20251001" }
  }
}
```

```jsonc
// /my-project/.opencode/pantheon.json (project-local)
{
  "agents": {
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

Effective configuration when running inside `/my-project`:

| Agent | Model | Source |
|---|---|---|
| `perun` | `anthropic/claude-opus-4-7` | user-global |
| `zmora` | `anthropic/claude-sonnet-4-6` | project-local (overrides user-global) |

## Available agents

| Pantheon key | Registered as | Description | Model-configurable? |
|---|---|---|---|
| `perun` | `Perun - Coordinator` (primary) | The coordinator. Delegates work to specialists. | Yes — via `pantheon.json` |
| `zmora` | `zmora-fe` + `zmora-be` + `zmora-setup` (subagents) | QA tester. Three internal variants (`zmora-fe`, `zmora-be`, `zmora-setup`) share the same model — set once via `zmora`. | Yes — via `pantheon.json` |
| `triglav` | `triglav` (subagent) | Read-only codebase explorer. Dispatched up to 4× in parallel (and now in the background) — favor fast/cheap models. | Yes — via `pantheon.json` |
| `veles` | `Veles - Planner` (mode `all`) | Planning specialist. Authors QA test plans (and other work plans) from a diff or request; dispatches read-only helpers. Inherits the session default model when `agents.veles.model` is unset. | Yes — via `pantheon.json` |
| `stribog` | `stribog` (subagent) | Light execution specialist. Performs ONE small, mechanical task with real side effects (bring up/fix a service, restart, read logs, or a 1–2 file config change), then verifies. Unlike the other agents, **pins an eval-picked default** (`opencode-go/kimi-k2.7-code`) when `agents.stribog.model` is unset (see note below). | Yes — via `pantheon.json` |
| `svarog` | `svarog` (subagent) | Heavy/main code executor. Implements a multi-file feature or refactor from a plan — writes code test-first, runs the full suite/build, and returns a verified diff. Stops at READY (does not commit). Like Stribog, **pins an interim default** (`openai/gpt-5.4`) when `agents.svarog.model` is unset (see note below). | Yes — via `pantheon.json` |

> Internal variants of Zmora (`zmora-fe`, `zmora-be`, `zmora-setup`) are subagents dispatched by Perun. They are not user-facing, but the model you set under `zmora` applies to all three.

> **Triglav model defaults.** When `agents.triglav.model` is not set, Triglav inherits OpenCode's session default model (same pattern as `perun`/`zmora`). Because Triglav is dispatched many-in-parallel and in the background, a fast/cheap model is the natural choice — for example `opencode/claude-haiku-4-5` (subscription) or `opencode/deepseek-v4-flash-free` (zero marginal cost). The OpenCode-subscription provider prefix `opencode/<modelID>` lets you route through the subscription rather than per-token Anthropic billing.

> **Stribog model defaults.** Unlike the other agents — which inherit the session default model when their entry is unset — Stribog **pins an explicit default** (`opencode-go/kimi-k2.7-code`) when `agents.stribog.model` is not set. It is a doer that performs real side effects and, as a frequently-dispatched actuator, is cost-sensitive. The specific pick is **evidence-based**: in the 2026-06-16 eval (`docs/eval/scenarios/stribog/` run per `docs/eval/playbook.md`), after the collision / secret-gate / serena fixes, `opencode-go/kimi-k2.7-code` passed every discipline gate (scope / secret / liveness) and produced clean, pattern-correct edits at ~3× lower cost than `openai/gpt-5.4` (which is now also fully functional and a fine override). Setting `agents.stribog.model` overrides this default — re-run the eval scenarios before changing the tier. This pinned default is a **tier hint, not a security control** — it does not gate or restrict what Stribog can do (the tool-budget hook does).
>
> **The pinned default needs the opencode-go provider.** `opencode-go/kimi-k2.7-code` only resolves if your OpenCode install has the `opencode-go` provider configured (an `opencode-go` entry under `provider` or an OAuth entry in `auth.json`, not excluded by `disabled_providers`/`enabled_providers`). On an install without it, rather than pin an **unresolvable** model (which would make every Stribog dispatch fail at model resolution), the harness **falls back to your session default model** and emits a one-time warning toast on the first session noting the dependency. Your `agents.stribog.model` override (and a user `opencode.json` `agent.stribog.model`) always take precedence over this default and are **unaffected** by the probe — set `agents.stribog.model` to a model on your provider to silence the toast and pick the tier yourself. To keep the eval-picked default, configure the `opencode-go` provider.

> **Do not rename the `stribog` key.** The agent key `stribog` is security-relevant: it drives the QA `zmora-` secret-binding gate. Changing it (or the registered subagent name) breaks that gate, so treat the key as a stable contract — configure its model under `stribog`, but do not rename it.

> **Svarog model defaults.** Like Stribog, Svarog **pins an explicit default** (`openai/gpt-5.4`) rather than inheriting the session default — it is a heavy in-tree executor doing broad multi-file edits and must not run on a weak model. The pick is **interim**: the §11 Svarog eval (run per `docs/eval/playbook.md`) may raise this to a frontier model; re-run the eval scenarios before changing the tier. This pinned default is a **tier hint, not a security control** — it does not gate or restrict what Svarog can do (the tool hook does).
>
> **The pinned default needs the openai provider.** `openai/gpt-5.4` only resolves if your OpenCode install has the `openai` provider configured. On an install without it, the harness **falls back to your session default model** and emits a one-time warning toast on the first session noting the dependency. Your `agents.svarog.model` override (and a user `opencode.json` `agent.svarog.model`) always take precedence and are **unaffected** by the probe — set `agents.svarog.model` to a model on your provider to silence the toast and pick the tier yourself. To keep the pinned default, configure the `openai` provider.

### The picker only shows harness agents

By design, the agent picker lists **only the agents the harness registers** (the user-selectable agents above — currently `Perun - Coordinator` and `Veles - Planner`). The harness owns the roster and hides everything else:

- **OpenCode's native primaries `build` and `plan`** are hidden — they will not appear in the picker.
- **Your own user/project agents** (defined in `opencode.json` or `~/.config/opencode/agent/…`) are hidden too.

This is intentional, not a bug: if a familiar agent "disappeared" from the picker after enabling Pantheon, this is why. Your agent definitions are not deleted — they are only hidden from the picker so the harness can present a curated coordinator-first roster.

### Default agent on session open

New sessions open on **`Perun - Coordinator`** by default. This is set only when you have **not** specified a `default_agent` — an explicit `default_agent` is respected.

There is one exception. Because the harness hides `build`/`plan` and your user/project agents, OpenCode would throw at startup if `default_agent` pointed at a now-hidden agent. To avoid that, the harness **repoints** `default_agent` to a visible primary, in this order:

1. `Perun - Coordinator`, if it is a visible primary;
2. otherwise the first visible primary by sorted key order.

So if you set `default_agent` to an agent that is not a **visible primary** (a hidden agent, or one registered as mode `all`/`subagent` such as `Veles - Planner`), the session will silently open on Perun (or the first visible primary) instead. A `default_agent` that already points at a visible primary agent (`mode: "primary"` and not hidden — currently just `Perun - Coordinator`) is left untouched.

## Schema

```typescript
{
  "agents": {
    [agentName: string]: {
      "model"?:      string,    // "<providerID>/<modelID>", e.g. "anthropic/claude-opus-4-7"
      "extraTools"?: string[]   // Stribog only — see "Configuring Stribog extraTools" below
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | `string` | No | `<providerID>/<modelID>` — the model to use for this agent. Omit to inherit the session default (or, for Stribog, its eval-picked default). |
| `extraTools` | `string[]` | No | Stribog only. Additional tool ids or trailing-`*` globs to grant. Ignored on all other agents (a warning is emitted). |

Model strings follow OpenCode's native convention: `<providerID>/<modelID>`. Aggregator providers like OpenRouter use a three-segment form (`openrouter/openai/gpt-5.5`), and that is accepted too. The same value you would put in `opencode.json` `agent.<name>.model`.

JSONC support: comments (`//` and `/* */`) and trailing commas are allowed.

## Configuring Stribog `extraTools`

`agents.stribog.extraTools` is an optional `string[]` that grants Stribog access to additional tools beyond its default allow-list (`read`, `glob`, `grep`, `edit`, `write`, `bash`). It applies only to the `stribog` agent; the field is ignored (with a warning) on all others.

### Syntax

Each entry is either an **exact lowercase tool id** or a **trailing-`*` glob**:

```jsonc
{
  "agents": {
    "stribog": {
      "extraTools": [
        "supabase_execute_sql",   // exact id
        "supabase_*"              // trailing-glob: any tool whose id starts with "supabase_"
      ]
    }
  }
}
```

Tool ids follow MCP's flattened convention: `<serverKey>_<toolName>`, where dashes in the server key are preserved and a single `_` is inserted as the join. All ids and glob patterns must be lowercase alphanumeric with `_` and `-`; glob entries additionally end with `*`. Malformed entries are rejected at config-load with a diagnostic in the OpenCode console.

### Default: `[]`

When `extraTools` is absent or empty, Stribog's allowed set is exactly `{read, glob, grep, edit, write, bash}` — the same boundary as before this feature existed. No behavior changes unless you add entries.

### The immutable capability guardrail

The **`isImmutableDeny` guardrail** in the tool-budget hook always wins, regardless of how broad your `extraTools` config is. It permanently denies these capability classes for Stribog:

| Capability class | Examples |
|---|---|
| Secret-minting | `execute_recipe` |
| Leaf-dispatch | `task`, `dispatch_*`, `*_task` |
| Shell / exec | `*_execute_shell`, `*_shell_command` |
| Code / state writes | `serena_write_memory`, `serena_replace_symbol_body`, `serena_replace_content`, `serena_create_text_file` |

No `extraTools` entry — exact or glob — can re-enable any of these. Attempting to grant an exact denied id (e.g. `"execute_recipe"`) is rejected at config-load. A broad glob (e.g. `"serena_*"`) is accepted at load but its denied children are refused at runtime by the hook.

### Glob scoping warning

Scope globs to a **single, trusted data-MCP namespace** (e.g. `supabase_*` for a Supabase MCP server). A broad glob like `serena_*` nominally covers serena's write and shell tools; those specific ids are denied at runtime by the immutable guardrail, but the pattern still grants every other serena tool to Stribog. Prefer exact ids when the task is known; use a prefix glob only when the tool set for a given MCP server is stable and you trust the server.

### Preconditions when granting a database MCP tool

When `extraTools` gives Stribog a database MCP (e.g. `supabase_execute_sql`), Stribog gains structured read/write access to whatever the connection reaches — including remote, shared, or multi-tenant databases and secret-bearing tables. Two preconditions are mandatory:

1. **The MCP must point at the local stack the run targets.** Do not configure a shared or production endpoint.
2. **Use a least-privilege database role.** The role should be scoped to the operations the task requires (e.g. read-only, or restricted to specific tables).

The `isImmutableDeny` guardrail protects harness invariants (no minting, dispatch, shell, or code-write). It does **not** constrain the contents of any datastore the configured tools reach. Least-privilege is your responsibility.

### Whole-object merge footgun

Per-agent config entries are merged **whole-object**: a closer `pantheon.json` that sets `stribog.extraTools` replaces the user-global `stribog` entry entirely, including any `stribog.model` you set at the user level.

Example:

```jsonc
// ~/.config/opencode/pantheon.json (user-global)
{ "agents": { "stribog": { "model": "openai/gpt-5.4" } } }

// /my-project/.opencode/pantheon.json (project-local)
{ "agents": { "stribog": { "extraTools": ["supabase_execute_sql"] } } }
```

Effective config inside `/my-project`: `{ "extraTools": ["supabase_execute_sql"] }` — the `model` from the user-global file is **gone**. To keep both, repeat them in the closer file:

```jsonc
// /my-project/.opencode/pantheon.json
{ "agents": { "stribog": { "model": "openai/gpt-5.4", "extraTools": ["supabase_execute_sql"] } } }
```

## Precedence vs. `opencode.json`

OpenCode resolves an agent's effective model from several layers:

1. OpenCode built-in default (`config.model`)
2. **`pantheon.json` via the Pantheon plugin** ← this file
3. User-supplied `agent.<name>.model` in `opencode.json` ← **highest**

If you set the same agent's model in both `pantheon.json` and `opencode.json`, `opencode.json` wins. This is by design — `pantheon.json` is an opinionated layer, not a hard override.

### `default_agent` precedence

The roster policy described in [Default agent on session open](#default-agent-on-session-open) interacts with your `opencode.json` as follows:

| Your `default_agent` in `opencode.json` | Effective default agent |
|---|---|
| Unset | `Perun - Coordinator` (set by the harness) |
| A **visible primary** agent (currently only `Perun - Coordinator`) | Respected as-is |
| A **hidden** agent (your own agent, or native `build`/`plan`) | Repointed to `Perun - Coordinator`, else the first visible primary by sorted key order |
| `Veles - Planner` | Repointed to `Perun - Coordinator` — Veles is selectable in the picker but registered as mode `all`, not `primary`, so it does not satisfy the "visible primary" guard |

In short: an explicit `default_agent` is honored only when it points at a **visible primary** agent (`mode: "primary"` and not hidden — currently just Perun); otherwise it is repointed so OpenCode does not fail at startup.

## When no config exists

Pantheon falls back to OpenCode's default model. The first time you open a session after starting OpenCode without `pantheon.json`, you'll see a one-time TUI toast:

> **Pantheon** — pantheon.json not found — using default models

If your `pantheon.json` exists but fails to parse, you'll see a warning toast instead. The toast contains a short summary; the full diagnostic (every malformed file, parse offset, and invalid field) is written to the OpenCode console via `console.error` — check the terminal where OpenCode is running.

## Restart required

Changes to `pantheon.json` only take effect after restarting OpenCode. There is no hot-reload in the current version.
