import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  parseSkillFrontmatter,
  isToolSubset,
} from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/qa-plan-authoring/SKILL.md",
)
const COMMAND_PATH = path.resolve(
  __dirname,
  "../../src/commands/create-qa-plan.md",
)

function frontmatterToolList(md: string): string[] {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = (m?.[1] ?? "")
    .split(/\r?\n/)
    .find((l) => l.startsWith("allowed-tools:"))
  return (line ?? "")
    .replace("allowed-tools:", "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
}

describe("qa-plan-authoring skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("parses with a name and a single-line allowed-tools", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("qa-plan-authoring")
    expect(entry?.allowedTools?.length).toBeGreaterThan(0)
  })

  it("loads test-plan-format and saves to the plans dir", () => {
    expect(md).toContain("test-plan-format")
    expect(md).toContain("docs/testing/plans/")
  })

  it("its allowed-tools are an exact subset of the /qa:create-plan command's", () => {
    const skillTools = parseSkillFrontmatter(md, SKILL_PATH)!.allowedTools!
    const commandTools = frontmatterToolList(readFileSync(COMMAND_PATH, "utf8"))
    expect(isToolSubset(skillTools, commandTools)).toBe(true)
  })

  it("Step 0 binds the converse — (unverified) is a defect on on-disk source", () => {
    expect(md).toContain("The converse is equally binding")
  })

  it("teaches the framework-default trap (verify against the installed version)", () => {
    expect(md).toContain(
      "Framework defaults are the most common confident-wrong trap",
    )
    expect(md).toContain("HTTPBearer")
  })

  it("Step 6.6 carries the reachability litmus + in-scope-by-default classes", () => {
    expect(md).toContain("Reachability litmus")
    expect(md).toContain("IDOR / cross-tenant")
  })

  it("Step 6.8 adds a targeted refute pass with the momus seam", () => {
    expect(md).toContain("Targeted refute pass")
    expect(md).toContain("intent to *refute*")
    expect(md).toContain("Momus seam")
  })

  it("Step 1.5 pins the contract before observing runtime", () => {
    expect(md).toContain("Pin the intended contract")
  })

  it("Step 3.5 forces an emitted Blockers section incl. markerless guards", () => {
    expect(md).toContain("None found.")
    expect(md).toContain("commented-out")
  })

  it("Step 6.6 closes the transitive-punt hole", () => {
    expect(md).toContain("property of the HARNESS, not of the code")
  })

  it("Step 6.7 requires the completed coverage matrix", () => {
    expect(md).toContain("complete the coverage matrix")
  })

  it("Step 6.8 carries the contract-vs-runtime refute check", () => {
    expect(md).toContain("contract-vs-runtime")
  })

  it("Step 4.5 states the runner dispatches scenarios in parallel", () => {
    expect(md).toContain("dispatches scenarios in parallel")
  })

  it("Step 4 treats Playwright as an MCP harness capability, not a PATH binary (root-cause fix)", () => {
    // `command -v playwright` only finds a CLI binary; FE testing runs on the
    // playwright_browser_* MCP tools the runner is always granted. The CLI probe
    // must never be the thing that flips Playwright to unavailable.
    expect(md).toContain("Playwright is a harness capability, not a")
    expect(md).toContain("never gate it on `command -v playwright`")
    expect(md).toContain("Playwright CLI fallback")
  })

  it("Step 6.9 sequences shared-quota scenarios via Depends-on", () => {
    expect(md).toContain("Step 6.9")
    expect(md).toContain("terminal wave")
  })

  it("Step 6.6 carries no-oracle IDOR equality and reflected-input injection", () => {
    expect(md).toContain("indistinguishable from not-found")
    expect(md).toContain("reflected into a response header")
  })

  it("Step 6.6 carries lock-release-on-error and a no-mutation invariant", () => {
    expect(md).toContain("lock releases on the error path")
    expect(md).toContain("mutates no persistent state")
  })

  it("Step 3.5 orders multi-step blocker remediation as Setup prerequisites", () => {
    expect(md).toContain("ordered list of human Setup prerequisites")
  })

  it("Step 0 tiers tests as corroboration, not oracle, with a confidence floor", () => {
    expect(md).toContain("they are not the oracle")
    expect(md).toContain("keeps an assertion at full confidence")
    expect(md).toContain("suspected defective test")
  })

  it("Step 6.8 requires a claim-specific, branch-governing citation", () => {
    expect(md).toContain("branch-governing citation")
  })

  it("Step 6.7 carries the surface-coverage anchor (R-A, self-referential)", () => {
    expect(md).toContain("every external surface named in your own")
    expect(md).toContain("row set == the surfaces you declared")
  })

  it("Step 6.8 treats an out-of-scope surface reason as a refute class (R-A)", () => {
    expect(md).toContain("out-of-scope surface dispositions")
    expect(md).toContain("Only a true harness limit survives")
  })

  it("Step 6.8 forbids hand-computed derived literals (R-B)", () => {
    expect(md).toContain(
      "never assert a hand-computed encoding/hash/slug literal",
    )
    expect(md).toContain("assert the producing rule")
  })

  it("Step 6.7 carries the findings re-scan loop-back (R-C)", () => {
    expect(md).toContain(
      "re-scan the changed files for the Step 3.5 hazard classes",
    )
    expect(md).toContain("not folded into another blocker")
  })

  it("Step 6.8 requires the raise-site+catcher pair for envelope claims (L1)", () => {
    expect(md).toContain(
      "cite the *pair* — the raise-site AND the handler that catches that exception type",
    )
  })

  it("Step 6.8 carries the order-gated resolution-order rule (L1)", () => {
    expect(md).toContain("name the resolution order you rely on and ground it")
  })

  it("Step 6.6 rejects pre-auth-rejected requests as a 429 recipe (L1)", () => {
    expect(md).toContain("never increments the bucket and is a coverage defect")
  })

  it("Step 6.7 locks reachable changed surfaces out of out-of-scope (L2)", () => {
    expect(md).toContain(
      "A changed surface with a harness-observable interface",
    )
  })

  it("Step 6.8 out-of-scope-surface bullet carries the reachable-interface test (L2)", () => {
    expect(md).toContain(
      "if the changed surface has a curl/psql/Playwright interface or effect",
    )
  })

  it("Step 6.6 carries the 422 schema-validation class (L3)", () => {
    expect(md).toContain(
      "**Schema validation → 422** (any surface with a typed request body or typed params)",
    )
  })

  it("Step 0 carves the hermetic-observation pointer exception (L4)", () => {
    expect(md).toContain(
      "**EXCEPTION (verification pointer, not a scenario):**",
    )
  })

  it("Step 0 escalates a failed probe instead of guessing (L5)", () => {
    expect(md).toContain(
      "**A failed or inconclusive probe is not a license to guess:**",
    )
  })

  it("Seed write-safety is marker-keyed, not verb- or disposition-keyed (SEC seed-gate)", () => {
    // Pins the shipped tools.ts behavior: a `**Seed (psql/sqlite3):**` block strips on the
    // marker ALONE. If this doctrine silently drifts back to "INSERT lands unguarded", the
    // authoring skill would once again teach the opposite of the code.
    expect(md).toContain("**Write-safety is marker-keyed, not disposition-keyed:**")
    expect(md).toContain("strips a marked block on `!allow_mutations` alone")
  })

  it("Seed write-safety pins the Seeds fixtures consent marker (SEC seed-gate)", () => {
    expect(md).toContain("**Seeds fixtures:** BE-NN[, …] (auto-reverts with a paired Teardown on a local base-url; else requires allow_mutations)")
  })

  it("§8 teaches the auto-reverting seed (paired Teardown) as the DEFAULT shape (autorevert)", () => {
    // The new default: a Seed with a paired Teardown on a local base-url runs WITHOUT
    // allow_mutations and is un-seeded at finalize. If this drifts, authoring would again
    // teach seeding as a consent-gated exception, contradicting the shipped tools.ts default.
    expect(md).toContain("**Auto-reverting seed (paired Teardown) — the DEFAULT shape.**")
    expect(md).toContain("run-unique discriminator")
    // The discriminator must scope the DELETE (never an unscoped TRUNCATE).
    expect(md).toContain("an unscoped `DELETE`/`TRUNCATE` is a defect")
  })

  it("§8 requires the auto-reverting seed to be IDEMPOTENT (re-runs on the final pass) (autorevert-idempotent)", () => {
    // The loop re-runs the whole plan on the authoritative final pass before the single teardown,
    // so a fixed-PK INSERT collides on its 2nd run → false FAIL. If this rule drifts, the marquee
    // "modify then revert" flow silently mis-fails on any non-idempotent seed.
    expect(md).toContain("the Seed MUST be IDEMPOTENT")
    // Substring kept within one source line (the prose is hard-wrapped at ~col 90).
    expect(md).toContain("the authoritative final pass (and on each retest)")
  })

  it("§8 requires the seed's DSN to be the same local/throwaway instance as base-url (autorevert-dsn)", () => {
    // Phase-0 enforces the local floor on base-url only (it can't resolve the $VAR DSN), so a seed
    // whose DSN points at a shared/prod DB would auto-write there. Pinned so the authoring rule
    // that closes this residual can't silently vanish.
    expect(md).toContain("declared connection DSN MUST point at the SAME local/throwaway instance as `base-url`")
    expect(md).toContain("it cannot resolve the `$VAR` DSN")
  })

  it("Step 6.5 makes account-existence a first-class human precondition with a sanctioned provisioning-recipe escape (provisioning-delegation)", () => {
    // Upstream root cause of the i-need-cv auto-provision improvisation: the plan buried
    // "create test users … if necessary" in free prose because authoring had no account-existence
    // class. preflight verifies credential VALUE presence, never account existence. Phase 2 adds
    // the sanctioned escape: a `- Provisions:` recipe run under the allow_provisioning consent gate,
    // so a producible account no longer dead-ends as a human-only prerequisite.
    expect(md).toContain(
      "Account existence is a human prerequisite that preflight cannot verify",
    )
    expect(md).toContain("account existence DEFAULTS to a human precondition")
    expect(md).toContain("credential-presence ≠ account-existence")
    // An unproducible account demotes its scenarios to provisioning-blocked...
    expect(md).toContain("provisioning-blocked")
    // ...but a producible one is declared as a provisioning recipe under consent (the escape).
    expect(md).toContain("Escape — a provisioning recipe.")
    expect(md).toContain("- Provisions:")
    expect(md).toContain("allow_provisioning")
  })

  it("Step 5 Setup inference declares a scenario auth credential, keyed on scenarios not the diff (undeclared-auth-credential)", () => {
    // Root cause of the ai-score session: a BE-only diff (aiScore filter + fence-strip) added no
    // new `os.environ[...]`, so the diff-keyed Setup bullets fired nothing — yet every scenario
    // carried `Authorization: Bearer <token>`. preflight([]) then passed trivially and the missing
    // credential surfaced only mid-run as NEED_INFO. This bullet keys the declaration on the
    // authored SCENARIOS.
    expect(md).toContain(
      "Any scenario you write that needs an authenticated call → declare its credential",
    )
    expect(md).toContain("keyed on the SCENARIOS, not only the diff")
    // preflight([]) trivially passing on the empty list is named as the failure mode
    expect(md).toContain("`preflight([])` passes trivially on the empty list")
    // cross-links the canonical rule in test-plan-format
    expect(md).toContain(
      'see `test-plan-format` Setup Rules ("A scenario auth credential MUST be declared in `## Setup`")',
    )
  })

  it("Step 6 carries the state-combination-planning trigger", () => {
    expect(md).toContain('skill(name: "state-combination-planning")')
    expect(md).toContain("apply its bar to the scenario matrix")
  })

  it("Step 6.7 re-evaluates the state-combination trigger from the plan artifact", () => {
    // The gate hook: keyed on the trigger predicate + the artifact, NOT on
    // session memory of what was loaded (a missed load must fail the check).
    expect(md).toContain("re-evaluate the Step 6 trigger")
    expect(md).toContain("full 2^N table is present in the plan")
  })
})
