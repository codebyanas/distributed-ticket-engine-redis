# Production Deployment & DevOps Playbook
> **Stack Focus:** Node.js / TypeScript, Prisma, PostgreSQL, Redis, Docker, GitHub Actions, Low-Memory VMs (1GB RAM).

---

## 📌 Executive Summary
This playbook synthesizes critical lessons learned from resolving cascading deployment failures across Docker containers, Prisma ORM migrations, PostgreSQL authentication persistence, and low-memory Linux virtual machines. 

Use this guide as a **Day-One Blueprint** for future projects to eliminate configuration drift, Out-Of-Memory (OOM) crashes, and CI/CD bottlenecks.

---

## 📑 Table of Contents
1. [Core Architectural Rules](#-core-architectural-rules)
2. [Detailed Post-Mortem & Technical Lessons](#-detailed-post-mortem--technical-lessons)
   - [1. Package Dependency & Runtime Pruning](#1-package-dependency--runtime-pruning)
   - [2. Cross-Platform Scripting & Shell Compatibility](#2-cross-platform-scripting--shell-compatibility)
   - [3. Database Password Persistence & Volume Freezing](#3-database-password-persistence--volume-freezing)
   - [4. Multi-File Prisma Schema & Runtime Docker Baking](#4-multi-file-prisma-schema--runtime-docker-baking)
   - [5. Host-to-Container Volume Mount Pitfalls](#5-host-to-container-volume-mount-pitfalls)
   - [6. Service Readiness vs. Container Running State](#6-service-readiness-vs-container-running-state)
   - [7. Memory Overhead & OOM (Exit Status 137)](#7-memory-overhead--oom-exit-status-137)
   - [8. GitHub Actions Commit Revision & Re-Run Traps](#8-github-actions-commit-revision--re-run-traps)
3. [Production-Ready Configuration Templates](#-production-ready-configuration-templates)
   - [Dockerfile (Multi-Stage with Baked Prisma)](#dockerfile-multi-stage)
   - [Docker Compose (`docker-compose.yml`)](#docker-compose-docker-composeyml)
   - [Staggered SSH Deployment Script (`deploy.sh`)](#staggered-ssh-deployment-script)
4. [Day-One Pre-Flight Checklist](#-day-one-pre-flight-checklist)

---

## 🛡️ Core Architectural Rules

1. **Bake, Don't Mount:** Always copy Prisma schemas and configuration files directly into Docker runtime images during the build phase. Do not rely on relative host volume mounts (`-v ./prisma:...`) in production or CI/CD.
2. **Single Source of Credential Truth:** Passwords must flow strictly from `.env` or CI Secrets down to `docker-compose.yml` using `${POSTGRES_PASSWORD}` syntax. Never hardcode fallback strings in shell scripts.
3. **Control Memory Execution:** On 1GB RAM instances, never execute `docker compose up -d` for the entire stack at once. Use staggered startup (Dependencies $\rightarrow$ Migrations $\rightarrow$ Apps) and always enable 2GB swap space.
4. **Direct Binary Execution:** Run pre-installed node binaries directly (`./node_modules/.bin/prisma`) inside production containers. Avoid `npx`, `pnpm exec`, or `corepack` at runtime to prevent RAM spikes.
5. **Verify Commit SHAs in CI:** Never use GitHub UI's "Re-run failed jobs" after pushing new commits. Always confirm that the running workflow's Git commit SHA matches your latest remote commit (`git rev-parse HEAD`).

---

## 🔍 Detailed Post-Mortem & Technical Lessons

### 1. Package Dependency & Runtime Pruning
* **The Error:** `Process exited with status 127` (Command / Binary not found).
* **Root Cause:** Moving `prisma` to `devDependencies` caused `pnpm prune --prod` to remove the `./node_modules/.bin/prisma` executable during the production Docker build stage.
* **Prevention:** Any CLI utility executed inside production containers (e.g., `prisma db push`, `knex migrate`, DB seeds) **must** reside in main `dependencies` in `package.json`.

---

### 2. Cross-Platform Scripting & Shell Compatibility
* **The Error:** `scriptsci-local.cmd: not found` or syntax failure on Linux runners.
* **Root Cause:** `package.json` called Windows-specific backslash paths (`scripts\ci-local.cmd`). Linux environments interpret backslashes as escape characters rather than directory separators.
* **Prevention:** 
  - Standardize package scripts on POSIX syntax: `"ci:local": "sh scripts/ci-local.sh"`.
  - Maintain OS-neutral bash scripts for local and CI workflows, or use cross-platform Node.js runners (`zx`, `tsx`).

---

### 3. Database Password Persistence & Volume Freezing
* **The Error:** `P1000: Authentication failed against database server`.
* **Root Cause:** The official PostgreSQL Docker image initializes its database directory (`/var/lib/postgresql/data`) and credentials **only on the first run**. Updating `.env` or `docker-compose.yml` passwords afterwards has no effect on an existing named volume (`postgres_data`).
* **Prevention:**
  - **Local Development:** Reset volumes explicitly when credentials change: `docker compose down -v`.
  - **Production:** Never run `down -v`. Execute `ALTER USER postgres WITH PASSWORD 'new_pass';` directly inside the running container, then update environment secrets.
  - Eliminate hardcoded fallback credentials in helper scripts (e.g., `ci-local.sh`).

---

### 4. Multi-File Prisma Schema & Runtime Docker Baking
* **The Error:** `Could not find Prisma Schema that is required for this command`.
* **Root Cause:** Projects using custom/multi-file schema layouts (`schema: "prisma/schema"`) require both the schema directory **and** `prisma.config.ts`. In multi-stage Docker builds, build stage assets do not automatically transfer to the final runtime stage unless explicitly copied.
* **Prevention:** Ensure the final stage in your `Dockerfile` explicitly includes:
  ```dockerfile
  COPY --from=build /app/prisma.config.ts ./
  COPY prisma ./prisma
  ```

---

### 5. Host-to-Container Volume Mount Pitfalls
* **The Error:** `prisma/schema.prisma: file not found` during `docker compose run`.
* **Root Cause:** Relative host volume paths (`-v ./prisma:/app/prisma`) resolve differently across local OS, GitHub Codespaces, and remote cloud VMs. If the parent config or schema fragment is missing from the mount, Prisma fails completely.
* **Prevention:** Eliminate volume mounts for code and config files in deployment scripts. Rely exclusively on files baked into the image.

---

### 6. Service Readiness vs. Container Running State
* **The Error:** `P1001: Can't reach database server`.
* **Root Cause:** Running `docker compose up -d postgres` starts the container process, but the PostgreSQL database process takes several seconds to accept incoming socket connections.
* **Prevention:**
  - Use healthchecks with `condition: service_healthy` or `docker compose up -d --wait postgres`.
  - Wrap migration commands in a retry loop:
    ```sh
    until ./node_modules/.bin/prisma db push; do
      echo "Waiting for PostgreSQL connection..."
      sleep 2
    done
    ```

---

### 7. Memory Overhead & OOM (Exit Status 137)
* **The Error:** `Process exited with status 137` (SIGKILL by Linux OOM Killer).
* **Root Cause:** Concurrent builds and simultaneous container startups (`app`, `worker`, `postgres`, `redis`, `migrate`) exceed 1GB RAM. Dynamic package runners (`npx`, `corepack`) also introduce significant memory spikes.
* **Prevention:**
  - **Configure Swap:** Allocate a 2GB `/swapfile` on low-cost single-core VMs.
  - **Direct Binaries:** Execute `./node_modules/.bin/prisma` directly.
  - **Stagger Startup:** Launch infrastructure containers first, run migrations in isolation, and start application services last.

---

### 8. GitHub Actions Commit Revision & Re-Run Traps
* **The Error:** Fixes committed locally fail to reflect during remote deployment.
* **Root Cause:** Clicking "Re-run jobs" on a failed GitHub Actions run re-executes the **historical commit SHA** associated with that run, ignoring newer commits pushed to `main`.
* **Prevention:**
  - Always verify the Git commit hash in deployment logs: `HEAD is now at <commit_sha>`.
  - Always push a new commit to trigger a fresh GitHub Actions workflow run instead of re-running stale jobs.

---

## 🛠️ Production-Ready Configuration Templates

### Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: Base
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Stage 2: Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.prisma.json ./
RUN pnpm install --frozen-lockfile

# Stage 3: Build
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm prisma generate
RUN pnpm build

# Stage 4: Production Dependencies Prune
FROM deps AS prod-deps
RUN pnpm prune --prod

# Stage 5: Final Runtime Image
FROM base AS runner
ENV NODE_ENV=production

# Copy node_modules and built dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# CRITICAL: Copy Prisma schemas and config files for runtime migrations
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

EXPOSE 5000
CMD ["node", "dist/server.js"]
```

---

### Docker Compose (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    restart: always
    ports:
      - "5432:5432"
    env_file:
      - .env
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres123}
      POSTGRES_DB: ${POSTGRES_DB:-ticket_db}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-ticket_db}"]
      interval: 3s
      timeout: 3s
      retries: 10
      start_period: 5s

  redis:
    image: redis:7-alpine
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 10

  app:
    build: .
    restart: always
    ports:
      - "5000:5000"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres123}@postgres:5432/${POSTGRES_DB:-ticket_db}?schema=public
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:
    build: .
    restart: always
    command: ["node", "dist/workers/worker.js"]
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres123}@postgres:5432/${POSTGRES_DB:-ticket_db}?schema=public
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

---

### Staggered SSH Deployment Script

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$HOME/distributed-ticket-engine-redis"
cd "$PROJECT_DIR"

echo "=== 1. Cleaning Git Locks and Syncing Code ==="
rm -f .git/refs/remotes/origin/main.lock .git/index.lock .git/FETCH_HEAD || true
git fetch origin main --prune --force
git reset --hard origin/main

echo "=== 2. Stopping Old Containers ==="
docker compose down --remove-orphans || true

echo "=== 3. Starting Database & Redis (Low-Memory Stagger) ==="
docker compose up -d --build postgres redis

echo "=== 4. Waiting for PostgreSQL Readiness ==="
until docker compose exec -T postgres pg_isready -U postgres; do
  echo "Waiting for database socket..."
  sleep 2
done

echo "=== 5. Running Database Migrations in Isolated Container ==="
docker compose run --rm app ./node_modules/.bin/prisma db push

echo "=== 6. Launching Application & Worker Services ==="
docker compose up -d app worker

echo "=== 7. Cleaning Build Cache ==="
docker builder prune -f

echo "✅ Deployment completed successfully!"
```

---

## 📋 Day-One Pre-Flight Checklist

Before pushing new features or deploying to production, verify every item:

### 📦 Package & Script Verification
- [ ] `"prisma"` is listed in `"dependencies"` (not `"devDependencies"`).
- [ ] All package scripts use POSIX-compliant paths (`sh scripts/ci-local.sh`).
- [ ] No Windows-specific batch scripts (`.cmd`) are invoked inside Linux pipelines.

### 🐳 Docker & Multi-Stage Image Design
- [ ] `Dockerfile` copies `prisma/` schema folder into the final runtime image.
- [ ] `Dockerfile` copies custom configuration files (`prisma.config.ts`) into the final runtime image.
- [ ] Direct binaries (`./node_modules/.bin/prisma`) are used instead of `npx` or `pnpm exec`.

### 🔑 Environment & Credentials Single Source of Truth
- [ ] `docker-compose.yml` uses `${POSTGRES_PASSWORD}` variables matching `.env`.
- [ ] Fallback connection strings in shell scripts match `.env` default values.
- [ ] Local database credential updates are accompanied by `docker compose down -v`.

### ⚙️ Low-Memory VM & Deployment Sequence
- [ ] Server has a 2GB Swap file configured (`swapon --show`).
- [ ] Deployment script executes in staggered order: DB/Redis $\rightarrow$ Migration $\rightarrow$ App/Worker.
- [ ] Database readiness (`pg_isready`) is confirmed before migration execution.
- [ ] Latest Git commit SHA matches the running GitHub Actions workflow execution log.