import { fstatSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
const PLANNING_ARTIFACT_DIRECTORIES = ["docs/specs", "docs/plans"];
function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function containsTraversalSegment(pathValue) {
  return pathValue.split(/[\\/]/).some((segment) => segment === "" || segment === "." || segment === "..");
}
function matchesNoFollowFileDescriptor(descriptor, targetPath, canonicalParent) {
  const opened = fstatSync(descriptor);
  const named = lstatSync(targetPath);
  return opened.isFile() && !named.isSymbolicLink() && opened.dev === named.dev && opened.ino === named.ino && realpathSync(path.dirname(targetPath)) === canonicalParent;
}
function verifiesNoFollowFileDescriptor(descriptor, targetPath, canonicalParent) {
  try {
    return matchesNoFollowFileDescriptor(descriptor, targetPath, canonicalParent);
  } catch {
    return false;
  }
}
export {
  PLANNING_ARTIFACT_DIRECTORIES,
  containsTraversalSegment,
  isWithin,
  matchesNoFollowFileDescriptor,
  verifiesNoFollowFileDescriptor
};
