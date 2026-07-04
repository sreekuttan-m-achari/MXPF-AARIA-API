# syntax=docker/dockerfile:1

# AARIA API + TUI — Cursor-SDK work-desk assistant.
# tsx runs the TypeScript sources directly, so no separate build step is needed.
FROM node:22-bookworm-slim

# uv / uvx power the bundled `mcp-server-fetch` MCP (only used when MCP is enabled).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV NODE_ENV=production \
    HOME=/home/aria \
    AARIA_WS_HOST=0.0.0.0 \
    AARIA_WS_PORT=8788 \
    AARIA_API_URL=http://127.0.0.1:8788

# Non-root runtime user. The Cursor SDK persists agent state under $HOME/.cursor,
# so a fresh named volume mounted there inherits this ownership.
RUN groupadd --gid 1001 aria \
 && useradd --uid 1001 --gid 1001 --home-dir /home/aria --create-home --shell /bin/bash aria \
 && mkdir -p /home/aria/.cursor \
 && chown -R aria:aria /home/aria

WORKDIR /app

# Dependencies first for better layer caching. Dev deps are required (tsx/typescript).
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

# Application source (exclusions live in .dockerignore).
COPY . .
RUN chown -R aria:aria /app

USER aria
EXPOSE 8788

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AARIA_WS_PORT||8788)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# API server. Override with `aaria` to launch the TUI (see docker-compose `tui` service).
CMD ["npm", "start"]
