import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/test-plan-format/SKILL.md",
)

describe("test-plan-format skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("shows Depends-on serializing a rate-limit scenario", () => {
    expect(md).toContain("serialize a rate-limit")
  })

  it("Edge Case Rules carry adversarial teeth (pointers to Step 6.6)", () => {
    expect(md).toContain("indistinguishable from not-found")
    expect(md).toContain("mutates no persistent state")
    expect(md).toContain("reflected into a response header")
  })

  it("requires runnable DSN credentials and the sanctioned-tool note", () => {
    expect(md).toContain("carry the credentials the local service requires")
    expect(md).toContain("cite any repo-sanctioned seeding script")
  })

  it("requires DB-checks to assert the active predicate, not bare existence", () => {
    expect(md).toContain("asserts the active predicate")
  })

  it("Coverage Matrix and checklist require a row per changed external surface (R-A)", () => {
    expect(md).toContain(
      "per changed external surface named in the Changes Summary",
    )
    expect(md).toContain("one row per status and per changed external surface")
  })

  it("grounding tags carry the function-derived-value rule (R-B)", () => {
    expect(md).toContain("Function-derived values")
    expect(md).toContain("not a hand-computed literal")
    expect(md).toContain("generating rule + producer")
  })

  it("Coverage Matrix desc locks reachable surfaces out of out-of-scope (L2)", () => {
    expect(md).toContain(
      "A changed surface with a harness-observable interface (route / DB-effect / Playwright)",
    )
  })

  it("Plan Quality Checklist forbids out-of-scoping a reachable changed surface (L2)", () => {
    expect(md).toContain(
      "No changed surface with a curl/psql/Playwright interface or effect is dispositioned",
    )
  })

  it("Blocker template carries the optional hermetic-observation pointer (L4)", () => {
    expect(md).toContain("**Hermetic observation (optional):**")
  })

  it("Coverage Matrix Pointer cell allows a hermetic pointer on blocked rows (L4)", () => {
    expect(md).toContain("whose contract is unobservable live may add a")
  })

  it("defines the Seeds fixtures consent marker as MANDATORY for any Seed step (TEST seed-gate)", () => {
    // The marker Perun's seed-consent gate keys on. Pinned so the definition can't silently
    // vanish and quietly disable the only consent surface for plan-declared DB writes.
    expect(md).toContain("**Seeds fixtures marker.**")
    expect(md).toContain(
      "MANDATORY whenever any scenario carries a `**Seed (psql/sqlite3):**` step",
    )
  })

  it("§8 defines the paired Teardown block that makes a seed auto-reverting (TEST teardown)", () => {
    // The reversal half of "modify then revert": a Seed with a paired Teardown on a local
    // base-url runs by default and is un-seeded at finalize. Pinned so the block spec + the
    // discriminator-scoping safety rule can't silently vanish.
    expect(md).toContain("**Teardown (psql/sqlite3):**")
    expect(md).toContain("AUTO-REVERTING")
    expect(md).toContain("Scope the discriminator so the DELETE can never touch a row the Seed did not create")
  })

  it("Setup Rules carry the account-existence-is-a-prerequisite rule (provisioning-delegation)", () => {
    // Peer to qa-plan-authoring Step 6.5: preflight verifies credential presence, never account
    // existence, so an auth-account precondition must be an imperative human Setup prerequisite.
    expect(md).toContain("Account existence is a human prerequisite, not a value.")
    expect(md).toContain("verifies credential *presence*, never account *existence*")
  })

  it("Field rules define the optional `- Provisions:` provisioning-recipe marker (provisioning-consent)", () => {
    // Phase 2: the ONLY declarative way to sanction account creation. Its presence marks a recipe
    // as a principal WRITE and arms the allow_provisioning consent gate; omitting it keeps a recipe
    // a token-minting read. Rewording this away would strand the sanctioned account-creation path.
    expect(md).toContain("Provisions (optional).")
    expect(md).toContain("- Provisions: <principal>")
    expect(md).toContain("provisioning-consent gate")
    expect(md).toContain("allow_provisioning")
  })

  it("Setup Rules mandate declaring a scenario auth credential up front (undeclared-auth-credential)", () => {
    // Root cause of the ai-score session: scenarios carried `Authorization: Bearer <token>`
    // but `## Setup` declared no Required env var / binding, so `preflight([])` returned ok on
    // the empty list and the missing credential only surfaced mid-run as NEED_INFO on every
    // scenario. This rule moves the gap to preflight time via a declared NAME.
    expect(md).toContain("A scenario auth credential MUST be declared in `## Setup`.")
    expect(md).toContain("Authorization: Bearer <token>")
    // both canonical Setup forms are named (static env var / dynamic binding)
    expect(md).toContain("**Required environment variables:**` NAME")
    expect(md).toContain("**Bindings:**` `QA_BIND_*` entry")
    // explicitly the belt-and-suspenders COMPLEMENT to injection, not the injection cause
    expect(md).toContain("belt-and-suspenders COMPLEMENT to shell-env injection, not its cause")
    expect(md).toContain(
      "reaches every `zmora-*` child through the `shell.env` hook regardless of declaration",
    )
  })
})
