import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { QaRunState } from "../../../src/modules/qa/qa-run-state.js"
import { makeExecuteRecipeHandler } from "../../../src/modules/qa/execute-recipe.js"
import type { ParsedBinding } from "../../../src/modules/qa/binding-parser.js"

const tokenBinding: ParsedBinding = {
  name: "QA_BIND_TOKEN",
  type: "secret",
  description: "test",
  inputs: ["TEST_USER_EMAIL", "TEST_USER_PASSWORD"],
  egress: "$URL",
  recipe: `curl --data-urlencode "email=$TEST_USER_EMAIL" "$URL" | jq -er .access_token`,
  provisions: null,
}

// A PROVISIONING binding: its recipe CREATES an account (a write). The `provisions`
// marker makes execute_recipe gate it on allow_provisioning consent.
const provisioningBinding: ParsedBinding = {
  name: "QA_BIND_USER_A",
  type: "plain",
  description: "provisioned test user A",
  inputs: ["ADMIN_URL", "SUPABASE_SERVICE_KEY"],
  egress: "$ADMIN_URL",
  recipe: `curl -sS -X POST "$ADMIN_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_KEY" | jq -er .id`,
  provisions: "a confirmed Supabase auth user",
}

function makeHandler(opts: {
  store?: BindingsStore
  state?: QaRunState
  parent?: string
  bashRun?: (
    cmd: string,
    env: Record<string, string>,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  processEnv?: Record<string, string | undefined>
}) {
  const store = opts.store ?? new BindingsStore()
  const state = opts.state ?? new QaRunState()
  state.storePlan(opts.parent ?? "p1", [tokenBinding])
  return makeExecuteRecipeHandler({
    store,
    state,
    resolveParentID: async () => opts.parent ?? "p1",
    runBash:
      opts.bashRun ??
      (async () => ({ exitCode: 0, stdout: "TOKEN_VALUE", stderr: "" })),
    processEnv: opts.processEnv ?? {},
  })
}

describe("execute_recipe handler", () => {
  it("returns need_info when an input is missing", async () => {
    const handler = makeHandler({})
    const result = await handler(
      { binding_name: "QA_BIND_TOKEN" },
      { sessionID: "zmora-1" },
    )
    expect(result.status).toBe("need_info")
    if (result.status === "need_info") {
      expect(result.missing).toContain("TEST_USER_EMAIL")
      expect(result.missing).toContain("TEST_USER_PASSWORD")
    }
  })

  it("runs recipe and registers binding atomically when all inputs present", async () => {
    const store = new BindingsStore()
    store.writeBinding(
      "p1",
      "TEST_USER_EMAIL",
      "foo@bar.com",
      "secret",
      "user-paste",
    )
    store.writeBinding(
      "p1",
      "TEST_USER_PASSWORD",
      "secret123",
      "secret",
      "user-paste",
    )
    const handler = makeHandler({ store })
    const result = await handler(
      { binding_name: "QA_BIND_TOKEN" },
      { sessionID: "zmora-1" },
    )
    expect(result.status).toBe("ok")
    expect(store.getBinding("p1", "QA_BIND_TOKEN")?.value.unwrap()).toBe(
      "TOKEN_VALUE",
    )
    expect(store.getBinding("p1", "QA_BIND_TOKEN")?.type).toBe("secret")
    expect(store.getBinding("p1", "QA_BIND_TOKEN")?.source).toBe(
      "minted-recipe",
    )
  })

  it("returns recipe_failed on non-zero exit", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "y", "secret", "user-paste")
    const handler = makeHandler({
      store,
      bashRun: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "jq: parse error",
      }),
    })
    const result = await handler(
      { binding_name: "QA_BIND_TOKEN" },
      { sessionID: "zmora-1" },
    )
    expect(result.status).toBe("recipe_failed")
    if (result.status === "recipe_failed") {
      expect(result.reason).toContain("exit_code")
      expect(result.stderr_tail).toContain("jq: parse error")
    }
  })

  it("rejects literal 'null' stdout", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "y", "secret", "user-paste")
    const handler = makeHandler({
      store,
      bashRun: async () => ({ exitCode: 0, stdout: "null\n", stderr: "" }),
    })
    const result = await handler(
      { binding_name: "QA_BIND_TOKEN" },
      { sessionID: "zmora-1" },
    )
    expect(result.status).toBe("recipe_failed")
    if (result.status === "recipe_failed") {
      expect(result.reason).toMatch(/invalid_output|nullish/)
    }
  })

  it("returns unknown_binding when name not in plan", async () => {
    const handler = makeHandler({})
    const result = await handler(
      { binding_name: "QA_BIND_NOT_DECLARED" },
      { sessionID: "zmora-1" },
    )
    expect(result.status).toBe("unknown_binding")
  })

  it("scrubs stderr_tail against current bindings before returning", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding(
      "p1",
      "TEST_USER_PASSWORD",
      "MyVeryLongSecretPasswordXYZ123",
      "secret",
      "user-paste",
    )
    const handler = makeHandler({
      store,
      bashRun: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "curl error: pwd=MyVeryLongSecretPasswordXYZ123 failed",
      }),
    })
    const result = await handler(
      { binding_name: "QA_BIND_TOKEN" },
      { sessionID: "zmora-1" },
    )
    if (result.status === "recipe_failed") {
      expect(result.stderr_tail).not.toContain("MyVeryLongSecretPasswordXYZ123")
      expect(result.stderr_tail).toContain("[REDACTED:TEST_USER_PASSWORD]")
    }
  })

  it("scrubs the full stderr before truncating so secrets at the tail boundary do not leak", async () => {
    const store = new BindingsStore()
    // Recipe inputs (irrelevant to this test; given short safe values).
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "y", "secret", "user-paste")

    // Register an extra binding whose VALUE we want the scrubber to redact
    // from stderr. We deliberately pick a value that the scrubber's
    // partial-substring path will NOT match — long enough to exceed
    // PARTIAL_MIN_LEN but with entropy below ENTROPY_MIN — so the only
    // way to redact it is the EXACT-match path, which requires the full
    // value to appear in the input passed to scrubSecrets. This isolates
    // the bug: if truncation happens first, exact match fails on the
    // boundary-cut tail, and the suffix bytes leak.
    const bindingName = "PWD"
    const secret = "passwordpasswordpassword" // 24 chars, low entropy
    store.writeBinding("p1", bindingName, secret, "secret", "user-paste")
    const marker = `[REDACTED:${bindingName}]` // 14 chars

    // Build stderr so the ORIGINAL slice(-200) cuts the secret in half:
    //   [prefixPad]      <secret>      [trailingPad]
    //                       ^ boundary at index (total-200)
    //
    // Choose trailingPad so boundary lands strictly inside the secret
    // (200 - secret.length < trailingPad < 200), and so scrubbed total
    // (prefix + marker + trailing) ≤ 200 so the full marker survives the
    // final slice(-200).
    const trailingPad = 180
    const prefixPad = 6
    const stderr = "P".repeat(prefixPad) + secret + "T".repeat(trailingPad)

    // Sanity-check: with the OLD slice-then-scrub order, the naive tail
    // contains 20 chars of the secret (boundary cuts 4 chars off the
    // front). Exact-match fails (truncated secret), and partial-match is
    // skipped due to low entropy, so on the old code those bytes would
    // leak.
    const naiveTail = stderr.slice(-200)
    // Boundary at original index (total - 200) = secret offset
    // (total - 200 - prefixPad). leakedBytes is everything from there to
    // the end of the secret.
    const secretCutOffset = stderr.length - 200 - prefixPad
    const leakedBytes = secret.slice(secretCutOffset)
    expect(naiveTail.startsWith(leakedBytes)).toBe(true)
    expect(naiveTail).not.toContain(secret) // boundary really splits the secret

    const handler = makeHandler({
      store,
      bashRun: async () => ({ exitCode: 1, stdout: "", stderr }),
    })
    const result = await handler(
      { binding_name: "QA_BIND_TOKEN" },
      { sessionID: "zmora-1" },
    )
    expect(result.status).toBe("recipe_failed")
    if (result.status === "recipe_failed") {
      // The redaction marker survives into the tail.
      expect(result.stderr_tail).toContain(marker)
      // No raw secret bytes leak — neither the full secret nor the
      // boundary-cut suffix that would have leaked under the old order.
      expect(result.stderr_tail).not.toContain(secret)
      expect(result.stderr_tail).not.toContain(leakedBytes)
    }
  })
})

describe("execute_recipe handler — provisioning-consent gate", () => {
  function provisioningHandler(opts: { allow: boolean; ran: { value: boolean } }) {
    const store = new BindingsStore()
    // All recipe inputs ARE present — so a block is caused by the consent gate, never by need_info.
    store.writeBinding("p1", "ADMIN_URL", "http://127.0.0.1:54321", "plain", "user-paste")
    // The service key is a declared recipe input, so it stores with the same declaredInput
    // exemption record_input grants a plan-declared credential-prefixed name (else the
    // SUPABASE_ prefix denylist would reject it and mask the consent gate behind need_info).
    store.writeBinding("p1", "SUPABASE_SERVICE_KEY", "svc-role-key-value", "secret", "user-paste", { declaredInput: true })
    const state = new QaRunState()
    state.storePlan("p1", [provisioningBinding])
    if (opts.allow) state.setAllowProvisioning("p1", true)
    const handler = makeExecuteRecipeHandler({
      store,
      state,
      resolveParentID: async () => "p1",
      runBash: async () => {
        opts.ran.value = true
        return { exitCode: 0, stdout: "new-user-id", stderr: "" }
      },
      processEnv: {},
    })
    return { handler, store }
  }

  it("refuses a provisioning recipe without allow_provisioning consent — the account is never created", async () => {
    const ran = { value: false }
    const { handler, store } = provisioningHandler({ allow: false, ran })
    const result = await handler({ binding_name: "QA_BIND_USER_A" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("provisioning_blocked")
    if (result.status === "provisioning_blocked") {
      expect(result.reason).toMatch(/allow_provisioning/)
      expect(result.reason).toContain("QA_BIND_USER_A")
    }
    // The recipe never ran and no principal was minted — consent is a hard precondition.
    expect(ran.value).toBe(false)
    expect(store.getBinding("p1", "QA_BIND_USER_A")).toBeUndefined()
  })

  it("blocks BEFORE input resolution: missing inputs + no consent still returns provisioning_blocked, not need_info", async () => {
    // No inputs bound at all. A gate placed AFTER input resolution would surface need_info and
    // leak that the provisioning recipe is otherwise ready-to-run; the gate must fire first.
    const state = new QaRunState()
    state.storePlan("p1", [provisioningBinding])
    let ran = false
    const handler = makeExecuteRecipeHandler({
      store: new BindingsStore(),
      state,
      resolveParentID: async () => "p1",
      runBash: async () => {
        ran = true
        return { exitCode: 0, stdout: "x", stderr: "" }
      },
      processEnv: {},
    })
    const result = await handler({ binding_name: "QA_BIND_USER_A" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("provisioning_blocked")
    expect(ran).toBe(false)
  })

  it("runs the provisioning recipe once allow_provisioning consent is recorded", async () => {
    const ran = { value: false }
    const { handler, store } = provisioningHandler({ allow: true, ran })
    const result = await handler({ binding_name: "QA_BIND_USER_A" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("ok")
    expect(ran.value).toBe(true)
    // The sanctioned path mints the principal id the recipe returned.
    expect(store.getBinding("p1", "QA_BIND_USER_A")?.value.unwrap()).toBe("new-user-id")
  })

  it("a NON-provisioning recipe (provisions:null) is unaffected by the default-false consent", async () => {
    // The gate must not over-reach: an ordinary token-minting recipe runs with no consent.
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "a@b.com", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "pw", "secret", "user-paste")
    const state = new QaRunState()
    state.storePlan("p1", [tokenBinding]) // provisions: null, no consent set
    const handler = makeExecuteRecipeHandler({
      store,
      state,
      resolveParentID: async () => "p1",
      runBash: async () => ({ exitCode: 0, stdout: "TOKEN_VALUE", stderr: "" }),
      processEnv: {},
    })
    const result = await handler({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("ok")
  })
})
