function parseAllowedBashPrograms(frontmatter) {
  const out = [];
  const re = /Bash\(([^:)]+):\*\)/g;
  let m;
  while ((m = re.exec(frontmatter)) !== null) {
    const prog = m[1];
    if (prog !== void 0) out.push(prog.trim());
  }
  return out;
}
const COMPOUND = /(\|\||&&|;|\||&|[\r\n]|`|\$\(|<|>|(?<![\w./-])(?:bash|sh|eval)\b)/;
function isCompoundCommand(command) {
  return COMPOUND.test(command.trim());
}
function classifyCoordinatorBash(command, allowedPrograms) {
  const trimmed = command.trim();
  if (isCompoundCommand(trimmed)) return { allowed: false, program: null };
  const program = trimmed.split(/\s+/)[0] ?? "";
  return { allowed: allowedPrograms.includes(program), program };
}
function buildViolationError(info) {
  const payload = JSON.stringify({
    marker: "COORDINATOR_POLICY_VIOLATION",
    ...info
  });
  const subject = info.command ? isCompoundCommand(info.command) ? "a compound command" : `\`${info.command.split(/\s+/)[0]}\`` : info.skill ? `skill \`${info.skill}\`` : "that";
  return new Error(
    `${payload}
The coordinator may not run ${subject}. Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`
  );
}
export {
  buildViolationError,
  classifyCoordinatorBash,
  isCompoundCommand,
  parseAllowedBashPrograms
};
