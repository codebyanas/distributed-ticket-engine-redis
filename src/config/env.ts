import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Boot-time environment variable schema and validator.
 * Enforces strict typing and presence of critical environment variables.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_USER: z.string().default('admin'),
  POSTGRES_PASSWORD: z.string().default('secret'),
  POSTGRES_DB: z.string().default('eventlock_db'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
});

/**
 * Validates process.env against envSchema.
 * Throws and terminates process if validation fails.
 * 
 * @returns Parsed and strongly-typed environment variables.
 */
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment validation failed:', JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
