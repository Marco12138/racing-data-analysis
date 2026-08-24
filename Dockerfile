FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg gosu libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-xrk.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install -r requirements-xrk.txt

COPY backend ./backend
COPY scripts/docker-entrypoint.sh /usr/local/bin/racing-api-entrypoint
RUN mkdir -p /app/storage /data \
    && useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app /data \
    && chmod 0755 /usr/local/bin/racing-api-entrypoint

WORKDIR /app/backend
EXPOSE 8000

ENTRYPOINT ["racing-api-entrypoint"]
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1} --proxy-headers"]
