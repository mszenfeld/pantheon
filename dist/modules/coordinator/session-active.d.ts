/**
 * Defensive wrapper around the session-status probe shared by the foreground
 * (`pollUntilIdle`) and background (`collectOne`) completion gates. This is the
 * single authoritative CONSUMER-SIDE degraded-mode gate: callers must route the
 * probe through here and must NOT re-wrap it in their own try/catch — the swallow
 * lives in exactly one place. It encodes the degraded-mode contract both paths
 * rely on:
 *
 *   absent probe OR rejected probe ⇒ inactive
 *
 * An absent probe is the pre-status-gate behaviour (message-only completion),
 * and a thrown/rejected probe must degrade gracefully — a broken status
 * endpoint reports "inactive" so the gate falls back to message-only
 * completion rather than wedging the poll until `timeoutMs`. This holds even if
 * a `DispatchSpecialist.isSessionActive` implementation violates its own
 * producer-side "degrade to false" contract and throws: this gate still reads it
 * as inactive (defence-in-depth), so a throwing probe can never wedge or fail the
 * poll. Both call sites bind the probe to their own session.
 */
declare function probeSessionActive(probe: (() => Promise<boolean>) | undefined): Promise<boolean>;

export { probeSessionActive };
