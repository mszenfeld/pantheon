# Stribog `extraTools` — configurable actuator tools + targeted fixture mutation (design)

**Date:** 2026-06-14
**Status:** Approved direction; revised twice — second pass was sequential-thinking + a **5-lens MoA with
source/binary cross-checking** (which corrected several first-revision claims: deny-before-attribution, the
dash-flattening id shape, config.agent.tools enforcement, the prose capability patterns). Ready for the
implementation plan; the only remaining runtime probe is the §4.1 Supabase id literal (a setup step).
**Scope:** Stribog **plus** the Perun→Stribog dispatch contract and the **§3.10 prompt guard** against the
general-fallback — together the full incident fix (common case handled in Stribog's lane; escalations route to
a stop, not to `general`). **Code-enforced** general/explore dispatch denial and closing the roster remain a
separate later topic (tracked fast-follow).

## 1. Context & problem

During a QA run (manual test of the `i-need-cv` export-snapshot branch), Perun needed a **live
data-fixture mutation** — grant an active export entitlement for the test CV, then repair its empty
payload — so the export endpoint would stop returning `402` / `502`. Perun told Stribog to "use
`supabase_execute_sql`". The tool-budget hook denies any tool outside `{read,glob,grep,edit,write,bash}`
→ `STRIBOG_TOOL_DENIED` → a correct `ESCALATE`. Perun then fell back to the **`general`** all-tools agent
(not in the blessed roster), which, **operating against the wrong Supabase project**, created duplicate
`auth.users` rows and guessed the schema wrong before eventually succeeding.

Re-reading the incident is what shapes the fix:

- **Assumption (must be validated against the `i-need-cv` QA plan before implementation — same status as
  the §4 runtime probes; not checkable from this harness repo):** the prerequisite FK chain
  (`auth.users → profiles → cvs → cv_payload`) was **already seeded by the existing QA flow** — SETUP-01
  logged the test user in (→ the auth row exists), SETUP-02 created the CV via `POST /api/v1/cvs` (→ the
  cv + payload rows exist). If true, the only missing pieces were the **entitlement row** and a **payload
  repair**. The "FK-chain-from-scratch" `general` performed was then an **artefact of hitting the wrong
  project** (empty → it recreated everything). **If this assumption is false** (e.g. the CV POST itself
  402'd for lack of entitlement, so no cv/payload row exists), the task IS a multi-table seed → `ESCALATE`
  (§3.9), and `extraTools` alone does not close the incident — making this probe load-bearing.
- **Mutation shape (resolve the INSERT-vs-UPDATE ambiguity explicitly):** the entitlement is a **bounded
  `INSERT`** of exactly one row keyed to the verified CV. The payload is a **bounded `UPDATE`** *iff* the
  `cv_payload` row already exists (created by SETUP-02) but is empty/invalid; if that row is absent, the
  repair is an `INSERT` — and **Stribog must distinguish these by reading back first** (§3.9), not assume.
- So **if** the assumption holds, with **correct targeting** the task reduces to a **bounded grant/fix on
  an already-seeded fixture** — squarely in Stribog's "small, mechanical, real-side-effect" lane.
  **Targeting is the keystone**, not raw FK-chain capability.

Three structural findings frame the design:

1. The harm was the improvised, **context-blind** fallback, not Stribog's refusal.
2. No roster role owns "mutate live fixture data"; `zmora-setup` only mints secrets, `zmora-{fe,be}`
   execute, `triglav` is read-only, `stribog` does services + ≤2-file edits. Data seeding was unowned.
3. Stribog's boundary is inconsistent: its `bash` is already a full host shell (can run `psql`/`curl`);
   the hook deliberately denies only `execute_recipe` (minter≠actuator) and `task` (leaf), and
   `supabase_execute_sql` falls as **collateral** of a closed allow-list — blocking the clean path while
   leaving the raw one open.

**Decision:** give Stribog a **configurable** set of extra actuator tools (exact id or `supabase_*`
group), **plus** a dispatch contract and a project-identity verification step so the mutation lands on
the right target — without re-opening the load-bearing invariants.

## 2. Goals / Non-goals

**Goals**
- Stribog can use a curated, per-project-configurable set of extra tools (e.g. the Supabase MCP), by
  exact id or trailing-`*` group glob.
- A **capability-aware, immutable guardrail** no config can re-enable: not just the named minter/dispatch
  ids, but the *exec/dispatch/mint capability class*.
- A **dispatch contract** (Perun → Stribog) carrying the non-secret **base-URL + concrete row id**, and a
  **project-identity verification** that refuses to mutate (or create-from-scratch) when the target does
  not already hold the expected fixture.
- Zero behavior change when unconfigured (`extraTools` defaults to `[]`).

**Non-goals**
- **Code-enforced** denial of `general`/`explore` as Perun dispatch targets, and closing the roster — a
  separate topic (tracked fast-follow). This spec adds only the **§3.10 prompt-level guard**.
- Restricting bash sub-commands (`rm`/mutating-git) — existing documented follow-up.
- Automatic edit-recovery (Phase 2); a per-operation DB blast-radius budget.
- A brand-new fixture-owner agent — the FK chain stays owned by the **existing QA recipe flow**.

## 3. Design

### 3.1 Config surface — `agents.stribog.extraTools`

```jsonc
{ "agents": { "stribog": {
  "extraTools": ["supabase_*"]   // exact lowercase runtime id OR trailing-* group glob
} } }
```

- Each entry is an **exact** lowercase runtime id (`supabase_execute_sql`) or a **prefix-glob** ending in
  a single `*` (`supabase_*`). Entries are lowercase by validation (§3.5); the runtime ids opencode emits
  are lowercase (pinned by `tool-budget-hook.test.ts` — capital `Edit` is denied).
- Default `[]` → byte-for-byte today's Stribog (no regression).
- Name is deliberately **not** `tools` — that collides with the inert native `config.agent.stribog.tools`
  deny-map.
- **MCP-id shape (binary-verified on 1.17.3 — corrected):** opencode joins an MCP server's tools as
  `<serverKey>_<toolName>` where each segment is sanitized by `s => s.replace(/[^a-zA-Z0-9_-]/g,"_")` —
  the char class **includes `-`, so dashes are PRESERVED**; only the single `_` *between* server-key and
  tool-name is injected. It does **not** use the `mcp__server__tool` form (that is Claude Code's own
  namespacing, not opencode's). Consequences the first draft got wrong:
  - context7's real tool `resolve-library-id` surfaces as `context7_resolve-library-id` (**not**
    `..._resolve_library_id`). A Supabase tool named `execute-sql` surfaces as `supabase_execute-sql`.
  - `supabase_*` still matches either spelling (prefix glob), but any **exact-id** `extraTools` entry or
    test must use the literal **as emitted, dashes and all** — so the §3.5 validator must permit `-`
    (see §3.5), and the §4.1 probe must record `execute_sql` vs `execute-sql`.
  - A trailing-`*` matches the flattened namespace prefix **including sibling server keys**
    (`supabase_admin_*`) — acceptable because the guardrail (§3.4) is checked first.

### 3.2 Resolution & plumbing

- `src/modules/pantheon-config/schema.ts`:
  - `PantheonConfig` agent shape: `{ model: string }` → `{ model?: string; extraTools?: string[] }`
    (**`model` becomes optional** — an `extraTools`-only agent is valid; all readers already use `?.model`).
  - Add `"extraTools"` to `KNOWN_AGENT_FIELDS`.
  - **CRITICAL fix (else the headline case silently no-ops):** today the validator does
    `if (model === undefined) continue;` *before* storing `result.agents[name] = { model }` (~`schema.ts:139`,
    `:161`). An `extraTools`-only agent (no `model` — the common case, since the model already defaults) hits
    the `continue` and is **never stored** → `loadPantheonConfig().agents.stribog` is `undefined` →
    `?.extraTools ?? []` is empty → feature does nothing. Restructure: extract+validate `extraTools` **above**
    the `model`-undefined guard, and store the agent when **`model` is valid OR `extraTools` is non-empty**:
    `result.agents[name] = { ...(model ? { model } : {}), ...(extraTools.length ? { extraTools } : {}) }`.
  - `schema.test.ts` `toEqual` snapshots gain the new field.
- `src/modules/stribog/index.ts`: read `loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.extraTools ?? []`,
  normalize/validate, pass into `makeStribogToolHook({ resolveAgent, extraPatterns })`.
  - **Timing (note, not parity):** this is a **construction-time** read (~`index.ts:35`), unlike `model`
    which is resolved in the `config` hook via `applyModelOverride` (`index.ts:88`). That is fine on its own
    terms — `loadPantheonConfig()` is synchronous and process-lifetime cached, and `extraTools` has **no
    `opencode.json` precedence leg** (so the `captureUserModels` dance doesn't apply). Do **not** describe it
    as "mirroring how `model` is read."
- **Loader merge footgun (document):** `loader.ts` merges per-agent by **whole-object replace** ("closest
  file wins"), not per-field. With two fields, a project `.opencode/pantheon.json` of
  `{ agents: { stribog: { extraTools: [...] } } }` will **wipe** a user-global `{ stribog: { model } }`.
  Document this in `configuring-agents.md` (v1); per-field shallow-merge is a possible follow-up.

### 3.3 Hook predicate (the boundary)

`tool-budget-hook.ts` changes only the "allowed for a stribog session" predicate. Two ordering rules are
load-bearing: **(a) every denial stays gated on confirmed-stribog attribution**, and **(b) within that
block, `IMMUTABLE_DENY` is checked first** so it wins over any glob.

```
hook(input):
  const raw     = input.tool                          // exact runtime id (opencode emits lowercase)
  const denyKey = raw.toLowerCase()                   // lowercased copy used ONLY for deny + glob match
  const isEditWrite = raw === "edit" || raw === "write"

  // pre-filter (no attribution): the 6 core non-edit builtins always pass, are a no-op for everyone else
  if (!isEditWrite && CORE_BUILTINS.has(raw)) return

  const agent = await resolveAgent(input.sessionID)
  if (agent !== STRIBOG_AGENT_KEY) return              // FAIL-OPEN for non-stribog / unresolved attribution

  // ---- confirmed stribog from here ----
  1. if IMMUTABLE_DENY_MATCH(denyKey)             -> DENY   (guardrail; wins over any glob)
  2. if CORE_BUILTINS.has(raw)                    -> edit/write budget (unchanged), else ALLOW
  3. if extraPatterns.some(p => match(p,denyKey)) -> ALLOW
  4. else                                         -> DENY   (STRIBOG_TOOL_DENIED)

match(pattern, tool): pattern ends with "*" ? tool.startsWith(pattern.slice(0,-1)) : tool === pattern
```

- **Raw-vs-lowercase split (resolves the `Edit` contradiction):** opencode emits lowercase ids, so
  `CORE_BUILTINS` membership and the `edit`/`write` budget match the **raw** id — which keeps capital
  `Edit` **denied** (preserving the existing pin `tool-budget-hook.test.ts:90-94`). The lowercased
  `denyKey` is used **only** for `IMMUTABLE_DENY_MATCH` and the `extraPatterns` glob, so a weird-cased
  dangerous id (`"Execute_Recipe"`, `"TASK"`) is still caught. Do **not** lowercase before the
  `CORE_BUILTINS`/budget checks (that would make `Edit` allowed and invert the test). The first draft's
  "normalize ONCE, match everything against the lowercase" was wrong on exactly this point.
- **Attribution-gated denial (corrects "deny-before-attribution", which was unsafe):** the previous draft
  put `IMMUTABLE_DENY` *before* attribution. That is wrong — **every** immutable-denied id is legitimate
  for some *other* agent (`execute_recipe` → `zmora-setup`; `dispatch_*` → Perun/Veles), so a
  pre-attribution throw would break those callers during *their* turn-1 / 5s-negative-cache window. The
  hook must fail open until the session is positively `stribog`. The minter≠actuator invariant does **not**
  rely on this hook's timing: `execute_recipe` is independently gated by its own caller-gate
  (`gate.isSetupCaller`, `zmora-setup`-only, `qa/index.ts`), so even if a stribog session reaches
  `execute_recipe` in its own attribution-fail window, that gate refuses it. This hook is defense-in-depth.
- **Pre-filter stays `CORE_BUILTINS`-only:** `!isEditWrite && CORE_BUILTINS.has(raw) → return`. Do **not**
  add `extraPatterns` to it — that would skip attribution and leak the conditional allow to *every* session
  (the hook fails open for non-stribog), exposing the actuator tool to Perun/zmora/triglav.
- Edit-budget logic for `edit`/`write` is unchanged; DB/MCP tools correctly bypass it (intended — same trust
  class as bash, §3.6).
- `CORE_BUILTINS` = today's `STRIBOG_ALLOWED_TOOL_IDS`, renamed for clarity (extra set is the *other* source).

### 3.4 `IMMUTABLE_DENY` — capability-aware, not just six names

Centralized in `stribog.metadata.ts`. The first cut (six literal ids) was **too weak**: a `serena_*` glob —
the in-repo MCP convention (`plan/allowed-tools.ts:11-17`, `perun.md`) — matches
`serena_execute_shell_command` (**arbitrary host shell**) and serena memory-writes, none of which are
`execute_recipe`/`task`/dispatch literals. So the guardrail must deny the **capability class**, not just names:

- **Named immutable ids:** `execute_recipe` (minter≠actuator) + the dispatch family. Reuse the canonical
  `DISPATCH_TOOL_NAMES` (`src/modules/coordinator/dispatch-tool-names.ts`) rather than re-hardcoding:
  `IMMUTABLE_DENY = new Set(["execute_recipe", "task", ...DISPATCH_TOOL_NAMES])`. (`task` is opencode's native
  leaf-dispatch id and is *not* in `DISPATCH_TOOL_NAMES`, so it stays an explicit literal — comment it.)
  - **Pin the membership (anti-shrink):** `DISPATCH_TOOL_NAMES` exists to opt Veles *into* dispatch; if a
    future edit removes a name from it, Stribog's deny set silently shrinks. Add a test asserting the literal
    expected members (`dispatch_parallel`, `dispatch_background`, `poll_background`, `wait_background`) are in
    `IMMUTABLE_DENY`, so an unrelated edit to the shared list fails *Stribog's* test too.
- **Capability-class deny — COMMITTED, TESTED REGEXES, not prose (the first revision's gap):** prose patterns
  like "`replace_*`/`insert_*`" left real holes — `serena_replace_symbol_body` (writes arbitrary code),
  `serena_create_text_file`, `serena_replace_content`, `serena_insert_after_symbol`, `serena_safe_delete_symbol`,
  `serena_edit_memory` contain none of shell/dispatch/recipe/task and would reach ALLOW. The deny must be a
  concrete, segment-anchored regex list (matched against `denyKey`; segment-anchoring makes it **server-key /
  prefix agnostic**, so `serena_…`, `serena2_…`, or any future key is covered):
  - exec/shell: `/(^|_)execute_shell(_command)?$/`, `/(^|_)shell(_command)?$/`
  - dispatch/recipe/leaf: `/(^|_)dispatch(_|$)/`, `/(^|_)recipe(_|$)/`, `/(^|_)task$/`, `/^task(_|$)/`
  - mutation verbs (catches serena writes + any write-capable MCP): `/(^|_)(write|create|replace|insert|rename|delete|move|edit)_/`
  - mutation-target suffixes: `/_(memory|symbol|symbol_body|content|text_file)$/`
  This restores (and makes real for the first time — see §5/`light-execution.md:24` note) the "serena-write
  denied" guarantee.
- **`IMMUTABLE_DENY_MATCH(tool)`** = `named.has(tool) || CAPABILITY_DENY_PATTERNS.some(rx => rx.test(tool))`.
- **Corpus test (mandatory):** a single test asserts **every** id in an enumerated dangerous corpus is denied —
  at minimum `serena_execute_shell_command`, `serena_write_memory`, `serena_create_text_file`,
  `serena_replace_content`, `serena_replace_symbol_body`, `serena_insert_after_symbol`,
  `serena_insert_before_symbol`, `serena_rename_symbol`, `serena_delete_memory`, `serena_safe_delete_symbol`,
  `serena_edit_memory`, `execute_recipe`, `task`, and each `DISPATCH_TOOL_NAMES` member — plus their
  weird-cased variants (`"SERENA_EXECUTE_SHELL_COMMAND"`). This corpus is the guardrail's real contract.
- **Honest scope statement (docs):** the guardrail blocks the harness's *minting/dispatch/exec/write* classes;
  it does **not** make an arbitrary broad glob safe. `configuring-agents.md` + `stribog.md` carry a hard
  warning: *scope `extraTools` globs to a single trusted data-MCP namespace; a glob like `serena_*` grants a
  shell + code-writes and its dangerous children are denied at runtime by the hook.*
- **`STRIBOG_DENIED_TOOLS` relationship (don't naively equate):** the inert native deny-map
  (`stribog.metadata.ts:45-51`) lists `task/execute_recipe/todowrite/webfetch/websearch`. It is **declarative
  only** (inert per §4) and intentionally a *different* set from `IMMUTABLE_DENY` — it carries extra opt-outs
  (`todowrite/webfetch/websearch`, already denied-by-omission from `CORE_BUILTINS`) but omits the dispatch
  family. The correct reconcile is the **invariant `IMMUTABLE_DENY-named ⊆ STRIBOG_DENIED_TOOLS keys`**
  (assert in a test), extending `STRIBOG_DENIED_TOOLS` to also list the dispatch family — **not** equating the
  two (which would wrongly drop `webfetch/websearch`). Update `metadata.test.ts:79-87` (hardcoded 5-literal
  `toMatchObject` — **breaks on extension**) accordingly; `plugin.test.ts:107` reads the live constant and is
  unaffected.

### 3.5 Two-layer guardrail enforcement

Enforced at **config-load** (best-effort fail-fast UX) and in the **hook** (the authoritative boundary). The
split of responsibility must be stated honestly — config-load cannot catch everything a glob can reach:

- **Config-load — reject (drop entry + push to `errors[]`, rest of list survives) when an entry is:**
  - malformed — not `^[a-z0-9_-]+\*?$` (lowercase alnum / `_` / `-`, optional single trailing `*`; the `-` is
    required because emitted ids preserve dashes, §3.1), or a bare `*` (the regex already rejects it since it
    requires ≥1 leading char); the error states "must be lowercase alnum/_/-, optional single trailing `*`"; or
  - a **statically-provable collision** with the capability guardrail — exactly an `IMMUTABLE_DENY` named id;
    OR a glob whose prefix covers a named denied id (`denyId.startsWith(globPrefix)`, e.g. `execute_*` ⊃
    `execute_recipe`); OR a glob whose **prefix itself** matches a `CAPABILITY_DENY_PATTERN` (e.g. `*shell*`).
- **What config-load CANNOT prove (documented limitation, not a bug):** a glob like `serena_*` is **not**
  rejected at config-load — its prefix `serena_` contains no shell/write marker and no named denyId starts with
  it, so static analysis cannot know it covers `serena_execute_shell_command`. The first revision's claim that
  `serena_*` is "rejected at config-load" was **false to the stated mechanism**. Such a glob is accepted by
  config-load and its dangerous **children are denied one-by-one by the hook at call time** (step 1). The
  fail-fast UX therefore does *not* fire for broad cross-namespace globs — the docs (§3.4) must warn operators
  not to write them. (Optional future UX nicety, not required: an advisory denylist of known code/shell server
  keys (`serena_`) rejected at config-load; deferred — the hook already makes it safe, just not friendly.)
- **Hook — `IMMUTABLE_DENY_MATCH` (step 1) denies regardless of how an id arrived** — the real boundary;
  config validation is only fail-fast surfacing of the statically-decidable subset.

### 3.6 Blast radius & the trust boundary (honest framing)

DB mutations bypass the 2-file `edit`/`write` budget — left as-is, but the framing is corrected:

- This is the **same accepted host-env trust class as bash**: Stribog can already run `psql`/`docker`/`rm`/
  `curl`. A structured `supabase_*` exposes a cleaner path to power it already holds — for **authority**.
- **What is genuinely new (stated plainly, not "no worse than bash reads `.env`"):** a DB-mutation MCP gives
  Stribog **structured read/write to whatever that connection can reach — including remote/shared/multi-tenant
  secret-bearing tables** (`auth.users`, service-role rows). That is a new *reachable-secret* surface vs.
  local-`.env` egress, and it is exactly the data the `bindings-store` denylist prefixes
  (`SUPABASE_`/`POSTGRES_`/`DATABASE_`) exist to keep from agents. The secret never enters via the binding
  gate (which stays `zmora-*`-only) — it enters via the **tool *result* the model sees**, and Stribog tool
  results are **not** run through the QA stderr scrubber (that protects `zmora`, not `stribog`). So a
  `SELECT *` on a secret-bearing table puts those values directly in context.
- **Least-privilege is a hard precondition, not a recommendation:** because the only real control on datastore
  contents is the connection's own grants, the DB MCP for a QA run **must** be configured with a
  least-privilege role scoped to the fixture tables — documented as a **required precondition** alongside
  §3.7's "MCP points at the local stack" (both in `light-execution.md` + `configuring-agents.md`). The
  capability guardrail protects harness invariants (no minting machinery, no dispatch/exec/write-to-code),
  **not** the contents of any datastore the configured tools reach.

### 3.7 Targeting & project-identity verification (the keystone)

`extraTools` governs *which tool ids* the hook permits; it does **not** govern the MCP's **connection
target** — that is ambient opencode MCP config, outside Pantheon. Left unaddressed, the incident's worst harm
(mutating the wrong project) recurs via a cleaner-looking path. Two parts:

1. **Operator precondition (documented):** the DB MCP configured for a QA run **must point at the local stack
   the run targets** (the same DB `localhost:8000` uses). Documented in `light-execution.md` +
   `configuring-agents.md`, alongside "start the services."
2. **Stribog verifies before mutating (prompt-enforced) — by run-unique identity, not bare id-presence:**
   before any write, Stribog reads back the supplied row in the target DB **and confirms a discriminator that
   is unique to *this* run**, not just that *a* row with that id exists. Id-presence alone is insufficient: a
   wrong-but-populated project can hold a row with the same id (UUIDs get cloned across env snapshots; integer
   PKs collide trivially), which would **false-pass** the check and let the mutation land on the wrong target —
   the exact "cleaner path" failure this section exists to prevent. The discriminator is a field Perun passes
   in the dispatch contract (§3.8) — e.g. the fixture CV's **owner email == the run's `TEST_USER_EMAIL`**. Only
   on a positive identity match does Stribog proceed. If the row is **absent**, or the discriminator
   **mismatches**, that means *wrong project or unseeded fixture* → **FAIL/ESCALATE — never create the
   prerequisite chain from scratch** (that is precisely the seed-from-scratch the QA flow already owns). This
   converts silent wrong-project corruption into a loud, safe stop.

### 3.8 Dispatch contract: Perun → Stribog

A `stribog` session deliberately receives **no QA bindings** (`shell-env-hook.ts:32` injects only for
`zmora-*`) — correct for *secrets*. But a data mutation needs three **non-secret** facts: the **target
base-URL**, the **concrete row id(s)**, and the **run-unique discriminator** (§3.7 — e.g. `TEST_USER_EMAIL`).

- **`perun.md` — this is a NET-NEW dispatch path, not a tweak.** Perun has **no** Stribog-dispatch template
  today: Stribog is surfaced only via the runtime `SPECIALISTS_TABLE` (`registerAgentMetadata`), and
  `grep stribog perun.md` is empty. So §5 must **author** a Stribog data-dispatch block (modeled on the zmora
  "scenario block + base URL" template at `perun.md` Step 5f), passing base-URL + row id(s) + discriminator +
  stack/project identity in the dispatch prompt.
- **Row-id provenance must be deterministic, not incidental.** "The CV id surfaces in `zmora` results" was an
  *observation* from the incident (Perun happened to see `edf681ab…`), **not** a contract guarantee — the QA
  report format does not promise a CV id. The dispatch path must source the id from a **declared plan
  binding / scenario output field**, so Perun deterministically has it. If no such id is available, Perun
  **cannot** dispatch a data mutation → it must stop and report (§3.10), **not** hand an under-specified task
  to an all-tools agent.
- **`stribog.md`:** a data-mutation task **requires an explicit target + id + discriminator in its prompt**;
  if any is absent, Stribog **ESCALATEs and never guesses** an id or schema (exactly where `general` guessed).
  This makes the §3.7 read-back executable and ties verification to the **same project just mutated**.

### 3.9 Prompt discipline & verification (`stribog.md`)

- **Scope rule — made executable (the implied discriminator, now explicit).** "Missing entitlement → OK to
  INSERT" and "missing fixture → ESCALATE" both present as *a `SELECT` returning no row*, so the rule must say
  **which row** disambiguates. The discipline is a closed procedure keyed on the **parent fixture (the CV),
  not the entitlement**:
  1. **Verify the parent** — read back the bound CV id **and** confirm the run-unique discriminator (§3.7,
     e.g. owner email == `TEST_USER_EMAIL`). Parent **absent or discriminator mismatch → `ESCALATE`** (wrong
     project / unseeded chain; owned by the QA recipe flow, never seeded by Stribog).
  2. **Only with a verified parent**, the allowed mutations are a **closed list**: (a) **INSERT exactly one
     entitlement row** keyed to the verified CV (its absence is *expected* — it is what QA grants); (b) **repair
     that CV's payload** — `UPDATE` if the `cv_payload` row exists, `INSERT` if SETUP-02 left it absent
     (§1, decided by read-back). Anything that would require creating a **missing ancestor**
     (`auth.users`/`profiles`/`cvs`) is **out** → `ESCALATE`.
  So a multi-table FK chain from scratch stays an `ESCALATE`; a bounded grant/fix on a *verified* parent is in
  scope. (In the incident, correct targeting makes the entitlement one bounded `INSERT` and the payload one
  bounded `UPDATE`/`INSERT` — in scope.)
- **Verify by read-back**, deterministically, **against the target just mutated**: re-`SELECT` the row, or hit
  the dependent endpoint and confirm the observable effect (e.g. `GET {base-URL}/cvs/{id}` →
  `entitlementStatus: active`). Folds into the existing `READY`/`FAIL`/`ESCALATE` JSON contract.
- The new risk this introduces is **unaimed / over-eager mutation** (a structured tool lowers friction and
  raises apparent legitimacy) — mitigated, not subsumed, by the §3.7 read-back + §3.8 explicit target/id.

### 3.10 Closing the general-fallback for data tasks (Perun prompt guard)

The incident's actual harm was not Stribog's refusal — it was Perun's **context-blind fallback to the
`general` all-tools agent**, which mutated the wrong project. `extraTools` + §3.7–3.9 keep the **common** case
(bounded grant/fix on a verified, seeded fixture) in Stribog's lane, so it no longer escalates. But when
Stribog *does* `ESCALATE`/`FAIL` a data task (a genuinely out-of-scope case — multi-table seed-from-scratch,
wrong project, missing ancestor), Perun must not improvise:

- **`perun.md` rule:** for **data / fixture mutations**, Perun dispatches **only Stribog** (the owning role).
  If Stribog returns `ESCALATE`/`FAIL` on such a task, Perun **stops and reports to the human** with the
  reason — it does **not** re-dispatch the same task to `general` (or any all-tools / non-roster agent).
  Seeding a from-scratch FK chain is the QA recipe flow's job; a wrong-project / missing-ancestor stop is an
  operator or plan issue, not something to brute-force with broad tooling.
- **Honest limitation (this is prompt-level, not enforced):** like Perun's other dispatch discipline, this is
  a prompt instruction an LLM *could* violate — `validateDispatchable` still permits `general` as a subagent
  target (verified `dispatch.ts:129-131`). It makes recurrence far less likely (common case handled in-lane;
  escalations route to a stop, not to `general`) but is **not** a hard boundary. The durable fix —
  **code-enforced denial of `general`/`explore` as Perun dispatch targets** — is a **tracked fast-follow**
  (§7), deliberately kept out of this spec to avoid expanding into coordinator dispatch policy here.

## 4. Runtime / version prerequisites

Both assumptions were re-checked against the **installed opencode 1.17.3** binary
(`/opt/homebrew/Cellar/opencode/1.17.3/bin/opencode`; the 1.15.10 probes cited in `allowed-tools.ts:4` /
`stribog.metadata.ts:41` are stale). Disassembly resolved the second; only the first needs a live run.

1. **(ONE remaining probe — and it is a SETUP step, currently un-runnable) exact MCP-id shape for Supabase.**
   The flattening *mechanism* is binary-verified: ids are `<serverKey>_<toolName>` with each segment sanitized
   by `replace(/[^a-zA-Z0-9_-]/g,"_")` — **dashes preserved** (§3.1). What is *not* knowable from disk is
   Supabase's literal tool name (`execute_sql` vs `execute-sql`) and chosen server key, because **no Supabase
   MCP is configured on this machine** (`~/.config/opencode/opencode.json` has only context7/serena/
   sequential-thinking/playwright/agentmemory). So the probe is a prerequisite *setup*, not a passive
   observation: **(i)** add `mcp.supabase` to opencode.json pointing at the local stack, **(ii)** record the
   exact server key (that becomes the prefix), **(iii)** dispatch stribog with `extraTools:["supabase_*"]`,
   **(iv)** log `input.tool` in the hook, **(v)** pin the observed literal in a test.
2. **(RESOLVED — was the scary one) `config.agent.<x>.tools` is honored on 1.17.3 but DEFAULT-ALLOW.** The
   binary converts an agent `tools:{name:bool}` map to permission rules and filters a tool out **only** when a
   rule explicitly matches it with `action:"deny", pattern:"*"` (`disabled()` / `k6`); a tool **absent from all
   rules survives**. Therefore an `extraTools` MCP id that is in no allow-map is **NOT** pre-denied — **the
   feature will not silently fail**, and the hook remains the real boundary. **Consequence:** mirroring
   `extraTools` into `config.agent.stribog.tools` is **OPTIONAL defense-in-depth**, no longer a gating
   prerequisite. Its *only* value is overriding a hostile/legacy **explicit** deny (`user.tools?.[id]===false`
   removes a tool regardless). Recommend: keep it as a small, cheap injection (pattern exists at
   `plan/index.ts:50`, Veles `AgentConfig.tools`) but the plan need not block on a re-probe of this point.

## 5. Files touched

- `src/modules/stribog/stribog.metadata.ts` — `CORE_BUILTINS` (rename), `IMMUTABLE_DENY` (+ capability
  patterns, reuse `DISPATCH_TOOL_NAMES`), reconcile `STRIBOG_DENIED_TOOLS`, `match`/`isAllowed` helpers.
- `src/modules/stribog/tool-budget-hook.ts` — `allowed()` predicate with the **raw-vs-lowercase split** and
  **attribution-gated deny** (§3.3, NOT deny-before-attribution), `extraPatterns` dep, pre-filter on
  `CORE_BUILTINS`, rename the `STRIBOG_ALLOWED_TOOL_IDS` import to `CORE_BUILTINS`.
- `src/modules/stribog/index.ts` — read+normalize `extraTools`, pass into the hook factory.
- `src/modules/stribog/allowed-tools.ts` — declaration/comments; state `STRIBOG_TOOLS ≡ CORE_BUILTINS` (static
  boundary) stays synced and `extraTools` is a **separate dynamic source** `tools-sync` does not cover.
- `src/modules/pantheon-config/schema.ts` — optional `model`, `extraTools` type + `KNOWN_AGENT_FIELDS` +
  validation (§3.5, regex permits `-`) + the store-when-`extraTools`-only fix (§3.2); non-stribog `extraTools`
  → ignored-field diagnostic.
- `src/agents/perun.md` — **author a NET-NEW** Stribog data-dispatch block (§3.8 — none exists today): base-URL
  + deterministic row id(s) + run-unique discriminator + project identity; and the §3.10 guard ("for data
  mutations dispatch only Stribog; on its ESCALATE/FAIL stop and report — never re-dispatch to `general`").
- `src/modules/stribog/stribog.md` — §3.7/§3.8/§3.9 (require target+id+discriminator, parent read-back by
  run-unique identity, closed-list mutation shape, clarified ESCALATE line, capability-glob warning).
- `docs/light-execution.md` — security model (configurable extension + capability guardrail), honest exfil
  framing + **tool-results-not-scrubbed** note, **least-privilege as required precondition**, targeting
  precondition; reconcile the existing denied-set prose (`:24-25,:38`) with `IMMUTABLE_DENY` (note `:24`'s
  "serena-write denied" only becomes *truly* enforced now, via §3.4 patterns).
- `docs/configuring-agents.md` — `agents.stribog.extraTools` (syntax, default, guardrail, glob warning,
  loader whole-object-replace footgun, DB-MCP-targets-local-stack + least-privilege preconditions) **AND update
  the canonical "## Schema" block (lines 101-113)** to add `"extraTools"?: string[]` — else the schema
  reference contradicts the new field.
- **`dist/`** — committed and CI-enforced (`scripts/verify-dist-sync.mjs` + a CI dist-drift `git diff`); run
  `bun run build` + commit. **Note:** `copy-root-assets.mjs` copies `src/agents/**/*.md` and
  `src/modules/*/**/*.md` into `dist/`, so the committed dist diff includes **`dist/agents/perun.md` and
  `dist/modules/stribog/stribog.md`**, not just the four stribog `.js`/`.d.ts` artifacts.
- **Tests** — see §6.

## 6. Testing

- `match()`: exact / prefix / miss; trailing-`*` only.
- **Raw-vs-lowercase split (§3.3):** capital `"Edit"` stays **denied** (matched raw against `CORE_BUILTINS`,
  preserving `tool-budget-hook.test.ts:90-94`), while `"Execute_Recipe"`, `"TASK"`,
  `"SERENA_EXECUTE_SHELL_COMMAND"` are **denied** (matched lowercased against `IMMUTABLE_DENY`).
- **Capability corpus (§3.4) — the guardrail's real contract:** every id in the enumerated dangerous corpus
  (serena exec + all serena write/symbol/memory ids incl. `serena_replace_symbol_body`/`serena_create_text_file`,
  `execute_recipe`, `task`, each `DISPATCH_TOOL_NAMES` member) is denied by the hook; plus a **DISPATCH
  membership pin** (the four literals are present in `IMMUTABLE_DENY`, so shrinking the shared list fails this
  test). `supabase_*` allows `supabase_execute_sql`; `execute_*`/bare-prefix globs never yield
  `execute_recipe`/`task`.
- **Config-load validation (§3.5):** malformed (no trailing-`*`-only, allows `-`), bare `*`, and exact named
  denyIds are dropped to `errors[]`; a `serena_*` glob is **accepted at config-load** (its danger is in the
  children, not statically provable) but each dangerous child is **denied by the hook** — assert both halves so
  the honest split is locked, not the false "rejected at config-load."
- **Attribution-gated deny (§3.3, corrected):** an `IMMUTABLE_DENY` id is denied **only for a confirmed
  stribog session**; during *unresolved* attribution the hook **fails open** (NOT denied) — and a non-stribog
  caller of `execute_recipe`/`dispatch_*` is never blocked by this hook. A pattern-matched MCP id **does**
  trigger `resolveAgent` (pre-filter stays `CORE_BUILTINS`-only, never `extraPatterns`).
- **Config plumbing — the headline case:** a pantheon.json with `extraTools` and **no `model`** yields
  non-empty `extraPatterns` at the hook (guards the §3.2 store-fix); default `[]` = no change (regression guard
  on the core six). Non-stribog `extraTools` warns.
- **Id-shape pin (after the §4.1 setup probe):** the hook allows the literal `input.tool` a real Supabase MCP
  emits under `extraPatterns:["supabase_*"]` (record whether it is `execute_sql` or `execute-sql`).
- **Add (not "relocate") the secret-gate assertion:** "`execute_recipe` denied for a stribog session even with
  permissive `extraPatterns`" is **added** to `tool-budget-hook.test.ts` (feed the hook directly). There is
  nothing to move out of `secret-gate-invariant.test.ts` — that file tests `shell-env` binding injection (a
  different layer) and has no such assertion.
- **schema.test.ts (corrected — do NOT edit existing snapshots):** existing `toEqual` cases feed `model`-only
  input and stay green (extraTools stored only when present); **ADD** new cases (extraTools-only stored as
  `{extraTools:[...]}`; malformed/collision → `errors[]`; non-stribog warns). Verified baseline: 19/19 schema,
  107/107 total green.
- **Rename ripple:** `tools-sync.test.ts` (rename the `STRIBOG_ALLOWED_TOOL_IDS` import at line 3 + uses at
  28,40; the cited "33" is the derived-var assertion, untouched), `allowed-tools.test.ts` length guard (49-51),
  `metadata.test.ts` (frozen ids 69-77; denied map 79-87 — breaks on the §3.4 `STRIBOG_DENIED_TOOLS`
  extension), `plugin.test.ts:107` (reads the live constant — unaffected, but is the *second* consumer of
  `STRIBOG_DENIED_TOOLS`), and the `STRIBOG_ALLOWED_TOOL_IDS → CORE_BUILTINS` import in `tool-budget-hook.ts`.

## 7. Out of scope (deliberate, later)

**Code-enforced** general/explore dispatch-target denial (the §3.10 guard is prompt-only; code enforcement in
`validateDispatchable` is the tracked fast-follow) and closing the roster; bash sub-command restriction; auto
edit-recovery (Phase 2); DB-operation count/blast-radius budget; per-field loader shallow-merge; a dedicated
fixture-owner agent.

## 8. Compatibility

`extraTools` defaults to `[]`; unset = today's Stribog exactly. The native `config.agent.stribog.tools`
deny-map (confirmed default-allow on 1.17.3, §4.2), the QA binding gate, and `execute_recipe` =
`zmora-setup`-only are untouched; the minter≠actuator invariant holds (and does not depend on the tool-budget
hook's timing — §3.3). The Perun dispatch-contract change is additive (extra context in the prompt) and inert
for non-data Stribog tasks.
