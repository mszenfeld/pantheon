# Light Execution (Stribog)

**Stribog** is a light-execution actuator dispatched by the Perun coordinator. Perun hands it ONE small, mechanical task — bring up / restart / fix a downed service, read logs, or apply a 1–2 file config/value change — which it performs with **real side effects**, verifies, and reports as a structured JSON result. Stribog is a leaf: it never delegates or spawns other agents, and it never produces feature work or secrets.

This is the counterpart to Triglav's read-only [`exploration.md`](exploration.md): where Triglav *gathers*, Stribog *acts*.

## Scope — hard limits (harness-enforced)

Two of these limits are **enforced by the harness** (the tool-budget hook, see below); the rest is judgment Stribog applies, returning `ESCALATE` rather than pressing on:

1. **At most 2 distinct files** per task (`edit`/`write`) — a third is refused with `STRIBOG_SCOPE_VIOLATION` (enforced).
2. **Only** `read`/`glob`/`grep`/`edit`/`write`/`bash` — any other tool is refused with `STRIBOG_TOOL_DENIED` (enforced).
3. Local and mechanical — no new abstractions, modules, or architectural decisions; verification is deterministic and fast (build/lint passes, or the service answers).

A task that fails any check, or turns out non-trivial mid-way (it spreads across subsystems, or needs a design decision), is escalated — not attempted. **Producing or refreshing a secret/credential value is explicitly out of scope** (that is `zmora-setup`'s job); Stribog never mints, reads-for-output, or echoes secrets.

## Security model — the tool-budget hook is the boundary

The runtime security boundary is the **`tool.execute.before` hook** in `src/modules/stribog/tool-budget-hook.ts`. A 2026-06-10 live probe established that opencode 1.15.10 does **not** enforce the prompt frontmatter `allowed-tools:` list, **nor** a `config.agent.stribog.tools` deny-map — both are inert (a non-listed tool still executed). So the allow-list in `allowed-tools.ts` is a **declaration** (rendered into the prompt, and the source the hook's allowed set is kept in sync with), not the gate.

For a session positively attributed as `stribog` (via `getSessionAgentCached`), the hook enforces two limits and **fails open** for any other/unknown session:

- **Tool-name allow-list.** Any tool whose lowercase runtime id is outside `{read, glob, grep, edit, write, bash}` is refused with `STRIBOG_TOOL_DENIED`. This is what makes the exclusions real:
  - **`execute_recipe` / `serena-write` denied** → Stribog cannot value-hide-mint secrets (minter ≠ actuator; minting stays with `zmora-setup` — see [the invariant](#the-minter--actuator-invariant) below).
  - **`task` / dispatch denied** → Stribog is a leaf; it never fans out.
- **Edit budget.** At most `STRIBOG_EDIT_BUDGET` (2) distinct files via `edit`/`write`; a third is refused with `STRIBOG_SCOPE_VIOLATION`.

The declared list grants three groups: structured tools (`Read`/`Glob`/`Grep`/`Edit`/`Write`), actuator Bash verbs (`docker`/`docker compose`/`make`/`npm`/`pnpm`/`bun`/`uv`/`curl`), and read-only git (`log`/`blame`/`status`/`diff`).

> **Bash is allowed at the tool-name level only — the hook does not inspect sub-commands.** The `Bash(...)`-verb scoping in the declared list is therefore *not* enforced: at runtime Stribog's `bash` is effectively a full host shell (only `git commit` is globally blocked, by the commit plugin). So `rm`, `git reset`, `git revert`, etc. are **not** blocked. This is the accepted host-env trust boundary (see below): `make`/`npm`/`docker` already run repo-controlled code with the operator's env, so program-name matching is not the containment mechanism. Restricting bash verbs is a documented follow-up. Edit recovery is therefore **not** `git revert`/`reset` from within Stribog — it is the Perun scratch-ref snapshot (a Phase-2 component; see the [Experimental note](#experimental--phase-1-note)). `interactive_bash` is not ported in v1; long-running services run **detached** via plain `Bash`.

This mirrors the in-code note at the top of `src/modules/stribog/allowed-tools.ts` and the hook in `tool-budget-hook.ts`.

## The minter ≠ actuator invariant

Secrets stay with `zmora-setup`; they are never co-resident with the actuator.

- The tool-budget hook **denies `execute_recipe`** for a stribog session (→ `STRIBOG_TOOL_DENIED`), so Stribog has no path to the minting machinery. (This is hook-enforced, not a property of an inert allow-list.)
- The QA module injects minted binding values into a session's shell env only for sessions whose key matches the `zmora-` binding gate. **Stribog's agent key is `stribog`** — it cannot match that gate, so no minted QA binding is ever injected into a Stribog session. `zmora-setup` is unchanged and not retired; the QA mechanism (`VARIANTS` / `SETUP_TOOLS` / the `execute_recipe` gate / `BindingsStore` / the binding-injection hook) is untouched.

The result is that the two roles stay cleanly separated: `zmora-setup` *mints and hides* secret values; Stribog *acts* and never sees them through any value-hiding channel. Any residual secret exposure is only the **same filesystem / host-env surface any operator-privileged coding agent has** (reading `.env`, `~/.aws`, etc.) — owned by the trust assumption below, not a value-hiding regression.

## The accepted trust assumption

Stribog runs in the **real working tree**; its edits are persistent and git-visible. The host-environment trust boundary is stated plainly and **knowingly accepted**:

- **Bash runs repo-controlled code with the operator's env.** Stribog's `Bash` invokes `make` / `npm run` / `docker compose` / `uv` — i.e. **repo-controlled code** — with the **operator's full host env and credentials**. This is the same posture as any real coding agent. The `buildChildEnv` host-env stripping protects only the `execute_recipe` child (which Stribog does not have), **not** normal `Bash`. This is the accepted trust boundary for a real actuator with no OS sandbox.
- **`curl` is the egress primitive.** `curl` is allow-listed because liveness verification needs it (polling a service until it answers). It is also, by the same token, an unrestricted network-egress primitive. With no OS sandbox, that egress capability is accepted as part of the host-env trust boundary above — it is not separately contained.

> This rationale is **ported here intentionally** so it survives the eventual deletion of the design spec under `docs/superpowers/` (a deletable working artefact). This doc is the durable home for the "why."

## Bringing an environment up & verifying liveness

Stribog detects the run command from `package.json` scripts, a `Makefile`, or `docker-compose.yml` (returning `ESCALATE` if none is discoverable). Services are started **detached** so they survive the turn: `docker compose up -d`, or `<run-command> &`.

It then **verifies liveness** rather than trusting a zero exit code:

- Poll the service with `curl` in a bounded loop (a few attempts, a short fixed interval, a hard timeout).
- For a `&`-backgrounded process, also confirm its PID is still alive.
- A build failure, a dead PID, or no healthy response within the budget ⇒ `FAIL`.

A host-port collision (connection refused, or a non-matching service answering the port after bring-up) is caught by this liveness probe and surfaces as a **distinct `FAIL` reason**, not a generic failure.

> **Orphans:** v1 has no managed teardown. Detached services persist beyond the run and are the human's to stop; Stribog reports what it started in `result.started`.

## The JSON result contract

Stribog **always** ends its turn with exactly one fenced ` ```json ` block and nothing after it:

```json
{
  "status": "READY",
  "reason": "<one line; required for FAIL and ESCALATE>",
  "baseUrl": "<scheme://host:port; only on READY when you brought a service up>",
  "started": ["<service or process you started and left running>"]
}
```

| `status` | Meaning |
|---|---|
| `READY` | The task is done / the service is live. Include `baseUrl` and `started` when something was brought up. |
| `FAIL` | Stribog tried and it did not work (build failed, won't start, port already taken). The distinct cause goes in `reason`. |
| `ESCALATE` | Out of scope (too complex, needs a decision, or would touch source it should not). If partial edits were already written, the touched files are listed in `reason`. |

- `reason` — one line; **required** for `FAIL` and `ESCALATE`.
- `baseUrl` — `scheme://host:port`; present only on `READY` when a service was brought up.
- `started` — services or processes left running (the orphan-tracking field).

## Model selection

Unlike Triglav (which inherits the session default), **Stribog is a doer and pins a Sonnet-class default**: `anthropic/claude-sonnet-4-6` (`DEFAULT_STRIBOG_MODEL` in `src/modules/stribog/stribog.metadata.ts`). This is a role fit, **not** a security control — the security boundary is the tool-budget hook, never the model choice.

The default is overridable via `agents.stribog.model` in `pantheon.json` (same mechanism as `perun`, `zmora`, and `triglav`). See [`configuring-agents.md`](configuring-agents.md) for the file's location, precedence rules, and full schema:

```jsonc
{ "agents": { "stribog": { "model": "<providerID>/<modelID>" } } }
```

A Sonnet-class model fits because Stribog's work is **operational reasoning with real side effects** — detect the run command, bring a service up, interpret liveness probes, apply a precise edit, and decide READY/FAIL/ESCALATE — where a wrong call has real consequences (a mis-applied edit, a falsely-reported-live service). That is a heavier bar than Triglav's retrieval-and-synthesize workload, so Stribog does not chase the cheapest/fastest model the way the many-in-parallel explorer does.

## EXPERIMENTAL / Phase-1 note

Stribog is **EXPERIMENTAL (Phase 1)**. Most notably: **there is no automatic edit-recovery yet** — a botched edit cannot be auto-restored from within Stribog. Recovery is intended to come from the Perun scratch-ref snapshot taken before each run (a Phase-2 component), which reverts **tracked-file edits only**. It does **not** undo the side effects an actuator exists to cause (started services, untracked artifacts); those remain the human's to clean up, per the orphan policy above. Treat Stribog accordingly until later phases land.
