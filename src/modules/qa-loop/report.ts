import type { IssueRecord, Sidecar } from "./types.js"
import { deriveCoverage } from "./coverage.js"

/** §5 status→marker discipline: only `fixed`/`deferred` carry a marker; everything else is unmarked. */
function markerFor(iss: IssueRecord): string {
  if (iss.status === "fixed") return `✅ Fixed (${iss.fixed_at ?? ""})`
  if (iss.status === "deferred")
    return `⏸ Deferred — ${iss.fix.escalate_reason ?? "no reason given"}`
  return "" // open / fix-attempted / fix-failed → still-failing, unmarked
}

/**
 * §5 report renderer — the SINGLE deterministic writer of the report markdown: Status · Issues Found ·
 * All Scenarios · Loop History · Coverage · the qa_loop_undo recovery line. A pure render of the
 * sidecar (no I/O); the tool persists the returned string.
 */
export function renderReport(s: Sidecar): string {
  const lines: string[] = []

  lines.push(`# QA Loop Report — ${s.run_id}`)
  lines.push("")
  lines.push(`**Status:** ${s.result ?? "in-progress"}`)
  lines.push("")

  // ── Issues Found ──────────────────────────────────────────────────────────
  lines.push("## Issues Found")
  lines.push("")
  const issueIds = Object.keys(s.issues).sort()
  if (issueIds.length === 0) {
    lines.push("_None._")
    lines.push("")
  } else {
    for (const id of issueIds) {
      const iss = s.issues[id]
      if (!iss) continue
      const marker = markerFor(iss)
      lines.push(`### ${id}${marker ? ` ${marker}` : ""}`)
      lines.push(`- **Severity:** ${iss.severity}`)
      lines.push(`- **Scenario:** ${iss.scenario}`)
      lines.push(`- **Location:** ${iss.location ?? "—"}`)
      lines.push(`- **Title:** ${iss.title}`)
      lines.push(`- **Problem:** ${iss.problem}`)
      lines.push(`- **Remediation:** ${iss.remediation}`)
      lines.push("")
    }
  }

  // ── All Scenarios ─────────────────────────────────────────────────────────
  lines.push("## All Scenarios")
  lines.push("")
  lines.push("| Scenario | Section | Kind | Baseline | Current | Reason |")
  lines.push("|---|---|---|---|---|---|")
  for (const key of Object.keys(s.scenarios).sort()) {
    const sc = s.scenarios[key]
    if (!sc) continue
    lines.push(
      `| ${key} | ${sc.section} | ${sc.kind} | ${sc.baseline} | ${sc.current} | ${sc.reason ?? "—"} |`,
    )
  }
  lines.push("")

  // ── Loop History ──────────────────────────────────────────────────────────
  lines.push("## Loop History")
  lines.push("")
  lines.push("| Iteration | Failing in | Now passing | Still failing | Warnings | Regressions | Dispatches |")
  lines.push("|---|---|---|---|---|---|---|")
  for (const it of s.iterations) {
    const failingIn = it.attempted_so_far.join(", ") || "—"
    const nowPassing = it.now_passing.join(", ") || "—"
    const stillFailing = it.still_failing.join(", ") || "—"
    const warnings = it.warnings.join("; ") || "—"
    const regressions = it.regressions.join(", ") || "—"
    lines.push(
      `| ${it.n} | ${failingIn} | ${nowPassing} | ${stillFailing} | ${warnings} | ${regressions} | ${it.dispatches_this_iter} |`,
    )
  }
  lines.push("")

  // ── Coverage ──────────────────────────────────────────────────────────────
  lines.push("## Coverage")
  lines.push("")
  const cov = deriveCoverage(s)
  const ex = cov.exercised
  const nv = cov.not_verified
  lines.push(`- **Exercised:** feature ${ex.feature} · sanity ${ex.sanity} · enforcement ${ex.enforcement}`)
  lines.push(
    `- **Not verified:** auth-unverified ${nv["auth-unverified"]} · mutation-guard ${nv["mutation-guard"]} · tool-unavailable ${nv["tool-unavailable"]}`,
  )
  if (cov.routing_warnings.length > 0) {
    lines.push(`- **Routing warnings:** ${cov.routing_warnings.join("; ")}`)
  }
  lines.push("")

  // ── Recovery ──────────────────────────────────────────────────────────────
  lines.push("## Recovery")
  lines.push("")
  lines.push(
    `Run \`qa_loop_undo\` to revert everything this loop did — it restores \`${s.pre_loop.undo_ref}\` (a plain git ref you can also restore from your own shell).`,
  )
  lines.push("")

  return lines.join("\n")
}
