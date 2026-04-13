import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import { z } from "zod";

loadEnv();

function readSecretFile(path: string | undefined) {
  if (!path) {
    return undefined;
  }

  return fs.readFileSync(path, "utf8").trim();
}

function resolveSecret(name: string) {
  const inlineValue = process.env[name];
  if (inlineValue) {
    return inlineValue;
  }

  const fileValue = readSecretFile(process.env[`${name}_FILE`]);
  if (fileValue) {
    process.env[name] = fileValue;
    return fileValue;
  }

  return undefined;
}

[
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_MANAGEMENT_CLIENT_SECRET",
  "AUTH0_JWT_SECRET",
  "AUTH0_JWT_PUBLIC_KEY"
].forEach(resolveSecret);

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
  AUTH0_MANAGEMENT_CLIENT_ID: z.string().optional(),
  AUTH0_MANAGEMENT_CLIENT_SECRET: z.string().optional(),
  AUTH0_MANAGEMENT_AUDIENCE: z.string().optional(),
  AUTH0_PROVISIONING_CONNECTION: z.string().optional(),
  AUTH0_CALLBACK_URL: z.string().min(1).default("http://localhost:4000/auth/callback"),
  AUTH0_LOGOUT_URL: z.string().min(1).default("http://localhost:4000/operator"),
  AUTH0_DEFAULT_ORGANIZATION: z.string().optional(),
  AUTH0_DEFAULT_CONNECTION: z.string().optional(),
  AUTH0_JWT_ALGORITHMS: z.string().default("HS256"),
  AUTH0_JWKS_URL: z.string().url().optional(),
  AUTH0_JWT_SECRET: z.string().optional(),
  AUTH0_JWT_PUBLIC_KEY: z.string().optional(),
  AUTH0_PERMISSIONS_CLAIM: z.string().default("permissions"),
  AUTH0_ROLES_CLAIM: z.string().default("https://agentic-service-provider/roles"),
  AUTH0_TENANT_CLAIM: z.string().default("https://agentic-service-provider/tenant_id"),
  AUTH0_MFA_FRESHNESS_SECONDS: z.coerce.number().default(300),
  TRUST_PROXY: z.string().default("loopback, linklocal, uniquelocal"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(60),
  SESSION_COOKIE_NAME: z.string().default("asp_operator_session"),
  AUTH_STATE_COOKIE_NAME: z.string().default("asp_auth_state"),
  AUTH_CODE_VERIFIER_COOKIE_NAME: z.string().default("asp_auth_code_verifier"),
  AUTH_NONCE_COOKIE_NAME: z.string().default("asp_auth_nonce"),
  AUTH_ORGANIZATION_COOKIE_NAME: z.string().default("asp_auth_organization")
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
