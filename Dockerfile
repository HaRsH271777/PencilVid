# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_PUBLIC_DEMO_URL
ARG VITE_PUBLIC_DEMO_POSTER_URL
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_PUBLIC_DEMO_URL=${VITE_PUBLIC_DEMO_URL} \
    VITE_PUBLIC_DEMO_POSTER_URL=${VITE_PUBLIC_DEMO_POSTER_URL}
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    JOB_EXECUTION_MODE=queue \
    USE_STREAMING=0 \
    TTS_BACKEND=espeak \
    ESPEAK_BIN=espeak-ng \
    FFMPEG_BIN=ffmpeg \
    FFPROBE_BIN=ffprobe \
    HOME=/home/pencilvid \
    OUTPUT_DIR=/app/outputs \
    WORK_DIR=/app/work \
    DOC_UPLOAD_DIR=/app/work/uploads \
    ICON_CACHE_DIR=/app/work/icon_cache \
    RUN_LOGS_DIR=/app/work/logs/runs

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      dumb-init \
      espeak-ng \
      ffmpeg \
      fonts-dejavu-core \
      fonts-liberation \
      libcairo2 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements.lock ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && pip install -r requirements.lock

COPY --chown=10001:10001 . .
COPY --from=frontend-build --chown=10001:10001 /build/frontend/dist /app/frontend/dist
RUN mkdir -p /home/pencilvid /app/work/uploads /app/work/icon_cache \
      /app/work/logs/runs /app/outputs \
    && chown -R 10001:10001 /home/pencilvid /app/work /app/outputs

USER 10001:10001
EXPOSE 5000
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-5000} --workers ${WEB_WORKERS:-2} --threads ${WEB_THREADS:-4} --timeout ${WEB_TIMEOUT_SECONDS:-120} --graceful-timeout 30 --access-logfile - --error-logfile - app:app"]
