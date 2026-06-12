/**
 * @deprecated Import from `../_shared/sanitize.js` instead — this is a
 * compatibility re-export only.
 *
 * The single source of truth for the untrusted-output sanitizer now lives in
 * `../_shared/sanitize.ts`, so `coordinator/` and `pantheon-config/` (a sibling
 * library that previously imported "upward" from `coordinator/`) both depend on
 * the same `_shared/` leaf — removing the only layer inversion in `src/`.
 *
 * This shim preserves the historical `coordinator/sanitize.js` import path used
 * by existing call sites, docs (`src/agents/perun.md`), and tests. New code
 * SHOULD import from `../_shared/sanitize.js` directly. Treat any change to the
 * strip rules as a security change in `_shared/sanitize.ts`, not here.
 */
export {
  neutralizeUntrustedOutput,
  normalizeVariantSuffix,
  deriveReportPath,
} from "../_shared/sanitize.js"
