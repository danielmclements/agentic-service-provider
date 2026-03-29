import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/agentic_msp"),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("agentic-msp"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  AUTH0_DOMAIN: z.string().min(1).default("example.us.auth0.com"),
  AUTH0_AUDIENCE: z.string().min(1).default("https://agentic-service-provider/api"),
  AUTH0_ISSUER: z.string().optional(),
  AUTH0_CLIENT_ID: z.string().min(1).default("operator-console"),
  AUTH0_CLIENT_SECRET: z.string().optional(),
  AUTH0_CALLBACK_URL: z.string().min(1).default("http://localhost:4000/auth/callback"),
  AUTH0_LOGOUT_URL: z.string().min(1).default("http://localhost:4000/operator"),
  AUTH0_DEFAULT_ORGANIZATION: z.string().optional(),
  AUTH0_DEFAULT_CONNECTION: z.string().optional(),
  AUTH0_JWT_ALGORITHMS: z.string().default("HS256"),
  AUTH0_JWT_SECRET: z.string().optional(),
  AUTH0_JWT_PUBLIC_KEY: z.string().optional(),
  AUTH0_PERMISSIONS_CLAIM: z.string().default("permissions"),
  AUTH0_ROLES_CLAIM: z.string().default("https://agentic-service-provider/roles"),
  AUTH0_TENANT_CLAIM: z.string().default("https://agentic-service-provider/tenant_id"),
  AUTH0_MFA_FRESHNESS_SECONDS: z.coerce.number().default(300),
  SESSION_COOKIE_NAME: z.string().default("asp_operator_session"),
  AUTH_STATE_COOKIE_NAME: z.string().default("asp_auth_state"),
  AUTH_CODE_VERIFIER_COOKIE_NAME: z.string().default("asp_auth_code_verifier"),
  AUTH_NONCE_COOKIE_NAME: z.string().default("asp_auth_nonce")
});

export const env = envSchema.parse(process.env);

declare global {
  var __asp_prisma__: PrismaClient | undefined;
}

export const prisma =
  global.__asp_prisma__ ??
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL
      }
    }
  });

if (env.NODE_ENV !== "production") {
  global.__asp_prisma__ = prisma;
}
