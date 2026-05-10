from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta

from core.database import get_db
from auth import models, schemas

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

SECRET_KEY = "super-secret-key-change-this-in-production"
ALGORITHM = "HS256"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


@router.post("/register")
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")

    hashed_pw = pwd_context.hash(user.password)
    new_user = models.User(username=user.username, hashed_password=hashed_pw, role=user.role)
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully"}


@router.post("/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()

    if not db_user or not pwd_context.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token_data = {"sub": db_user.username, "id": db_user.user_id, "role": db_user.role,
                  "exp": datetime.utcnow() + timedelta(hours=12)}
    token = jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)

    return {"access_token": token, "token_type": "bearer",
            "user": {"id": db_user.user_id, "username": db_user.username, "role": db_user.role}}


@router.get("/users")
def get_all_active_users(db: Session = Depends(get_db)):
    from auth.models import User  # Adjust import if your model is elsewhere!

    # Grab all active users so we can populate the dropdown
    users = db.query(User).filter(User.is_active == True).all()
    return users