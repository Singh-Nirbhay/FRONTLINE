import { z } from "@frontline/core";
import fs from "fs";
import path from "path";

// Self-contained .env loader that traverses upwards to find and load the root .env file
function loadEnv() {
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(currentDir, ".env");
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const index = trimmed.indexOf("=");
            if (index > -1) {
              const key = trimmed.slice(0, index).trim();
              let val = trimmed.slice(index + 1).trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              if (process.env[key] === undefined || process.env[key] === "") {
                process.env[key] = val;
              }
            }
          }
        }
        break;
      }
    } catch (e) {
      console.error(`[EnvLoader] Error reading ${envPath}:`, e);
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
}

// Load root .env variables
loadEnv();

const isTest = process.env.NODE_ENV === "test";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  CONFIDENCE_THRESHOLD: z.coerce.number().default(0.72),
  MAX_RETRIES: z.coerce.number().int().default(3),
  CONCURRENCY: z.coerce.number().int().default(5),
  PORT: z.coerce.number().int().default(3001),
  LOG_LEVEL: z.string().default("info")
});

// For testing environments, provide mock database/cache/AI details if they are missing to prevent test failures
const envToValidate = isTest
  ? {
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgrespassword@localhost:5432/frontline_test",
      REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
      GROQ_API_KEY: process.env.GROQ_API_KEY || "mock-key",
      ...process.env
    }
  : process.env;

const parsed = envSchema.safeParse(envToValidate);

if (!parsed.success) {
  console.error("❌ Invalid environment variables configuration:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
