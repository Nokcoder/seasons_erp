# /seasons_erp/backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (for faster rebuilds)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your backend code
COPY . .

# Run Alembic migrations automatically, then start the FastAPI server
CMD bash -c "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"