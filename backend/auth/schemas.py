from pydantic import BaseModel

class UserSchema(BaseModel):
    user_id: int
    username: str
    role: str
    class Config: from_attributes = True

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "WAREHOUSE_STAFF"

class UserLogin(BaseModel):
    username: str
    password: str