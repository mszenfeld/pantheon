import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import type { Hooks } from "@opencode-ai/plugin"

const rootDirectory = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
)
const packageJsonPath = path.join(rootDirectory, "package.json")

function readRootPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    main: string
    types?: string
    files?: string[]
    dependencies?: Record<string, string>
  }
}

async function loadRootModule() {
  const packageJson = readRootPackageJson()
  const entrypointPath = path.resolve(rootDirectory, packageJson.main)

  expect(existsSync(entrypointPath)).toBe(true)

  return import(pathToFileURL(entrypointPath).href)
}

function deriveExpectedFilesFromPackageJson(
  packageJson: { files?: string[] },
  rootDir: string,
): string[] {
  const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"])
  const SKIP_EXTENSIONS = [".tsbuildinfo"]
  const isSkippable = (name: string): boolean =>
    name.startsWith(".") ||
    SKIP_FILES.has(name) ||
    SKIP_EXTENSIONS.some((ext) => name.endsWith(ext))

  const entries = packageJson.files ?? []
  const result: string[] = []

  for (const entry of entries) {
    // Assumption (verified): mszenfeld package.json `files` has no glob patterns
    if (entry.includes("*")) {
      throw new Error(`Glob in files array not supported: ${entry}`)
    }
    const absPath = path.join(rootDir, entry)
    if (!existsSync(absPath)) {
      throw new Error(`File or directory not found: ${absPath}`)
    }
    const stat = statSync(absPath)
    if (stat.isFile()) {
      const basename = path.basename(entry)
      if (!isSkippable(basename)) result.push(entry)
      continue
    }
    // Directory — recurse
    const dirEntries = readdirSync(absPath, {
      recursive: true,
      withFileTypes: true,
    })
    for (const dirent of dirEntries) {
      if (dirent.isDirectory()) continue
      if (isSkippable(dirent.name)) continue
      const relativePath = path.relative(
        absPath,
        path.join(dirent.parentPath, dirent.name),
      )
      result.push(
        path.posix.join(entry, relativePath.split(path.sep).join("/")),
      )
    }
  }

  return result
}

type ShellEnvHook = NonNullable<Hooks["shell.env"]>
type ChatHeadersHook = NonNullable<Hooks["chat.headers"]>

describe("AppVerkPlugins", () => {
  it("loads through the package main entrypoint and registers the commit command", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      command?: Record<string, { description?: string; template: string }>
    }

    await plugin.config?.(config as never)

    expect(config.command?.commit?.description).toBe(
      "Create a git commit with the AppVerk commit workflow",
    )
    expect(config.command?.commit?.template).toContain("## Context")
    expect(config.command?.commit?.template).toContain(
      "Use the `av_commit` tool",
    )
    expect(plugin.tool?.av_commit).toBeDefined()
  })

  it("registers the /swift command and swift-developer agent", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      command?: Record<
        string,
        { description?: string; template: string; agent?: string }
      >
      agent?: Record<
        string,
        { description?: string; prompt: string; mode?: string }
      >
    }

    await plugin.config?.(config as never)

    expect(config.command?.swift?.description).toContain("Swift")
    expect(config.command?.swift?.agent).toBe("swift-developer")
    expect(config.agent?.["swift-developer"]?.description).toContain("Swift")
    expect(config.agent?.["swift-developer"]?.mode).toBe("primary")
    expect(plugin.tool?.load_appverk_skill).toBeDefined()
  })

  it("registers Perun coordinator agent and coordinator tools", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      agent?: Record<
        string,
        { description?: string; prompt: string; mode?: string }
      >
    }

    await plugin.config?.(config as never)

    const perun = config.agent?.["Perun - Coordinator"]
    expect(perun?.description).toContain("Delegates work to specialists")
    expect(perun?.mode).toBe("primary")
    expect(perun?.prompt).toContain("Perun")
    expect(plugin.tool?.dispatch_parallel).toBeDefined()
    expect(plugin.tool?.assign_issue_ids).toBeDefined()
  })

  it("registers the /frontend command and frontend-developer agent", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      command?: Record<
        string,
        { description?: string; template: string; agent?: string }
      >
      agent?: Record<
        string,
        { description?: string; prompt: string; mode?: string }
      >
    }

    await plugin.config?.(config as never)

    expect(config.command?.frontend?.description).toContain("TypeScript")
    expect(config.command?.frontend?.agent).toBe("frontend-developer")
    expect(config.agent?.["frontend-developer"]?.description).toContain(
      "TypeScript",
    )
    expect(config.agent?.["frontend-developer"]?.mode).toBe("primary")
    expect(plugin.tool?.load_appverk_skill).toBeDefined()
  })

  it("packages a self-contained git-install surface", () => {
    const packageJson = readRootPackageJson()

    expect(packageJson.dependencies).toMatchObject({
      "@opencode-ai/plugin": expect.any(String),
    })
    expect(packageJson.dependencies).not.toHaveProperty(
      "@appverk/opencode-commit",
    )
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist"]))

    const tmpDir = mkdtempSync(path.join(tmpdir(), "bun-pack-"))
    try {
      // Resolve the tarball name deterministically from bun's own output rather
      // than scanning the temp dir for the first *.tgz. `--quiet` prints the
      // created tarball path on stdout (with a leading newline), so trim + basename.
      const packOutput = execFileSync(
        "bun",
        ["pm", "pack", "--quiet", "--destination", tmpDir],
        { cwd: rootDirectory, encoding: "utf8" },
      ).trim()
      const tarballPath = path.join(tmpDir, path.basename(packOutput))

      // Assumption (deliberate): this test requires a system `tar` on PATH to
      // list the tarball contents. macOS/Linux CI ship `tar`; minimal containers
      // or bare Windows may lack it (or provide a bsdtar variant). This is a
      // conscious environmental assumption — in-process tarball parsing is out
      // of scope for this LOW-severity robustness item.
      const packedFiles = execFileSync("tar", ["-tzf", tarballPath], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .map((entry) => entry.replace(/^package\//, ""))
        .filter((entry) => entry.length > 0)

      // Top-level contract assertion: catches both over-inclusion (a stray file
      // such as a .map, source, or secret silently riding along) and a whole
      // path dropping out of `files[]` (which the subset check below cannot see,
      // since removing a path shrinks both the expected and packed sets in
      // lockstep). package.json and README.md are always packed by bun
      // regardless of `files[]`. Verified empirically via `bun pm pack` +
      // `tar -tzf` against this repo.
      const topLevel = new Set(packedFiles.map((entry) => entry.split("/")[0]))
      expect(topLevel).toEqual(
        new Set(["package.json", "README.md", "dist", "scripts", "packages"]),
      )

      // Fine-grained check: derive expected files from package.json `files` so
      // any new path added to `files` is auto-asserted without test maintenance.
      const expectedFiles = deriveExpectedFilesFromPackageJson(
        packageJson,
        rootDirectory,
      )
      expect(packedFiles).toEqual(expect.arrayContaining(expectedFiles))

      // Regression guard (H4): the shipped artifact must carry a resolvable
      // `@appverk/opencode-skill-utils` package, not just its `dist/`. The
      // root-dist modules (stribog, coordinator-policy) and skill-registry
      // import it by bare specifier under `bundle: false`, so the tarball must
      // ship `packages/skill-utils/package.json` (its name + exports manifest)
      // alongside the `dist/`. Asserting the manifest is packed catches a
      // `files[]` regression that would otherwise only surface as a runtime
      // `Cannot find module` on a fresh install.
      expect(packedFiles).toContain("packages/skill-utils/package.json")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("installs the packed tarball and loads the entrypoint with all skill-utils consumers", () => {
    // End-to-end packaging proof (H4): rather than only listing the tarball,
    // this extracts it, runs a real `bun install` (which links the declared
    // `@appverk/opencode-skill-utils` dependency from the shipped subdir), then
    // `import()`s the entrypoint and runs its `config` hook in a child process.
    // That hook instantiates stribog, coordinator-policy, and skill-registry —
    // the three modules that import skill-utils by bare specifier — so an
    // unresolvable specifier surfaces as a thrown `Cannot find module` here
    // instead of silently at runtime on a real install.
    const tmpDir = mkdtempSync(path.join(tmpdir(), "bun-install-"))
    try {
      const packOutput = execFileSync(
        "bun",
        ["pm", "pack", "--quiet", "--destination", tmpDir],
        { cwd: rootDirectory, encoding: "utf8" },
      ).trim()
      const tarballPath = path.join(tmpDir, path.basename(packOutput))

      // Extract the tarball into a clean directory (strips the leading
      // `package/` path component that npm/bun tarballs use).
      const extractDir = path.join(tmpDir, "extracted")
      mkdirSync(extractDir, { recursive: true })
      execFileSync(
        "tar",
        ["-xzf", tarballPath, "-C", extractDir, "--strip-components=1"],
        {
          encoding: "utf8",
        },
      )

      // Install the extracted package's own dependencies. This must link
      // `@appverk/opencode-skill-utils` from the shipped `packages/skill-utils`
      // subdir (the root manifest declares it `workspace:*`, which bun rewrites
      // to a concrete version on pack, resolved here against the shipped
      // package's own `package.json`). Without the declaration + shipped
      // manifest, install leaves the bare specifier unresolvable and the import
      // below throws. `--ignore-scripts` skips the `preinstall` package-manager
      // guard (explicitly "not a security control") — we only need dependency
      // linking, not the dev-ergonomics hint.
      execFileSync("bun", ["install", "--no-save", "--ignore-scripts"], {
        cwd: extractDir,
        encoding: "utf8",
      })

      // Import + run the config hook in a child process so module resolution
      // happens from the INSTALLED package root, not this repo's node_modules.
      const probe = [
        "const { AppVerkPlugins } = await import('./dist/index.js');",
        "const plugin = await AppVerkPlugins({});",
        "const config = {};",
        "await plugin.config?.(config);",
        // Touch outputs that only exist if the skill-utils consumers loaded:
        // skill-registry registers load_appverk_skill; coordinator-policy +
        // stribog register their hooks via the same plugin graph.
        "if (!plugin.tool?.load_appverk_skill) throw new Error('skill-registry tool missing');",
        "if (typeof plugin['tool.execute.before'] !== 'function') throw new Error('bash gate missing');",
        "if (!config.agent?.['Perun - Coordinator']) throw new Error('coordinator agent missing');",
        "console.log('OK');",
      ].join("\n")

      const result = execFileSync("bun", ["-e", probe], {
        cwd: extractDir,
        encoding: "utf8",
      }).trim()

      expect(result).toContain("OK")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
    // E2E: packs + extracts + `bun install` + a child `bun -e` import (4 spawned
    // processes). It runs ~1.5s in isolation but brushes the 5s unit-test default
    // under parallel suite load — give it generous headroom so it never flakes
    // the suite (a spurious timeout here would corrupt any run gated on a green suite).
  }, 60_000)

  it("registers the Pantheon session-notification event hook", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    expect(typeof plugin.event).toBe("function")
    // Smoke: feed a synthetic event; must not throw.
    const eventHandler = plugin.event
    if (typeof eventHandler !== "function")
      throw new Error("expected event handler")
    await expect(
      eventHandler({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses_unknown" },
        },
      } as never),
    ).resolves.toBeUndefined()
  })

  it("injects skill activation rules via system prompt transform", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)

    // A resolvable, non-coordinator session: the transform fails closed on a
    // missing sessionID (coordinator-suppression guard), so supply one. With the
    // bare client used here getSessionAgent resolves to undefined (not the
    // coordinator), so the activation rules are injected.
    const output = { system: [] as string[] }
    await plugin["experimental.chat.system.transform"]?.(
      { sessionID: "ses_specialist", model: {} as never } as never,
      output as never,
    )

    expect(output.system.length).toBeGreaterThan(0)
    expect(output.system[0]).toContain("AppVerk Skills")
    expect(output.system[0]).toContain("load_appverk_skill")
  })

  it("preserves commit bash protections through the aggregated hook", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)

    await expect(
      plugin["tool.execute.before"]?.(
        {
          tool: "bash",
          args: { command: 'git commit -m "feat: bypass"' },
        } as never,
        { args: { command: 'git commit -m "feat: bypass"' } } as never,
      ),
    ).rejects.toThrow(/use \/commit/i)
  })

  it("hides native build/plan and pre-existing user agents, keeps registered agents", async () => {
    const { createAppVerkPlugins } = await loadRootModule()
    const plugin = createAppVerkPlugins([
      async () => ({
        config: async (config: { agent?: Record<string, unknown> }) => {
          config.agent ??= {}
          config.agent["Perun - Coordinator"] = { mode: "primary" }
        },
      }),
    ])
    const hooks = await plugin({} as never)
    const config = {
      agent: {
        build: { mode: "primary" },
        plan: { mode: "primary" },
        "user-agent": { mode: "primary" },
      },
    } as never

    await hooks.config?.(config)

    const agent = (
      config as { agent: Record<string, { mode?: string; hidden?: boolean }> }
    ).agent
    expect(agent.build!.hidden).toBe(true)
    expect(agent.plan!.hidden).toBe(true)
    expect(agent["user-agent"]!.hidden).toBe(true)
    expect(agent["Perun - Coordinator"]!.hidden).toBeUndefined()
    expect(agent["Perun - Coordinator"]!.mode).toBe("primary")
    expect((config as { default_agent?: string }).default_agent).toBe(
      "Perun - Coordinator",
    )
  })

  it("survives a second invocation on the same config (does not hide its own agents)", async () => {
    const { createAppVerkPlugins } = await loadRootModule()
    const plugin = createAppVerkPlugins([
      async () => ({
        config: async (config: { agent?: Record<string, unknown> }) => {
          config.agent ??= {}
          config.agent["Perun - Coordinator"] = { mode: "primary" }
        },
      }),
    ])
    const hooks = await plugin({} as never)
    const config = { agent: { build: { mode: "primary" } } } as never

    await hooks.config?.(config)
    await hooks.config?.(config) // second pass on the SAME object

    const agent = (config as { agent: Record<string, { hidden?: boolean }> })
      .agent
    expect(agent["Perun - Coordinator"]!.hidden).toBeUndefined()
    expect(agent.build!.hidden).toBe(true)
  })

  it("sets default_agent to Perun when the user has not set one", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as never

    await plugin.config?.(config)

    expect((config as { default_agent?: string }).default_agent).toBe(
      "Perun - Coordinator",
    )
  })

  it("respects a user-provided default_agent that resolves to a visible primary", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    // frontend-developer is registered as mode:"primary" by AppVerkFrontendDeveloperPlugin,
    // so it stays a visible primary through the full stack and the coordinator's "don't
    // overwrite" guard preserves it. If that agent is renamed/removed, update this value.
    const config = { default_agent: "frontend-developer" } as never

    await plugin.config?.(config)

    expect((config as { default_agent?: string }).default_agent).toBe(
      "frontend-developer",
    )
  })

  it("composes non-tool hook keys generically", async () => {
    const { createAppVerkPlugins } = await loadRootModule()
    const plugin = createAppVerkPlugins([
      async () => ({
        "shell.env": async (
          _input: Parameters<ShellEnvHook>[0],
          output: Parameters<ShellEnvHook>[1],
        ) => {
          output.env.FIRST = "1"
        },
      }),
      async () => ({
        "shell.env": async (
          _input: Parameters<ShellEnvHook>[0],
          output: Parameters<ShellEnvHook>[1],
        ) => {
          output.env.SECOND = "2"
        },
        "chat.headers": async (
          _input: Parameters<ChatHeadersHook>[0],
          output: Parameters<ChatHeadersHook>[1],
        ) => {
          output.headers.authorization = "Bearer test"
        },
      }),
    ])

    const hooks = await plugin({} as never)
    const envOutput = { env: {} as Record<string, string> }
    const headersOutput = { headers: {} as Record<string, string> }

    await hooks["shell.env"]?.(
      { cwd: rootDirectory } as never,
      envOutput as never,
    )
    await hooks["chat.headers"]?.(
      {
        sessionID: "session",
        agent: "agent",
        model: {} as never,
        provider: {} as never,
        message: {} as never,
      } as never,
      headersOutput as never,
    )

    expect(envOutput.env).toEqual({ FIRST: "1", SECOND: "2" })
    expect(headersOutput.headers).toEqual({ authorization: "Bearer test" })
  })
})
