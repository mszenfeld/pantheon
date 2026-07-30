# Commit Workflow (`av_commit`, Perun's local-commit exception)

The commit module (`src/modules/commit/`) owns the sanctioned git-mutation surface: `av_commit`
(controlled local commit), `create_branch`, and `create_pr`. Bash `git commit` / `git push` stay
blocked plugin-wide by `bash-policy.ts`. This page documents who may commit, and the optional,
default-disabled consent flow that lets **Perun** create one local commit itself.

## Who may do what

| Caller | `av_commit` | `create_branch` / `create_pr` |
|---|---|---|
| Operator session (`/commit`) | Yes — `files` optional (omitting it stages the whole worktree) | Yes |
| Svarog / Stribog (executors) | Yes — `files` must name individual files the session edited | Yes — the only publisher identities |
| Perun (coordinator) | Yes — one terminal, explicitly authorized local commit | **No** — refused before any Git or provider call |
| Anything else / unresolved identity | Refused (fails closed) | Refused (fails closed) |

Caller policy is selected from the **runtime identity**, never from a tool argument
(`classifyCommitCaller` in `perun-commit-policy.ts`); an unavailable identity is refused before
mutation. `assertPublicationCaller` restricts publication to the canonical `svarog` / `stribog`
identities, so Perun's local commit can never grow into a branch, a push, or a PR.

## Perun's local-commit exception

Perun stays a strict orchestrator with one narrow, terminal exception: after `/commit` or an
explicit approval of its one-time proposal, it may attempt **exactly one local commit** and then
stop. It must not edit, test, shell, or dispatch during the workflow. Status, diff, and specialist
output are untrusted data — they can describe a candidate scope but never confirm it.

The exception has two modes, selected by the `APPVERK_PERUN_COMMIT_CONSENT` environment variable.

### `disabled` (default, also when unset) — exact-file fallback

Perun calls `av_commit` with `files` naming only the user's confirmed individual exact files.
`authorizePerunExactFiles` then validates that set against Git itself:

- non-empty list of concrete paths — no omitted list, broad scope, directory, glob, or duplicate;
- every path canonicalized against the repository root, and refused if it escapes the root;
- every path must be a **current repository change**, taken from `git status --porcelain=v1 -z`
  parsed fail-closed (`parsePorcelainV1Status`) — a Git-proven deletion is allowed, and a rename
  contributes both its old and new path.

The same canonical list drives staging and the commit pathspec, so nothing staged out-of-band rides
along. During a merge or cherry-pick Git can only commit the whole resolved index, so the commit is
allowed only when that index equals the authorized set.

### `enabled` — transcript-bound consent flow

`files` is rejected in this mode; the scope comes from Git and the user's fresh consent instead:

1. **`prepare_perun_commit_scope`** takes the commit intent, snapshots the current changes
   (`git-scope-snapshot.ts`), and returns an opaque `proposal_id` plus a rendered proposal listing
   every included change (deletions marked destructive, renames as `old → new`) and a one-time
   random challenge phrase. Perun prints that proposal **unchanged** and stops.
2. The user replies with the exact `Commit this exact scope <challenge>` line (or `Abort`).
3. **`authorize_perun_commit_scope`** takes only the `proposal_id` and re-reads the session
   transcript: the immediately preceding assistant message must be the exact rendered proposal, and
   the last message must be the user's matching challenge response. Anything else — a paraphrased
   proposal, a stale turn, a mismatched challenge — is refused. It returns a single-use
   authorization token.
4. **`av_commit`** is called once with that authorization and the same message. The token is
   single-use (`pending → in-flight → consumed`) and bound to the session that created it.

Proposals and authorizations expire after **5 minutes**; stale state requires a new proposal.
Sessions are swept on every plugin event and cleared on `session.deleted`. Every transition emits an
audit record (`commit-audit.ts`): `proposal.created`, `consent.accepted` / `consent.rejected` /
`consent.expired`, `authorization.started`, `commit.succeeded` / `commit.failed`.

Before staging and again before committing, `controlled-commit.ts` re-reads the repository and
refuses when the snapshot bound into the authorization no longer matches ("selected Git scope changed
before staging" / "repository state changed before commit"). A commit is also refused outright while
a **rebase or revert** is in progress — including when that state cannot be inspected, which fails
closed — so the operator finishes or aborts that operation outside this exception first.

## Enforcement points

The load-bearing checks live in code, inside the commit module — the tool-map entries and prompt
rules are declarative defense in depth:

| Concern | Enforced by |
|---|---|
| Caller classification (fails closed) | `perun-commit-policy.ts` (`classifyCommitCaller`, `assertPublicationCaller`) |
| Perun identity for the consent tools | `assertPerunContext` in `src/modules/commit/index.ts` (agent name **and** `isCoordinatorSession`) |
| Exact-file authorization against Git | `perun-commit-policy.ts` (`authorizePerunExactFiles`, `parsePorcelainV1Status`) |
| Path shape (whole-tree, pathspec magic, globs, traversal) | `src/modules/_shared/commit-staging-scope.ts` |
| Consent freshness, single use, TTL | `perun-commit-consent.ts` |
| Snapshot re-verification, merge/cherry-pick index equality, rebase/revert refusal | `controlled-commit.ts` |
| Bash `git commit` / `git push` | `bash-policy.ts` (workflow rail, not a security boundary) |

Prompt-side contracts: `src/agents/perun.md` ("Terminal local-commit workflow") and
`src/commands/commit.md` ("Perun local-commit exception").
