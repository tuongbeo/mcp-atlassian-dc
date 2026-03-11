FROM ghcr.io/astral-sh/uv:python3.13-alpine AS uv

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Copy dependency files first for layer caching
COPY pyproject.toml README.md ./
RUN uv lock

COPY uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev --no-editable

# Copy source and install project
COPY . /app
RUN uv sync --frozen --no-dev --no-editable

# Clean up unnecessary files
RUN find /app/.venv -name '__pycache__' -type d -exec rm -rf {} + && \
    find /app/.venv -name '*.pyc' -delete && \
    find /app/.venv -name '*.pyo' -delete

# Final stage
FROM python:3.13-alpine

RUN adduser -D -h /home/app -s /bin/sh app
WORKDIR /app
USER app

COPY --from=uv --chown=app:app /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["mcp-atlassian"]
