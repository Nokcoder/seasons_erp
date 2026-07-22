# settings/schemas.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class InventoryPolicyOut(BaseModel):
    allow_negative_stock:   bool
    updated_at:             Optional[datetime] = None
    updated_by_user_id:     Optional[int]      = None
    updated_by_username:    Optional[str]      = None


class InventoryPolicyPatch(BaseModel):
    allow_negative_stock: bool


class ReceiptsSettingOut(BaseModel):
    receipts_enabled:    bool
    updated_at:          Optional[datetime] = None
    updated_by_user_id:  Optional[int]      = None
    updated_by_username: Optional[str]      = None


class ReceiptsSettingPatch(BaseModel):
    receipts_enabled: bool


class ReceiptsAutoPrintSettingOut(BaseModel):
    receipts_auto_print: bool
    updated_at:          Optional[datetime] = None
    updated_by_user_id:  Optional[int]      = None
    updated_by_username: Optional[str]      = None


class ReceiptsAutoPrintSettingPatch(BaseModel):
    receipts_auto_print: bool


# ── Print templates (server-side storage) ────────────────────────────────────

class PrintTemplateOut(BaseModel):
    template_id:        UUID
    name:               str
    doc_type:           str
    template:           dict
    created_at:         datetime
    updated_at:         datetime
    created_by_user_id: Optional[int] = None
    updated_by_user_id: Optional[int] = None
    is_deleted:         bool
    class Config: from_attributes = True


class PrintTemplateCreate(BaseModel):
    name:        str
    doc_type:    str
    template:    dict
    # Optional client-supplied UUID so existing designer ids (and the Phase 4
    # import) are preserved rather than remapped. Omit to let the DB generate one.
    template_id: Optional[UUID] = None


class PrintTemplatePatch(BaseModel):
    name:     Optional[str]  = None
    doc_type: Optional[str]  = None
    template: Optional[dict] = None


class FunctionAssignmentOut(BaseModel):
    function_key: str
    template_id:  Optional[UUID]     = None
    updated_at:   Optional[datetime] = None
    class Config: from_attributes = True


class FunctionAssignmentPut(BaseModel):
    # null clears the assignment (function becomes unassigned → built-in default).
    template_id: Optional[UUID] = None


class ResolvedTemplateOut(BaseModel):
    """Resolve result for a function. assigned=False (template null) when the
    function is unassigned OR its template was soft-deleted — the client then
    falls back to the built-in default."""
    assigned: bool
    template: Optional[PrintTemplateOut] = None


