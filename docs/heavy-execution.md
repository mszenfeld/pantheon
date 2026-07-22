# Heavy Execution (Svarog)

**Svarog** is a heavy/main code executor dispatched by the Perun coordinator. Perun hands it a goal — often a Veles plan — and Svarog executes it end-to-end: explores the codebase, writes code test-first, runs the full suite/build, and returns a verified diff. Svarog is a leaf: it never delegates or spawns other agents, and it never produces secrets. It never commits via bash — commits go only through the sanctioned `av_commit` tool (the publish chain `create_branch` → `av_commit` → `create_pr`), always with an explicit `files` list.

This is the counterpart to Stribog's [`light-execution.md`](light-execution.md): where Stribog performs one small mechanical task in one or two files, Svarog implements a multi-file feature or refactor.

## Scope — the dispatch rubric

Svarog applies judgment at every step, returning `ESCALATE` rather than pressing on when the work is outside its lane:

- **ESCALATE up** when: the design/approach is ambiguous or the plan is wrong/missing; the work needs a new architectural decision not covered by the plan; a secret or credential value is required (→ `zmora-setup`, minter ≠ actuator); the work needs to fan out to other agents.
- **Delegate trivial → Stribog** when: the task is a 1–2 file mechanical change or an environment bring-up that does not require broad in-tree edits. Svarog does not spin up the heavy executor for work that is in Stribog's lane.
- **Just do it** when: the task is a planned multi-file feature or refactor with deterministic verification. If the goal is unambiguous and the plan is present, Svarog works autonomously to completion without asking.

A task that fails any check, or turns out to require an unsettled design decision mid-way, is escalated — not attempted. **Producing or refreshing a secret/credential value is explicitly out of scope** (that is `zmora-setup`'s job); Svarog never mints, writes, or echoes secrets.

## Security model — allow-by-default with a deny floor

The runtime security boundary is the **`tool.execute.before` hook** in `src/modules/svarog/tool-budget-hook.ts`.

Unlike Stribog's closed deny-by-default allow-list, Svarog is a **broad-access multi-file executor** — it uses the full toolset (edit many files, run the suite, read diagnostics, load skills). Its hook is therefore **allow-by-default with a deny floor**. The order is load-bearing:

1. **Pre-filter:** `read`, `glob`, `grep` pass immediately without attribution — they have no deny path and the attribution fetch is skipped for them.
2. **Attribution gate:** the hook resolves the session's agent via `getSessionAgentCached` and **fails open** for any non-svarog or unresolved session. Every denial is attribution-gated — a denied id is never refused for another agent that legitimately uses it.
3. **Auto-create the recovery checkpoint** (once, before the first mutating tool) — see [Checkpoint and recovery](#checkpoint-and-recovery-in-tree-commit-tree) below.
4. **Bash secret-generation tripwire:** if a `bash` call matches known secret-generation patterns (`openssl rand/genrsa`, `uuidgen`, `/dev/urandom`, `randomBytes`, `secrets.token`, `os.urandom`, `uuid4`, `gpg --gen-key`, `ssh-keygen`, …), it is refused with `SVAROG_SECRET_DENIED`. Every other bash command passes (host-shell trust boundary — Svarog is not containment). This is defense-in-depth behind the hardened `svarog.md` refusal; the real boundary is that secrets are minted by `zmora-setup` and never injected into a Svarog session.
5. **Serena-editor carve-out:** the named serena refactor editors (`create_text_file`, `replace_content`, `replace_regex`, `replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`, `rename_symbol`, `safe_delete_symbol`) are **allowed before the immutable floor** — which would otherwise deny them via its mutation-verb / `_symbol` / `_content` / `_text_file` patterns. Memory writes (`_write_memory`, `_delete_memory`) and the shell escape (`execute_shell_command`) are NOT in this carve-out and fall through to the floor.
6. **`question` deny:** Svarog runs headless and has no `question` tool. A task that needs a decision is an `ESCALATE` — not a question. No `isImmutableDeny` pattern covers `question`, so this is an explicit step.
7. **Publish/branch carve-out (executor-chain doctrine, 2026-07-22):** `create_pr` (validated push + PR — `docs/specs/create-pr-tool.md` §5.5) and `create_branch` (convention-validated branch creation — `docs/specs/create-branch-tool-2.md` §5.4) are **allowed before the immutable floor** — which would otherwise deny them via its `create_` verb pattern. `av_commit` needs no such carve-out to pass — under the allow-by-default design it is not floor-denied to begin with — and its access is sanctioned by the same 2026-07-22 executor-chain decision (`docs/specs/create-pr-tool.md` §9 item 5) that authorizes the self-serve publish chain `create_branch` → `av_commit` → `create_pr`. It is, however, **fail-closed on staging scope**: a bare `av_commit` would fall back to `git add -A` and commit the operator's unrelated working-tree changes, so the hook refuses it unless an explicit non-empty `files` list is supplied (`src/modules/_shared/commit-staging-scope.ts`).
8. **Shared `isImmutableDeny` floor** (reused from the stribog contract, unchanged): denies secret-minting (`execute_recipe`), dispatch/leaf (`task`, `dispatch_parallel`, `dispatch_background`, `poll_background`, `wait_background`, the `dispatch_*` / `*_task` patterns), shell/exec (`*_execute_shell`, `*_shell_command`), and DB/DDL mutation verbs and serena memory writes (`serena_write_memory`, `serena_replace_symbol_body`, `serena_replace_content`, `serena_create_text_file` — the floor's version of these; the carve-out at step 5 allows the legitimate refactor subset BEFORE the floor reaches them). **No config can re-enable these.**
9. **Allow-by-default:** everything else — `edit`, `write`, `multiedit`, serena reads and diagnostics (`read_file`, `find_symbol`, `get_diagnostics_for_file`, …), `skill` / `load_appverk_skill`, and so on.

The declared tool list (`src/modules/svarog/allowed-tools.ts`) is a **declaration** — the source the prompt frontmatter is rendered from. As with Stribog, opencode 1.17.3 honors `config.agent.svarog.tools` but operates **default-allow**, so the hook remains the authoritative gate.

> **UPGRADE TRIPWIRE — verified against opencode 1.17.3.** The `isImmutableDeny` floor normalizes `-`→`_` before matching its underscore-segmented patterns (because opencode preserves dashes in MCP tool ids: its sanitizer is `replace(/[^a-zA-Z0-9_-]/g, "_")`). **If a future opencode release changes how MCP tool ids are formed**, the floor's `-`→`_` normalization must be re-validated. See `src/modules/_shared/stribog-extra-tools-contract.ts`.

## The minter ≠ actuator invariant

Secrets stay with `zmora-setup`; they are never co-resident with the executor.

- The `isImmutableDeny` floor **denies `execute_recipe`** for a svarog session. The denial is pattern-enforced and no config can re-enable it.
- The bash secret-generation tripwire (step 4 above) catches imperative shell-level minting as defense-in-depth.
- The QA module injects minted binding values only for sessions whose key matches the `zmora-` binding gate. **Svarog's agent key is `svarog`** — it cannot match that gate, so no minted QA binding is ever injected into a Svarog session.

The result is that the two roles stay cleanly separated: `zmora-setup` *mints and hides* secret values; Svarog *implements* and never sees them through any value-hiding channel.

## Checkpoint and recovery — in-tree `commit-tree`

Before Svarog's **first mutating tool** (`edit`, `write`, `multiedit`, or a serena editor), the hook **automatically creates a recovery checkpoint** — a `git commit-tree` object stored at the deterministic ref `refs/svarog/ckpt/<sessionID>`. Svarog cannot read its own opencode session id, so it does **not** report a resolved ref; the ref is enumerable out-of-band (`git for-each-ref refs/svarog/ckpt/`) and the operator restores the tree on `FAIL`.

### How it works

A throwaway index is seeded from the real one (preserving staged state), `git add -A` is applied to it, `write-tree` and `commit-tree -p HEAD` produce the snapshot commit, and `update-ref` writes the scratch ref. The live index and working tree are never touched.

### Restoring

Restore is **manual** — Svarog does not restore its own checkpoint. On `FAIL`, the operator or Perun calls `restoreCheckpoint(cwd, ref)` from `src/modules/svarog/checkpoint.ts`. The restore flow:

1. `git read-tree <ckptRef>` — sets the index to the checkpoint tree.
2. `git checkout-index -a -f` — writes tracked checkpoint content to the working tree.
3. Orphans (files present now but absent from the checkpoint) are removed with `fs.rmSync`.
4. `git reset -q` — resets the index to `HEAD`. (Original staging is **not** preserved — restore is a recovery aid that yields a clean, recoverable tree, not a replay of mid-turn staging.)

**Inside the QA loop, restore is automatic.** When Svarog runs as the in-loop fixer, `qa_loop_record_fix` resolves `refs/svarog/ckpt/<sessionID>` from the child session id surfaced on `DispatchResult.sessionId` and, on `FAIL`, auto-restores that checkpoint (carrying only `READY` fixes forward). The manual `git for-each-ref` path remains for standalone Workflow-3 Svarog runs. Note also that `createCheckpoint`'s `update-ref` is **create-only** (a freshness guard): a host-restart-resumed session that re-fires the hook keeps its ORIGINAL pre-edit checkpoint instead of overwriting it.

### Honest limits

The checkpoint captures the tree as it was before the first edit. It has the following **documented limitations**:

- **Gitignored files are NOT captured.** `git add -A` excludes gitignored files by design. Any gitignored file that Svarog modifies cannot be recovered from this checkpoint.
- **Embedded / vendored repos are NOT captured.** Nested `.git` directories (submodules or vendored repos) are not walked.
- **Started services are NOT recovered.** Side effects outside the git tree — processes, databases, network state — are outside the scope of a `commit-tree` checkpoint.
- **Assumes a born HEAD.** `commit-tree -p HEAD` fails on a repository with no commits. The executor's lane is existing codebases; a brand-new empty repo is out of scope.
- **Never `clean -x`.** The restore logic explicitly does NOT run `git clean -x` — that would delete the operator's gitignored data. Only orphans (files Svarog created that were not in the checkpoint) are removed.
- **Staged/unstaged distinction is flattened on restore.** The restore sets the index to the checkpoint tree and then resets it to `HEAD`. The original distinction between staged and unstaged changes is not preserved — everything returns to the pre-edit committed state.
- **Commits are NOT rewound.** The restore resets the index to the *current* `HEAD`; it never moves `HEAD` and never rewrites history. Since Svarog may commit through the sanctioned `av_commit` tool (and switch branches through `create_branch`), a commit made before a `FAIL` survives the restore — the operator must undo it separately (`git reset --hard <pre-session commit>`, or the reflog) and check the original branch back out. The prompt therefore constrains Svarog to commit only verified-green work, so the `FAIL` path normally has no commit to undo.

## Operating loop and test-first posture

Svarog follows: **Explore → Plan → (test-first) Implement → Verify → Manual QA gate.**

- **Test-first:** load the target stack's coding-standards or TDD skill (`load_appverk_skill`) before the first edit; write the failing test first, then the implementation, then run green. The plan's test scope is authoritative — Svarog tests the behavior it implements; it does not expand coverage to unrelated code.
- **Greenfield (untested target):** bootstrap a minimal test harness for the behavior being added. Never fabricate coverage of pre-existing untested code; never weaken correctness to make a test pass.
- **Style-match / surgical:** match the codebase's naming, imports, and indentation. Smallest correct change; no opportunistic refactor of code outside the plan (planned cross-file `rename_symbol` / `safe_delete_symbol` refactors ARE in scope).
- **Verify:** run `serena get_diagnostics_for_file` on changed files, then the full suite/build must actually run green. Then self-verify: re-read every changed file.

## The Manual QA gate — leaf surface

Svarog performs developer self-verification of its own diff. It drives the artifact through a surface it actually has:

- A **non-interactive CLI** via bash.
- An **HTTP API** via `curl`.
- A **library/module** via a minimal driver script.

**Web-UI / interactive-TUI work is outside Svarog's surface** → `ESCALATE` or leave it to a Zmora acceptance pass. Reading the source and concluding "should work" does NOT pass the gate.

This gate is leaf-scoped: it does not author QA plans, emit QA issue IDs, or replace Zmora's independent acceptance pass.

## The JSON result contract

Svarog **always** ends its turn with exactly one fenced ` ```json ` block and nothing after it:

```json
{
  "status": "READY",
  "reason": "<one line; required for FAIL and ESCALATE>",
  "changed": ["<files you created or edited>"],
  "verification": "<the suite/build command you ran + pass/fail>",
  "checkpoint": "refs/svarog/ckpt/<session>"
}
```

| `status` | Meaning |
|---|---|
| `READY` | The task is done and the full suite/build ran green. Does **not** mean "committed" — Svarog never commits via bash; commits go only through the sanctioned `av_commit` tool. |
| `FAIL` | Svarog tried and the tests/build do not pass. The auto-created checkpoint (`refs/svarog/ckpt/<session>`) lets the operator restore the tree **content** — it does not rewind commits or branch switches (see [Honest limits](#honest-limits)). |
| `ESCALATE` | Out of scope or needs a decision (open question in `reason`). |

- `reason` — one line; **required** for `FAIL` and `ESCALATE`.
- `changed` — files created or edited this turn.
- `verification` — the suite/build command and its pass/fail result.
- `checkpoint` — the deterministic `refs/svarog/ckpt/<session>` namespace where the recovery ref was auto-created before the first edit. Svarog cannot resolve its own session id, so it reports this template, not a concrete `ses_…` value; the operator enumerates the real ref via `git for-each-ref refs/svarog/ckpt/`.

**Svarog never commits via bash — commits go only through the `av_commit` tool.** Review the diff, then commit via `av_commit` (or `/commit`).

## Model selection

Svarog is a heavy executor doing broad in-tree edits and must not run on a weak model. It **pins an explicit default**: `openai/gpt-5.5` — the strongest GPT on the OpenAI subscription (`DEFAULT_SVAROG_MODEL` in `src/modules/svarog/svarog.metadata.ts`). This is a role-fit, **not** a security control — the security boundary is the tool hook, never the model choice.

The Svarog eval (run per `docs/eval/playbook.md`) may still refine the exact tier. `gpt-5.5` is the top standard GPT SKU on the OpenAI subscription (the `-pro` tier needs higher access; `-fast`/`-mini` are weaker).

The default is **provider-gated** on `openai`. If the `openai` provider is absent (fresh subscription/Anthropic install), the default is skipped (Svarog inherits the session default) and a one-time warning toast fires on `session.created`. User/pantheon overrides are unaffected and still win.

The default is overridable via `agents.svarog.model` in `pantheon.json`. See [`configuring-agents.md`](configuring-agents.md) for the file's location, precedence rules, and full schema:

```jsonc
{ "agents": { "svarog": { "model": "<providerID>/<modelID>" } } }
```

## Phase-1b note — worktree isolation

Svarog currently edits the **real working tree** (same posture as Stribog). Worktree isolation — running in a dedicated `git worktree` so a failed run can be discarded without touching the main tree — is **deferred to Phase-1b** and is not implemented. The in-tree `commit-tree` checkpoint is the current recovery mechanism, with the honest limits listed above.
