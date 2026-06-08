# backend/settings/router.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import inspect # <-- ADD THIS IMPORT
from core.database import get_db
#from . import models, schemas
import hashlib  # For a simple placeholder password hash

from settings import schemas, models as setting_models


# IMPORT SCHEMAS AND LOCAL MODELS
from . import schemas
from . import models as setting_models

from auth.models import User
from inventory.models import Location

router = APIRouter(prefix="/settings", tags=["Settings"])


# --- GENERIC CRUD HELPERS ---
def get_all(db: Session, model):
    pk_column = inspect(model).primary_key[0]
    return db.query(model).order_by(pk_column).all()


# --- LOCATIONS ---
@router.get("/locations", response_model=list[schemas.LocationResponse])
def get_locations(db: Session = Depends(get_db)):
    locs = get_all(db, Location)
    # Translate location_id -> id for the frontend
    return [{**loc.__dict__, "id": loc.location_id} for loc in locs]


@router.post("/locations", response_model=schemas.LocationResponse)
def upsert_location(data: schemas.LocationUpsert, db: Session = Depends(get_db)):
    obj = db.query(Location).filter(Location.location_id == data.id).first()

    payload = data.model_dump(exclude={'id'} if not data.id else {})
    if obj:
        for key, value in payload.items():
            if key != 'id':
                setattr(obj, key, value)
    else:
        obj = Location(**payload)
        db.add(obj)

    db.commit()
    db.refresh(obj)
    return {**obj.__dict__, "id": obj.location_id}


# --- REGISTERS ---
@router.get("/registers", response_model=list[schemas.RegisterResponse])
def get_registers(db: Session = Depends(get_db)):
    return get_all(db, setting_models.Register)


# @router.post("/registers", response_model=schemas.RegisterResponse)
# def upsert_register(data: schemas.RegisterBase, db: Session = Depends(get_db)):
#     obj = db.query(setting_models.Register).filter(setting_models.Register.id == data.id).first()
#     if obj:
#         for key, value in data.model_dump().items():
#             setattr(obj, key, value)
#     else:
#         obj = setting_models.Register(**data.model_dump())
#         db.add(obj)
#     db.commit()
#     db.refresh(obj)
#     return obj

@router.post("/registers", response_model=schemas.RegisterResponse)
def upsert_register(data: schemas.RegisterUpsert, db: Session = Depends(get_db)):
    if data.id:
        # UPDATE
        obj = db.query(setting_models.Register).filter(setting_models.Register.id == data.id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Register not found")
        for key, value in data.dict(exclude={'id'}, exclude_unset=True).items():
            setattr(obj, key, value)
    else:
        # CREATE
        obj = setting_models.Register(**data.dict(exclude={'id'}))
        db.add(obj)

    db.commit()
    db.refresh(obj)
    return obj

# --- SHIFTS ---
@router.get("/shifts", response_model=list[schemas.ShiftResponse])
def get_shifts(db: Session = Depends(get_db)):
    return get_all(db, setting_models.Shift)


# @router.post("/shifts", response_model=schemas.ShiftResponse)
# def upsert_shift(data: schemas.ShiftBase, db: Session = Depends(get_db)):
#     obj = db.query(setting_models.Shift).filter(setting_models.Shift.id == data.id).first()
#     if obj:
#         for key, value in data.model_dump().items():
#             setattr(obj, key, value)
#     else:
#         obj = setting_models.Shift(**data.model_dump())
#         db.add(obj)
#     db.commit()
#     db.refresh(obj)
#     return obj


@router.post("/shifts", response_model=schemas.ShiftResponse)
def upsert_shift(data: schemas.ShiftUpsert, db: Session = Depends(get_db)):
    if data.id:
        # UPDATE
        obj = db.query(setting_models.Shift).filter(setting_models.Shift.id == data.id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Shift not found")
        for key, value in data.dict(exclude={'id'}, exclude_unset=True).items():
            setattr(obj, key, value)
    else:
        # CREATE
        obj = setting_models.Shift(**data.dict(exclude={'id'}))
        db.add(obj)

    db.commit()
    db.refresh(obj)
    return obj


# --- PAYMENTS ---
@router.get("/payments", response_model=list[schemas.PaymentMethodResponse])
def get_payments(db: Session = Depends(get_db)):
    return get_all(db, setting_models.PaymentMethod)


@router.post("/payments", response_model=schemas.PaymentMethodResponse)
# CHANGE PaymentMethodResponse to PaymentMethodUpsert right here:
def upsert_payment(data: schemas.PaymentMethodUpsert, db: Session = Depends(get_db)):
    obj = db.query(setting_models.PaymentMethod).filter(setting_models.PaymentMethod.id == data.id).first()
    if obj:
        for key, value in data.model_dump().items():
            setattr(obj, key, value)
    else:
        # We can now safely exclude the empty 'id' so the DB can auto-generate it
        obj = setting_models.PaymentMethod(**data.model_dump(exclude={'id'}))
        db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


# --- USERS ---
# @router.get("/users", response_model=list[schemas.UserResponse])
# def get_users(db: Session = Depends(get_db)):
#     users = get_all(db, User)
#     # Translate user_id -> id for the frontend
#     return [{**user.__dict__, "id": user.user_id} for user in users]
#
# @router.post("/users", response_model=schemas.UserResponse)
# def upsert_user(data: schemas.UserCreate, user_id: int = None, db: Session = Depends(get_db)):
#     obj = db.query(User).filter(User.user_id == user_id).first() if user_id else None
#
#     payload = data.model_dump(exclude={"password"})
#     if data.password:
#         payload["hashed_password"] = hashlib.sha256(data.password.encode()).hexdigest()
#
#     if obj:
#         for key, value in payload.items():
#             if key != 'id':
#                 setattr(obj, key, value)
#     else:
#         if not data.password:
#             raise HTTPException(status_code=400, detail="Password is required for new users")
#         obj = User(**payload)
#         db.add(obj)
#
#     db.commit()
#     db.refresh(obj)
#     return {**obj.__dict__, "id": obj.user_id}