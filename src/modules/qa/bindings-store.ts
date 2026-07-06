import { Secret } from "./secret.js"

export type BindingType = "secret" | "plain"
export type BindingSource = "minted-recipe" | "user-paste"

export interface BindingEntry {
  value: Secret
  type: BindingType
  source: BindingSource
  createdAt: number
}

export type WriteResult =
  | { status: "ok" }
  | { status: "updated" }
  | { status: "duplicate" }
  | { status: "immutable"; reason: string }
  | { status: "error"; reason: string }

export interface BindingSnapshot {
  readonly id: string
  readonly entries: ReadonlyMap<string, BindingEntry>
}

const QA_BIND_RE = /^QA_BIND_[A-Z][A-Z0-9_]*$/
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/

const PER_PARENT_CAP = 32
const GLOBAL_CAP = 256

/**
 * Process-control env names that are NEVER acceptable as binding names —
 * overriding any of these would compromise the host shell environment for
 * subsequent Zmora bash invocations.
 */
const NAME_DENYLIST = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "IFS",
  "PS4",
  "SHELLOPTS",
  "PROMPT_COMMAND",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
])

/**
 * Prefix denylist for `user-paste` bindings (CWE-15). A malicious
 * plan can ask the user to paste under a plausible name and exfil to
 * attacker-controlled egress, so we reject any name that begins with a
 * well-known credential / secret-manager / cloud-provider / database prefix.
 * Keep this list conservative: false positives are recoverable (user picks a
 * different name); false negatives leak credentials.
 */
const DENYLIST_PREFIXES = [
  // Cloud providers
  "AWS_",
  "GCP_",
  "AZURE_",
  // VCS / hosting
  "GIT_",
  "GH_",
  "GITHUB_",
  "GITLAB_",
  // LLM / agent platforms
  "ANTHROPIC_",
  "OPENAI_",
  "OPENCODE_",
  // Databases / data stores
  "DATABASE_",
  "REDIS_",
  "MONGO_",
  "POSTGRES_",
  // PaaS / BaaS
  "SUPABASE_",
  "FIREBASE_",
  "VERCEL_",
  // Secret managers
  "OP_",
  "VAULT_",
  "DOPPLER_",
  // Kubernetes (note: "KUBE" with no trailing _ catches KUBECONFIG)
  "K8S_",
  "KUBE",
]

/**
 * Process-control names corrupt the host shell environment for subsequent
 * recipe / Zmora bash invocations (overriding PATH hijacks binary resolution,
 * etc.). They are NEVER acceptable as a user-paste binding name — not even
 * when a plan declares them as a recipe input.
 */
function nameInProcessControlDenylist(name: string): boolean {
  return NAME_DENYLIST.has(name)
}

/**
 * Credential / cloud / secret-manager prefixes. Guards against a malicious
 * plan phishing the user into pasting a real credential under a plausible
 * name. Only applies to names that are NOT declared inputs of a binding the
 * user has already consented to — declared inputs are authorised by the plan
 * (the recipe's `Egress` is validated and shown at consent time), mirroring
 * the exemption that minted `QA_BIND_*` bindings already enjoy.
 */
function nameMatchesCredentialPrefix(name: string): boolean {
  for (const prefix of DENYLIST_PREFIXES) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

function valueIsValid(
  value: string,
): { ok: true } | { ok: false; reason: string } {
  if (value.length > 4096) {
    return { ok: false, reason: "value exceeds 4 KB size cap" }
  }
  // Forbid control bytes except a single trailing newline (which is trimmed
  // before storage). Tab (0x09), CR (0x0D), and LF (0x0A) anywhere else are
  // rejected as they can break header / JSON-payload framing.
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) {
      return {
        ok: false,
        reason: `value contains control byte 0x${c.toString(16).padStart(2, "0")} at position ${i}`,
      }
    }
  }
  return { ok: true }
}

export class BindingsStore {
  readonly #map = new Map<string, Map<string, BindingEntry>>()
  readonly #pinCounts = new Map<string, Map<string, number>>() // parentID → name → count
  readonly #snapshotIds = new Map<
    string,
    { parentID: string; names: string[] }
  >()
  #snapshotCounter = 0
  #globalCount = 0

  listForParent(parentID: string): ReadonlyMap<string, BindingEntry> {
    return this.#map.get(parentID) ?? new Map()
  }

  getBinding(parentID: string, name: string): BindingEntry | undefined {
    return this.#map.get(parentID)?.get(name)
  }

  pinSnapshot(parentID: string): BindingSnapshot {
    const live = this.#map.get(parentID) ?? new Map()
    const snapshotEntries = new Map(live)
    const id = `snap-${++this.#snapshotCounter}`

    let parentPinCounts = this.#pinCounts.get(parentID)
    if (parentPinCounts === undefined) {
      parentPinCounts = new Map()
      this.#pinCounts.set(parentID, parentPinCounts)
    }
    const names: string[] = []
    for (const name of snapshotEntries.keys()) {
      parentPinCounts.set(name, (parentPinCounts.get(name) ?? 0) + 1)
      names.push(name)
    }
    this.#snapshotIds.set(id, { parentID, names })
    return { id, entries: snapshotEntries }
  }

  releaseSnapshot(id: string): void {
    const record = this.#snapshotIds.get(id)
    if (record === undefined) return
    this.#snapshotIds.delete(id)
    const parentPinCounts = this.#pinCounts.get(record.parentID)
    if (parentPinCounts === undefined) return
    for (const name of record.names) {
      const c = parentPinCounts.get(name)
      if (c === undefined) continue
      if (c <= 1) {
        parentPinCounts.delete(name)
      } else {
        parentPinCounts.set(name, c - 1)
      }
    }
    if (parentPinCounts.size === 0) {
      this.#pinCounts.delete(record.parentID)
    }
  }

  isPinned(parentID: string, name: string): boolean {
    return (this.#pinCounts.get(parentID)?.get(name) ?? 0) > 0
  }

  writeBinding(
    parentID: string,
    name: string,
    value: string,
    type: BindingType,
    source: BindingSource,
    opts: { declaredInput?: boolean } = {},
  ): WriteResult {
    if (source === "minted-recipe") {
      if (!QA_BIND_RE.test(name)) {
        return {
          status: "error",
          reason: `minted bindings must match ^QA_BIND_[A-Z][A-Z0-9_]*$ (got '${name}')`,
        }
      }
    } else {
      if (!ENV_NAME_RE.test(name)) {
        return {
          status: "error",
          reason: `name must match ^[A-Z_][A-Z0-9_]*$ (got '${name}')`,
        }
      }
      if (nameInProcessControlDenylist(name)) {
        return {
          status: "error",
          reason: `name '${name}' is in the process-control denylist`,
        }
      }
      // The credential-prefix denylist is skipped only for names the plan
      // declares as a recipe input — those are authorised by the consented
      // plan and its validated egress.
      if (opts.declaredInput !== true && nameMatchesCredentialPrefix(name)) {
        return {
          status: "error",
          reason: `name '${name}' matches a credential-prefix denylist (declare it in the plan — as a binding Input or a Required environment variable — to use it)`,
        }
      }
    }

    const vCheck = valueIsValid(value)
    if (!vCheck.ok) {
      return { status: "error", reason: vCheck.reason }
    }

    const stored = value.endsWith("\n") ? value.slice(0, -1) : value
    let parentMap = this.#map.get(parentID)
    if (parentMap === undefined) {
      parentMap = new Map()
      this.#map.set(parentID, parentMap)
    }
    const existing = parentMap.get(name)
    if (existing !== undefined) {
      // A byte-identical re-write is a true idempotent no-op for ANY source.
      if (existing.value.unwrap() === stored) {
        return { status: "duplicate" }
      }
      // The value DIFFERS. A minted re-mint keeps the first value: QA_BIND_*
      // bindings are write-once and execute_recipe treats any non-error as ok.
      if (source === "minted-recipe") {
        return { status: "duplicate" }
      }
      // Incoming is a user paste carrying a CORRECTED value. It may replace an
      // existing user-paste value — re-pasting a truncated/expired credential
      // mid-run is the whole point — but it must NEVER overwrite a minted
      // QA_BIND_* value, nor an entry a snapshot has pinned (the scrubber may
      // be reading it mid-wave — CWE-362 / CWE-672). Those stay immutable.
      if (
        existing.source === "minted-recipe" ||
        this.isPinned(parentID, name)
      ) {
        const kind = existing.source === "minted-recipe" ? "minted" : "pinned"
        return {
          status: "immutable",
          reason: `name '${name}' holds an immutable ${kind} value and cannot be overwritten by paste`,
        }
      }
      // Both user-paste, unpinned → overwrite in place. The name already counts
      // against the caps, so #globalCount is left untouched; createdAt is
      // refreshed so the corrected value gets a fresh TTL window.
      parentMap.set(name, {
        value: new Secret(stored),
        type,
        source,
        createdAt: Date.now(),
      })
      return { status: "updated" }
    }
    if (parentMap.size >= PER_PARENT_CAP) {
      return {
        status: "error",
        reason: `per-parent cap of ${PER_PARENT_CAP} reached`,
      }
    }
    if (this.#globalCount >= GLOBAL_CAP) {
      return { status: "error", reason: `global cap of ${GLOBAL_CAP} reached` }
    }
    parentMap.set(name, {
      value: new Secret(stored),
      type,
      source,
      createdAt: Date.now(),
    })
    this.#globalCount++
    return { status: "ok" }
  }

  /**
   * Purge entries older than TTL (excluding pinned). Returns count purged.
   * Called periodically from the plugin sweep timer.
   */
  sweepExpired(nowMs: number, ttlMs: number): number {
    let purged = 0
    for (const [parentID, parentMap] of this.#map.entries()) {
      for (const [name, entry] of parentMap.entries()) {
        if (this.isPinned(parentID, name)) continue
        if (nowMs - entry.createdAt < ttlMs) continue
        parentMap.delete(name)
        purged++
        this.#globalCount--
      }
      if (parentMap.size === 0) {
        this.#map.delete(parentID)
      }
    }
    return purged
  }

  /**
   * Purge bindings for a parent session (called on session.deleted /
   * QA-run completion / abort). Pinned entries are preserved so that any
   * in-flight reader holding a snapshot (e.g. the scrubber) still has a
   * coherent backing entry until the snapshot is explicitly released
   * (CWE-672 — operation invoked on resource in incompatible phase).
   * Returns the number of entries actually purged. Pin-counts and pinned
   * entries remain so releaseSnapshot() can complete normally.
   */
  clearParent(parentID: string): number {
    const parentMap = this.#map.get(parentID)
    if (parentMap === undefined) return 0
    const parentPinCounts = this.#pinCounts.get(parentID)
    let purged = 0
    for (const name of Array.from(parentMap.keys())) {
      if ((parentPinCounts?.get(name) ?? 0) > 0) continue
      parentMap.delete(name)
      purged++
      this.#globalCount--
    }
    if (parentMap.size === 0) {
      this.#map.delete(parentID)
    }
    return purged
  }
}
