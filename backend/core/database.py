import os
from urllib.parse import quote_plus
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load the variables from .env into the system environment
load_dotenv()

# Extract variables with fallbacks for safety
db_user = os.getenv("DB_USER")
db_password = os.getenv("DB_PASSWORD")
db_host = os.getenv("DB_HOST", "db")   # <--- Added 'db' as the default Docker fallback
db_port = os.getenv("DB_PORT", "5432")
db_name = os.getenv("DB_NAME")

# Safely URL-encode the password to handle special characters
safe_password = quote_plus(db_password) if db_password else ""

# Construct the URL dynamically USING the safe_password
DATABASE_URL = f"postgresql+psycopg2://{db_user}:{safe_password}@{db_host}:{db_port}/{db_name}"

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
