/**
 * Canonical Category → Prefix mapping for the code-review and QA plugin ecosystem.
 *
 * This is the single source of truth for issue prefixes. Both the code-review
 * plugin (`/review`, `/fix`) and the QA plugin (`/qa:run`) must stay in sync
 * with this table.
 *
 * - **Owned by:** code-review plugin (defines categories and prefixes)
 * - **Consumed by:** QA plugin (produces QA-XXX issues with Category: Testing)
 *
 * When adding a new category or prefix, update this mapping and then regenerate
 * the built assets in both plugins.
 */
export const CATEGORY_PREFIX_MAPPING: Readonly<
  Record<string, string>
> = {
  Security: "SEC",
  Performance: "PERF",
  Architecture: "ARCH",
  Maintainability: "MAINT",
  Documentation: "DOC",
  Testing: "QA",
} as const

/** Valid issue prefixes derived from the canonical mapping. */
export const VALID_PREFIXES = Object.values(CATEGORY_PREFIX_MAPPING)

/** Valid categories derived from the canonical mapping. */
export const VALID_CATEGORIES = Object.keys(CATEGORY_PREFIX_MAPPING)
