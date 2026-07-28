export interface CreatePullRequestInput {
  cwd: string
  head: string
  base: string
  title: string
  body: string
  draft: boolean
}

export interface PrProvider {
  name: string
  createPullRequest(input: CreatePullRequestInput): Promise<{ url: string }>
}

/**
 * Pure origin-URL parsing (spec §5.4) — no I/O, no trimming (the FR-5 caller
 * trims runner stdout before calling this). Exactly three anchored shapes;
 * anything else (GHE hosts, gitlab, http, file://, local paths) → undefined.
 */
const URL_SHAPES: readonly RegExp[] = [
  /^git@([^:/]+):[^/]+\/[^/]+?(?:\.git)?$/i, // scp-like SSH
  /^ssh:\/\/git@([^:/]+)(?::\d+)?\/[^/]+\/[^/]+?(?:\.git)?$/i, // SSH URL
  /^https:\/\/([^:/]+)\/[^/]+\/[^/]+?(?:\.git)?$/i, // HTTPS
]

export function detectProvider(originUrl: string): "github" | undefined {
  // Reject URLs with whitespace (including trailing newlines); caller must trim
  if (/\s/.test(originUrl)) return undefined

  for (const shape of URL_SHAPES) {
    const host = shape.exec(originUrl)?.[1]
    if (host?.toLowerCase() === "github.com") return "github"
  }
  return undefined
}
