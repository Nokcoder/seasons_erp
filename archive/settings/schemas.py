# backend/settings/schemas.py
from pydantic import BaseModel
from typing import Optional

# --- Locations ---
class LocationBase(BaseModel):
    name: str
    type: Optional[str] = "Store"  # <--- ADD THIS LINE
    address: Optional[str] = ""
    status: str = "Active"

class LocationUpsert(LocationBase):
    id: Optional[int] = None

class LocationResponse(LocationBase):
    id: int
    class Config: from_attributes = True


# --- Registers ---
class RegisterBase(BaseModel):
   # id: str
    location_id: int
    name: str
    status: str = "Active"

class RegisterUpsert(RegisterBase):
    # SURGICAL FIX: Allows data.id to be checked in router without crashing (Fixes 500)
    # Defaults to None if frontend doesn't send it (Fixes 422)
    id: Optional[int] = None

class RegisterResponse(RegisterBase):
    id: int
    class Config: from_attributes = True

# --- Shifts ---
class ShiftBase(BaseModel):
    # id: str
    name: str
    start_time: str
    end_time: str

class ShiftUpsert(ShiftBase):
    id: Optional[int] = None

class ShiftResponse(ShiftBase):
    id: int
    class Config: from_attributes = True

# --- Payments ---
class PaymentMethodBase(BaseModel):
    name: str
    type: str = "Till"
    status: str = "Active"

class PaymentMethodUpsert(PaymentMethodBase):
    id: Optional[int] = None

class PaymentMethodResponse(PaymentMethodBase):
    id: int
    class Config: from_attributes = True

# --- Users ---
class UserCreate(BaseModel):
    username: str
    full_name: str
    role: str
    status: str = "Active"
    password: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    status: str
    class Config: from_attributes = True