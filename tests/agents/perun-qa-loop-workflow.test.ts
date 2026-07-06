import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const perun = readFileSync(
  join(__dirname, "../../src/agents/perun.md"),
  "utf8",
)

describe("Perun unified QA-loop workflow", () => {
  it("has a single QA Loop workflow, not separate Workflow 1 + Workflow 2", () => {
    expect(perun).toMatch(/###\s+Workflow 1:\s*QA Loop/)
    expect(perun).not.toMatch(/###\s+Workflow 2:\s*Issue Fix/)
  })

  it("drives the §4 phase pipeline by name", () => {
    expect(perun).toContain("Phase 0")
    expect(perun).toContain("Phase 1")
    expect(perun).toContain("Phase 2")
    expect(perun).toContain("Phase 3")
    expect(perun).toContain("Phase 4")
  })

  it("calls every qa_loop_* tool in the workflow body", () => {
    for (const t of [
      "qa_loop_start",
      "qa_loop_ingest",
      "qa_loop_step",
      "qa_loop_record_fix",
      "qa_loop_finalize",
      "qa_loop_undo",
    ]) {
      expect(perun).toContain(t)
    }
  })

  it("dispatches Svarog (not fix-auto) as the in-loop fixer", () => {
    // the loop body dispatches svarog one issue at a time
    expect(perun).toMatch(/agent:\s*"svarog"/)
    // no fix-auto dispatch survives anywhere in the workflow
    expect(perun).not.toContain("fix-auto")
  })

  it("preserves the reused-verbatim steps inside the loop", () => {
    expect(perun).toContain("Preflight prerequisites")
    expect(perun).toContain("Service bring-up (auto, via Stribog)")
    expect(perun).toContain("Parse bindings")
    expect(perun).toContain("Compute waves")
    expect(perun).toContain("NEED_INFO")
  })

  it("stops authoring the report itself — the tool is the single writer", () => {
    // the hand-Edit of Status: ✅ Fixed lines is gone
    expect(perun).not.toMatch(/Edit.*Status:.*✅ Fixed/)
  })
})

describe("Perun Workflow 0 routing points at the QA loop", () => {
  it("the test-it branch routes into the QA loop, not a one-pass run", () => {
    const wf0 = perun.slice(
      perun.indexOf("### Workflow 0"),
      perun.indexOf("### Workflow 1"),
    )
    expect(wf0).toMatch(/QA loop|Workflow 1.*QA Loop/)
    expect(wf0).not.toMatch(/per Workflow 1\b(?!.*Loop)/)
  })
})

describe("Perun seed-consent gate doctrine (pinned against silent regression)", () => {
  it("keeps allow_mutations false unless the Seeds fixtures marker is present, and never self-consents", () => {
    // The ONLY human-consent leg of the seed-write path lives in perun.md — tools.ts merely
    // enforces the allow_mutations flag (already tested). Deleting/rewording these bullets
    // would let Perun run plan-declared DB writes without operator confirmation, with the rest
    // of the suite green.
    expect(perun).toContain("Keep `allow_mutations: false` UNLESS")
    expect(perun).toContain("**Seeds fixtures:**")
    expect(perun).toContain("only after the user confirms")
    expect(perun).toContain("Never flip it silently")
  })

  it("stops the run on an error status or an empty dispatch_set", () => {
    expect(perun).toContain('If `status` is `"error"`, or `dispatch_set` is empty, STOP the run.')
  })

  it("a plan-declared Seed block strips under the seed-consent gate regardless of blocked phrasing", () => {
    // DOC-drift guard: the qa_loop_start contract note must describe the shipped marker-alone
    // gate (a Seed block is a fixture write that strips on allow_mutations), not the old
    // "negative-blocked scenarios always stay in" behavior the code no longer implements.
    expect(perun).toContain("EXCEPT a plan-declared `**Seed (psql/sqlite3):**` block")
    expect(perun).toContain("regardless of any blocked phrasing")
  })
})

describe("Perun account-provisioning-offer prohibition (pinned against silent regression)", () => {
  it("bars Perun from offering to create accounts/principals or soliciting a provisioning secret", () => {
    // Real i-need-cv session: a swappable coordinator model improvised an "I'll create the test
    // users / generate their credentials via a SERVICE_KEY export+restart" offer that no lane can
    // execute, and its own credential-prefix denylist then dead-ended the user's compliant paste.
    // This bullet closes the runtime vacuum (perun.md enumerated forbidden credential MINTING but
    // never the provisioning OFFER). Deleting/rewording it would let the improvisation return with
    // the rest of the suite green.
    expect(perun).toContain(
      "Offer to create or provision test users, accounts, or principals itself",
    )
    expect(perun).toContain("prepare the accounts yourself")
    expect(perun).toContain("do NOT counter-offer to do it yourself")
  })
})

describe("Perun credential-recovery & diagnostic-honesty doctrine (pinned against silent regression)", () => {
  it("tells Perun a re-paste REPLACES the stored value and returns updated", () => {
    // Real SynergyCodes session: the store dropped a corrected re-paste as a
    // duplicate no-op while telling Perun {status:"ok"}. D1 made the store
    // overwrite (returning "updated"); this doctrine tells Perun to use it
    // instead of pushing the user to export-and-restart. Rewording it back
    // would resurrect the unrecoverable-bad-first-paste loop, suite still green.
    expect(perun).toContain("Credential-recovery & diagnostic honesty")
    expect(perun).toContain("REPLACES the stored value")
    expect(perun).toContain('{status: "updated"}')
    // The user-facing confirmation string is the observable contract of the
    // overwrite path — pin it so a reword cannot drop the "Updated" ack.
    expect(perun).toContain("Updated <NAME> (<N> chars)")
    expect(perun).toContain(
      "export-and-restart is only for an UNDECLARED credential-prefixed boot secret",
    )
  })

  it("pins the status-aware user-reply echo LINE with literals unique to it (not the doctrine block)", () => {
    // The echo line (user-reply parsing) branches on record_input's status: a
    // first paste "Recorded values for: ... Re-attempting setup...", an
    // {status:"updated"} re-paste "Updated <NAME> (<N> chars).", and a
    // {status:"rejected"} surfaces the reason and does NOT re-attempt. The
    // "Updated <NAME> (<N> chars)" / '{status: "updated"}' literals ALSO live in
    // the doctrine block below, so they cannot guard the echo line — pin text
    // that appears ONLY on the echo line so a revert to the pre-status-aware
    // form (which passed the whole suite) is caught here.
    expect(perun).toContain("Re-attempting setup...")
    expect(perun).toContain("do NOT re-attempt with the same value")
  })

  it("bars inferring credential state from a write-only tool, and bans the Stribog credential probe", () => {
    // Perun twice confabulated a root cause off unobservable state: a decoded
    // "expired" verdict, then an "injection broken" verdict read from a Stribog
    // probe the zmora-scoped shell.env hook deliberately never feeds.
    expect(perun).toContain("write-only")
    expect(perun).toContain("401 Invalid or expired token")
    expect(perun).toContain("401 Not authenticated")
    expect(perun).toContain("never a Stribog diagnostic")
  })
})

describe("Perun write-only credential rule (pinned against silent regression)", () => {
  it("bars decoding/echoing a pasted credential — the scrubber cannot redact decoded plaintext", () => {
    // Real SynergyCodes session: Perun base64-decoded the user's JWT, printed
    // its identity claims (name/email/tid/roles) and manufactured a false
    // "expired" verdict. This universal MUST-NOT bullet closes that PII leak;
    // the deterministic scrubber cannot backstop it (decoded plaintext is not a
    // substring of the stored base64 value).
    expect(perun).toContain("Decode, inspect, or echo a pasted credential")
    expect(perun).toContain("WRITE-ONLY")
    expect(perun).toContain("NEVER base64-decode it")
  })
})
