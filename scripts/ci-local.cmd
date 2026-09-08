@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

echo.
echo === Install dependencies ===
call pnpm install --frozen-lockfile
if errorlevel 1 goto failed

echo.
echo === Start Docker services ===
call pnpm docker:start
if errorlevel 1 goto failed

echo.
echo === Show Docker service status ===
call pnpm docker:status
if errorlevel 1 goto failed

set "NODE_ENV=test"
set "PORT=5000"
set "DATABASE_URL=postgresql://postgres:test_password_placeholder@localhost:5432/ticket-engine-redis-db"
set "REDIS_URL=redis://localhost:6379"
set "JWT_SECRET=test_jwt_secret_placeholder"

echo.
echo === Generate Prisma client ===
call pnpm prisma:generate
if errorlevel 1 goto failed

echo.
echo === Push database schema ===
call pnpm exec prisma db push
if errorlevel 1 goto failed

echo.
echo === Build and type-check ===
call pnpm build
if errorlevel 1 goto failed

echo.
echo === Run Jest coverage tests ===
call pnpm test:cov
if errorlevel 1 goto failed

echo.
echo Local CI checks passed.
exit /b 0

:failed
echo.
echo Local CI failed. Review the step above for the error.
exit /b 1
