# tenancy/validation.py
import re

# Reserved so a slug can never collide with a real or future URL path/prefix —
# relevant even without subdomain routing today, since slug also doubles as
# the login identifier typed at the login form.
RESERVED_SLUGS = {"www", "api", "admin", "platform", "app", "auth"}

_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def validate_slug(slug: str) -> str:
    """Validate an org slug: lowercase letters, digits, and single internal
    hyphens only (no leading/trailing/double hyphens), and not a reserved word.

    Returns the slug unchanged if valid; raises ValueError otherwise.
    """
    if not slug or not _SLUG_RE.match(slug):
        raise ValueError(
            "Slug must be lowercase letters, numbers, and hyphens only "
            "(no leading, trailing, or double hyphens)."
        )
    if slug in RESERVED_SLUGS:
        raise ValueError(f"'{slug}' is a reserved word and cannot be used as a slug.")
    return slug
