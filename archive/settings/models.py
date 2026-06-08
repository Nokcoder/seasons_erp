# backend/settings/models.py
from sqlalchemy import Column, Integer, String, ForeignKey
from core.database import Base
from pydantic import BaseModel
from typing import Optional




class Register(Base):
    __tablename__ = "registers"
    __table_args__ = {"schema": "settings"}

    #id = Column(String, primary_key=True)
    id = Column(Integer, primary_key=True, index=True)
    # Update the reference to exactly match the database column
    location_id = Column(Integer, ForeignKey("inventory.locations.location_id"))

    name = Column(String, nullable=False)
    status = Column(String, default="Active")


class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = {"schema": "settings"}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)


class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    __table_args__ = {"schema": "settings"}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    status = Column(String, default="Active")


