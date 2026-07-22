# settings/print_router.py
#
# Server-side print template storage API (Phase 2). Templates + function
# assignments live in settings.print_templates / print_function_assignments,
# tenant-scoped by RLS (every query runs on get_db, which SET LOCAL app.tenant_id).
#
# Permission split:
#   Reads  — auth-only (router-level get_current_user), so cashiers can resolve
#            and print the assigned template at checkout.
#   Writes — require_permission("manage_print_templates"), admin-gated.
#
# Deletes are SOFT (is_deleted = true, never hard-deleted). A function whose
# assigned template was soft-deleted resolves to "unassigned" so the client falls
# back to the built-in default (locked decision) — never a 404/500.

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from core.database import get_db
from core.audit import write_audit, _serialize
from auth.dependencies import get_current_user, require_permission
from auth.models import User
from settings import models, schemas

router = APIRouter(
    prefix="/print",
    tags=["Print Templates"],
    dependencies=[Depends(get_current_user)],
)

_TEMPLATES_TBL = "settings.print_templates"
_ASSIGN_TBL = "settings.print_function_assignments"


def _live_template(db: Session, template_id: UUID) -> models.PrintTemplate:
    row = (
        db.query(models.PrintTemplate)
        .filter(models.PrintTemplate.template_id == template_id,
                models.PrintTemplate.is_deleted.is_(False))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return row


# ── Reads (auth-only) ─────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[schemas.PrintTemplateOut])
def list_templates(db: Session = Depends(get_db)):
    return (
        db.query(models.PrintTemplate)
        .filter(models.PrintTemplate.is_deleted.is_(False))
        .order_by(models.PrintTemplate.updated_at.desc())
        .all()
    )


@router.get("/templates/{template_id}", response_model=schemas.PrintTemplateOut)
def get_template(template_id: UUID, db: Session = Depends(get_db)):
    return _live_template(db, template_id)


@router.get("/functions", response_model=list[schemas.FunctionAssignmentOut])
def list_assignments(db: Session = Depends(get_db)):
    return db.query(models.PrintFunctionAssignment).all()


@router.get("/functions/{function_key}/template", response_model=schemas.ResolvedTemplateOut)
def resolve_function_template(function_key: str, db: Session = Depends(get_db)):
    assign = (
        db.query(models.PrintFunctionAssignment)
        .filter(models.PrintFunctionAssignment.function_key == function_key)
        .first()
    )
    if not assign or assign.template_id is None:
        return schemas.ResolvedTemplateOut(assigned=False, template=None)
    tpl = (
        db.query(models.PrintTemplate)
        .filter(models.PrintTemplate.template_id == assign.template_id,
                models.PrintTemplate.is_deleted.is_(False))
        .first()
    )
    # Soft-deleted (or missing) assigned template → unassigned, client falls back.
    if not tpl:
        return schemas.ResolvedTemplateOut(assigned=False, template=None)
    return schemas.ResolvedTemplateOut(assigned=True, template=schemas.PrintTemplateOut.model_validate(tpl))


# ── Writes (manage_print_templates) ───────────────────────────────────────────

@router.post("/templates", response_model=schemas.PrintTemplateOut, status_code=201)
def create_template(
    payload: schemas.PrintTemplateCreate,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_print_templates")),
):
    # Friendly conflict for an id already present in this tenant (e.g. a retry),
    # instead of surfacing the raw DB PK violation.
    if payload.template_id is not None:
        exists = (
            db.query(models.PrintTemplate.template_id)
            .filter(models.PrintTemplate.template_id == payload.template_id)
            .first()
        )
        if exists:
            raise HTTPException(status_code=409, detail=f"A template with id {payload.template_id} already exists.")

    row = models.PrintTemplate(
        name=payload.name,
        doc_type=payload.doc_type,
        template=payload.template,
        created_by_user_id=_actor.user_id,
        updated_by_user_id=_actor.user_id,
    )
    if payload.template_id is not None:
        row.template_id = payload.template_id
    db.add(row)
    try:
        db.flush()  # assign PK / defaults; a PK collision surfaces here
    except IntegrityError:
        # Safety net for a race or a cross-tenant id collision the RLS-scoped
        # pre-check above can't see. Reset the session and return a clean 409.
        db.rollback()
        raise HTTPException(status_code=409, detail="A template with this id already exists.")
    write_audit(db, _TEMPLATES_TBL, str(row.template_id), "INSERT",
                actor_user_id=_actor.user_id, new_values=_serialize(row))
    db.commit()
    db.refresh(row)
    return row


@router.patch("/templates/{template_id}", response_model=schemas.PrintTemplateOut)
def update_template(
    template_id: UUID,
    payload: schemas.PrintTemplatePatch,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_print_templates")),
):
    row = _live_template(db, template_id)
    old = _serialize(row)
    if payload.name is not None:
        row.name = payload.name
    if payload.doc_type is not None:
        row.doc_type = payload.doc_type
    if payload.template is not None:
        row.template = payload.template
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by_user_id = _actor.user_id
    write_audit(db, _TEMPLATES_TBL, str(template_id), "UPDATE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(row))
    db.commit()
    db.refresh(row)
    return row


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_print_templates")),
):
    row = _live_template(db, template_id)
    old = _serialize(row)
    row.is_deleted = True
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by_user_id = _actor.user_id
    write_audit(db, _TEMPLATES_TBL, str(template_id), "DELETE",
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(row))
    db.commit()
    return Response(status_code=204)


@router.put("/functions/{function_key}", response_model=schemas.FunctionAssignmentOut)
def assign_function(
    function_key: str,
    payload: schemas.FunctionAssignmentPut,
    db: Session = Depends(get_db),
    _actor: User = Depends(require_permission("manage_print_templates")),
):
    # Validate the target template exists (and is live) when assigning one.
    if payload.template_id is not None:
        _live_template(db, payload.template_id)

    assign = (
        db.query(models.PrintFunctionAssignment)
        .filter(models.PrintFunctionAssignment.function_key == function_key)
        .first()
    )
    if assign:
        old = _serialize(assign)
        assign.template_id = payload.template_id
        assign.updated_at = datetime.now(timezone.utc)
        assign.updated_by_user_id = _actor.user_id
        action = "UPDATE"
    else:
        assign = models.PrintFunctionAssignment(
            function_key=function_key,
            template_id=payload.template_id,
            updated_by_user_id=_actor.user_id,
        )
        db.add(assign)
        db.flush()
        old = None
        action = "INSERT"
    write_audit(db, _ASSIGN_TBL, str(assign.assignment_id), action,
                actor_user_id=_actor.user_id, old_values=old, new_values=_serialize(assign))
    db.commit()
    db.refresh(assign)
    return assign
