#!/usr/bin/env node
/**
 * Verifies that all workspace `package.json` versions agree with the root, and
 * that every documented git-install pin references the same `v<version>` tag.
 *
 * Why this exists: AGENTS.md → "Versioning & Git Installation" requires bumping
 * the version in ALL package.json files together and keeping every install
 * example on the SAME tag as the current root `package.json` version. Drift
 * here is silent: a consumer installing `…#vX.Y.Z` gets a tree whose workspace
 * packages may disagree, and the README/AGENTS examples can rot out of lockstep
 * with the actual version. This guard turns that into a hard error — pair it
 * with `verify-version-tag.mjs` (root version ↔ reachable git tag) at tag time.
 *
 * Checks:
 *   1) Every workspace package.json `version` equals the root version.
 *   2) Every documented `…av-opencode-plugins.git#vX.Y.Z` pin equals `v<root>`.
 *
 * Exit codes: 0 = ok, 1 = any mismatch or read failure.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

// The full set of package.json files that must move in lockstep (root + every
// workspace under packages/*). Keep in sync with root package.json `workspaces`.
const packageJsonPaths = [
  'package.json',
  'packages/code-review/package.json',
  'packages/frontend-developer/package.json',
  'packages/python-developer/package.json',
  'packages/skill-registry/package.json',
  'packages/skill-utils/package.json',
  'packages/swift-developer/package.json',
];

// Docs that pin a git-install tag. Each must reference the current root version.
const docsWithInstallPins = [
  'README.md',
  'AGENTS.md',
  'docs/plugins/commit.md',
];

const PIN_RE = /av-opencode-plugins\.git#v(\d+\.\d+\.\d+)/g;

function readJson(relPath) {
  try {
    return JSON.parse(
      readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8'),
    );
  } catch (err) {
    console.error(`Failed to read ${relPath}:`, String(err?.message ?? err));
    process.exit(1);
  }
}

function readText(relPath) {
  try {
    return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
  } catch {
    // A missing docs file is not a versioning failure — skip it.
    return null;
  }
}

const rootVersion = readJson('package.json').version;
if (typeof rootVersion !== 'string' || rootVersion.length === 0) {
  console.error('❌ WORKSPACE VERSION CHECK FAILED');
  console.error('Root package.json has no usable "version" field.');
  process.exit(1);
}

const errors = [];

// 1) Workspace versions must all equal the root version.
for (const relPath of packageJsonPaths) {
  const pkg = readJson(relPath);
  if (pkg.version !== rootVersion) {
    errors.push(
      `${relPath}: version ${JSON.stringify(pkg.version)} != root ${JSON.stringify(rootVersion)}`,
    );
  }
}

// 2) Documented install pins must reference v<rootVersion>.
const expectedPin = `v${rootVersion}`;
for (const relPath of docsWithInstallPins) {
  const text = readText(relPath);
  if (text === null) continue;
  const matches = [...text.matchAll(PIN_RE)];
  for (const m of matches) {
    const found = `v${m[1]}`;
    if (found !== expectedPin) {
      errors.push(
        `${relPath}: install pin ${found} != expected ${expectedPin}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('\n❌ WORKSPACE VERSION CHECK FAILED');
  console.error(
    `All workspace package.json versions and documented install pins must equal v${rootVersion}:`,
  );
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\nBump every package.json and every README/AGENTS install example together.',
  );
  console.error('See AGENTS.md → "Versioning & Git Installation".');
  process.exit(1);
}

console.log(
  `✅ All ${packageJsonPaths.length} package.json versions and documented install pins are ${expectedPin}.`,
);
