# WISI Assistant crawler — Crawl4AI + Playwright Chromium. Deploy on Railway/Render as a Docker service.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Each step is its own RUN so a failure stops the build with a clear error.
RUN pip install -r requirements.txt && pip check
RUN python -m playwright install --with-deps chromium
# crawl4ai-setup only re-checks browsers (already installed above) and warms NLTK data; treat it as optional.
RUN crawl4ai-setup || echo "WARNING: crawl4ai-setup failed (non-fatal)"

# Fail the build early if the app or its deps can't be imported.
COPY . .
RUN python -c "import uvicorn, crawl4ai, main"

EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
