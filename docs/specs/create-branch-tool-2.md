---
title: "create_branch — convention-enforced git branch creation tool for executor agents"
date: 2026-07-21
source: "Headless Perun dispatch (Mode: spec), request: safe branch creation for Svarog/Stribog/commit flow — revised same day to a segmented-argument interface (type/id/description) with in-tool name composition; revised again the same day against MoA review findings (see §2 revision note 2)"
supersedes: "docs/specs/create-branch-tool.md (uncommitted working draft — superseded before it was ever checked in; the path is not present in the repository tree)"
approved: false
---

# Feature Specification: `create_branch` tool

## 1. Goal

Give agents (Svarog, Stribog, and the `/commit` flow) a safe, validated way to create a new local
git branch **without loosening the mutating-git bash policy** that blocks `git checkout` for the
executor agents. The tool accepts **segmented arguments** (`type`, optional `id`, `description`),
composes the conventional branch name itself, and enforces the project branch-naming convention in
pure TypeScript before any git invocation.

**In scope**

- A new plugin tool `create_branch` with parameters `type` (required enum), `id` (optional string),
  `description` (required string), and `checkout` (optional boolean, default `true`).
- In-tool composition of the branch name from the segments (`<type>/<id>-<description>` or
  `<type>/<description>`), with pure-TypeScript validation of each segment and of the composed
  name (zero git spawns on invalid input).
- Registration in the commit module alongside `av_commit`.
- A named, attribution-gated allow for `create_branch` in the Stribog and Svarog tool hooks.
- Unit tests (injected `GitRunner`) and at least one real-repo integration test.
- Documentation of the tool and the naming convention in `src/commands/commit.md`.

**Out of scope**

- Changing `src/modules/_shared/mutating-git.ts` or the bash-command tripwire logic
  (`SECRET_GEN_BASH`, `isMutatingGitCommand` call sites) in either executor hook.
- Branch deletion, renaming, remote operations (`push`/`fetch`/`pull`), or upstream tracking.
- Any change to the QA tools, the coordinator, or `pantheon.json` schema.

**Success criteria**

- A Stribog or Svarog session can create + switch to a convention-valid branch via `create_branch`
  while `git checkout` via `bash` remains denied (`STRIBOG_GIT_DENIED` / `SVAROG_GIT_DENIED`).
- Every invalid segment and every invalid composed name in §5.2 is rejected with a descriptive
  error and zero git invocations.
- `bun run check` (typecheck + test + build) passes.

## 2. Background & current behaviour

- The executor agents' bash is gated by `tool.execute.before` hooks that deny tree/branch-mutating
  git via `isMutatingGitCommand` (`src/modules/stribog/tool-budget-hook.ts:230`,
  `src/modules/svarog/tool-budget-hook.ts:138`). The deny was added after a dispatched executor ran
  `git checkout feature/global-skills` and silently moved the operator's worktree off `master`
  (rationale recorded in `src/modules/_shared/mutating-git.ts:1-16`). `git branch <name>` (create,
  no `-d/-D`) is *not* bash-denied, but switching to the new branch is — so today an executor
  cannot complete a create-and-switch workflow at all and must `ESCALATE`.
- The commit module (`src/modules/commit/`) already owns the sanctioned git-mutation surface: the
  `av_commit` plugin tool wraps an injectable `GitRunner` (`execFile`, argv array, no shell) in
  `src/modules/commit/controlled-commit.ts:13-47`, registered in
  `src/modules/commit/index.ts:44-71`, with unit + real-repo integration tests under
  `tests/modules/commit/`.
- Plugin-tool visibility is global: any tool registered in a plugin's `tool: {}` map is callable
  by any agent unless a runtime hook denies it (per-agent `config.agent[].tools` maps are
  declarative-only on opencode 1.17.3 — see AGENTS.md "Plugin-tool enforcement model").
- **Discovered constraint that shapes this design:** the shared `isImmutableDeny` floor
  (`src/modules/_shared/stribog-extra-tools-contract.ts:65`) denies any tool id containing
  `create` as a whole underscore-segment. `create_branch` matches, so the floor denies the tool
  for **both** executors — Stribog at `src/modules/stribog/tool-budget-hook.ts:322` (step 3) and
  Svarog at `src/modules/svarog/tool-budget-hook.ts:199` (step 4). The originating request assumed
  "Svarog is allow-by-default for plugin tools, so no Svarog change is needed"; that assumption
  does not hold (see §5.4 and §9).
- **Revision note (2026-07-21):** the first draft of this spec took a single `name` string. The
  interface was revised to segmented arguments with in-tool composition so that agents supply
  intent (`type`, `id`, plain-English `description`) and the tool — not the model — owns the
  mechanical naming convention (kebab-casing, joining, ordering). This shrinks the invalid-input
  surface agents can produce and centralizes the convention in one audited function. All other
  aspects of the original design (registration, runner contract, hook carve-outs, test plan) are
  unchanged.
- **Revision note 2 (2026-07-21, MoA review):** this file is the MoA-revised successor of
  `docs/specs/create-branch-tool.md` (the superseded draft — retained only in the originating
  working tree, never committed; the path is not in the repository's tracked tree) — the
  harness collision policy routes durable-artefact revisions to a new suffixed path rather
  than overwriting the prior draft, so the review deltas land here and this file supersedes
  the original. The nine applied deltas: (1) added the
  240-byte UTF-8 composed-name cap (§5.2.4 rule 11); (2) fixed the `validateBranchName` signature
  to take `expectedType` so the type-prefix rule is enforceable by the validator itself (§5.1,
  §5.2.4); (3) specified description normalization byte-precisely (§5.2.1); (4) documented
  checkout-failure recovery semantics (FR-7, D3); (5) corrected the integration fixture
  (mandatory initial commit + captured symbolic HEAD, §7.2); (6) expanded the normative test
  vectors (§5.2.5); (7) added wrapper-level acceptance tests (§7.4 AC-13; the invariants AC moved
  to AC-14); (8) made the error-message template normative (§5.2, NFR-4); (9) made `checkedOut`
  unconditional in the result contract (FR-6/FR-7, §5.5).
- **Revision note 3 (2026-07-22, post-implementation MoA review, ARCH-001):** the operator
  resolved the executor-chain doctrine in favor of the full self-serve chain
  `create_branch` → `av_commit` → `create_pr`: Stribog's hook gained an attribution-gated
  `av_commit` early-return beside this spec's §5.4 carve-outs, and Svarog's "Never commit." /
  "stops at READY (no commit)" doctrine texts were reworded to "commits only via `av_commit`".
  This spec's own contract is unchanged; the note records the decision that makes the chain
  this tool opens completable by the executors it is carved out for. Full record:
  docs/specs/create-pr-tool.md §9 item 5.

## 3. Constraints

- **C-1:** No shell interpretation anywhere in the tool: `execFile("git", args, { cwd })` with an
  argv array, mirroring `defaultGitRunner` (`src/modules/commit/controlled-commit.ts:25-47`).
- **C-2:** `src/modules/_shared/mutating-git.ts` and the executor bash tripwires
  (secret-generation and mutating-git call sites in both `tool-budget-hook.ts` files) MUST NOT be
  modified. The `git checkout` bash denial stays byte-identical in behavior.
- **C-3:** Minimal, consistent change: reuse the existing `GitRunner`/`GitResult`/
  `defaultGitRunner` exports from `./controlled-commit.js`; do not duplicate the runner.
- **C-4:** Locked invariants that MUST keep passing:
  `tests/modules/stribog/metadata.test.ts:74` pins `CORE_BUILTINS` membership;
  `tests/modules/stribog/tools-sync.test.ts:33` pins exact parity between `STRIBOG_TOOLS`
  (structured entries, lowercased) and `CORE_BUILTINS` minus `bash`.
- **C-5:** ESM/NodeNext, TypeScript strict, root-build layout (`bundle: false`); tests import from
  `src/` and run via root `bun run test` after `bun run build:root` (repo convention).

## 4. Requirements

### 4.1 Functional

- **FR-1 — Tool shape.** Register a plugin tool named exactly `create_branch` with args:
  - `type: string` (required enum) — after trimming, exactly one of `feature`, `fix`, `hotfix`,
    `release`, `docs`, `chore`, `refactor` (case-sensitive; no case folding). Exposed at the
    plugin boundary as a plain string schema (`tool.schema.string()`, as `av_commit`/`create_pr`
    do), **not** a schema-level enum: the allow-list is enforced by rule S1 in TypeScript so an
    invalid value reaches the normative S1 error (NFR-4 self-correction) instead of being
    rejected by the schema before S1 can fire.
  - `id: string` (optional) — a task/ticket identifier, e.g. `INC-212`.
  - `description: string` (required) — a short kebab-case or plain-English description, e.g.
    `fix alert dialog` or `fix-alert-dialog`.
  - `checkout: boolean` (optional, default `true`).
- **FR-2 — Normalize and validate first.** Apply §5.2.1 normalization, validate each segment
  against §5.2.2, compose per §5.2.3, and validate the composed name against §5.2.4 — all in pure
  TypeScript. On any violation, throw a descriptive `Error` in the §5.2 normative template
  (naming the segment, the violated rule, and the JSON-encoded offending value) and execute
  **zero** git commands.
- **FR-3 — Composition.** After per-segment validation, compose the full branch name as
  `<type>/<id>-<description>` when `id` is provided and non-empty after trimming, and
  `<type>/<description>` when `id` is omitted or trims to empty.
- **FR-4 — Create.** Run `git branch <composed-name>` as argv `["branch", name]`. A non-zero exit
  (including git's own `already exists` failure) MUST propagate as an `Error` carrying git's
  stderr (or stdout when stderr is empty), mirroring `controlled-commit.ts:82-88`.
- **FR-5 — Optional checkout.** When `checkout` resolves to `true`, run `git checkout
  <composed-name>` as a second argv invocation `["checkout", name]` after creation succeeds.
- **FR-6 — Result contract.** The result **always** contains `checkedOut: boolean`. On full
  success return `{ name, created: true, checkedOut: true }`; when `checkout: false` ran, return
  `{ name, created: true, checkedOut: false }` (`checkedOut` is emitted unconditionally, never
  omitted). `name` is the composed branch name. Serialized via
  `JSON.stringify(result, null, 2)` from the `execute` wrapper, as `av_commit` does.
- **FR-7 — Partial success on checkout failure.** If branch creation succeeded but checkout fails,
  return `{ name, created: true, checkedOut: false, checkoutError: "<failure detail>" }` — do **not**
  throw, and **never** delete the created branch automatically (see D3, §5.4). `checkoutError`
  follows FR-4's capture rule: git's stderr, falling back to stdout when stderr is empty
  (mirroring `controlled-commit.ts:82-88` and the sibling `create_pr` convention), and the fixed
  string `git checkout failed.` when both streams are empty — the field is never empty on this
  path, so `checkedOut: false` with `checkoutError` present stays unambiguously distinguishable
  from the `checkout: false` path (FR-6). **Recovery
  semantics (normative):** on this path the branch *is* created; the caller must resolve the
  checkout blocker manually — e.g. run `git checkout <name>` itself (where permitted) or ask the
  operator to — once the blocker is cleared. Retrying `create_branch` with the same segments will
  fail at FR-4 with git's `already exists` error. This is intentional: the tool does not
  auto-delete a created branch and never checks out a pre-existing branch.
- **FR-8 — Working directory.** The `execute` wrapper passes `cwd: context.worktree ??
  context.directory` (same resolution as `av_commit`, `src/modules/commit/index.ts:62`).
- **FR-9 — Stribog access.** A positively-attributed Stribog session can invoke `create_branch`
  (hook allow per §5.4); the tool is not edit-budgeted (it is not an edit/write tool).
- **FR-10 — Svarog access.** A positively-attributed Svarog session can invoke `create_branch`
  (hook allow per §5.4).
- **FR-11 — Docs.** `src/commands/commit.md` documents the tool's segmented arguments, the
  normalization/composition behavior, and the normative naming convention (prefix list, per-segment
  rules, valid/invalid examples).

### 4.2 Non-functional

- **NFR-1 — No shell.** argv-only git invocation; no string concatenation into a shell command.
- **NFR-2 — Fail fast.** Invalid segments or composed names cost zero process spawns.
- **NFR-3 — No network, no secrets.** The tool performs local git operations only; it handles no
  credentials and emits no secret material.
- **NFR-4 — Deterministic errors.** Validation errors are stable, rule-identifying strings
  suitable for agent self-correction, in the normative template of §5.2:
  `create_branch: segment '<segment>' violates rule <ruleId> (<shortDescription>): <jsonEncodedValue>`.
  User-supplied input echoed in errors is JSON-encoded (control bytes escaped — CWE-117 hygiene
  consistent with the hooks' "never echo the raw value" practice).
- **NFR-5 — Testability.** All git interaction flows through an injectable `GitRunner`; unit tests
  require no git binary.

## 5. Architecture & design decisions

### 5.1 Components

| Component | Change |
|---|---|
| `src/modules/commit/create-branch.ts` (new) | `BRANCH_TYPES` const, `BranchType` (= `typeof BRANCH_TYPES[number]`), `CreateBranchInput { type, id?, description, checkout?, cwd, runGit? }`, `CreateBranchResult` (always includes `checkedOut: boolean`; `checkoutError` only on the FR-7 path), `composeBranchName(input): string` (normalize → validate segments → compose → validate composed), `validateBranchName(name: string, expectedType: BranchType): string` (the §5.2.4 composed-name validator — verifies the name's `<type>` segment equals `expectedType`; returns the validated name, throws on the first failed rule; exported for tests), `createBranch(input)`. Imports `GitRunner`/`defaultGitRunner` from `./controlled-commit.js` (C-3). |
| `src/modules/commit/index.ts` | Register `create_branch` in the plugin's `tool: {}` map beside `av_commit`; `execute` delegates to `createBranch` and JSON-serializes the result. |
| `src/modules/stribog/tool-budget-hook.ts` | Add the named allow (D2). No other logic changes. |
| `src/modules/svarog/tool-budget-hook.ts` | Add the named allow (D2). No other logic changes. |
| `src/modules/stribog/allowed-tools.ts`, `src/modules/svarog/allowed-tools.ts` | Comment-only note that `create_branch` is hook-allowed (mirrors the existing "serena is HOOK-allowed, not listed" notes). Lists themselves unchanged (C-4). |
| `src/commands/commit.md` | New section: `create_branch` segmented usage + the normative naming convention. |
| `src/modules/stribog/stribog.md`, `src/modules/svarog/svarog.md` | One-line prompt note each: branch creation/switching goes through `create_branch` (prevents ESCALATE-on-branch reflex; see D8). |
| `tests/modules/commit/create-branch.test.ts` (new) | Unit tests with injected runner (§7). |
| `tests/modules/commit/create-branch.integration.test.ts` (new) | Real temp-repo tests (§7). |
| `tests/modules/stribog/tool-budget-hook.test.ts`, `tests/modules/svarog/tool-budget-hook.test.ts` | Add: confirmed-agent session invoking `create_branch` passes the hook. |

**D1 — Registration location: the commit module, not a new module.** The commit module already
owns the sanctioned git-mutation workflow (`av_commit`, the `GitRunner` pattern, the `/commit`
command asset, and its test tree) and is already registered in `src/index.ts`. A new module would
require root registration, asset-copy wiring, an AGENTS.md row, and would duplicate
`GitRunner` — more churn for zero isolation benefit, since the tool is the same domain (safe git
mutation) as `av_commit`.

### 5.2 Normalization, segment validation, and composition (normative)

Validation is layered: normalize → validate each segment → compose → validate the composed name.
Every layer runs in pure TypeScript; any failure throws before any git invocation (FR-2).

**Error format (normative).** Every validation failure throws an `Error` whose message matches
exactly:

```
create_branch: segment '<segment>' violates rule <ruleId> (<shortDescription>): <jsonEncodedValue>
```

where `<segment>` is `type` | `id` | `description` | `name`; `<ruleId>` is the failing rule's
identifier (`S1`–`S8` for the §5.2.2 segment rules; `N1`–`N11` for the §5.2.4 composed-name rules,
numbered in the order listed there); `<shortDescription>` is the rule's slug from the table below;
and `<jsonEncodedValue>` is `JSON.stringify` of the offending value — the **post-normalization**
value for `description`-derived failures (so the agent sees the string that actually failed, e.g.
`"fix---alert"` for S6), the trimmed value for `type`/`id` failures, and the composed name for
`name` failures (NFR-4).

| ruleId | shortDescription | ruleId | shortDescription |
|---|---|---|---|
| S1 | `type-not-allowed` | N1 | `single-slash` |
| S2 | `empty-description` | N2 | `type-mismatch` |
| S3 | `invalid-characters` | N3 | `leading-dash` |
| S4 | `leading-dash` | N4 | `empty-description-part` |
| S5 | `leading-dot` | N5 | `invalid-characters` |
| S6 | `double-hyphen` | N6 | `leading-dash-or-dot` |
| S7 | `consecutive-dots` | N7 | `double-hyphen` |
| S8 | `lock-suffix-or-trailing-dot` | N8 | `consecutive-dots` |
|  |  | N9 | `lock-suffix` |
|  |  | N10 | `trailing-dot` |
|  |  | N11 | `max-length-240-bytes` |

Example: `create_branch: segment 'id' violates rule S3 (invalid-characters): "INC 212"`.

#### 5.2.1 Normalization

1. **Trim** `type`, `id` (when provided), and `description`: remove leading/trailing Unicode
   whitespace — exactly `String.prototype.trim()` semantics (Unicode White_Space plus line
   terminators, including NBSP U+00A0).
2. Normalize `description` further, in this exact order:
   a. **Collapse internal whitespace:** replace every run of one or more Unicode whitespace
      characters with a single `-` — exactly `description.replace(/\s+/g, "-")`. JavaScript `\s`
      covers tab, newline, carriage return, vertical tab, form feed, NBSP, and the remaining
      Unicode space separators, so `fix\talert`, `fix\nalert`, and `fix\u00A0alert` all normalize
      to `fix-alert`.
   b. **Strip edge dashes:** remove all leading and trailing `-` characters — including any `-`
      the collapse produced at either edge. (This is what reduces `"---"` to empty, failing S2.)
3. `id` is **not** normalized beyond trimming (D9). An `id` that is omitted, `""`, or trims to
   empty is treated as omitted for composition (FR-3).

#### 5.2.2 Segment validation rules

Applied to each segment independently, after §5.2.1. A segment is valid iff **all** applicable
rules pass.

**Evaluation order (normative).** Segments are validated in the order `type` → `id` →
`description`, and within a segment the rules are evaluated in the order listed (S1→S8); on
multi-violation input the first failing rule is the one reported (mirroring §5.2.4's "throws on
the first failed rule"), and on a multi-segment violation the first segment in that order
reports. This makes NFR-4's deterministic errors well-defined: an empty `description` is
reported as S2 (not S3), and a bad-type-and-bad-id input reports `type`/S1 first.

- **S1 — Type allow-list.** The trimmed `type` is exactly one of `feature`, `fix`, `hotfix`,
  `release`, `docs`, `chore`, `refactor`, case-sensitively. (Rejects `""`, `"  "` (trims to
  empty), `feat`, `Feature`, `bugfix`.) The enum subsumes the charset rules for `type` — every
  allow-listed value is charset-valid by inspection — so no further `type` checks are needed.
- **S2 — Non-empty description.** The normalized `description` is non-empty. (Rejects `""`,
  `"   "`, and `"---"`, which normalizes to empty.)
- **S3 — Character whitelist.** The segment matches `^[A-Za-z0-9._-]+$`. Applies to `id` (when
  present and non-empty) and to the normalized `description`. (Rejects `id: "INC 212"` — spaces
  are normalized out of `description` only, never out of `id` — NUL and every other control byte,
  and by exclusion every git-forbidden byte: space, `~ ^ : ? * [ \ @`, non-ASCII, control chars.)
- **S4 — No leading dash.** The segment does not start with `-`. (Flag-injection guard; argv is
  shell-free, but `git branch` itself parses leading-dash positionals as options. Post-normalization
  a `description` cannot trip this — leading dashes are stripped — so this binds `id` in practice.)
- **S5 — No leading dot.** The segment does not start with `.`. (Rejects `description: ".hidden"`,
  `id: ".INC"`.)
- **S6 — No double hyphen.** The segment does not contain `--`. (Rejects `description:
  "fix--alert"`, `id: "INC--212"`. Note `description: "fix - alert"` normalizes to
  `fix---alert` and fails here — the error message shows the normalized value per the §5.2
  template so the agent can self-correct.)
- **S7 — No consecutive dots.** The segment does not contain `..`. (Git refname rule; traversal
  hygiene.)
- **S8 — No `.lock` suffix, no trailing dot.** The segment does not end with `.lock` and does not
  end with `.`. (Git refname rules — a name valid by this convention must also be accepted by
  git.)

#### 5.2.3 Composition

After all segments pass §5.2.2:

```
name = id is present and non-empty ? `${type}/${id}-${description}` : `${type}/${description}`
```

**Worked examples (normative):**

| Input | Composed name |
|---|---|
| `type="feature", id="INC-212", description="fix alert dialog slide animation"` | `feature/INC-212-fix-alert-dialog-slide-animation` |
| `type="feature", description="fix alert dialog"` | `feature/fix-alert-dialog` |
| `type="fix", id="PROD-42", description="memory leak in auth"` | `fix/PROD-42-memory-leak-in-auth` |

**D9 — Normalization applies to `description` only.** Plain-English input is expected for
`description` (that is the point of the segmented interface), so spaces become dashes there. `id`
is a machine identifier (ticket key); accepting-and-rewriting `INC 212` → `INC-212` would
silently mutate a foreign key and could misattribute work, so a spaced `id` fails S3 with a
descriptive error instead. `type` needs no normalization beyond trimming because it is an exact
enum match.

#### 5.2.4 Final composed-name validation

The composed `name` is re-validated as a whole against the final rule set below — defense-in-depth
over the composition step, and the exported `validateBranchName` contract for direct unit testing.
Signature: **`validateBranchName(name: string, expectedType: BranchType): string`** — it returns
the validated name on success and throws on the first failed rule; `composeBranchName` invokes it
as `validateBranchName(name, trimmedType)` immediately after §5.2.3, before any git invocation.
Rules N1–N11 below carry those ids for error reporting (§5.2 template). A composed name is valid
iff **all** rules pass:

1. **Single slash.** The name contains exactly one `/`, splitting it into `<type>` and
   `<description-part>`. (Rejects `feature/INC-212/`, `feature/../main`, `feature/a/b`, and
   slash-less names.)
2. **Prefix matches the expected type.** The `<type>` segment equals the `expectedType` argument
   and is in the §5.2.2-S1 allow-list. (The `expectedType` parameter is what makes this rule
   enforceable by the validator itself: a `fix/…` name can never validate against a `feature`
   request, and vice versa. An `expectedType` outside the allow-list is unrepresentable in
   TypeScript — `BranchType` admits only allow-listed values — and the allow-list clause still
   catches non-TypeScript callers passing an arbitrary string.)
3. **No leading dash (whole name).** The name does not start with `-`.
4. **Non-empty description part.** `<description-part>` is non-empty.
5. **Character whitelist.** `<description-part>` matches `^[A-Za-z0-9._-]+$`.
6. **Description part does not start with `-` or `.`.**
7. **No double hyphen.** `<description-part>` does not contain `--`. (By construction the
   `<id>-<description>` join inserts exactly one dash; this rule catches segment-boundary cases
   such as an `id` ending in `-`, which S4/S6 do not cover — e.g. `id: "INC-"` passes S3–S8 but
   composes `feature/INC--x`, which fails here.)
8. **No consecutive dots.** `<description-part>` does not contain `..`.
9. **No `.lock` suffix.** `<description-part>` does not end with `.lock`.
10. **No trailing dot.** `<description-part>` does not end with `.`.
11. **Maximum byte length.** The composed name is at most **240 bytes in UTF-8**
    (`Buffer.byteLength(name, "utf8") <= 240`). Rationale: loose refs are stored under
    `.git/refs/heads/<type>/<description-part>`; a 240-byte ceiling keeps every path component
    comfortably below the 255-byte per-component limit of the common filesystems (APFS, ext4,
    NTFS) hosting `.git`. Because N5 restricts the name to ASCII, byte length equals string
    length for any name reaching this rule — the rule is specified in bytes so the guarantee is
    charset-independent.

Rules 5–10 apply to the description part only; rule 11 applies to the whole composed name. The
`<id>-` prefix form (`feature/INC-212-…`) needs no special parsing at this layer — it is just
description-part content under the same rules.

#### 5.2.5 Normative test vectors

Segment-level (input → verdict). Escape spellings (`\t`, `\n`, `\u0000`) denote the actual
bytes; the NBSP row embeds a literal U+00A0 (annotated in its Rule column); `'a'×n` denotes the
character `a` repeated `n` times:

| Input | Verdict / composed name | Rule(s) exercised |
|---|---|---|
| `{type:"feature", id:"INC-212", description:"fix alert dialog slide animation"}` | `feature/INC-212-fix-alert-dialog-slide-animation` | — |
| `{type:"feature", description:"fix alert dialog"}` | `feature/fix-alert-dialog` | — |
| `{type:"fix", id:"PROD-42", description:"memory leak in auth"}` | `fix/PROD-42-memory-leak-in-auth` | — |
| `{type:"feature", id:"", description:"x"}` | `feature/x` | empty id omitted (FR-3) |
| `{type:"feature", id:"  ", description:"x"}` | `feature/x` | empty id omitted (FR-3) |
| `{type:"docs", description:"readme update"}` | `docs/readme-update` | — |
| `{type:"release", description:"2026.07.21"}` | `release/2026.07.21` | dots allowed; not `..`, not `.lock`, not trailing `.` |
| `{type:"chore", description:"update dependencies"}` | `chore/update-dependencies` | — |
| `{type:"refactor", description:"simplify parser"}` | `refactor/simplify-parser` | — |
| `{type:"hotfix", description:"fix  alert   dialog"}` | `hotfix/fix-alert-dialog` | whitespace collapse |
| `{type:"feature", description:"fix\talert"}` | `feature/fix-alert` | §5.2.1 collapse (tab) |
| `{type:"feature", description:"fix\nalert"}` | `feature/fix-alert` | §5.2.1 collapse (newline) |
| `{type:"feature", description:"fix alert"}` | `feature/fix-alert` | §5.2.1 collapse (NBSP U+00A0) |
| `{type:"feature", description:"3rd retry"}` | `feature/3rd-retry` | leading digit allowed |
| `{type:"  fix  ", description:"auth login error"}` | `fix/auth-login-error` | trimming |
| `{type:"", description:"x"}` | invalid | S1 (empty after trim) |
| `{type:"  ", description:"x"}` | invalid | S1 (trims to empty) |
| `{type:"feat", description:"x"}` | invalid | S1 |
| `{type:"Feature", description:"x"}` | invalid | S1 (case-sensitive) |
| `{type:"feature", description:""}` | invalid | S2 |
| `{type:"feature", description:"   "}` | invalid | S2 (normalizes empty) |
| `{type:"feature", description:"---"}` | invalid | S2 (strips to empty) |
| `{type:"feature", id:"INC 212", description:"x"}` | invalid | S3 (id charset; D9) |
| `{type:"feature", description:"café"}` | invalid | S3 |
| `{type:"feature", description:"fix\u0000alert"}` | invalid | S3 (NUL/control byte) |
| `{type:"feature", id:"-INC-1", description:"x"}` | invalid | S4 |
| `{type:"feature", id:".INC", description:"x"}` | invalid | S5 |
| `{type:"feature", description:".hidden"}` | invalid | S5 |
| `{type:"feature", description:"fix--alert"}` | invalid | S6 |
| `{type:"feature", description:"fix - alert"}` | invalid | S6 (normalizes to `fix---alert`) |
| `{type:"feature", id:"INC--212", description:"x"}` | invalid | S6 |
| `{type:"feature", description:"x..y"}` | invalid | S7 |
| `{type:"feature", description:"x.lock"}` | invalid | S8 |
| `{type:"feature", description:"x."}` | invalid | S8 |
| `{type:"feature", id:"INC-", description:"x"}` | invalid | §5.2.4-7 (composed `INC--x`) |
| `{type:"feature", description:"'a'×232"}` | valid — composed name is exactly 240 bytes | §5.2.4-11 boundary |
| `{type:"feature", description:"'a'×233"}` | invalid | §5.2.4-11 (composed 241 bytes) |

Composed-name layer (`validateBranchName(name, expectedType)` direct vectors):

| Name | `expectedType` | Verdict | Rule(s) exercised |
|---|---|---|---|
| `feature/INC-212-fix-alert-dialog-slide-animation` | `feature` | valid | — |
| `feature/fix-alert-dialog-slide-animation` | `feature` | valid | — |
| `release/2026.07.21` | `release` | valid | dots allowed |
| `feature/` | `feature` | invalid | N4 |
| `feature/INC 212` | `feature` | invalid | N5 |
| `feature/INC--212` | `feature` | invalid | N7 |
| `feat/INC-212` | `feature` | invalid | N2 |
| `fix/INC-212` | `feature` | invalid | N2 (expectedType mismatch) |
| `feature/INC-212` | `fix` | invalid | N2 (expectedType mismatch) |
| `feature/INC-212/` | `feature` | invalid | N1 |
| `feature/../main` | `feature` | invalid | N1 (also N8) |
| `-feature/INC-212` | `feature` | invalid | N2 (also N3) |
| `feature/.hidden` | `feature` | invalid | N6 |
| `feature/x.lock` | `feature` | invalid | N9 |
| `feature/` + `'a'×232` (exactly 240 bytes) | `feature` | valid | N11 boundary |
| `feature/` + `'a'×233` (241 bytes) | `feature` | invalid | N11 |

### 5.3 Git invocation contract

Exactly two possible invocations, in order, both through the injected `GitRunner`, both using the
composed and validated `name`:

1. `["branch", name]` — create-only. Git itself fails with `already exists` for a duplicate;
   that error propagates (FR-4). No existence pre-check is performed (git is the single source of
   truth; a pre-check would be TOCTOU anyway).
2. `["checkout", name]` — only when `checkout` is true and step 1 succeeded.

No `rev-parse` pre-check: a non-repository `cwd` fails step 1 with git's own fatal error, which
propagates per FR-4 (keeps to the request's 1–2 invocations; the `av_commit` pre-check pattern was
considered and rejected as non-minimal here).

**Safety property that justifies the executor carve-out:** `git branch <name>` creates a ref at
HEAD; `git checkout <name>` then moves HEAD to that ref — *the same commit*. The working tree is
untouched and uncommitted changes carry over. The hazard the mutating-git bash policy guards
against (moving/rewriting the worktree to a different commit) cannot arise from create-and-switch
at HEAD, and the name is convention-validated before either invocation.

### 5.4 Executor allow-list integration (D2, D3)

**D2 — Named, attribution-gated allow in both hooks (NOT `CORE_BUILTINS`, NOT `extraTools`, NOT
the declared lists).** The integration point is a single early-return in each hook, placed after
attribution and before the `isImmutableDeny` floor:

- Stribog: in `src/modules/stribog/tool-budget-hook.ts`, immediately after the serena block
  (step 2c, ends line 278) and before `denyKey`/step 3 (line 287): if the normalized id equals
  `create_branch`, return (allowed, unbudgeted) — the new return sits beside the existing
  `create_pr` early-return (line 285), a live precedent of exactly this carve-out. Comment
  records that the tool is the sanctioned branch path (validated, argv-only, no shell) and that
  the bash mutating-git tripwire is unchanged.
- Svarog: in `src/modules/svarog/tool-budget-hook.ts`, immediately before the floor at step 4
  (line 186), beside the existing `create_pr` early-return (line 181): same normalized-id
  early-return, same comment.

Alternatives considered and rejected:

- **Add to `CORE_BUILTINS`** — rejected: the set is pinned by
  `tests/modules/stribog/metadata.test.ts:74` and is documented as the *native-builtin* static
  boundary; adding a plugin tool there also creates a contract inconsistency (the same id is
  `isImmutableDeny`-true) and would pre-filter it without attribution.
- **Operator `agents.stribog.extraTools: ["create_branch"]`** — rejected: impossible by design.
  `validateExtraToolsPattern` rejects exact ids that are immutable-denied
  (`src/modules/_shared/stribog-extra-tools-contract.ts:101-105`), and the runtime floor wins over
  any extraPattern anyway (`tool-budget-hook.ts:317-322`).
- **Add to `STRIBOG_TOOLS`/`SVAROG_TOOLS`** — rejected: `tools-sync.test.ts:33` pins exact
  parity between `STRIBOG_TOOLS` structured entries and `CORE_BUILTINS` minus `bash`; the
  established pattern for hook-allowed non-builtin tools is hook-only with a comment in
  `allowed-tools.ts` (the serena precedent, `svarog/allowed-tools.ts:4-7`).
- **Rename the tool to dodge the `create_` verb pattern** — rejected: the request fixes the name
  `create_branch`; bending names around a regex obscures intent. The carve-out is explicit,
  audited, and tested.
- **Weaken the shared verb pattern** — rejected outright (C-2 adjacent): it is a security floor
  for data-MCP write tools; no change there is acceptable for this feature.

This decision **supersedes the request's assumption that Svarog needs no change**: the shared
floor denies `create_branch` for Svarog too (§2). The change is two lines plus comments and tests
in `src/modules/svarog/`, and it does not touch the bash tripwire logic (C-2 honored).

**D3 — Checkout failure is a partial-success result, not a throw.** The created branch is the
primary side effect and is reported with `checkedOut: false` and `checkoutError` (FR-7).
Rationale: throwing would signal total failure and invite a retry of `git branch`, which would
then fail with `already exists` and mask the real state; a structured result lets the agent fix
the checkout blocker and re-run checkout. The recovery path is therefore explicit and manual
(FR-7): the branch stays created, the caller runs `git checkout <name>` itself (where permitted)
or asks the operator to, and a retry of `create_branch` with the same segments fails at FR-4 with
`already exists`. The branch is never auto-deleted (the operator may have intended the ref; silent
deletion is a second, unrequested mutation) and the tool never checks out a pre-existing branch.
This extends the request's return schema with one optional field, `checkoutError`.

**D5 — No Svarog recovery checkpoint for `create_branch`.** The auto-checkpoint fires on
file-mutating tools (`MUTATING_NATIVE`, `svarog/tool-budget-hook.ts:24-30`). A same-commit
checkout changes no working-tree file (§5.3), so there is nothing to recover; adding the tool to
that set was considered and rejected.

**D8 — Prompt/denial-guidance routing (SHOULD, not acceptance-blocking).** One line is added to
`stribog.md` and `svarog.md` naming `create_branch` as the branch path. The `GIT_DENIED` denial
strings in both hooks SHOULD also gain "use the `create_branch` tool" redirect text — the hooks
already use redirect-guidance for collision families (`SKILL_META_TOOL`, `EDIT_EQUIVALENT_TOOL`)
precisely because a bare denial makes models ESCALATE (documented in
`stribog/tool-budget-hook.ts:31-47`). This edits only the *message* of a denial, never its
behavior, so it does not loosen the bash policy (C-2); it is flagged here because the request
said "do not modify the executor bash hooks" — the approver may defer this line to a follow-up
without affecting FR-1…FR-11. **Status: implemented 2026-07-22** (initially deferred, then
landed in the post-implementation review): both `GIT_DENIED` messages now redirect branch
creation to `create_branch` and keep the ESCALATE guidance for every other branch/tree
operation; `isMutatingGitCommand` and the deny decision are byte-identical (C-2 upheld).

### 5.5 Data flow

```
agent (stribog | svarog | /commit session)
  → create_branch({ type, id?, description, checkout? })   [plugin tool, global registry]
    → stribog/svarog hook: attribution + named allow       [D2; bash policy untouched]
    → execute wrapper: cwd = worktree ?? directory         [FR-8]
    → normalize segments (§5.2.1)                          [FR-2]
    → validate segments (§5.2.2)                           [FR-2 — zero git on failure]
    → compose name (§5.2.3)                                [FR-3]
    → validate composed name (§5.2.4)                      [FR-2 — zero git on failure]
    → GitRunner(cwd, ["branch", name])                     [FR-4]
    → GitRunner(cwd, ["checkout", name])?                  [FR-5/FR-7]
    → JSON { name, created: true, checkedOut, checkoutError? }
```

## 6. Security assessment

- **Trust boundaries.** The tool bridges agent-controlled strings to local `git` exec. All
  untrusted input flows through the §5.2 layered validator (segments, then composed name) before
  any spawn; git is invoked via argv (`execFile`), so no shell interpretation exists to inject
  into (NFR-1, C-1).
- **Flag injection.** S4 (segment level) and §5.2.4 rules 3/6 (composed level) reject leading
  dashes even though argv is shell-free, because `git branch`/`git checkout` themselves parse
  leading-dash positionals as options. With all layers enforced, the only argv slots are fixed
  verbs plus one validated positional.
- **Refname attacks.** Traversal (`..`), dot components, `.lock`, trailing dot/slash, and control
  bytes are all rejected (S3–S8 and §5.2.4 rules 1, 5, 6, 8, 9, 10), and over-long names are
  rejected by the 240-byte UTF-8 cap (rule 11) below common filesystem component limits, so a
  valid-by-convention name is always a valid, storable git refname and cannot escape
  `refs/heads/` semantics.
- **Normalization safety.** Description normalization is a pure, deterministic, order-fixed string
  transform (§5.2.1) applied *before* validation — it can never introduce a character outside the
  whitelist (it only removes whitespace and dashes or converts whitespace to dashes), and every
  output still passes S3–S8 or the input is rejected. `id` is never rewritten (D9).
- **Worktree safety.** Same-commit checkout cannot move, discard, or rewrite working-tree state
  (§5.3); the executor bash denial for general `git checkout` remains in force unchanged (C-2).
- **Authorization posture.** Plugin tools are globally visible; the executor hooks are the only
  runtime gate and they *allow* this tool (D2). No new caller-gate is introduced — the tool
  performs a local, reversible-by-hand ref creation, a strictly weaker capability than the
  existing `av_commit`. The immutable-deny floor is not weakened for any other id.
- **Error hygiene.** Validation errors echo user input only JSON-encoded (§5.2 template, NFR-4);
  git stderr is propagated as-is (local git output, no secret material in these two verbs' failure
  modes).
- **Auditability.** Unit tests assert the zero-git-on-invalid property at both validation layers;
  the hook carve-outs are single named lines with tests, keeping the exception enumerable and
  reviewable.

## 7. Testing & acceptance criteria

### 7.1 Unit tests — `tests/modules/commit/create-branch.test.ts` (injected runner)

- **AC-1 (validation tables).** Every row in the §5.2.5 segment-level table produces the stated
  verdict (and composed name where valid); every row in the composed-name table produces the
  stated verdict against `validateBranchName(name, expectedType)` directly — including the
  240-byte boundary row and the 241-byte over-limit row at both layers. Invalid inputs reject with
  an `Error` whose message matches the §5.2 normative template exactly —
  `create_branch: segment '<segment>' violates rule <ruleId> (<shortDescription>): <jsonEncodedValue>`
  — carrying the row's rule id, and the injected runner records **zero** calls.
  Trimming: `{type: "  fix  ", description: "auth login error"}` composes `fix/auth-login-error`.
- **AC-2 (happy path, default checkout).** `createBranch({ cwd, type: "feature", id: "INC-212",
  description: "fix alert dialog", runGit })` calls `["branch",
  "feature/INC-212-fix-alert-dialog"]` then `["checkout", "feature/INC-212-fix-alert-dialog"]` and
  returns exactly `{ name: "feature/INC-212-fix-alert-dialog", created: true, checkedOut: true }`
  (no `checkoutError` key).
- **AC-3 (id omitted, empty, and whitespace-only).** `{ cwd, type: "feature", description: "fix
  alert dialog" }`, `{ cwd, type: "feature", id: "", description: "fix alert dialog" }`, and
  `{ cwd, type: "feature", id: "  ", description: "fix alert dialog" }` all compose
  `feature/fix-alert-dialog`, and each result contains `checkedOut: true` (default checkout ran).
- **AC-4 (checkout: false).** Only the `branch` call is made; result is
  `{ name, created: true, checkedOut: false }` — `checkedOut` is always emitted (FR-6) and is
  `false` on this path.
- **AC-5 (create failure).** Runner returns non-zero for `branch` (stderr set, e.g. `already
  exists`); `createBranch` rejects with that stderr; no `checkout` call follows.
- **AC-6 (checkout failure → partial result).** `branch` succeeds, `checkout` returns non-zero;
  result is exactly `{ name, created: true, checkedOut: false, checkoutError: <stderr> }`; a
  second vector with empty stderr and non-empty stdout yields `checkoutError: <stdout>` (FR-7
  capture rule); the runner records exactly two calls in each case (no delete/third call).

### 7.2 Integration tests — `tests/modules/commit/create-branch.integration.test.ts`

Real temp repo via `mkdtemp` + `git init` + user config (pattern of
`controlled-commit.integration.test.ts:11-23`), with two **mandatory fixture additions**:

1. **Initial commit.** The fixture MUST create an initial file (e.g. `writeFile` a `README.md`),
   stage it (`git add <file>`), and commit it (`git commit -m ...`) before any `createBranch`
   call — `git branch <name>` fails on an unborn HEAD, so without this every test fails for the
   wrong reason. Use plain `execFile`, as the existing fixture does.
2. **Captured initial HEAD.** The fixture MUST capture the initial symbolic HEAD before the test
   (`git symbolic-ref --short HEAD`, or `git branch --show-current`) and use that captured value —
   never a hardcoded `master`/`main` — for HEAD comparisons, because the default branch name is
   configurable (`init.defaultBranch`, user/global config, git version).

- **AC-7.** `createBranch({ cwd, type: "feature", description: "inc 1 demo" })` → `git branch
  --list feature/inc-1-demo` non-empty and `git symbolic-ref --short HEAD` equals
  `feature/inc-1-demo`.
- **AC-8.** `checkout: false` → branch exists, and `git symbolic-ref --short HEAD` still equals
  the fixture-captured initial HEAD (unchanged).
- **AC-9.** Second call with the same segments rejects with git's `already exists` error.
- **AC-10.** Invalid input (e.g. `type: "feat"`) rejects and `git branch --list` shows no new
  branch.

### 7.3 Hook tests

- **AC-11 (stribog).** Confirmed-stribog session, `input.tool === "create_branch"` → hook returns
  without throwing; existing denials (`execute_recipe`, dispatch family) still throw (regression).
- **AC-12 (svarog).** Same for confirmed-svarog; `question`/`webfetch`/floor denials unaffected.

### 7.4 Plugin-wrapper tests — registration contract (`src/modules/commit/index.ts`)

- **AC-13 (wrapper & schema).** Assert against the registered `create_branch` tool (the pattern
  mirrors `av_commit`, `src/modules/commit/index.ts:45-69`):
  - the tool's arg schema exposes **exactly** `type`, `id`, `description`, `checkout` — no `cwd`,
    `runGit`, or other internal keys are agent-visible, and `type` is a plain string schema
    (`tool.schema.string()`), **not** a schema-level enum, so an invalid `type` reaches the
    normative S1 error rather than a schema-level rejection (FR-1, NFR-4);
  - `checkout` omitted or explicitly `undefined` resolves to `true` (the default is applied before
    `createBranch` is invoked);
  - `cwd` is resolved as `context.worktree ?? context.directory` — two cases: worktree set →
    worktree wins; worktree absent → `directory` is used;
  - `execute` returns a **string** equal to `JSON.stringify(result, null, 2)` of the
    `createBranch` result (parseable JSON, not a raw object).

  Stub the runner or the `createBranch` seam; no git binary required.

### 7.5 Invariants

- **AC-14 (invariants).** `metadata.test.ts`, `tools-sync.test.ts`, and the commit plugin's
  existing suites pass unchanged (evidence C-2/C-4 held).

## 8. Rollout

- No migration, feature flags, or config changes. `pantheon.json` schema untouched; no
  `extraTools` operator action needed (and none would work — §5.4).
- Build/verify: `bun run build:root` then `bun run check`; the root `dist/` tree is regenerated
  and committed per repo convention.
- Versioning: adding a tool is a new built-asset surface — bump all `package.json` versions and
  tag per the repo versioning policy (AGENTS.md "Versioning & Git Installation"), as part of the
  implementing change's release flow.
- Documentation: `src/commands/commit.md` (FR-11) plus the comment/prompt notes in §5.1. The
  AGENTS.md commit-module row does not enumerate tools, so no AGENTS.md change is required.
- Support: none anticipated; failures surface as descriptive tool errors in the agent transcript.

## 9. Deviations from the originating request

1. **Svarog *does* need a (two-line) hook change** (D2, §5.4): the shared `isImmutableDeny`
   floor denies the `create_` verb for Svarog at `src/modules/svarog/tool-budget-hook.ts:199`.
   The request's "no Svarog change is needed" is incorrect on the evidence; the minimal carve-out
   is specified instead of loosening anything.
2. **Return schema gains optional `checkoutError`** on the checkout-failure path only (D3, FR-7) —
   the mechanism by which "report the created branch and the checkout failure" is satisfied
   without throwing away the partial success.
3. **"Stribog's allow-list" is implemented as a hook carve-out, not a list edit** (D2): both
   declarative lists are pinned by sync tests, and `extraTools` cannot carry an immutable-denied
   id. The hook is where the repo already puts non-builtin allows (serena precedent).
4. **Optional routing guidance** (D8) flags a one-line redirect inside the `GIT_DENIED` denial
   *messages* as a SHOULD; flagged because the request constrained hook edits — behavior is
   unchanged either way and it may be deferred without blocking any FR.
5. **Interface change from the prior draft of this spec** (revision, not a request deviation):
   the single `name` parameter was replaced by segmented `type`/`id`/`description` composition per
   the follow-up request (§2 revision note). Two deliberate sub-decisions ride with it:
   normalization rewrites `description` only, never the `id` foreign key (D9); and the composed
   name still passes the full §5.2.4 rule set so the previous design's validation guarantees are
   preserved verbatim at the outer layer.
6. **MoA-review revision (this document's second revision, §2 revision note 2):** the nine deltas
   listed there were applied against mixture-of-agents review findings. None of them alters the
   interface shape, the hook carve-out design (D2), the runner contract, or the rollout plan —
   they tighten validation (240-byte cap, `expectedType` signature, precise normalization),
   contracts (unconditional `checkedOut`, normative error template), and test fidelity (expanded
   vectors, corrected fixture, wrapper-level ACs) only.
