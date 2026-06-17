import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
function git(cwd, args, env) {
  return execFileSync("git", args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf-8"
  }).trim();
}
function createCheckpoint(cwd, sessionId) {
  const dir = mkdtempSync(path.join(tmpdir(), "svarog-ckpt-"));
  const idx = path.join(dir, "index");
  try {
    const rel = git(cwd, ["rev-parse", "--git-path", "index"]);
    const realIndex = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    if (existsSync(realIndex)) copyFileSync(realIndex, idx);
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    git(cwd, ["add", "-A"], env);
    const tree = git(cwd, ["write-tree"], env);
    const commit = git(cwd, [
      "commit-tree",
      tree,
      "-p",
      "HEAD",
      "-m",
      "svarog checkpoint"
    ]);
    const ref = `refs/svarog/ckpt/${sessionId}`;
    git(cwd, ["update-ref", ref, commit]);
    return ref;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function restoreCheckpoint(cwd, ckptRef) {
  const inCkpt = new Set(
    git(cwd, ["ls-tree", "-r", "--name-only", ckptRef]).split("\n").filter(Boolean)
  );
  const present = [
    ...git(cwd, ["ls-files"]).split("\n"),
    ...git(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n")
  ].filter(Boolean);
  const orphans = present.filter((f) => !inCkpt.has(f));
  git(cwd, ["read-tree", ckptRef]);
  git(cwd, ["checkout-index", "-a", "-f"]);
  for (const f of orphans) rmSync(path.join(cwd, f), { force: true });
  git(cwd, ["reset", "-q"]);
}
export {
  createCheckpoint,
  restoreCheckpoint
};
