# settings/schemas.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class InventoryPolicyOut(BaseModel):
    allow_negative_stock:   bool
    updated_at:             Optional[datetime] = None
    updated_by_user_id:     Optional[int]      = None
    updated_by_username:    Optional[str]      = None


class InventoryPolicyPatch(BaseModel):
    allow_negative_stock: bool


