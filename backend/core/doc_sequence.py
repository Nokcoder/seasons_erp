# core/doc_sequence.py
"""Per-tenant document numbering (Phase 2).

Replaces the old global-serial-based PID assignment (f"SALE-{sale_id}") which
leaked cross-tenant volume and made every tenant's numbering continue from a
shared counter. Numbers now come from platform.document_sequences, scoped to the
caller's tenant (via the app.tenant_id GUC), and allocated with a row lock so
simultaneous callers in the same tenant serialize — no MAX()+1 race, no reliance
on retry-on-conflict in the POS checkout path.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

# doc_type -> PID format. CM (credit-memo) is intentionally absent: its code is a
# random suffix, not a sequential counter.
_FORMATS = {
    "SALE": "SALE-{:05d}",
    "RET":  "RET-{:05d}",
    "SRET": "SRET-{:05d}",
    "PO":   "PO-{:06d}",
    "SHP":  "SHP-{:06d}",
    "TRF":  "TRF-{:06d}",
}


def next_document_pid(db: Session, doc_type: str) -> str:
    """Atomically allocate the next per-tenant number for doc_type and return the
    formatted PID.

    Concurrency-safe: the INSERT..ON CONFLICT DO UPDATE takes a row lock on
    (tenant_id, doc_type) held until the surrounding transaction commits, so two
    simultaneous documents in the same tenant serialize and get distinct numbers.
    Because the allocation shares the request transaction, a rolled-back document
    also rolls back its number (no gaps from failed posts).

    A tenant with no counter row yet (e.g. a brand-new tenant's first document)
    is auto-started at 1 by the ON CONFLICT insert. Existing tenants were seeded
    to (their current max + 1) by the migration, so their numbering CONTINUES.
    """
    if doc_type not in _FORMATS:
        raise ValueError(f"Unknown document type: {doc_type}")
    n = db.execute(text("""
        INSERT INTO platform.document_sequences (tenant_id, doc_type, next_number)
        VALUES (current_setting('app.tenant_id')::int, :doc, 2)
        ON CONFLICT (tenant_id, doc_type)
        DO UPDATE SET next_number = platform.document_sequences.next_number + 1
        RETURNING next_number - 1
    """), {"doc": doc_type}).scalar()
    return _FORMATS[doc_type].format(n)


def peek_next_document_pid(db: Session, doc_type: str) -> str:
    """Non-consuming preview of the next PID for the caller's tenant (for
    GET /sales/next-pid). Reads the counter without incrementing so the preview
    matches what the next allocation will actually assign. A tenant with no row
    yet previews #1."""
    if doc_type not in _FORMATS:
        raise ValueError(f"Unknown document type: {doc_type}")
    n = db.execute(text("""
        SELECT next_number FROM platform.document_sequences
        WHERE tenant_id = current_setting('app.tenant_id')::int AND doc_type = :doc
    """), {"doc": doc_type}).scalar()
    return _FORMATS[doc_type].format(n if n is not None else 1)
