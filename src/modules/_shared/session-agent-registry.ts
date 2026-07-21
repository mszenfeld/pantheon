/**
 * Cross-module registry mapping `childSessionID → agent name`.
 *
 * Owned by the `_shared` layer so both the coordinator (`dispatch_parallel`,
 * which writes entries on task start) and feature modules like QA (whose
 * `shell.env` hook reads entries to resolve agent identity for a given
 * session) can depend on it without inverting the module layering.
 *
 * Registration persists for the OpenCode session lifetime. Cleanup is the
 * responsibility of the plugin that consumes the registry (typically via a
 * `session.deleted` handler) — `dispatch_parallel` does NOT unregister.
 */
export class SessionAgentRegistry {
  readonly #map = new Map<string, string>()
  readonly #metadata = new Map<string, { headless?: boolean }>()

  register(sessionID: string, agent: string): void {
    this.registerWithMetadata(sessionID, agent, {})
  }

  registerWithMetadata(
    sessionID: string,
    agent: string,
    metadata: { headless?: boolean },
  ): void {
    this.#map.set(sessionID, agent)
    this.#metadata.set(sessionID, metadata)
  }

  unregister(sessionID: string): void {
    this.#map.delete(sessionID)
    this.#metadata.delete(sessionID)
  }

  lookupMetadata(sessionID: string): { headless?: boolean } | undefined {
    return this.#metadata.get(sessionID)
  }

  lookup(sessionID: string): string | undefined {
    return this.#map.get(sessionID)
  }
}
