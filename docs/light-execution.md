# Light Execution (Stribog)

**Stribog** is a light-execution actuator dispatched by the Perun coordinator. Perun hands it ONE small, mechanical task — bring up / restart / fix a downed service, read logs, or apply a 1–2 file config/value change — which it performs with **real side effects**, verifies, and reports as a structured JSON result. Stribog is a leaf: it never delegates or spawns other agents, and it never produces feature work or secrets.

This is the counterpart to Triglav's read-only [`exploration.md`](exploration.md): where Triglav *gathers*, Stribog *acts*.

## Scope — accept the task only if ALL hold

Stribog accepts a task only when every rubric point holds, and otherwise returns `ESCALATE` rather than pressing on:

1. It touches a narrow, known set of files (order of 1–2), not a sprawling change.
2. It is local and mechanical — bring up / restart a service, read logs, add a config field/entry, change a value — with **no** new abstractions, modules, or architectural decisions.
3. Verification is deterministic and fast (build/lint passes, or the service answers).

A task that fails any check, or turns out non-trivial mid-way (it spreads across subsystems, or needs a design decision), is escalated — not attempted. **Producing or refreshing a secret/credential value is explicitly out of scope** (that is `zmora-setup`'s job); Stribog never mints, reads-for-output, or echoes secrets.

## Security model — what the allow-list actually contains

The **real** security boundary is OpenCode's **deny-by-default allow-list**: Stribog can only call tools that appear in its allow-list (`src/modules/stribog/allowed-tools.ts`). Anything not listed is simply uncallable.

The list grants exactly three groups:

- **Structured tools:** `Read`, `Glob`, `Grep`, `Edit`, `Write`.
- **Actuator Bash verbs:** `Bash(docker:*)`, `Bash(docker compose:*)`, `Bash(make:*)`, `Bash(npm:*)`, `Bash(pnpm:*)`, `Bash(bun:*)`, `Bash(uv:*)`, `Bash(curl:*)`.
- **Read-only git:** `Bash(git --no-pager log:*)`, `Bash(git --no-pager blame:*)`, `Bash(git --no-pager status:*)`, `Bash(git --no-pager diff:*)`.

### Why these exclusions are load-bearing

The exclusions matter more than the inclusions. Each one is deliberate (see the EXCLUSIONS comment at the top of `src/modules/stribog/allowed-tools.ts`):

- **No `execute_recipe` / `serena-write`** → Stribog cannot value-hide-mint secrets. Minting stays with `zmora-setup` (see [the minter ≠ actuator invariant](#the-minter--actuator-invariant) below).
- **No `Task` / dispatch** → Stribog is a leaf; it never fans out to other agents.
- **No `rm`, and `git` is read-only** → Stribog cannot use `rm`, `git revert`, or `git reset` to "recover" from a botched edit. Edit recovery is **not** Stribog's responsibility — it is the Perun scratch-ref snapshot (a Phase-2 component; see the [Experimental note](#experimental--phase-1-note) below). Program-name matching could never reliably stop `git reset --hard` / `git checkout -- .` / `git clean` from erasing an uncommitted diff anyway, so the recovery net lives outside Stribog by design.
- **No `interactive_bash`** → not ported in v1; long-running services run **detached** via plain `Bash` (`docker compose up -d`, `<cmd> &`).

> Per project doctrine (AGENTS.md): **Bash token-matching is defense-in-depth, not a security boundary.** It cannot inspect flag values, and `make` / `npm` / `docker` run repo-controlled code with the operator's env. Do not rely on Stribog's Bash rail to contain an adversarial prompt — the **tool exclusion** in the allow-list is the boundary; the Bash filtering only raises the cost of escalation.

This mirrors the in-code note at `src/modules/stribog/allowed-tools.ts:1-13`.

## The minter ≠ actuator invariant

Secrets stay with `zmora-setup`; they are never co-resident with the actuator.

- Stribog has **no `execute_recipe`**, so it has no path to the minting machinery in the first place.
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

Unlike Triglav (which inherits the session default), **Stribog is a doer and pins a Sonnet-class default**: `anthropic/claude-sonnet-4-6` (`DEFAULT_STRIBOG_MODEL` in `src/modules/stribog/stribog.metadata.ts`). This is a role fit, **not** a security control — the security boundary is the allow-list, never the model choice.

The default is overridable via `agents.stribog.model` in `pantheon.json` (same mechanism as `perun`, `zmora`, and `triglav`). See [`configuring-agents.md`](configuring-agents.md) for the file's location, precedence rules, and full schema:

```jsonc
{ "agents": { "stribog": { "model": "<providerID>/<modelID>" } } }
```

A Sonnet-class model fits because Stribog's work is **operational reasoning with real side effects** — detect the run command, bring a service up, interpret liveness probes, apply a precise edit, and decide READY/FAIL/ESCALATE — where a wrong call has real consequences (a mis-applied edit, a falsely-reported-live service). That is a heavier bar than Triglav's retrieval-and-synthesize workload, so Stribog does not chase the cheapest/fastest model the way the many-in-parallel explorer does.

## EXPERIMENTAL / Phase-1 note

Stribog is **EXPERIMENTAL (Phase 1)**. Most notably: **there is no automatic edit-recovery yet** — a botched edit cannot be auto-restored from within Stribog. Recovery is intended to come from the Perun scratch-ref snapshot taken before each run (a Phase-2 component), which reverts **tracked-file edits only**. It does **not** undo the side effects an actuator exists to cause (started services, untracked artifacts); those remain the human's to clean up, per the orphan policy above. Treat Stribog accordingly until later phases land.
