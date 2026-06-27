import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { restoreCheckpoint } from "../svarog/checkpoint.js";
function git(cwd, args, env) {
  return execFileSync("git", args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf-8"
  }).trim();
}
function capturePreLoopRef(cwd, runId) {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-loop-pre-"));
  const idx = path.join(dir, "index");
  try {
    const rel = git(cwd, ["rev-parse", "--git-path", "index"]);
    const realIndex = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    if (existsSync(realIndex)) copyFileSync(realIndex, idx);
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    git(cwd, ["add", "-A"], env);
    const tree = git(cwd, ["write-tree"], env);
    const commit = git(cwd, ["commit-tree", tree, "-p", "HEAD", "-m", "qa-loop pre-loop"]);
    const ref = `refs/qa-loop/pre/${runId}`;
    git(cwd, ["update-ref", ref, commit]);
    return ref;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function refExists(cwd, ref) {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}
function restoreFailRef(cwd, ref) {
  restoreCheckpoint(cwd, ref);
}
function undoToPreLoop(cwd, ref) {
  restoreCheckpoint(cwd, ref);
}
function antiHardcodeDiff(cwd, ckptRef, changed, bePayloads) {
  const warnings = [];
  const payloads = bePayloads.map((p) => p.trim()).filter(Boolean);
  if (payloads.length === 0 || changed.length === 0) return warnings;
  for (const file of changed) {
    let diff = "";
    try {
      diff = git(cwd, ["diff", "--no-color", ckptRef, "--", file]);
    } catch {
      continue;
    }
    const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    for (const line of addedLines) {
      for (const payload of payloads) {
        if (line.includes(payload)) {
          warnings.push(
            `${file}: added literal matching BE payload ${payload} \u2014 possible hardcoded test value`
          );
        }
      }
    }
  }
  return warnings;
}
export {
  antiHardcodeDiff,
  capturePreLoopRef,
  refExists,
  restoreFailRef,
  undoToPreLoop
};
