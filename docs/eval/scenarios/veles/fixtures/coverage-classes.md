# Export-PDF coverage classes (from spec §0.2 / C1)

Named behavior classes Plan B missed — A3 MUST-cover these for the export-PDF surface:

- Entitlement expiry boundary: `valid_to = now()` (exactly-expired is treated as expired).
- One expired + one active entitlement → the active one wins.
- Rate limit counts ALL results, not only 200s.
- Lock cleanup / no lock leak; lock is per-cv_id, not global.
- Independence of /duplicate vs /export rate limits.
- Multiple 502 triggers: PDF_WORKER_API_KEY mismatch → worker 401 → 502; missing key → 500 → 502; container stopped; worker 400.
- Content-Disposition filename correctness across unicode names (e.g. "Łukasz Żółć" → `lukasz-zolc.pdf`).
