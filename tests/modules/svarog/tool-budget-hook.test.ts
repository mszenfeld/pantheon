import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { makeSvarogToolHook } from "../../../src/modules/svarog/tool-budget-hook.js"
import { SVAROG_AGENT_KEY } from "../../../src/modules/svarog/svarog.metadata.js"

const svarogHook = () =>
  makeSvarogToolHook({ resolveAgent: async () => SVAROG_AGENT_KEY }).hook
const input = (tool: string) => ({ tool, sessionID: "s1", callID: "c" })
const noArgs = { args: {} }

async function denies(tool: string, marker = "SVAROG_TOOL_DENIED") {
  await expect(svarogHook()(input(tool), noArgs)).rejects.toThrow(marker)
}
async function allows(tool: string, output: { args: object } = noArgs) {
  await expect(svarogHook()(input(tool), output)).resolves.toBeUndefined()
}

describe("makeSvarogToolHook", () => {
  it("allows the multi-file editors (no budget) and serena editors", async () => {
    await allows("edit", { args: { filePath: "/a" } })
    await allows("write", { args: { filePath: "/b" } })
    await allows("multiedit", { args: { filePath: "/c" } })
    for (const p of ["/1", "/2", "/3", "/4", "/5"])
      await allows("edit", { args: { filePath: p } })
    // all 8 serena editors must pass the carve-out BEFORE the reused isImmutableDeny floor
    await allows("serena_rename_symbol")
    await allows("serena_safe_delete_symbol")
    await allows("serena_replace_symbol_body")
    await allows("serena_replace_content")
    await allows("serena_create_text_file")
    await allows("serena_insert_after_symbol")
    await allows("serena_insert_before_symbol")
    await allows("serena_replace_regex")
  })

  it("allows reads, diagnostics, and skill loading", async () => {
    await allows("read")
    await allows("glob")
    await allows("serena_get_diagnostics_for_file")
    await allows("skill")
    await allows("load_appverk_skill")
  })

  it("denies the headless `question` tool (ESCALATE, never ask)", async () => {
    await denies("question")
  })

  it("denies network egress (webfetch/websearch) but KEEPS todowrite", async () => {
    await denies("webfetch")
    await denies("websearch")
    await denies("WebFetch") // normalized match (lowercased) — casing must not bypass
    // todowrite is a planning aid Svarog's heavy multi-step work uses — NOT denied (unlike Stribog)
    await allows("todowrite")
  })

  it("denies the immutable floor: dispatch / recipe / shell / DB-mutation / memory-write", async () => {
    await denies("task")
    await denies("dispatch_parallel")
    await denies("execute_recipe")
    await denies("serena_execute_shell_command")
    await denies("serena_write_memory")
    await denies("serena_delete_memory")
    await denies("supabase_delete_rows")
    await denies("db_drop_table")
  })

  it("denies secret GENERATION via bash (minter != actuator)", async () => {
    await expect(
      svarogHook()(input("bash"), {
        args: { command: "openssl rand -hex 32" },
      }),
    ).rejects.toThrow("SVAROG_SECRET_DENIED")
    await expect(
      svarogHook()(input("bash"), {
        args: { command: 'node -e "crypto.randomBytes(32)"' },
      }),
    ).rejects.toThrow("SVAROG_SECRET_DENIED")
  })

  it("allows ordinary bash", async () => {
    await allows("bash", { args: { command: "bun run test" } })
  })

  it("denies tree/branch-mutating git via bash; allows read-only git", async () => {
    for (const cmd of [
      "git checkout feature/global-skills", // the eval-incident command
      "git reset --hard HEAD",
      "git switch main",
      "git -C /repo worktree add /tmp/wt HEAD",
      "git branch -D stale",
    ]) {
      await expect(
        svarogHook()(input("bash"), { args: { command: cmd } }),
      ).rejects.toThrow("SVAROG_GIT_DENIED")
    }
    // The denial redirects branch creation to the sanctioned tool instead of ESCALATE
    // (message-only guidance; the deny decision itself is unchanged).
    const branchDenial = await svarogHook()(input("bash"), {
      args: { command: "git checkout -b feature/x" },
    }).catch((error: Error) => error.message)
    expect(branchDenial).toMatch(/use the create_branch tool/)
    expect(branchDenial).toMatch(/do NOT ESCALATE for branch creation/)
    // read-only git stays allowed — an executor legitimately inspects state.
    await allows("bash", { args: { command: "git status" } })
    await allows("bash", {
      args: { command: "git --no-pager log --oneline -5" },
    })
    await allows("bash", { args: { command: "git diff --stat" } })
  })

  it("creates a recovery checkpoint once, before the first mutating tool", async () => {
    const created: string[] = []
    const { hook } = makeSvarogToolHook({
      resolveAgent: async () => SVAROG_AGENT_KEY,
      createCheckpoint: (s) => created.push(s),
    })
    await hook(input("read"), noArgs) // read -> no checkpoint
    expect(created).toEqual([])
    await hook(input("edit"), { args: { filePath: "/a" } }) // first mutating -> checkpoint
    await hook(input("write"), { args: { filePath: "/b" } }) // -> no new checkpoint
    await hook(input("serena_replace_content"), noArgs) // serena editor -> no new checkpoint
    expect(created).toEqual(["s1"])
  })

  it("triggers the checkpoint on apply_patch / patch (opencode native patch tools)", async () => {
    // Regression: GPT-class models edit almost exclusively via `apply_patch`, which was
    // absent from MUTATING_NATIVE — so the recovery checkpoint never fired for them. The
    // match is normalised, so casing/dash variants count too.
    for (const tool of ["apply_patch", "patch", "Apply-Patch"]) {
      const created: string[] = []
      const { hook } = makeSvarogToolHook({
        resolveAgent: async () => SVAROG_AGENT_KEY,
        createCheckpoint: (s) => created.push(s),
      })
      await hook(input(tool), { args: { filePath: "/a" } })
      expect(created).toEqual(["s1"])
    }
  })

  it("retries the checkpoint on the next mutating tool when the first attempt fails", async () => {
    let attempts = 0
    const { hook } = makeSvarogToolHook({
      resolveAgent: async () => SVAROG_AGENT_KEY,
      createCheckpoint: () => {
        attempts += 1
        if (attempts === 1)
          throw new Error("born-HEAD: commit-tree -p HEAD failed")
      },
    })
    // first mutating tool: checkpoint throws (swallowed) -> session NOT latched, edit still allowed
    await expect(
      hook(input("edit"), { args: { filePath: "/a" } }),
    ).resolves.toBeUndefined()
    // next mutating tool retries and succeeds; a third no longer attempts (now latched)
    await hook(input("write"), { args: { filePath: "/b" } })
    await hook(input("multiedit"), { args: { filePath: "/c" } })
    expect(attempts).toBe(2)
  })

  it("fails OPEN for a non-svarog / unresolved session", async () => {
    const other = makeSvarogToolHook({
      resolveAgent: async () => "zmora-setup",
    }).hook
    await expect(
      other(input("execute_recipe"), noArgs),
    ).resolves.toBeUndefined()
    const unknown = makeSvarogToolHook({
      resolveAgent: async () => undefined,
    }).hook
    await expect(unknown(input("task"), noArgs)).resolves.toBeUndefined()
  })

  it("clearSession resets the per-session checkpoint flag", async () => {
    const created: string[] = []
    const { hook, clearSession } = makeSvarogToolHook({
      resolveAgent: async () => SVAROG_AGENT_KEY,
      createCheckpoint: (s) => created.push(s),
    })
    await hook(input("edit"), { args: { filePath: "/a" } }) // creates checkpoint
    expect(created).toHaveLength(1)
    clearSession("s1")
    await hook(input("edit"), { args: { filePath: "/b" } }) // checkpoints again
    expect(created).toHaveLength(2)
  })

  it("allows create_pr — the sanctioned publish path — past the immutable floor", async () => {
    await allows("create_pr")
    await allows("Create-PR") // case/hyphen normalization must not bypass the carve-out
    await denies("execute_recipe") // floor regression guard (AC-15)
  })

  it("allows create_branch — the sanctioned branch path — past the immutable floor", async () => {
    await allows("create_branch")
    await allows("Create-Branch") // normalization must not bypass the carve-out
    await denies("execute_recipe") // floor regression guard
  })

  it("refuses an av_commit naming a directory — it would stage everything beneath it", async () => {
    // Hermetic: a temp worktree, threaded in as the resolution base exactly as the plugin
    // wires it, so the guard stats the same paths av_commit would stage — no dependence on
    // the runner's cwd or on real repo directories.
    const root = await mkdtemp(path.join(tmpdir(), "av-svarog-scope-"))
    await mkdir(path.join(root, "pkg"), { recursive: true })
    await writeFile(path.join(root, "pkg", "a.ts"), "export {}\n")
    const scoped = makeSvarogToolHook({
      resolveAgent: async () => SVAROG_AGENT_KEY,
      worktree: root,
    }).hook

    try {
      // `git add -- pkg` stages every modified/untracked file under pkg/. Svarog has no edit
      // budget to compare against, so the directory check is its floor.
      for (const dir of ["pkg", "pkg/", "./pkg"]) {
        const message = await scoped(input("av_commit"), {
          args: { files: [dir] },
        })
          .then(() => "<allowed>")
          .catch((error: Error) => error.message)
        expect(message).toMatch(/^SVAROG_TOOL_DENIED/)
        expect(message).toMatch(/not a single existing file/)
        expect(message).toMatch(/Do NOT ESCALATE/)
      }
      // a real file in that worktree passes, in either spelling
      await expect(
        scoped(input("av_commit"), { args: { files: ["pkg/a.ts"] } }),
      ).resolves.toBeUndefined()
      await expect(
        scoped(input("av_commit"), {
          args: { files: [path.join(root, "pkg", "a.ts")] },
        }),
      ).resolves.toBeUndefined()
      // fail-closed: a path that does not resolve cannot be proven to be one file
      const missing = await scoped(input("av_commit"), {
        args: { files: ["pkg/nope.ts"] },
      })
        .then(() => "<allowed>")
        .catch((error: Error) => error.message)
      expect(missing).toMatch(/^SVAROG_TOOL_DENIED/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("allows av_commit — the sanctioned commit path (executor-chain doctrine, 2026-07-22)", async () => {
    // Svarog's hook is allow-by-default and av_commit is not floor-denied; this pin documents
    // the doctrine decision so a future floor/deny change cannot silently cut the chain's
    // commit link (create_branch → av_commit → create_pr). Hermetic temp worktree threaded in
    // as the resolution base, mirroring the directory-rejection test — no cwd dependence.
    const root = await mkdtemp(path.join(tmpdir(), "av-svarog-allow-"))
    await writeFile(path.join(root, "a.ts"), "export {}\n")
    const scoped = makeSvarogToolHook({
      resolveAgent: async () => SVAROG_AGENT_KEY,
      worktree: root,
    }).hook
    try {
      await expect(
        scoped(input("av_commit"), { args: { files: ["a.ts"] } }),
      ).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("refuses an unscoped av_commit — whole-tree staging is fail-closed", async () => {
    for (const args of [
      {},
      { files: [] },
      { files: ["  "] },
      { files: ["."] },
      { files: [":/"] },
      { files: ["**"] },
      { files: ["../outside.ts"] },
      { files: ["src/a.ts", "."] },
    ]) {
      const message = await svarogHook()(input("av_commit"), { args })
        .then(() => "<allowed>")
        .catch((error: Error) => error.message)
      expect(message).toMatch(/^SVAROG_TOOL_DENIED/)
      expect(message).toMatch(/explicit 'files' list/)
      expect(message).toMatch(/Do NOT ESCALATE/)
    }
  })
})
