process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
const postgresPassword = process.env.POSTGRES_PASSWORD || 'test_password_placeholder';
process.env.DATABASE_URL = process.env.DATABASE_URL || `postgresql://postgres:${postgresPassword}@localhost:5432/ticket-engine-redis-db`;
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_placeholder';
process.env.RATE_LIMIT_WINDOW_MS = '1000';
process.env.RATE_LIMIT_MAX_REQUESTS = '3';