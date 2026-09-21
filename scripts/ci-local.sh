#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

echo
echo "=== Install dependencies ==="
pnpm install --frozen-lockfile

echo
echo "=== Start Docker services ==="
pnpm docker:start

echo
echo "=== Show Docker service status ==="
pnpm docker:status

export NODE_ENV=test
export PORT=5000
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD:-postgres123}@localhost:5432/ticket-engine-redis-db}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export JWT_SECRET="${JWT_SECRET:-test_jwt_secret_placeholder}"

echo
echo "=== Generate Prisma client ==="
pnpm prisma:generate

echo
echo "=== Push database schema ==="
until pnpm exec prisma db push; do
	echo "Waiting for PostgreSQL to accept Prisma connections..."
	sleep 3
done

echo
echo "=== Build and type-check ==="
pnpm build

echo
echo "=== Run Jest coverage tests ==="
pnpm test:cov

echo
echo "Local CI checks passed."
