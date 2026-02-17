# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend + built frontend
FROM python:3.12-slim

# OCI metadata labels
LABEL org.opencontainers.image.title="GridMind"
LABEL org.opencontainers.image.description="Personal Tesla Powerwall 3 automation and monitoring app"
LABEL org.opencontainers.image.url="https://github.com/smidley/gridmind"
LABEL org.opencontainers.image.source="https://github.com/smidley/gridmind"
LABEL org.opencontainers.image.vendor="smidley"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install system dependencies first (rarely changes, caches well)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (only re-runs when requirements.txt changes)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend into backend's static directory
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create data directory
RUN mkdir -p /app/data

# Environment defaults
ENV GRIDMIND_DATA_DIR=/app/data
ENV GRIDMIND_HOST=0.0.0.0
ENV GRIDMIND_PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

WORKDIR /app/backend

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
