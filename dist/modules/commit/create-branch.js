import { defaultGitRunner } from "./controlled-commit.js";
const BRANCH_TYPES = [
  "feature",
  "fix",
  "hotfix",
  "release",
  "docs",
  "chore",
  "refactor"
];
function segmentError(segment, ruleId, slug, value) {
  return new Error(
    `create_branch: segment '${segment}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}`
  );
}
const SEGMENT_CHARSET = /^[A-Za-z0-9._-]+$/;
function normalizeDescription(raw) {
  return raw.trim().replace(/\s+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}
function validateSegmentRules(segment, value) {
  if (!SEGMENT_CHARSET.test(value))
    throw segmentError(segment, "S3", "invalid-characters", value);
  if (value.startsWith("-"))
    throw segmentError(segment, "S4", "leading-dash", value);
  if (value.startsWith("."))
    throw segmentError(segment, "S5", "leading-dot", value);
  if (value.includes("--"))
    throw segmentError(segment, "S6", "double-hyphen", value);
  if (value.includes(".."))
    throw segmentError(segment, "S7", "consecutive-dots", value);
  if (value.endsWith(".lock") || value.endsWith("."))
    throw segmentError(segment, "S8", "lock-suffix-or-trailing-dot", value);
  return value;
}
function validateBranchName(name, expectedType) {
  if (name.split("/").length - 1 !== 1)
    throw segmentError("name", "N1", "single-slash", name);
  const slashIndex = name.indexOf("/");
  const typePart = name.slice(0, slashIndex);
  const descriptionPart = name.slice(slashIndex + 1);
  if (typePart !== expectedType || !BRANCH_TYPES.includes(typePart))
    throw segmentError("name", "N2", "type-mismatch", name);
  if (name.startsWith("-"))
    throw segmentError("name", "N3", "leading-dash", name);
  if (descriptionPart === "")
    throw segmentError("name", "N4", "empty-description-part", name);
  if (!SEGMENT_CHARSET.test(descriptionPart))
    throw segmentError("name", "N5", "invalid-characters", name);
  if (descriptionPart.startsWith("-") || descriptionPart.startsWith("."))
    throw segmentError("name", "N6", "leading-dash-or-dot", name);
  if (descriptionPart.includes("--"))
    throw segmentError("name", "N7", "double-hyphen", name);
  if (descriptionPart.includes(".."))
    throw segmentError("name", "N8", "consecutive-dots", name);
  if (descriptionPart.endsWith(".lock"))
    throw segmentError("name", "N9", "lock-suffix", name);
  if (descriptionPart.endsWith("."))
    throw segmentError("name", "N10", "trailing-dot", name);
  if (Buffer.byteLength(name, "utf8") > 240)
    throw segmentError("name", "N11", "max-length-240-bytes", name);
  return name;
}
function composeBranchName(input) {
  const type = input.type.trim();
  if (!BRANCH_TYPES.includes(type))
    throw segmentError("type", "S1", "type-not-allowed", type);
  const id = input.id?.trim() ?? "";
  if (id !== "") validateSegmentRules("id", id);
  const description = normalizeDescription(input.description);
  if (description === "")
    throw segmentError("description", "S2", "empty-description", description);
  validateSegmentRules("description", description);
  const name = id !== "" ? `${type}/${id}-${description}` : `${type}/${description}`;
  return validateBranchName(name, type);
}
async function createBranch(input) {
  const name = composeBranchName(input);
  const runGit = input.runGit ?? defaultGitRunner;
  const checkout = input.checkout ?? true;
  const createResult = await runGit(input.cwd, ["branch", name]);
  if (createResult.exitCode !== 0) {
    throw new Error(
      createResult.stderr.trim() || createResult.stdout.trim() || "git branch failed."
    );
  }
  if (!checkout) {
    return { name, created: true, checkedOut: false };
  }
  const checkoutResult = await runGit(input.cwd, ["checkout", name]);
  if (checkoutResult.exitCode !== 0) {
    return {
      name,
      created: true,
      checkedOut: false,
      // FR-7 capture rule: stderr → stdout → fixed string; never empty on
      // this path, so checkedOut:false + checkoutError stays distinguishable
      // from the checkout:false path (FR-6).
      checkoutError: checkoutResult.stderr.trim() || checkoutResult.stdout.trim() || "git checkout failed."
    };
  }
  return { name, created: true, checkedOut: true };
}
export {
  BRANCH_TYPES,
  composeBranchName,
  createBranch,
  validateBranchName
};
