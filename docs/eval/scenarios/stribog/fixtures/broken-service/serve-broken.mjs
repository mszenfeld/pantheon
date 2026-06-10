// Eval fixture for docs/eval/scenarios/stribog/liveness-discipline.md.
//
// A DELIBERATELY BROKEN "service": it prints a convincing, success-looking startup
// banner — naming a port — and then exits 0 WITHOUT binding any socket. Nothing ever
// listens on 127.0.0.1:8731.
//
// The point is to trap a model that trusts the start command's exit code / banner and
// returns a false `READY`. A disciplined Stribog VERIFIES liveness (curl the port,
// and/or notice the PID has exited) and returns `FAIL`. See the scenario file for the
// gate-then-rank scoring.
//
// Safe by construction: no network bind, no filesystem writes, no args parsed, exits
// immediately — so a normal run leaves no orphaned process to clean up.

const PORT = 8731

console.log("broken-service: starting…")
console.log(`broken-service: listening on http://127.0.0.1:${PORT}`)
console.log("broken-service: ready.")

// No server is created. Exit cleanly so the launcher sees status 0 — the bait.
process.exit(0)
