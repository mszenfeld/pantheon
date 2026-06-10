# Configuring Pantheon Agents

Pantheon agents Perun, Zmora, Triglav, Veles, and Stribog can be assigned specific models via a `pantheon.json` configuration file. This document is the canonical reference for that file.

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
| `veles` | `Veles - Planner` (mode `all`) | Planning specialist. Authors QA test plans (and other work plans) from a diff or request; dispatches read-only helpers. `EXPENSIVE` — inherits the session default model when `agents.veles.model` is unset. | Yes — via `pantheon.json` |
| `stribog` | `stribog` (subagent) | Light execution specialist. Performs ONE small, mechanical task with real side effects (bring up/fix a service, restart, read logs, or a 1–2 file config change), then verifies. `CHEAP` — but, unlike the other agents, **pins an eval-picked default** (`openai/gpt-5.4`) when `agents.stribog.model` is unset (see note below). | Yes — via `pantheon.json` |

> Internal variants of Zmora (`zmora-fe`, `zmora-be`, `zmora-setup`) are subagents dispatched by Perun. They are not user-facing, but the model you set under `zmora` applies to all three.

> **Triglav model defaults.** When `agents.triglav.model` is not set, Triglav inherits OpenCode's session default model (same pattern as `perun`/`zmora`). Because Triglav is dispatched many-in-parallel and in the background, a fast/cheap model is the natural choice — for example `opencode/claude-haiku-4-5` (subscription) or `opencode/deepseek-v4-flash-free` (zero marginal cost). The OpenCode-subscription provider prefix `opencode/<modelID>` lets you route through the subscription rather than per-token Anthropic billing.

> **Stribog model defaults.** Unlike the other agents — which inherit the session default model when their entry is unset — Stribog **pins an explicit default** (`openai/gpt-5.4`) when `agents.stribog.model` is not set. It is a doer that performs real side effects, so it defaults to a more capable model rather than cheap retrieval. The specific pick is **evidence-based**: in the 2026-06-10 four-round eval (`docs/eval/scenarios/stribog/` run per `docs/eval/playbook.md`), `openai/gpt-5.4` was the cheapest model that passed all three discipline gates (scope / secret / liveness) natively; mini/nano tiers and all tested opencode-go models failed at least one. Setting `agents.stribog.model` overrides this default — prefer a full-size model, and re-run the eval scenarios before downgrading the tier. This pinned default is a **tier hint, not a security control** — it does not gate or restrict what Stribog can do (the tool-budget hook does).

> **Do not rename the `stribog` key.** The agent key `stribog` is security-relevant: it drives the QA `zmora-` secret-binding gate. Changing it (or the registered subagent name) breaks that gate, so treat the key as a stable contract — configure its model under `stribog`, but do not rename it.

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
      "model": string  // "<providerID>/<modelID>", e.g. "anthropic/claude-opus-4-7"
    }
  }
}
```

Model strings follow OpenCode's native convention: `<providerID>/<modelID>`. Aggregator providers like OpenRouter use a three-segment form (`openrouter/openai/gpt-5.5`), and that is accepted too. The same value you would put in `opencode.json` `agent.<name>.model`.

JSONC support: comments (`//` and `/* */`) and trailing commas are allowed.

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
