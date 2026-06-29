import { deriveCoverage } from "./coverage.js";
function markerFor(iss) {
  if (iss.status === "fixed") return `\u2705 Fixed (${iss.fixed_at ?? ""})`;
  if (iss.status === "deferred")
    return `\u23F8 Deferred \u2014 ${iss.fix.escalate_reason ?? "no reason given"}`;
  return "";
}
function renderReport(s) {
  const lines = [];
  lines.push(`# QA Loop Report \u2014 ${s.run_id}`);
  lines.push("");
  lines.push(`**Status:** ${s.result ?? "in-progress"}`);
  lines.push("");
  lines.push("## Issues Found");
  lines.push("");
  const issueIds = Object.keys(s.issues).sort();
  if (issueIds.length === 0) {
    lines.push("_None._");
    lines.push("");
  } else {
    for (const id of issueIds) {
      const iss = s.issues[id];
      if (!iss) continue;
      const marker = markerFor(iss);
      lines.push(`### ${id}${marker ? ` ${marker}` : ""}`);
      lines.push(`- **Severity:** ${iss.severity}`);
      lines.push(`- **Scenario:** ${iss.scenario}`);
      lines.push(`- **Location:** ${iss.location ?? "\u2014"}`);
      lines.push(`- **Title:** ${iss.title}`);
      lines.push(`- **Problem:** ${iss.problem}`);
      lines.push(`- **Remediation:** ${iss.remediation}`);
      lines.push("");
    }
  }
  lines.push("## All Scenarios");
  lines.push("");
  lines.push("| Scenario | Section | Kind | Baseline | Current | Reason |");
  lines.push("|---|---|---|---|---|---|");
  for (const key of Object.keys(s.scenarios).sort()) {
    const sc = s.scenarios[key];
    if (!sc) continue;
    lines.push(
      `| ${key} | ${sc.section} | ${sc.kind} | ${sc.baseline} | ${sc.current} | ${sc.reason ?? "\u2014"} |`
    );
  }
  lines.push("");
  lines.push("## Loop History");
  lines.push("");
  lines.push("| Iteration | Failing in | Now passing | Still failing | Warnings | Regressions | Dispatches |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const it of s.iterations) {
    const failingIn = it.attempted_so_far.join(", ") || "\u2014";
    const nowPassing = it.now_passing.join(", ") || "\u2014";
    const stillFailing = it.still_failing.join(", ") || "\u2014";
    const warnings = it.warnings.join("; ") || "\u2014";
    const regressions = it.regressions.join(", ") || "\u2014";
    lines.push(
      `| ${it.n} | ${failingIn} | ${nowPassing} | ${stillFailing} | ${warnings} | ${regressions} | ${it.dispatches_this_iter} |`
    );
  }
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  const cov = deriveCoverage(s);
  const ex = cov.exercised;
  const nv = cov.not_verified;
  lines.push(`- **Exercised:** feature ${ex.feature} \xB7 sanity ${ex.sanity} \xB7 enforcement ${ex.enforcement}`);
  lines.push(
    `- **Not verified:** auth-unverified ${nv["auth-unverified"]} \xB7 mutation-guard ${nv["mutation-guard"]} \xB7 tool-unavailable ${nv["tool-unavailable"]}`
  );
  if (cov.routing_warnings.length > 0) {
    lines.push(`- **Routing warnings:** ${cov.routing_warnings.join("; ")}`);
  }
  lines.push("");
  lines.push("## Recovery");
  lines.push("");
  lines.push(
    `Run \`qa_loop_undo\` to revert everything this loop did \u2014 it restores \`${s.pre_loop.undo_ref}\` (a plain git ref you can also restore from your own shell).`
  );
  lines.push("");
  return lines.join("\n");
}
export {
  renderReport
};
