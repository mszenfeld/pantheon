# Veles: QA plan from an export-PDF diff (grounding regression guard)

**Agent:** Veles - Planner
**Target codebase:** self-contained — the diff below is the complete change set;
plan only from it, do not read repo source, do not dispatch sub-agents, do not ask
clarifying questions. Save the plan and end with the required JSON.

## Query

> Generate a QA test plan for the following self-contained changes. The diff below
> is the complete and only change set — plan only from it.
>
> ```diff
> --- /dev/null
> +++ b/api/export/limiter.py
> @@
> +from slowapi import Limiter
> +from slowapi.util import get_remote_address
> +
> +# Fixed-window rate limiter keyed on the client IP.
> +# No strategy= kwarg → SlowAPI default is fixed-window.
> +limiter = Limiter(key_func=get_remote_address)
> --- /dev/null
> +++ b/api/export/auth.py
> @@
> +import os
> +import jwt
> +from fastapi import Depends, HTTPException, status
> +from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
> +
> +SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]
> +SUPABASE_JWT_ALGORITHM = os.environ.get("SUPABASE_JWT_ALGORITHM", "ES256")
> +
> +bearer = HTTPBearer()
> +
> +def get_current_user_id(
> +    creds: HTTPAuthorizationCredentials = Depends(bearer),
> +) -> str:
> +    """Validate JWT signature and claims; return the subject (user id).
> +
> +    NOTE: this dependency does NOT query the database.  A token that was
> +    issued before the user account was deleted will still pass this check.
> +    Ownership enforcement (and the resulting 404) happens in the endpoint.
> +    """
> +    try:
> +        payload = jwt.decode(
> +            creds.credentials,
> +            SUPABASE_JWT_SECRET,
> +            algorithms=[SUPABASE_JWT_ALGORITHM],
> +            audience="authenticated",
> +        )
> +    except jwt.PyJWTError:
> +        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
> +                            detail="invalid or expired token")
> +    return payload["sub"]
> --- /dev/null
> +++ b/api/export/router.py
> @@
> +import io
> +import os
> +from fastapi import APIRouter, Depends, HTTPException, Request
> +from reportlab.pdfgen import canvas as rl_canvas
> +from .auth import get_current_user_id
> +from .db import get_db                           # yields an AsyncSession
> +from .limiter import limiter
> +from .models import Entitlement                  # ORM: id, user_id, plan, valid_from, valid_to
> +
> +router = APIRouter()
> +
> +@router.get("/api/export/{doc_id}/pdf")
> +@limiter.limit("10/minute")
> +async def export_pdf(
> +    doc_id: str,
> +    request: Request,
> +    user_id: str = Depends(get_current_user_id),
> +    db=Depends(get_db),
> +):
> +    """Export a document as PDF.
> +
> +    Access is gated on a valid entitlement row.  `valid_to` is the expiry
> +    timestamp; a row with valid_to == now() is considered expired (boundary
> +    is exclusive: valid_to must be strictly GREATER THAN now()).
> +    """
> +    # Check entitlement (SELECT ... WHERE user_id = ? AND valid_to > now())
> +    entitlement = await db.scalar(
> +        "SELECT id FROM entitlements WHERE user_id = :uid AND valid_to > now()",
> +        {"uid": user_id},
> +    )
> +    if entitlement is None:
> +        raise HTTPException(status_code=403, detail="no active entitlement")
> +
> +    # Ownership: doc must belong to this user
> +    doc = await db.scalar(
> +        "SELECT title FROM documents WHERE id = :doc_id AND owner_id = :uid",
> +        {"doc_id": doc_id, "uid": user_id},
> +    )
> +    if doc is None:
> +        raise HTTPException(status_code=404, detail="document not found")
> +
> +    buf = io.BytesIO()
> +    c = rl_canvas.Canvas(buf)
> +    c.drawString(72, 800, doc)
> +    c.save()
> +    buf.seek(0)
> +    from fastapi.responses import Response
> +    return Response(content=buf.read(), media_type="application/pdf")
> --- /dev/null
> +++ b/supabase/config.toml
> @@
> +[api]
> +port = 54321
> +
> +[db]
> +port = 5432
> +
> +[auth]
> +jwt_algorithm = "ES256"
> +site_url = "http://localhost:3000"
> +
> +[studio]
> +port = 54323
> +
> +# Local Supabase REST API:  http://localhost:54321
> +# Local Supabase Auth API:  http://localhost:54321/auth/v1
> +# Local Supabase inbucket:  http://localhost:54324
> ```

## Expected coverage

**MUST:**
- Rate-limit scenario describes a **fixed-window** reset (penalize "sliding window").
- Auth: a valid token for a deleted/absent user passes auth and fails later on
  ownership (penalize "deleted-user → 401").
- Client IP via `get_remote_address` is host-based, not "IPv4-only" (penalize "IPv4-based").
- DB checks use the real column `valid_to` (incl. the `valid_to = now()` boundary).
- Setup targets the LOCAL Supabase from `config.toml` (ES256, local ports) — penalize
  a guessed remote `https://<ref>.supabase.co` + password grant.
- Every behavioral assertion carries a visible `(file:line)` citation OR an
  `(unverified — confirm at run time)` tag.

## Quality signals
- **Regression gate:** none of "sliding window" / "deleted-user→401" / "IPv4-based" appears.
- **Scope limit (see spec §A0):** because this is an embedded-diff scenario, the
  source is not on disk — this scenario validates citation/tag **form** + the
  local-vs-remote infra choice, NOT read-grounding. Real read-grounding is graded
  by the Layer-2 real-repo eval.

## What this discriminates
- Confidently-wrong behavioral claims (the three named errors); guessed remote infra;
  missing visible-citation/`(unverified)` discipline.
