import { Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../prisma.js";
import { TriageService } from "../services/triage.service.js";
import { metricsRegistry } from "../services/metrics.service.js";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// Instantiate the AI Triage Service
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy-key"
});
const triageService = new TriageService(anthropic, metricsRegistry);

const concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 5;

export const triageWorker = new Worker(
  "triage",
  async (job: Job) => {
    const { message_id, content, received_at } = job.data;

    try {
      // 1. Retrieve the message from the database
      const message = await prisma.message.findUnique({
        where: { id: message_id }
      });

      if (!message) {
        throw new Error(`Message ${message_id} not found in database.`);
      }

      // 2. Process triage
      const triageResult = await triageService.triage({
        id: message.id,
        content: message.content,
        received_at: message.received_at.toISOString()
      });

      // 3. Persist the triage result to the database
      const savedResult = await prisma.triageResult.create({
        data: {
          message_id: triageResult.message_id,
          category: triageResult.category,
          priority: triageResult.priority,
          summary: triageResult.summary,
          suggested_action: triageResult.suggested_action,
          needs_human: triageResult.needs_human,
          confidence: triageResult.confidence,
          processing_time_ms: triageResult.processing_time_ms,
          input_tokens: triageResult.token_usage.input,
          output_tokens: triageResult.token_usage.output
        }
      });

      // 4. Log success metrics
      console.log("Triage job completed successfully:", {
        message_id: savedResult.message_id,
        category: savedResult.category,
        priority: savedResult.priority,
        needs_human: savedResult.needs_human,
        confidence: savedResult.confidence,
        latency_ms: savedResult.processing_time_ms
      });

      return savedResult;

    } catch (error: any) {
      console.error(`Triage job ${job.id} failed on attempt ${job.attemptsMade + 1}: ${error.message}`);

      // If we have exhausted all attempts (attempts = 3), persist the fallback result in DB
      const maxAttempts = job.opts.attempts ?? 3;
      if (job.attemptsMade + 1 >= maxAttempts) {
        console.warn(`Max attempts (${maxAttempts}) reached for job ${job.id}. Writing fallback triage result.`);
        try {
          const fallbackResult = await prisma.triageResult.create({
            data: {
              message_id,
              category: "unclear",
              priority: "P3",
              summary: "Job processing failed after maximum retry attempts.",
              suggested_action: "Escalate to support team immediately for manual intervention.",
              needs_human: true,
              confidence: 0.0,
              processing_time_ms: 0,
              input_tokens: 0,
              output_tokens: 0
            }
          });
          return fallbackResult;
        } catch (dbErr: any) {
          console.error("Failed to persist fallback triage result:", dbErr.message);
        }
      }

      // Rethrow error so BullMQ handles backoff retries
      throw error;
    }
  },
  {
    connection: connection as any,
    concurrency
  }
);

// Worker Lifecycle & Event Listeners
triageWorker.on("ready", () => {
  console.log(`BullMQ Triage Worker started. Concurrency: ${concurrency}`);
});

triageWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed.`);
  metricsRegistry.incrementCounter("triage_jobs_total", { status: "completed" });
});

triageWorker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed permanently:`, error.message);
  metricsRegistry.incrementCounter("triage_jobs_total", { status: "failed" });
});

// Graceful worker shutdown handler
export async function shutdownWorker() {
  console.log("Shutting down BullMQ Triage Worker...");
  await triageWorker.close();
  await connection.quit();
  console.log("BullMQ Worker and Redis connections closed.");
}
