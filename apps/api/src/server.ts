import "./config/env.js";
import { buildApp } from "./index.js";
import { prisma } from "./prisma.js";
import { triageQueue } from "./routes/messages.route.js";
import { shutdownWorker } from "./workers/triage.worker.js";

async function start() {
  const app = await buildApp();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

  try {
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`Frontline API Server listening on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful Shutdown hooks
  const shutdown = async (signal: string) => {
    app.log.warn(`Received ${signal}. Starting graceful shutdown...`);

    // 1. Drain and close BullMQ queue
    try {
      app.log.info("Closing BullMQ Queue...");
      await triageQueue.close();
    } catch (e: any) {
      app.log.error(`Error closing BullMQ Queue: ${e.message}`);
    }

    // 2. Shut down BullMQ worker
    try {
      await shutdownWorker();
    } catch (e: any) {
      app.log.error(`Error shutting down BullMQ worker: ${e.message}`);
    }

    // 3. Close Prisma Database connection
    try {
      app.log.info("Disconnecting Prisma Client...");
      await prisma.$disconnect();
    } catch (e: any) {
      app.log.error(`Error disconnecting Prisma: ${e.message}`);
    }

    app.log.info("Shutdown completed successfully.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
