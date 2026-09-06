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
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
});

type ParsedEnv = z.infer<typeof envSchema>;

/**
 * Validates process.env against envSchema.
 * Throws and terminates process if validation fails.
 * 
 * @returns Parsed and strongly-typed environment variables.
 */
const parseEnv = (): ParsedEnv => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || 'root',
      message: issue.message,
    }));
    console.error('Environment validation failed:', JSON.stringify(issues, null, 2));
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();
export type Env = ParsedEnv;
