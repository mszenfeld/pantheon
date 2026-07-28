import { describe, expect, it } from "vitest"

import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import {
  classifyManifest,
  parseNulDelimitedPaths,
  parseManifest,
  validateAndClassify,
  type FeatureManifest,
  type GitRunner,
} from "../../../src/modules/coordinator/feature-manifest.js"

function manifest(overrides: Partial<FeatureManifest> = {}): FeatureManifest {
  return {
    files_changed: ["src/example.ts"],
    modules_affected: ["example"],
    new_surface_types: [],
    risk_flags: [],
    estimated_complexity: "mechanical",
    ...overrides,
  }
}

function triglavResult(value: FeatureManifest): string {
  return [
    "<results>",
    "CHANGE_MANIFEST_V1:",
    "```json",
    JSON.stringify({ manifest: value }),
    "```",
    "</results>",
  ].join("\n")
}

function gitRunner(files: string[]): GitRunner {
  return {
    async revParse(ref: string): Promise<string> {
      return ref === "origin/HEAD" ? "origin/main" : ref
    },
    async mergeBase(base: string, head: string): Promise<string> {
      return `${base}:${head}`
    },
    async diffNameOnly(base: string): Promise<string[]> {
      expect(base).toBe("origin/main:HEAD")
      return files
    },
  }
}


function toolContext(agent: string): {
  agent: string
  sessionID: string
  messageID: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata: () => void
  ask: () => Promise<void>
} {
  return {
    agent,
    sessionID: "perun-session",
    messageID: "message-1",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: (): void => undefined,
    ask: async (): Promise<void> => undefined,
  }
}

describe("feature manifest parsing", () => {
  it("parses NUL-delimited filenames split across streamed chunks", () => {
    expect(
      parseNulDelimitedPaths([
        Buffer.from("src/a.ts\0src/modules/_sh"),
        Buffer.from("ared/session-identity.ts\0"),
      ]),
    ).toEqual(["src/a.ts", "src/modules/_shared/session-identity.ts"])
  })

  it("extracts the wrapped JSON manifest after the stable marker", () => {
    const expected = manifest()

    expect(parseManifest(triglavResult(expected))).toEqual(expected)
  })

  it("rejects markerless, malformed, and unwrapped manifests", () => {
    expect(parseManifest("```json\n{}\n```")) .toBeUndefined()
    expect(parseManifest("CHANGE_MANIFEST_V1:\n```json\n{\n```")) .toBeUndefined()
    expect(parseManifest("CHANGE_MANIFEST_V1:\n```json\n{}\n```")) .toBeUndefined()
  })
})

describe("classifyManifest", () => {
  it("routes a matched mechanical manifest with one or two files to Stribog", () => {
    const value = manifest({ files_changed: ["src/a.ts", "src/b.ts"] })

    expect(classifyManifest(value, ["src/b.ts", "src/a.ts"])).toBe("stribog")
  })

  it("routes a matched simple manifest to Svarog", () => {
    const value = manifest({
      files_changed: ["src/a.ts", "src/b.ts", "src/c.ts"],
      modules_affected: ["a", "b"],
      estimated_complexity: "simple",
    })

    expect(classifyManifest(value, value.files_changed)).toBe("svarog")
  })

  it("fails closed for risks, new surfaces, sensitive paths, malformed values, or mismatched files", () => {
    expect(
      classifyManifest(manifest({ risk_flags: ["agent_contract"] }), ["src/example.ts"]),
    ).toBe("veles")
    expect(
      classifyManifest(manifest({ new_surface_types: ["cli"] }), ["src/example.ts"]),
    ).toBe("veles")
    expect(
      classifyManifest(manifest({ files_changed: ["src/agents/perun.md"] }), ["src/agents/perun.md"]),
    ).toBe("veles")
    expect(
      classifyManifest(
        manifest({ risk_flags: ["unknown"] }),
        ["src/example.ts"],
      ),
    ).toBe("veles")
    expect(classifyManifest(manifest(), ["src/other.ts"])).toBe("veles")
  })

  it.each([
    "src/modules/_shared/session-identity.ts",
    "src/modules/stribog/index.ts",
    "src/modules/svarog/index.ts",
    "packages/skill-utils/src/session-identity.ts",
    "packages/skill-utils/src/coordinator-bash-policy.ts",
  ])("routes sensitive control path %s to Veles", (file: string): void => {
    expect(classifyManifest(manifest({ files_changed: [file] }), [file])).toBe("veles")
  })
})

describe("validateAndClassify", () => {
  it("uses the trusted git diff instead of a caller-provided file list", async () => {
    const result = await validateAndClassify(triglavResult(manifest()), {
      gitRunner: gitRunner(["src/example.ts"]),
      base: "origin/main",
    })

    expect(result).toEqual({
      executor: "stribog",
      reason: "mechanical manifest matches the trusted git diff",
    })
  })

  it("routes user-requested planning, empty diffs, malformed manifests, and git errors to Veles", async () => {
    await expect(
      validateAndClassify(triglavResult(manifest()), {
        gitRunner: gitRunner(["src/example.ts"]),
        userRequestedPlanning: true,
      }),
    ).resolves.toMatchObject({ executor: "veles" })

    await expect(
      validateAndClassify(triglavResult(manifest()), { gitRunner: gitRunner([]) }),
    ).resolves.toMatchObject({ executor: "veles" })

    await expect(
      validateAndClassify("no manifest", { gitRunner: gitRunner(["src/example.ts"]) }),
    ).resolves.toMatchObject({ executor: "veles" })

    const failingRunner: GitRunner = {
      async revParse(_ref: string): Promise<string> {
        throw new Error("git unavailable")
      },
      async mergeBase(_base: string, _head: string): Promise<string> {
        throw new Error("unreachable")
      },
      async diffNameOnly(_base: string): Promise<string[]> {
        throw new Error("unreachable")
      },
    }
    await expect(
      validateAndClassify(triglavResult(manifest()), { gitRunner: failingRunner }),
    ).resolves.toMatchObject({ executor: "veles" })
  })
})

describe("classify_feature_manifest tool", () => {
  it("uses its injected Git runner and denies non-coordinator callers", async () => {
    const hooks = await AppVerkCoordinatorPlugin({
      client: {},
      featureManifestGitRunner: gitRunner(["src/example.ts"]),
    } as never)
    const classifyTool = hooks.tool?.classify_feature_manifest
    if (classifyTool === undefined) throw new Error("feature manifest tool not registered")

    const authorized = await classifyTool.execute(
      { result: triglavResult(manifest()), base: "origin/main" },
      toolContext(COORDINATOR_AGENT),
    )
    const authorizedOutput = typeof authorized === "string" ? authorized : authorized.output
    expect(JSON.parse(authorizedOutput)).toEqual({
      executor: "stribog",
      reason: "mechanical manifest matches the trusted git diff",
    })

    const forbidden = await classifyTool.execute(
      { result: triglavResult(manifest()) },
      toolContext("Veles - Planner"),
    )
    const forbiddenOutput = typeof forbidden === "string" ? forbidden : forbidden.output
    expect(JSON.parse(forbiddenOutput)).toMatchObject({ status: "forbidden" })
  })
})
