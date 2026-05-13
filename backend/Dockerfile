# /seasons_erp/backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (for faster rebuilds)
COPY requirements.txt .

# --- THE FIX ---
# Upgrade pip to the latest version to handle large downloads better
RUN pip install --default-timeout=1000 --upgrade pip
# Add a generous 100-second timeout so it doesn't give up on slow connections
RUN pip install --default-timeout=1000 --no-cache-dir -r requirements.txt
# ---------------

# Copy the rest of your backend code
COPY . .

# Run Alembic migrations automatically, then start the FastAPI server
CMD bash -c "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"
