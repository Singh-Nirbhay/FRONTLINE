import "./config/env.js";
import fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { prisma } from "./prisma.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { messagesRoutes } from "./routes/messages.route.js";
import { Redis } from "ioredis";

export async function buildApp() {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info"
    }
  });

  // Register Sensible (clean 4xx/5xx responses)
  await app.register(sensible);

  // Register CORS
  await app.register(cors, {
    origin: true
  });

  // Register Rate Limiting
  await app.register(rateLimit, {
    global: false, // Apply only on routes specifying a config
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message: `Too many requests. Please retry in ${context.after}.`
    })
  });

  // Register Custom Prometheus Metrics Plugin
  await app.register(metricsPlugin);

  // Global Error Handler: formatting response to { error: { code, message } }
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);

    const statusCode = error.statusCode || 500;
    
    // In production, mask detailed DB/syntax errors. In all cases, clean up stack traces and file paths.
    const isProd = process.env.NODE_ENV === "production";
    const message = isProd && statusCode === 500
      ? "An unexpected error occurred on the server."
      : cleanErrorMessage(error.message);

    reply.status(statusCode).send({
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        message
      }
    });
  });

  // Register routes under Prefix
  await app.register(messagesRoutes, { prefix: "/api/v1" });

  // GET /health: Health check endpoint
  app.get("/health", async (request, reply) => {
    let dbConnected = false;
    let redisConnected = false;

    // Check Prisma DB
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbConnected = true;
    } catch (e: any) {
      app.log.error(`Health DB check failure: ${e.message}`);
    }

    // Check Redis
    try {
      const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
      const client = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
      await client.ping();
      await client.quit();
      redisConnected = true;
    } catch (e: any) {
      app.log.error(`Health Redis check failure: ${e.message}`);
    }

    const isHealthy = dbConnected && redisConnected;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? "ok" : "degraded",
      db: dbConnected,
      redis: redisConnected,
      uptime: process.uptime()
    });
  });

  return app;
}

function cleanErrorMessage(msg: string): string {
  if (!msg) return "An unexpected error occurred.";

  // 1. If it contains Prisma-specific table or database errors, extract the exact database problem
  if (msg.includes("does not exist in the current database") || msg.includes("invocation in")) {
    const lines = msg.split("\n");
    const dbErrorLine = lines.find(l => l.includes("does not exist in the current database") || l.includes("Unique constraint failed"));
    if (dbErrorLine) {
      return dbErrorLine.trim();
    }
    return "A database operation error occurred. Please verify your schema and migrations.";
  }

  // 2. Strip standard Javascript stack trace frames and path references
  const cleanLines = msg.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (line.startsWith("at ")) return false;
      if (line.includes("node_modules")) return false;
      if (line.includes(":\\") || line.includes(":/")) return false; // Windows or Unix file paths
      if (line.startsWith("→") || /^\d+\s*\|/.test(line)) return false; // Code frame markers
      return true;
    });

  if (cleanLines.length === 0) {
    return "An unexpected error occurred.";
  }

  return cleanLines[0];
}
