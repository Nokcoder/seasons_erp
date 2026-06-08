# import_hub/schemas.py
from __future__ import annotations
from typing import Any, Dict, List, Optional
from decimal import Decimal
from pydantic import BaseModel


# ── Row types sent by the frontend (parsed from XLSX) ─────────────────────────

class CustomerImportRow(BaseModel):
    row_number: int
    customer_name: str
    credit_limit: Optional[str] = None   # raw string; '' = blank
    terms_days: Optional[str] = None
    clear_credit_limit: bool = False      # set if cell contains "no limit"


class SupplierImportRow(BaseModel):
    row_number: int
    supplier_code: str
    supplier_name: Optional[str] = None
    terms: Optional[str] = None
    bank_account_name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None


class StockBalanceImportRow(BaseModel):
    row_number: int
    PID: str
    location_name: str
    quantity: str   # raw string
    notes: Optional[str] = None


class VariantPriceImportRow(BaseModel):
    row_number: int
    PID: str
    price: Optional[str] = None
    promo_price: Optional[str] = None
    clear_promo: Optional[str] = None    # "true"/"yes" → clear


class VariantCostImportRow(BaseModel):
    row_number: int
    PID: str
    supplier_code: str
    gross_cost: Optional[str] = None
    supplier_discount: Optional[str] = None


# ── Request wrappers ──────────────────────────────────────────────────────────

class CustomerPreviewRequest(BaseModel):
    rows: List[CustomerImportRow]

class SupplierPreviewRequest(BaseModel):
    rows: List[SupplierImportRow]

class StockBalancePreviewRequest(BaseModel):
    rows: List[StockBalanceImportRow]

class VariantPricePreviewRequest(BaseModel):
    rows: List[VariantPriceImportRow]

class VariantCostPreviewRequest(BaseModel):
    rows: List[VariantCostImportRow]


class ImportConfirmRequest(BaseModel):
    confirmed_anchors: List[str]


# ── Combined confirm requests (anchors + rows in one body) ────────────────────

class CustomerConfirmRequest(BaseModel):
    confirmed_anchors: List[str]
    rows: List[CustomerImportRow]

class SupplierConfirmRequest(BaseModel):
    confirmed_anchors: List[str]
    rows: List[SupplierImportRow]

class StockBalanceConfirmRequest(BaseModel):
    confirmed_anchors: List[str]
    rows: List[StockBalanceImportRow]

class VariantPriceConfirmRequest(BaseModel):
    confirmed_anchors: List[str]
    rows: List[VariantPriceImportRow]

class VariantCostConfirmRequest(BaseModel):
    confirmed_anchors: List[str]
    rows: List[VariantCostImportRow]


# ── Preview response ──────────────────────────────────────────────────────────

class ImportDiffRow(BaseModel):
    row_number:  int
    anchor:      str
    mode:        str                            # 'create' | 'update' | 'noop'
    old_values:  Optional[Dict[str, Any]] = None
    new_values:  Dict[str, Any]
    diff_fields: List[str] = []


class ImportErrorRow(BaseModel):
    row_number: int
    anchor:     str
    error:      str


class ImportSummary(BaseModel):
    creates: int
    updates: int
    noops:   int
    errors:  int


class ImportPreviewResponse(BaseModel):
    valid_rows: List[ImportDiffRow]
    error_rows: List[ImportErrorRow]
    summary:    ImportSummary


# ── Confirm response ──────────────────────────────────────────────────────────

class ImportConfirmResponse(BaseModel):
    written: int
    skipped: int
    errors:  List[ImportErrorRow]
