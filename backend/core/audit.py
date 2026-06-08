# core/audit.py
from __future__ import annotations
from decimal import Decimal
from datetime import datetime, date
from typing import Optional
from sqlalchemy.orm import Session


def _serialize(obj) -> Optional[dict]:
    """Convert an ORM instance to a JSON-safe dict for audit log storage."""
    if obj is None:
        return None
    result = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, Decimal):
            val = str(val)
        elif isinstance(val, (datetime, date)):
            val = val.isoformat()
        elif hasattr(val, "value"):   # SQLAlchemy Enum
            val = val.value
        result[col.name] = val
    return result


def write_audit(
    db: Session,
    table_name: str,
    record_pk: str,
    action: str,                        # INSERT | UPDATE | DELETE
    actor_user_id: Optional[int] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
) -> None:
    """
    Append an immutable audit_log row to the current session.
    The caller is responsible for committing — this function does not commit.
    """
    from auth.models import AuditLog   # lazy import avoids circular deps
    db.add(AuditLog(
        table_name=table_name,
        record_pk=record_pk,
        action=action,
        actor_user_id=actor_user_id,
        old_values=old_values,
        new_values=new_values,
    ))
