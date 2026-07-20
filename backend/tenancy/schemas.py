# tenancy/schemas.py
from pydantic import BaseModel, Field


class SignupRequest(BaseModel):
    business_name: str
    slug: str
    # max_length matches auth.users.username (String(100)); without it, an
    # over-long username reaches the DB and surfaces as a raw 500 instead of a
    # clean 422 validation error.
    admin_username: str = Field(..., min_length=1, max_length=100)
    admin_password: str = Field(..., min_length=1)


class SignupResponse(BaseModel):
    """Deliberately does NOT include a JWT — the client logs in normally after
    signup via POST /auth/login with {org_slug: slug, ...}. See router docstring.
    """
    tenant_id: int
    business_name: str
    slug: str
    admin_username: str
