---
name: fe-testing
description: Frontend testing patterns using Playwright — navigation, interaction, assertions, screenshots on failure, and common UI testing scenarios.
activation: Load when testing frontend UI with Playwright
allowed-tools: playwright_browser_navigate, playwright_browser_click, playwright_browser_fill_form, playwright_browser_snapshot, playwright_browser_take_screenshot, playwright_browser_press_key, playwright_browser_select_option, playwright_browser_hover, playwright_browser_wait_for, playwright_browser_evaluate, playwright_browser_console_messages, playwright_browser_navigate_back, playwright_browser_tabs, playwright_browser_handle_dialog, playwright_browser_resize, playwright_browser_close, playwright_browser_drag, playwright_browser_type, playwright_browser_file_upload, playwright_browser_network_requests, Write, Read, Bash(mkdir:*)
---

# Frontend Testing Patterns

## Playwright Strategy

**Priority order:**
1. **OpenCode native Playwright tools** — `playwright_browser_navigate`, `playwright_browser_click`, `playwright_browser_snapshot`, etc.
2. **Bash `playwright` CLI** — `playwright screenshot`, `playwright open`, JS eval via node
3. **None** — route per the core prompt's SKIP-vs-NEED_INFO rule (would-apply scenarios → `NEED_INFO` with `kind: "tool"`; SKIP only when the scenario doesn't apply to this stack/environment)

---

## Execution Workflow

For each FE scenario from the test plan:

1. **Read the scenario** — understand steps, expected result, edge cases
2. **Execute main flow** — follow steps using available Playwright method
3. **Verify result** — check for expected elements/text
4. **Execute edge cases** — run each edge case as a sub-test
5. **Record result** — pass/fail with details

---

## Bash Playwright CLI Patterns

### Navigation & Verification

**Screenshot for visual verification:**
```bash
playwright screenshot --viewport-size=1280,720 "http://localhost:3000/page" /tmp/page-screenshot.png
```

Inspect the screenshot to verify the page loaded correctly.

**Open page in browser (for interactive debugging):**
```bash
playwright open "http://localhost:3000/page"
```

### JavaScript Evaluation via Node

Create a temporary script to evaluate JS on the page:
```bash
cat > /tmp/eval.js << 'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/page');
  
  // Evaluate JS
  const result = await page.evaluate(() => {
    return {
      title: document.title,
      itemsCount: document.querySelectorAll('.item').length,
      hasError: !!document.querySelector('.error-message')
    };
  });
  
  console.log(JSON.stringify(result));
  await browser.close();
})();
EOF
node /tmp/eval.js
```

### Screenshot on Failure

```bash
mkdir -p docs/testing/reports/screenshots
playwright screenshot --viewport-size=1280,720 "http://localhost:3000/page" docs/testing/reports/screenshots/fe-XX-fail.png
```

---

## OpenCode Native Playwright Patterns

These are the primary testing tools in OpenCode. Use them whenever available.

### Navigation

```
playwright_browser_navigate(url: "http://localhost:3000/page")
```

- Always use full URLs with the base URL from the test plan
- After navigation, take a snapshot to verify the page loaded:

```
playwright_browser_snapshot()
```

**Navigating back:**

```
playwright_browser_navigate_back()
```

- Returns to the previous page in browser history
- Useful for testing back-button behavior and breadcrumb navigation
- After navigating back, take a snapshot to verify the correct page loaded

### Interaction

**Clicking elements:**

```
playwright_browser_click(element: "Submit button", target: "<element-ref>")
playwright_browser_click(element: "Link with text 'Sign In'", target: "<element-ref>")
```

**Filling forms:**

```
playwright_browser_fill_form(fields: [
  { name: "email", type: "textbox", target: "<ref>", value: "test@example.com" },
  { name: "password", type: "textbox", target: "<ref>", value: "TestPass123!" }
])
```

If `playwright_browser_fill_form` doesn't work for a field, fall back to:

```
playwright_browser_click(element: "email input", target: "<ref>")
playwright_browser_type(target: "<ref>", text: "test@example.com")
```

**Selecting options:**

```
playwright_browser_select_option(element: "Country dropdown", target: "<ref>", values: ["PL"])
```

**Keyboard actions:**

```
playwright_browser_press_key(key: "Enter")
playwright_browser_press_key(key: "Escape")
playwright_browser_press_key(key: "Tab")
```

**File uploads:**

```
playwright_browser_file_upload(paths: ["/path/to/file.pdf"])
```

- Provide absolute paths to files on disk
- Triggered on the currently focused file input element
- Use after clicking a file input or drop zone to open the chooser

**Drag and drop:**

```
playwright_browser_drag(startTarget: "<source-ref>", endTarget: "<target-ref>", startElement: "Draggable item", endElement: "Drop zone")
```

- Simulates dragging one element and dropping it onto another
- Useful for testing reorderable lists, Kanban boards, or file drop zones

### Verification

**Primary method — snapshot and inspect:**

```
playwright_browser_snapshot()
```

After taking a snapshot, inspect the returned accessibility tree for:
- Expected text content
- Element visibility (present in tree = visible)
- Element state (disabled, checked, expanded)
- Error messages
- Success notifications

**JavaScript evaluation for complex checks:**

```
playwright_browser_evaluate(function: "() => document.querySelector('.items-list').children.length")
playwright_browser_evaluate(function: "() => document.title")
playwright_browser_evaluate(function: "() => window.location.pathname")
```

### Dialog Handling

**Accept or dismiss dialogs:**

```
playwright_browser_handle_dialog(accept: true)
playwright_browser_handle_dialog(accept: false)
playwright_browser_handle_dialog(accept: true, promptText: "user input")
```

- Use BEFORE the action that triggers the dialog (dialogs block execution)
- `accept: true` clicks OK/Yes; `accept: false` clicks Cancel/No
- For prompt dialogs, provide `promptText` to fill the input field
- Common triggers: `confirm()`, `alert()`, `prompt()`

### Waiting

```
playwright_browser_wait_for(text: "Success", time: 5)
playwright_browser_wait_for(textGone: ".loading-spinner", time: 10)
```

### Screenshots

```
playwright_browser_take_screenshot(type: "png")
```

### Session Cleanup

**Close the browser:**

```
playwright_browser_close()
```

- Closes the current browser page/context
- Call at the end of a test session to release resources
- Always close after taking final screenshots to avoid leaks

---

## Common Scenario Patterns

### Authentication Flow
1. Navigate to login page
2. Fill email + password
3. Click submit
4. Wait for redirect/dashboard
5. Verify user name/avatar visible
6. Edge: wrong password → error message
7. Edge: empty fields → validation errors

### Form Submission
1. Navigate to form page
2. Fill all required fields
3. Submit
4. Wait for success message or redirect
5. Verify data persisted (check list page or detail page)
6. Edge: submit with empty required fields → validation errors visible
7. Edge: submit with invalid data (bad email format) → field-level errors
8. Edge: double-click submit → no duplicate creation

### CRUD Operations
1. **Create:** Fill form → submit → verify new item in list
2. **Read:** Navigate to detail page → verify all fields displayed
3. **Update:** Open edit form → change field → submit → verify change
4. **Delete:** Click delete → confirm dialog → verify item removed from list
5. Edge: delete already deleted → graceful handling
6. Edge: edit with stale data → conflict handling

### Navigation & Routing
1. Click link → verify URL changed
2. Verify breadcrumb/nav state updated
3. Browser back → verify previous page
4. Direct URL access → verify page renders
5. Edge: access protected page without auth → redirect to login

---

## Tag handling (plan grounding tags)

Expected-result text may carry these author tags — handle them, do not match on
the tag text itself:

- `(unverified — confirm at run time)` — the author could not ground this. A
  mismatch here is reported as **LOW** (not HIGH), with a note that the
  expectation was author-flagged as unverified.
- `(exact text — brittle)` — match the quoted message as **substring/contains,
  not equality**.
- `(file:line)` — a source citation for humans/`momus`; **ignore** it when matching.

---

## Result Format

For each scenario, return results in this format:

```
### FE-XX: <scenario name>
- **Status:** PASS / FAIL / SKIP / NEED_INFO
- **Details:** <what was verified / what went wrong; battery refutation trace when a FAIL was re-verified>
- **Screenshot:** <path, only if FAIL>
- **Edge cases:**
  - <edge case 1>: PASS / FAIL / SKIP — <details>
  - <edge case 2>: PASS / FAIL / SKIP — <details>
```

---

## FAIL refutation battery (before returning any FAIL)

A FAIL is a claim — refute it before you report it. Run these four checks
before returning ANY `FAIL` the result carries: the scenario-level
`**Status:**` and each edge-case sub-result line (an edge-case FAIL under a
passing main flow still mints its own QA-XXX issue in the report).

1. **Re-verify the observation — once, deterministically, observation-only.**
   Take a fresh `playwright_browser_snapshot` (or `playwright_browser_wait_for`
   the expected text) and re-read. NEVER re-perform the scenario's action:
   no re-submit, no re-click through the flow. One re-check, then disposition —
   this is not retry-until-pass. If the two observations disagree, record BOTH
   in Details: first read failed, fresh snapshot passes → the initial read was
   a tester-side race → `PASS` with the trace `(re-verified: first read stale)`.
   **Carve-out:** when the Expected is explicitly timing/immediacy-sensitive
   ("appears immediately", "without reload"), or the mismatch recurs on any
   edge-case interaction, the discrepancy stays `FAIL` — there the timing flake
   IS the defect, not an observation artifact.
2. **Environment artifact?** A missing prerequisite discovered at execution
   time (env var, service, fixture, tool) → `NEED_INFO` with the matching
   `kind` (the Zmora core prompt's kind table), not `FAIL`. The app under test
   at the plan's base-url: never reachable in this scenario →
   `NEED_INFO kind=service`; answered earlier in the scenario and then died →
   genuine `FAIL` (the app crashed under test). Tool routing follows the core
   prompt's SKIP-vs-NEED_INFO rule: scenario inapplicable to this
   stack/environment → `SKIP`; scenario would apply but the tool is missing →
   `NEED_INFO` with `kind: "tool"`.
3. **Deliberate omission / scope mismatch?** An observed defect OUTSIDE the
   scenario's Expected, with the Expected itself met → `PASS` with the
   out-of-scope observation noted in Details (a follow-up scenario is the
   coordinator's call — it is not this scenario's FAIL); an omission recorded
   in the plan (`## Setup`, a plan note) that makes the scenario inapplicable
   here → `SKIP` per the core prompt's inapplicability rule; a missing declared
   prerequisite → `NEED_INFO` via check 2.
4. **Harness error?** Playwright MCP failure, tool timeout, selector
   unreachable because navigation never completed → re-attempt the failed
   harness step at most ONCE; if it fails again, return an error result naming
   the tool failure (core prompt's error-result shape) — never an application
   `FAIL`. No open-ended retries.

**Disposition:** a `FAIL` that survives carries a one-line refutation trace in
Details (e.g. `re-verified: yes; env: n/a`). A refuted FAIL becomes
`PASS`/`SKIP`/`NEED_INFO`/error per what the battery showed. Sub-verdicts: a
refuted edge-case FAIL flips that line to `PASS`/`SKIP` with its trace in the
line's details clause; a prerequisite-class edge failure escalates to
scenario-level `NEED_INFO`; a harness-refuted edge failure (second attempt also
failed) flips that line to `SKIP — <tool failure>` (the scenario-level error
result is reserved for main-flow harness errors).

---

## Error Handling

- If Playwright is unavailable and the scenarios would apply here: return `NEED_INFO` with `kind: "tool"`, `missing: ["playwright"]` — matching the FE overlay's Step 2 probe. Reserve SKIP for scenarios that do not apply to this stack/environment at all (core prompt SKIP-vs-NEED_INFO rule).
- If a page doesn't load (timeout): run battery checks 1–2 first — one fresh attempt; app never reachable in this scenario → `NEED_INFO kind=service`; app answered earlier and then died → FAIL, take screenshot, note the URL.
- If an element is not found: take a fresh snapshot once (battery check 1); still missing → report what elements ARE visible, mark as FAIL.
- If the application shows an error page (500, crash): take screenshot, mark as FAIL with error details (the app is alive and answering — an app defect, not an environment gap).
