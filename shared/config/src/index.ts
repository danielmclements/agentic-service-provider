import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/agentic_msp"),
  API_KEY: z.string().min(1).default("dev-api-key"),
  OPERATOR_API_KEY: z.string().min(1).default("dev-operator-key"),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("agentic-msp"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini")
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
