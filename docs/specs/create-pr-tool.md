---
title: "create_pr — sanctioned push + pull-request creation tool for executor agents"
date: 2026-07-21
source: "Interactive brainstorming session, 2026-07-21 — request to close the last gap in the branch → commit → push → PR chain: executors finish work on a branch (create_branch + av_commit) but cannot push or open a PR and must hand the operator manual `git push` / `gh pr create` instructions"
related: "docs/specs/create-branch-tool-2.md (branch step of the same chain; this spec reuses its validation, carve-out, and partial-success patterns)"
approved: false
---

# Feature Specification: `create_pr` tool

## 1. Goal

Give agents (Svarog, Stribog, and the `/commit` flow) a safe, validated way to publish the
current branch and open a pull request in **one tool call**, without loosening either the
mutating-git bash policy or the commit plugin's `block-push` bash gate. The tool pushes the
session's current branch to `origin` (never force), then creates the PR through a
**provider-agnostic layer** whose first and only v1 implementation is GitHub via the `gh` CLI
(argv-only, no shell, no credential handling in the plugin).

**In scope**

- A new plugin tool `create_pr` with parameters `title` (required), `body` (optional), `base`
  (optional, default = detected origin default branch), `draft` (optional boolean, default
  `false`), and `taskId` (optional, appended as a `Refs:` footer).
- Pure-TypeScript validation of every parameter and both branch names before any process spawn.
- A `PrProvider` interface with provider detection from the `origin` URL and a single GitHub
  implementation backed by `gh pr create` through an injectable runner.
- Push of the **current branch only** (`git push -u origin <branch>`) through the existing
  `GitRunner`; head branch is never a parameter.
- Registration in the commit module alongside `av_commit` and `create_branch`.
- Named, attribution-gated allows for `create_pr` in the Stribog and Svarog tool hooks
  (same pattern and placement as the `create_branch` carve-outs).
- Unit tests (injected runners), a real-repo + bare-remote integration test with an injected
  fake provider, hook tests, and wrapper tests.
- Documentation in `src/commands/commit.md` and one-line prompt notes in `stribog.md` /
  `svarog.md`.

**Out of scope**

- Changing `src/modules/_shared/mutating-git.ts`, the executor bash tripwires, or the
  `classifyBashCommand` gate behavior (`block-push` stays; only its *message* SHOULD gain a
  redirect — see D6).
- Force push, push of arbitrary refspecs, tag push, deleting remote branches.
- PR update/merge/close/review operations; only creation.
- A `--repo` override for cross-repo/fork targeting (D7).
- GitLab/Bitbucket/GitHub-Enterprise implementations (the seam exists; see D2).
- Any change to `pantheon.json` schema, the QA tools, or the coordinator.

**Success criteria**

- A Stribog or Svarog session standing on a feature branch can run
  `create_pr({ title: "..." })` and get back a PR URL, while bash `git push` remains blocked
  (`block-push`) and bash `git checkout` remains denied for executors.
- Every invalid user-supplied parameter (`title`, `body`, `base`, `taskId`) in §5.2 is
  rejected with a descriptive error and **zero** process spawns; the resolved-head R1–R5
  re-validation and every guard violation in §5.3 are rejected before the push, at the cost of
  read-only git calls only.
- A push that succeeds followed by a PR-creation failure returns a structured partial-success
  result (never a throw, never a rollback).
- `bun run check` (typecheck + test + build) passes.

## 2. Background & current behaviour

- The branch → commit steps of the executor workflow are solved by the sibling specs:
  `create_branch` (docs/specs/create-branch-tool-2.md) creates and switches to a
  convention-valid branch; `av_commit` commits onto it. The chain then dead-ends:
  - `git push` via bash is blocked **session-wide** by the commit plugin's
    `tool.execute.before` gate (`src/modules/commit/index.ts:84-85`,
    `classifyBashCommand` → `"block-push"`, `src/modules/commit/bash-policy.ts:100-101`).
    The gate is a documented workflow rail, not a security boundary
    (`bash-policy.ts:1-32`), and this spec does not change its behavior.
  - `gh pr create` via bash is not explicitly denied anywhere, but it is useless without a
    pushed branch, and agents correctly treat un-sanctioned outward-facing actions as outside
    their mandate. Observed outcome (2026-07-21 session transcript): an executor finished
    INCV-212 work on a branch and returned manual `git push -u` + `gh pr create` instructions
    to the operator instead of completing the flow.
- The commit module owns the sanctioned git-mutation surface: `av_commit` and `create_branch`
  wrap an injectable `GitRunner` (`execFile("git", args, { cwd })`, argv array, no shell —
  `src/modules/commit/controlled-commit.ts:13-47`), registered in
  `src/modules/commit/index.ts`, with unit + real-repo integration tests under
  `tests/modules/commit/`.
- Plugin-tool visibility is global; the executor hooks are the runtime gate (AGENTS.md
  "Plugin-tool enforcement model"). The shared `isImmutableDeny` floor
  (`src/modules/_shared/stribog-extra-tools-contract.ts:65`) denies any tool id containing
  `create` as a whole underscore-segment — `create_pr` matches, exactly as `create_branch`
  does, so **both** executor hooks need the same named carve-out
  (Stribog `src/modules/stribog/tool-budget-hook.ts:298`, Svarog
  `src/modules/svarog/tool-budget-hook.ts:188`).
- Design decisions taken with the operator in the originating session (recorded here so the
  reviewer sees they are choices, not defaults):
  1. **One tool, not two** — push + PR in a single `create_pr` call; partial success is a
     structured result, not a second tool.
  2. **Provider-agnostic layer** — a `PrProvider` seam with GitHub/`gh` as the only v1
     implementation, provider resolved from the `origin` URL.
  3. **Ready-for-review by default** — `draft` defaults to `false`; the operator accepted the
     residual notification risk (§6) in exchange for less friction.
  4. **Same access surface as `create_branch`** — Stribog + Svarog + the `/commit` flow.

## 3. Constraints

- **C-1:** No shell interpretation anywhere: `execFile("git", …)` and `execFile("gh", …)` with
  argv arrays only, mirroring `defaultGitRunner` (`controlled-commit.ts:25-47`).
- **C-2:** `src/modules/_shared/mutating-git.ts`, both executor bash tripwires, and the
  `classifyBashCommand` decisions MUST NOT change behavior. `git push` via bash stays blocked;
  the `block-push` error *message* SHOULD gain redirect text (D6).
- **C-3:** Reuse the existing `GitRunner`/`GitResult`/`defaultGitRunner` exports from
  `./controlled-commit.js`; do not duplicate the runner. The `gh` runner mirrors the same
  shape.
- **C-4:** Locked invariants that MUST keep passing: `tests/modules/stribog/metadata.test.ts`
  (`CORE_BUILTINS` membership) and `tests/modules/stribog/tools-sync.test.ts`
  (`STRIBOG_TOOLS` parity). Same integration pattern as `create_branch` §5.4: hook carve-out,
  not list edits.
- **C-5:** No credential handling: the plugin never reads, stores, or forwards tokens. `gh`
  owns its own authentication on the host machine.
- **C-6:** Never `--force`, never an arbitrary refspec: the only push form is
  `push -u origin <current-branch>` with a validated branch name.
- **C-7:** ESM/NodeNext, TypeScript strict, root-build layout; tests import from `src/` and
  run via root `bun run test` after `bun run build:root` (repo convention).

## 4. Requirements

### 4.1 Functional

- **FR-1 — Tool shape.** Register a plugin tool named exactly `create_pr` with args:
  - `title: string` (required) — PR title.
  - `body: string` (optional) — PR description (markdown).
  - `base: string` (optional) — base branch name; when omitted, resolved per FR-3.
  - `draft: boolean` (optional, default `false`).
  - `taskId: string` (optional) — task/ticket identifier appended to the body as a
    `Refs: <taskId>` footer (blank-line separated), mirroring `av_commit`.

  The head branch is **not** a parameter: it is always the session's current branch (FR-2).
- **FR-2 — Head resolution.** Resolve the current branch via `["branch", "--show-current"]`
  (read-only). `defaultGitRunner` returns stdout untrimmed by contract, so the resolved head
  is that stdout with `String.prototype.trim()` applied (stripping the trailing newline)
  before the §5.2 R1–R5 re-validation and before any use in the FR-6 push argv and the FR-7
  `--head=<head>` token. Empty (post-trim) output (detached HEAD) fails with guard G1 (§5.3)
  and zero further invocations.
- **FR-3 — Base resolution.** When `base` is omitted: resolve
  `["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]`, apply `String.prototype.trim()`
  to the command stdout (which `defaultGitRunner` returns untrimmed — the symbolic-ref output
  also carries a trailing newline), and strip the `origin/` prefix, before the auto-resolved
  base feeds the G2 comparison and the `--base=<base>` token. A non-zero exit fails with guard
  G5, whose message names both remedies (pass `base` explicitly, or run
  `git remote set-head origin --auto`). `base` counts as **omitted** iff `base === undefined`
  or `base.trim() === ""` — a whitespace-only value trims to empty and routes to the
  symbolic-ref auto-resolution above; otherwise `base` is provided, trimmed, and validated
  per §5.2 (R-rules), then **normalized identically to the auto-resolved path** — a leading
  `refs/heads/` and a leading `origin/` are stripped (2026-07-22 review hardening). Without
  this, a remote-tracking spelling of the current branch (`origin/master` while standing on
  `master`) would slip past the G2 head≠base guard and reach `gh --base=`, which wants the
  plain branch name. The resolved base is always passed explicitly to the provider
  (`--base=<base>`) — the provider never guesses.
- **FR-4 — Validate before any spawn.** All validation of the user-supplied parameters
  (`title`, `body`, `base`, `taskId`; §5.2) is pure TypeScript and runs before the first
  `runGit` invocation. On violation, throw an `Error` in the §5.2 normative template and
  execute **zero** git or provider commands. Guards G1–G5 (§5.3) run next, using read-only git
  calls only; the resolved-head R1–R5 re-validation (§5.2) runs among them, at the G2 step, on
  the output of G1's read-only `["branch", "--show-current"]`; any guard failure throws before
  the push.
- **FR-5 — Provider detection.** Resolve the `origin` URL via
  `["remote", "get-url", "origin"]` (read-only). Non-zero exit → guard G3. Apply `String.prototype.trim()` to the command stdout (which `defaultGitRunner` returns untrimmed — the get-url output also carries a trailing newline), then parse the trimmed URL per
  §5.4; host `github.com` (case-insensitive) selects the GitHub provider, constructed with
  the injected `runGh ?? defaultGhRunner`; any other host, scheme `file://`, or a local
  path → guard G4 with a message enumerating the supported providers (`github.com`).
  Detection is a pure exported function (`detectProvider`) with no I/O. **Injection rule
  (normative):** when `input.provider` is supplied (test seam, NFR-5), detection and guards
  G3/G4 are skipped entirely — detection exists only to choose a provider; a missing remote
  then surfaces naturally as an FR-6 push failure.
- **FR-6 — Push.** Run `git push -u origin <head>` as argv `["push", "-u", "origin", head]`
  through the injected `GitRunner`. A non-zero exit (auth failure, non-fast-forward, missing
  remote branch permissions) propagates as an `Error` carrying git's stderr (or stdout when
  stderr is empty). No `--force`, no refspec, no tags (C-6). A repeat push of an already
  up-to-date branch exits zero (git's own idempotency) — relied upon by the FR-8 recovery
  path.
- **FR-7 — PR creation.** After a successful push, call
  `provider.createPullRequest({ cwd, head, base, title, body, draft })`. The GitHub
  implementation invokes `gh` once:
  `["pr", "create", "--title=<title>", "--body=<body>", "--base=<base>", "--head=<head>"]`
  plus a trailing `"--draft"` when `draft` is `true`. All string options use the
  `--flag=value` single-token form (see §6 flag-injection). `--body=` is always passed — with
  the resolved body or the empty string — so `gh` never enters interactive mode. The PR URL is
  the last stdout line that matches `^https://\S+$`, taken by scanning every line in order and
  keeping the last match; if no line matches, the provider call is a failure (FR-8 path, with
  stdout/stderr in `prError`).
- **FR-8 — Partial success on PR failure.** If the push succeeded but the provider call fails
  (non-zero exit, `gh` missing, URL not found in output), return
  `{ head, base, pushed: true, prCreated: false, draft, prError: "<detail>" }` — do **not**
  throw and do **not** attempt any rollback (the push is durable and intended). **Recovery
  semantics (normative):** re-running `create_pr` with the same arguments is safe — the push
  becomes a no-op (FR-6) and the provider call runs again. If the PR meanwhile exists, the
  provider fails with its own "already exists" error, which lands in `prError` verbatim
  (GitHub's message includes the existing PR URL). The tool never updates or closes an
  existing PR.
- **FR-9 — Missing `gh` binary.** An ENOENT spawn failure from the GitHub provider maps to a
  deterministic FR-8 partial result whose `prError` says the GitHub CLI is not installed and
  names both remedies (`brew install gh` / platform equivalent, then `gh auth login`). **`defaultGhRunner` MUST surface a spawn-time ENOENT distinctly** rather than reusing `defaultGitRunner`'s lossy failure conversion: it MUST detect `error.code === "ENOENT"` and re-throw it so the provider's catch maps it to the deterministic message above (matching AC-8's throwing double). Mirroring `defaultGitRunner`'s error handling verbatim is insufficient — its `Number(failure.code ?? 1)` conversion turns ENOENT into `exitCode: NaN` with empty stderr and no throw, discarding the very signal FR-9 depends on.
- **FR-10 — Result contract.** The result **always** contains `head: string`,
  `base: string`, `pushed: boolean`, `prCreated: boolean`, and `draft: boolean` (the resolved
  values). Full success adds `url: string`; the FR-8 path adds `prError: string`. Serialized
  via `JSON.stringify(result, null, 2)` from the `execute` wrapper, as the sibling tools do.
- **FR-11 — Working directory.** The `execute` wrapper passes
  `cwd: context.worktree ?? context.directory` (same resolution as `av_commit`).
- **FR-12 — Executor access.** A positively-attributed Stribog or Svarog session can invoke
  `create_pr` (hook allow per §5.5); the tool is not edit-budgeted.
- **FR-13 — Docs.** `src/commands/commit.md` documents the full chain
  (`create_branch` → `av_commit` → `create_pr`), the tool's arguments, the guard semantics,
  the partial-success/recovery contract, and the unchanged prohibition on bash
  `git push`. `stribog.md` and `svarog.md` each gain one line naming `create_pr` as the
  publish path (prevents the ESCALATE-on-PR reflex, mirroring `create_branch` D8).

### 4.2 Non-functional

- **NFR-1 — No shell.** argv-only invocation of both binaries; no string concatenation into a
  shell command.
- **NFR-2 — Fail fast.** Invalid user-supplied parameters (`title`, `body`, `base`, `taskId`)
  cost zero process spawns; the resolved-head R1–R5 re-validation and all guard failures cost
  only read-only git calls; nothing mutates before the push.
- **NFR-3 — No secrets.** The plugin handles no credentials (C-5). Validation errors echo
  user input JSON-encoded only (CWE-117 hygiene, family convention).
- **NFR-4 — Deterministic errors.** Validation errors follow the normative template of §5.2:
  `create_pr: field '<field>' violates rule <ruleId> (<shortDescription>): <jsonEncodedValue>`.
  Guard errors (G1–G5) are stable, remedy-naming strings (§5.3).
- **NFR-5 — Testability.** All git interaction flows through the injectable `GitRunner`; all
  `gh` interaction flows through an injectable runner of the same shape; the provider itself
  is injectable into `createPr` (integration seam, §7.2). Unit tests require neither binary.
- **NFR-6 — Auditability.** Title and body appear verbatim in the tool call
  (session transcript); base and draft appear in the tool call when supplied and, as resolved
  values, in the returned JSON (FR-10). Every push and PR is attributable to a specific call.

## 5. Architecture & design decisions

### 5.1 Components

| Component | Change |
|---|---|
| `src/modules/commit/pr-provider.ts` (new) | `CreatePullRequestInput { cwd, head, base, title, body, draft }`, `PrProvider { name: string; createPullRequest(input): Promise<{ url: string }> }`, `detectProvider(originUrl: string): "github" | undefined` (pure URL parsing, §5.4; exported for tests). |
| `src/modules/commit/github-pr-provider.ts` (new) | `GhRunner` (same `(cwd, args) => Promise<GitResult>` shape as `GitRunner`, spawning `gh`), `defaultGhRunner`, `githubPrProvider(runGh?)` implementing `PrProvider` per FR-7/FR-9. |
| `src/modules/commit/create-pr.ts` (new) | Validation rules (§5.2), guards (§5.3), `CreatePrInput { title, body?, base?, draft?, taskId?, cwd, runGit?, runGh?, provider? }`, `CreatePrResult` (FR-10), `createPr(input)` orchestration. `runGh` feeds the detected GitHub provider (FR-5); `provider` overrides detection entirely (FR-5 injection rule). Imports `GitRunner`/`defaultGitRunner` from `./controlled-commit.js` (C-3). |
| `src/modules/commit/index.ts` | Register `create_pr` beside `av_commit`; `execute` delegates to `createPr` and JSON-serializes the result. SHOULD: extend the `block-push` message with a `create_pr` redirect (D6). |
| `src/modules/stribog/tool-budget-hook.ts` | Named allow for `create_pr` beside the `create_branch` carve-out (§5.5). No other logic changes. |
| `src/modules/svarog/tool-budget-hook.ts` | Same named allow (§5.5). |
| `src/modules/stribog/allowed-tools.ts`, `src/modules/svarog/allowed-tools.ts` | Comment-only notes (family convention; lists unchanged, C-4). |
| `src/commands/commit.md` | New section per FR-13. |
| `src/modules/stribog/stribog.md`, `src/modules/svarog/svarog.md` | One-line publish-path note each (FR-13). |
| `tests/modules/commit/create-pr.test.ts` (new) | Unit tests, injected runners + fake provider (§7.1). |
| `tests/modules/commit/create-pr.integration.test.ts` (new) | Real temp repo + bare `file://`-style remote, injected fake provider (§7.2). |
| `tests/modules/stribog/tool-budget-hook.test.ts`, `tests/modules/svarog/tool-budget-hook.test.ts` | Confirmed-agent `create_pr` passes the hook (§7.3). |

**D1 — Registration location: the commit module.** Same rationale as `create_branch` D1: the
module already owns the sanctioned git-mutation surface, the runner pattern, registration, and
the test tree. The provider layer is new *files*, not a new *module*; a separate module would
add root registration and asset wiring for zero isolation benefit.

**D2 — Provider layer scope (operator decision).** Interface + GitHub/`gh` implementation
only. The seam is the `PrProvider` interface plus `detectProvider`; no registry, no config,
no second implementation, no dead code. Alternatives (GitLab now; provider from
`pantheon.json`) were considered in the originating session and rejected as YAGNI /
scope-expanding.

**D3 — Head is never a parameter.** The tool publishes only the branch the session stands on.
This removes an entire class of inputs (arbitrary ref publication, publishing someone else's
branch) and makes the transcript the complete audit trail: the branch being published is the
one visible in the session's own work.

**D4 — Base is always explicit at the provider boundary.** Even when auto-resolved, the base
is passed as `--base=<base>`. Provider-side default-branch guessing is a hidden input;
explicit base makes the PR target deterministic and testable.

**D5 — PR failure after push is a partial result, not a throw (mirrors `create_branch` D3).**
The push is the durable side effect; throwing would misreport it as failed and invite
confusing retries. `pushed: true, prCreated: false, prError` tells the agent exactly what to
fix (auth, missing gh, PR exists) and FR-8 defines the safe retry.

**D6 — `block-push` redirect text (SHOULD, not acceptance-blocking).** The bash gate's
message "git push is blocked by the AppVerk commit plugin." SHOULD become "… Use the
`create_pr` tool to publish the current branch and open a pull request." Message-only, no
behavior change (C-2); same deferral rule as `create_branch` D8.

**D7 — No `--repo` override in v1 (recorded YAGNI with a caveat).** `gh` resolves the target
repo from the git remotes and its own `gh repo set-default` state. Known operational caveat
in *this* repository: the `origin` URL redirects to the AppVerk org while personal merges go
through the `mszenfeld/pantheon` fork — an operator using a fork workflow must set
`gh repo set-default` accordingly. Detection (§5.4) parses the URL textually and never
follows redirects. A `repo` parameter is deferred until a concrete need exists.

**D8 — Ready-for-review by default (operator decision).** `draft` defaults to `false`. The
safety trade-off is recorded in §6; the mitigation is the `draft` parameter plus prompt
guidance, not a hard gate.

### 5.2 Parameter validation (normative)

All rules for the user-supplied parameters (`title`, `body`, `base`, `taskId`) run in pure TypeScript before any spawn (FR-4); the resolved-head R1–R5 re-validation below runs later, during the guard phase (§5.3, at the G2 step), on read-only git output. **Error template (normative):**

```
create_pr: field '<field>' violates rule <ruleId> (<shortDescription>): <jsonEncodedValue>
```

where `<field>` is `title` | `body` | `base` | `taskId` | `head` (the last for the
defense-in-depth head re-validation below); `<jsonEncodedValue>` is `JSON.stringify` of the
offending (post-trim where trimming applies) value.

**Evaluation order (normative).** Rules are evaluated in a fixed order — title T1→T2→T3,
then taskId K1→K2, then body B1→B2 (B1 validates the resolved body, so taskId is checked
first), then base R1→R5 — and on multi-violation input the first failing rule is the one
reported (making NFR-4's deterministic errors well-defined).

**Normalization.** `title`, `base`, and `taskId` are trimmed (`String.prototype.trim()`).
`body` is passed verbatim (markdown whitespace is meaningful) except for the `Refs:` footer
append. When `taskId` is present and non-empty after trim, the resolved body is `"Refs: " + taskId` when `body` is absent or `body.trim()` is empty (whitespace-only), and `body.trimEnd() + "\n\nRefs: " + taskId` otherwise.

| ruleId | field | shortDescription | Rule |
|---|---|---|---|
| T1 | title | `empty-title` | Trimmed title is non-empty. |
| T2 | title | `max-length-256-chars` | ≤ 256 Unicode code points (`[...title].length` — GitHub's title limit). |
| T3 | title | `control-characters` | No code points in U+0000–U+001F or U+007F–U+009F (this bans newlines in titles). |
| B1 | body | `max-length-64000-bytes` | Resolved body (after `Refs:` append) ≤ 64 000 UTF-8 bytes (below GitHub's 65 536-char body limit; comfortably inside ARG_MAX for a single argv token). |
| B2 | body | `control-characters` | No code points in U+0000–U+001F or U+007F–U+009F **except** `\n` (U+000A), `\r` (U+000D), and `\t` (U+0009). |
| K1 | taskId | `invalid-characters` | When present and non-empty: matches `^[A-Za-z0-9._-]+$` (same charset as `create_branch` S3; rejects spaces and control bytes). |
| K2 | taskId | `leading-dash` | Does not start with `-`. |
| R1 | base | `invalid-characters` | When provided and non-empty after trim: matches `^[A-Za-z0-9._/-]+$` (`/` allowed — bases like `release/2026.07` are legal). |
| R2 | base | `leading-dash` | Does not start with `-`. |
| R3 | base | `dot-dot` | Does not contain `..`. |
| R4 | base | `component-rules` | No `//`; does not start or end with `/`; no path component starts with `.` or ends with `.lock`; does not end with `.`. |
| R5 | base | `max-length-240-bytes` | ≤ 240 UTF-8 bytes (family precedent, `create_branch` N11). |

The resolved **head** name (FR-2) is re-validated against R1–R5 as defense-in-depth (it
normally came from `create_branch` and passes trivially); a violation is reported with
`<field>` = `head` and is expected only when the operator hand-created an exotic branch name.
This re-validation is not one of the pre-spawn parameter checks above: it runs during the
guard phase (§5.3), at the G2 step, on the trimmed head resolved by G1's read-only
`["branch", "--show-current"]` — costing only read-only git calls, never the push.

### 5.3 Guards (normative, ordered)

Run after §5.2; each failure throws a stable, remedy-naming error and stops the sequence.
**Execution order is G1 → G5 → G2 → G3 → G4** (G2 needs the resolved base, so base
resolution — G5's check — runs before it; the table below is keyed by id, not order; §5.6
shows the same order). G1–G2 and G5 use read-only git; G3–G4 use read-only git + pure
parsing. When `input.provider` is injected, G3/G4 are skipped (FR-5 injection rule).

| Guard | Condition | Error (stable prefix) |
|---|---|---|
| G1 | `["branch", "--show-current"]` output is empty (detached HEAD). | `create_pr: HEAD is detached — check out a branch first (use create_branch).` |
| G2 | Resolved head equals resolved base. | `create_pr: refusing to push and open a PR from the base branch '<base>' — create a feature branch first (use create_branch).` |
| G3 | `["remote", "get-url", "origin"]` exits non-zero. | `create_pr: no 'origin' remote is configured.` |
| G4 | `detectProvider(originUrl)` returns `undefined`. | `create_pr: unsupported git host for PR creation (supported: github.com). origin: <jsonEncodedRedactedUrl>` |
| G5 | Base omitted and `refs/remotes/origin/HEAD` unresolvable. | `create_pr: cannot resolve the default branch of 'origin' — pass 'base' explicitly or run: git remote set-head origin --auto` |

Guard ordering rationale: G1 and the G5→G2 pair catch the cheapest and most common agent
mistakes before any remote-shape checks; G3/G4 close the sequence. **G4 redaction
(normative, 2026-07-22 MoA round-3 SEC finding):** `<jsonEncodedRedactedUrl>` is the trimmed
origin URL with its URL userinfo redacted before JSON-encoding —
`originUrl.replace(/^(\w+:\/\/)[^@/]+@/, "$1<redacted>@")` — so a PAT-in-URL remote
(`https://ghp_…@github.com/…`, which always fails detection and lands here) never reaches the
transcript (C-5, NFR-3). scp-like `git@host:` forms carry no credential and pass through
unchanged. Nothing before the FR-6
push mutates anything anywhere.

### 5.4 Provider detection (normative)

`detectProvider` recognizes exactly three `origin` URL shapes and extracts the host:

1. SCP-like SSH: `git@<host>:<owner>/<repo>(.git)?`
2. SSH URL: `ssh://git@<host>(:port)?/<owner>/<repo>(.git)?`
3. HTTPS: `https://<host>/<owner>/<repo>(.git)?`

Host comparison is case-insensitive. `github.com` → GitHub provider. Anything else —
including GitHub Enterprise hosts, `gitlab.com`, `http://`, `file://` URLs, and bare local
paths — returns `undefined` (guard G4). Normative vectors:

| origin URL | Result |
|---|---|
| `git@github.com:AppVerk/av-opencode-plugins.git` | github |
| `https://github.com/AppVerk/av-opencode-plugins` | github |
| `ssh://git@github.com/AppVerk/x.git` | github |
| `https://GITHUB.COM/a/b.git` | github (case-insensitive) |
| `git@gitlab.com:a/b.git` | undefined |
| `https://github.enterprise.corp/a/b` | undefined |
| `file:///tmp/bare-remote.git` | undefined |
| `/tmp/bare-remote.git` | undefined |
| `http://github.com/a/b` | undefined (https only) |
| `"git@github.com:AppVerk/av-opencode-plugins.git\n"` (raw trailing newline) | github (FR-5 trims the trailing newline before calling `detectProvider`, which then parses the canonical form as in row 1; this row documents the caller path, not a direct `detectProvider` input) |

### 5.5 Executor allow-list integration

Identical mechanism and placement to `create_branch` §5.4 (D2 there): a named,
attribution-gated early-return in each hook, after attribution and before the
`isImmutableDeny` floor, adjacent to the existing `create_branch` carve-out. All the
alternatives (CORE_BUILTINS, extraTools, declared lists, renaming, weakening the floor) were
already evaluated and rejected in that spec; the same reasoning applies verbatim and is not
repeated here. The carve-out comment records that `create_pr` is the sanctioned publish path
(validated, argv-only, never force) and that the bash `block-push` gate is unchanged.

### 5.6 Data flow

```
agent (stribog | svarog | /commit session)
  → create_pr({ title, body?, base?, draft?, taskId? })   [plugin tool, global registry]
    → stribog/svarog hook: attribution + named allow      [§5.5; bash policies untouched]
    → execute wrapper: cwd = worktree ?? directory        [FR-11]
    → validate title/body/base/taskId (§5.2)              [FR-4 — zero spawns on failure]
    → G1 head = branch --show-current                     [read-only]
    → G5 base ??= symbolic-ref origin/HEAD                [read-only]
    → G2 head ≠ base; head passes R-rules                 [pure TS]
    → G3/G4 originUrl → detectProvider                    [read-only + pure TS]
    → GitRunner(cwd, ["push", "-u", "origin", head])      [FR-6 — first mutation]
    → provider.createPullRequest({...})                   [FR-7 → gh, or FR-8 partial]
    → JSON { head, base, pushed, prCreated, draft, url? | prError? }
```

## 6. Security assessment

- **Trust boundaries.** Agent-controlled strings cross into two child processes: `git`
  (validated branch names only, fixed argv verbs) and `gh` (title/body/base/head as
  `--flag=value` tokens). No shell exists anywhere on the path (C-1). This is the commit
  module's first tool with a **network side effect**, but the network access itself lives in
  the audited system binaries (`git`, `gh`), not in plugin code — the plugin opens no sockets
  and reads no tokens (C-5).
- **Flag injection.** All `gh` string options use the `--flag=value` single-token form, so a
  value can never be re-parsed as a separate flag regardless of its first character.
  Defense-in-depth on top of that: R2/K2 reject leading dashes in ref-like fields, and the
  push argv has only fixed verbs plus one R-validated positional (`head`).
- **Refname attacks.** R1–R5 (base, head) carry over the family's refname hygiene:
  charset whitelist, `..`, `.lock`, dot-component, `//`, edge-slash, and length rules — a
  valid name is always a storable git ref and cannot smuggle options or traversal.
- **Content limits.** T2/B1 cap title/body far below argv and API limits; T3/B2 ban control
  bytes (log-forging, terminal-escape hygiene) while keeping markdown-meaningful whitespace
  in the body.
- **Blast radius of the push.** Only `push -u origin <current-branch>`, never force, never a
  refspec, never tags (C-6): the tool can publish new commits of one branch but can never
  rewrite, delete, or overwrite any remote ref. A non-fast-forward push fails with git's own
  error.
- **Outward-facing action (residual risk, accepted).** With `draft: false` as the default
  (D8), an executor's `create_pr` call notifies humans (review requests, CI, integrations)
  without an operator gate. Accepted trade-off, recorded in §2; mitigations: the `draft`
  parameter, prompt guidance (FR-13), and full transcript auditability (NFR-6). Flipping the
  default to draft is a one-line change if practice shows the risk was underpriced.
- **Fork/redirect caveat.** Provider detection never follows HTTP redirects; `gh` targets the
  repo per its own resolution (`gh repo set-default`). Operators using fork workflows must
  configure that once per clone (D7).
- **Error hygiene.** Validation errors echo input JSON-encoded only (NFR-3/NFR-4); git and
  `gh` stderr are propagated as-is (`gh` does not print tokens in these failure modes;
  its auth errors name the fix without secret material).
- **Authorization posture.** The executor hooks *allow* this tool via named carve-outs
  (§5.5); the immutable-deny floor is not weakened for any other id. `create_pr` is a
  strictly stronger capability than `create_branch` (network publication); the equalizer is
  that everything it publishes was already committed via the equally-sanctioned `av_commit`
  and is fully transcript-attributable.

## 7. Testing & acceptance criteria

### 7.1 Unit tests — `tests/modules/commit/create-pr.test.ts` (injected runners + fake provider)

- **AC-1 (validation matrix).** Every §5.2 rule has at least one rejecting vector (empty
  title; 257-code-point title; title with `\n`; body over 64 000 bytes; body with U+0000 and
  with U+001B; `taskId: "INC 212"`; `taskId: "-x"`; `base: "a b"` (space, out of the R1 charset); `base: "-d"`; `base: "a..b"`;
  `base: "a//b"`; `base: "/a"`, `base: "a/"`; `base: "a/.h"`; `base: "x.lock"`; `base: "x."`;
  241-byte base) and one accepting boundary vector (256-code-point title; exactly
  64 000-byte body; 240-byte base; `base: "release/2026.07"`). Rejections match the §5.2
  template exactly and the injected runners record **zero** calls.
- **AC-2 (provider detection table).** Every §5.4 vector except the raw-trailing-newline row
  produces the stated result from `detectProvider` directly; the raw-trailing-newline row is
  asserted at the FR-5 caller level (trim, then `detectProvider`), and `detectProvider`
  called on the un-trimmed string returns `undefined`.
- **AC-3 (happy path, detection exercised).** Stubbed `runGit` (returns a branch name for
  `--show-current`, `origin/master` for `symbolic-ref`, a `git@github.com:` URL with trailing newline for
  `remote get-url`, success for `push`) and stubbed `runGh` (returns a PR URL) — no
  `provider` injection, so detection runs for real and selects the GitHub provider. Recorded
  git argv sequence is exactly `["branch","--show-current"]`,
  `["symbolic-ref","--short","refs/remotes/origin/HEAD"]`, `["remote","get-url","origin"]`,
  `["push","-u","origin","feature/INC-212-x"]`; result is exactly
  `{ head, base: "master", pushed: true, prCreated: true, draft: false, url }`.
- **AC-4 (explicit base skips resolution).** With `base: "develop"`, no `symbolic-ref` call
  is recorded and the provider receives `base: "develop"`. Conversely, `base: "   "`
  (whitespace-only) is treated as omitted (FR-3): the `symbolic-ref` auto-resolution runs and
  the provider receives the resolved default base.
- **AC-5 (guards).** G1 (empty `--show-current` output), G2 (head equals base), G3
  (`remote get-url` non-zero), G4 (gitlab origin), G5 (`symbolic-ref` non-zero, base
  omitted): each throws its §5.3 message, and no `push` call is ever recorded.
- **AC-6 (push failure).** `push` returns non-zero with stderr → rejects with that stderr;
  the provider is never invoked.
- **AC-7 (partial success).** Push succeeds, provider throws / returns failure → resolves
  (not rejects) with `{ pushed: true, prCreated: false, prError }` containing the provider
  detail; exactly one `push` call recorded; no rollback calls.
- **AC-8 (gh ENOENT).** GitHub provider with a runner that throws ENOENT → FR-9 partial
  result whose `prError` names installation and `gh auth login`.
- **AC-9 (gh argv contract).** GitHub provider with a recording runner: argv is exactly
  `["pr","create","--title=<t>","--body=<body>","--base=<base>","--head=<h>"]` (+ `"--draft"` iff
  draft); body containing newlines stays one argv token; empty body still yields `--body=`;
  `taskId` produces a body ending `\n\nRefs: <taskId>`; a whitespace-only `body` given with a `taskId` yields exactly `Refs: <taskId>` (no leading blank lines, per §5.2 Normalization); the URL is extracted per FR-7 (the last stdout line matching `^https://\S+$`, taken by
  scanning every line and keeping the last match), and a no-match stdout yields the FR-8
  failure path.
- **AC-10 (draft flag).** `draft: true` appends `--draft` and echoes `draft: true` in the
  result; default omits the flag and echoes `draft: false`.

### 7.2 Integration tests — `tests/modules/commit/create-pr.integration.test.ts`

Fixture: `mkdtemp` working repo (init + user config + initial commit, per the
`create-branch` fixture rules — captured symbolic HEAD, never a hardcoded default branch
name) plus a second `mkdtemp` **bare** repo added as `origin`;
`git remote set-head origin <captured-default>` after an initial push of the default branch.
The provider is **injected** (fake recording provider), which per the FR-5 injection rule
skips G3/G4 — necessary here because the local bare-remote's path would otherwise fail
detection — so the real-git push path is exercised without `gh` or network.

- **AC-11 (real push).** On a feature branch with one commit: `createPr` with the fake
  provider → `git -C <bare> branch --list <feature>` is non-empty, the working repo's branch
  has upstream `origin/<feature>` (`git rev-parse --abbrev-ref <feature>@{upstream}`), and
  the fake provider received the resolved base equal to the captured default branch.
- **AC-12 (idempotent re-run).** Calling `createPr` again succeeds at the push step (no
  error) and invokes the provider a second time (FR-8 recovery relies on this).
- **AC-13 (guard G2 end-to-end).** On the default branch, `createPr` rejects with the G2
  message and the bare repo records no new branch.

### 7.3 Hook tests

- **AC-14 (stribog).** Confirmed-stribog session, `input.tool === "create_pr"` → hook
  returns without throwing; existing denials unaffected (regression).
- **AC-15 (svarog).** Same for confirmed-svarog.

### 7.4 Plugin-wrapper tests

- **AC-16 (wrapper & schema).** The registered `create_pr` tool exposes exactly `title`,
  `body`, `base`, `draft`, `taskId` (no `cwd`/`runGit`/`provider` leakage); `draft`
  omitted resolves to `false`; `cwd` resolves as `context.worktree ?? context.directory`
  (both cases); `execute` returns the `JSON.stringify(result, null, 2)` string. Stub the
  `createPr` seam; no binaries required.

### 7.5 Invariants

- **AC-17.** `metadata.test.ts`, `tools-sync.test.ts`, and the commit module's existing
  suites pass unchanged (C-2/C-4 held).

## 8. Rollout

- No migration, feature flags, or config changes; `pantheon.json` untouched.
- Environment expectation (documented, not enforced at install time): `gh` installed and
  authenticated on machines where PR creation should succeed; absence degrades to the FR-9
  partial result, never a crash.
- Build/verify: `bun run build:root` then `bun run check`; regenerate and commit the root
  `dist/` tree per repo convention.
- Versioning: new tool surface — bump all `package.json` versions and tag per AGENTS.md
  "Versioning & Git Installation".
- Docs per FR-13. Operators using fork workflows: run `gh repo set-default` once per clone
  (D7 caveat).
- Support: failures surface as descriptive tool errors / `prError` fields in the agent
  transcript.

## 9. Open items & recorded decisions

1. **Ready-by-default (D8)** is an explicit operator decision from the originating session,
   not a spec default; the §6 residual-risk note is the standing record. Revisit if
   agent-opened ready PRs generate unwanted review traffic.
2. **No `--repo` parameter (D7)** — deferred until a concrete cross-repo/fork need exists;
   the `gh repo set-default` guidance covers the known fork workflow.
3. **GitHub Enterprise / GitLab** — out of scope; the `PrProvider` seam and `detectProvider`
   are the designated extension points (D2).
4. **Dependency ordering.** This spec composes with `create_branch`
   (docs/specs/create-branch-tool-2.md) and `av_commit` for the full chain but is
   independently implementable and useful for any branch however created. Implementation may
   proceed in parallel; only the hook carve-out placement references the `create_branch`
   carve-out as its neighbor, which degrades gracefully to "same position, first carve-out"
   if this ships first.
5. **Executor-chain doctrine (recorded decision, 2026-07-22, MoA review ARCH-001).** The §2
   premise that `av_commit` supplies the chain's commit step is now enforced harness-side for
   both executors: the operator resolved the prior "executors never commit / stop at READY"
   doctrine in favor of the full self-serve chain `create_branch` → `av_commit` → `create_pr`.
   Stribog gained an attribution-gated `av_commit` early-return beside this spec's §5.5
   carve-outs (av_commit is not floor-denied; the carve-out exempts it from the step-4
   allow-list); Svarog's allow-by-default hook passes `av_commit` without a carve-out, and its
   prompt/doctrine texts ("Never commit.", "stops at READY (no commit)") were reworded to
   "commits only via `av_commit`". Bash `git commit`/`git push` remain blocked for everyone.
