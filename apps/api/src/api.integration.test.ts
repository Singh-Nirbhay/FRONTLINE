import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { Redis } from "ioredis";
import path from "path";
import { prisma } from "./prisma.js";
import { buildApp } from "./index.js";

// Import metrics to ensure monkey-patches and custom metrics are registered
// import "./observability/metrics.js";

// Helper function to truncate all tables in test database
async function truncateAllTables() {
  const tablenames = await prisma.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations';`;

  for (const { tablename } of tablenames) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`);
  }
}

// Helper to seed test messages
async function seedTestData() {
  await truncateAllTables();

  // Message 1: Billing, P3, Needs Human: false
  await prisma.message.create({
    data: {
      id: "11111111-1111-1111-1111-111111111111",
      content: "Hello, I cannot access my billing statements. Please help me get them.",
      received_at: new Date("2026-06-23T10:00:00Z"),
      created_at: new Date("2026-06-23T10:00:00Z"),
      triage_results: {
        create: {
          category: "billing",
          priority: "P3",
          summary: "Billing statements inquiry.",
          suggested_action: "Provide billing statement download instructions.",
          needs_human: false,
          confidence: 0.95,
          processing_time_ms: 120,
          input_tokens: 150,
          output_tokens: 45
        }
      }
    }
  });

  // Message 2: Technical, P0, Needs Human: true
  await prisma.message.create({
    data: {
      id: "22222222-2222-2222-2222-222222222222",
      content: "OUR PRODUCTION DATABASE HAS CRASHED! All customers are getting connection errors.",
      received_at: new Date("2026-06-23T10:05:00Z"),
      created_at: new Date("2026-06-23T10:05:00Z"),
      triage_results: {
        create: {
          category: "technical",
          priority: "P0",
          summary: "Database outage crash.",
          suggested_action: "Escalate to database administration team.",
          needs_human: true,
          confidence: 0.98,
          processing_time_ms: 250,
          input_tokens: 200,
          output_tokens: 55
        }
      }
    }
  });
}

// Check connectivity to Postgres and Redis
let servicesAvailable = false;
try {
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://postgres:postgrespassword@127.0.0.1:5432/frontline_test";
  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

  let dbHost = "127.0.0.1";
  let dbPort = 5432;
  try {
    const parsed = new URL(dbUrl);
    dbHost = parsed.hostname;
    dbPort = parsed.port ? parseInt(parsed.port, 10) : 5432;
  } catch (e) {}

  let redisHost = "127.0.0.1";
  let redisPort = 6379;
  try {
    const parsed = new URL(redisUrl);
    redisHost = parsed.hostname;
    redisPort = parsed.port ? parseInt(parsed.port, 10) : 6379;
  } catch (e) {}

  const checkDb = `const net = require('net'); const client = net.connect(${dbPort}, '${dbHost}', () => { client.end(); process.exit(0); }); client.on('error', () => { process.exit(1); }); setTimeout(() => { process.exit(1); }, 500);`;
  const checkRedis = `const net = require('net'); const client = net.connect(${redisPort}, '${redisHost}', () => { client.end(); process.exit(0); }); client.on('error', () => { process.exit(1); }); setTimeout(() => { process.exit(1); }, 500);`;

  execSync(`node -e "${checkDb}"`, { stdio: "ignore" });
  execSync(`node -e "${checkRedis}"`, { stdio: "ignore" });
  servicesAvailable = true;
} catch (e) {
  servicesAvailable = false;
}

if (!servicesAvailable) {
  console.log("[Integration Tests] Skipping Frontline API Integration Tests Suite: Postgres or Redis services are not running.");
}

describe.skipIf(!servicesAvailable)("Frontline API Integration Tests Suite", () => {
  let app: any;

  beforeAll(async () => {
    // 1. Force the database URL to point to the test database
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgrespassword@127.0.0.1:5432/frontline_test";

    // 2. Synchronize database schema before running integration tests
    console.log("[Setup] Running prisma db push on test database...");
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      stdio: "inherit",
      cwd: path.resolve(process.cwd(), "../../")
    });

    // 3. Build fastify app
    app = await buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    await seedTestData();
  });

  afterEach(async () => {
    // Clean up Redis test database key-space
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const redis = new Redis(redisUrl);
    try {
      await redis.flushdb();
    } catch (e) {
      // ignore
    } finally {
      await redis.quit();
    }
  });

  // Suite 1: POST /api/v1/messages
  describe("POST /api/v1/messages", () => {
    it("should accept valid body and return 202 queued", async () => {
      const response = await request(app.server)
        .post("/api/v1/messages")
        .send({ content: "I would like to report a bug in the billing page." })
        .expect(202);

      expect(response.body).toHaveProperty("message_id");
      expect(response.body.status).toBe("queued");
    });

    it("should return 400 when content is empty", async () => {
      const response = await request(app.server)
        .post("/api/v1/messages")
        .send({ content: "" })
        .expect(400);

      expect(response.body.error.code).toBe("FST_ERR_VALIDATION");
    });

    it("should return 400 when content is too long", async () => {
      const longContent = "a".repeat(5001);
      const response = await request(app.server)
        .post("/api/v1/messages")
        .send({ content: longContent })
        .expect(400);

      expect(response.body.error.code).toBe("FST_ERR_VALIDATION");
    });
  });

  // Suite 2: GET /api/v1/messages
  describe("GET /api/v1/messages", () => {
    it("should return paginated list of messages", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages")
        .query({ page: 1, per_page: 1 })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.total_pages).toBe(2);
    });

    it("should filter by category", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages")
        .query({ category: "technical" })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].triage_results[0].category).toBe("technical");
    });

    it("should filter by priority", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages")
        .query({ priority: "P3" })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].triage_results[0].priority).toBe("P3");
    });

    it("should filter by needs_human", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages")
        .query({ needs_human: true })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].triage_results[0].needs_human).toBe(true);
    });

    it("should search case-insensitively in content", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages")
        .query({ search: "crashed" })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].content).toContain("DATABASE HAS CRASHED");
    });
  });

  // Suite 3: GET /api/v1/messages/:id
  describe("GET /api/v1/messages/:id", () => {
    it("should return message detail if found", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages/11111111-1111-1111-1111-111111111111")
        .expect(200);

      expect(response.body.id).toBe("11111111-1111-1111-1111-111111111111");
      expect(response.body.content).toContain("billing statements");
    });

    it("should return 404 if message is not found", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages/00000000-0000-0000-0000-000000000000")
        .expect(404);

      expect(response.body.error.message).toBe("Message not found");
    });
  });

  // Suite 4: GET /api/v1/messages/stats
  describe("GET /api/v1/messages/stats", () => {
    it("should return correct aggregated stats", async () => {
      const response = await request(app.server)
        .get("/api/v1/messages/stats")
        .expect(200);

      expect(response.body.total).toBe(2);
      expect(response.body.by_category).toEqual({ billing: 1, technical: 1 });
      expect(response.body.by_priority).toEqual({ P0: 1, P3: 1 });
      expect(response.body.needs_human_count).toBe(1);
      expect(response.body.avg_confidence).toBeCloseTo(0.965, 2);
      expect(response.body.avg_latency_ms).toBeCloseTo(185, 0);
      expect(response.body.total_tokens).toEqual({ input: 350, output: 100 });
    });
  });

  // Suite 5: GET /health
  describe("GET /health", () => {
    it("should return 200 and healthy status when all services are running", async () => {
      const response = await request(app.server)
        .get("/health")
        .expect(200);

      expect(response.body.status).toBe("ok");
      expect(response.body.db).toBe(true);
      expect(response.body.redis).toBe(true);
    });

    it("should return 503 degraded when Database is down", async () => {
      const dbSpy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("DB Connection Error"));
      
      const response = await request(app.server)
        .get("/health")
        .expect(503);

      expect(response.body.status).toBe("degraded");
      expect(response.body.db).toBe(false);
      expect(response.body.redis).toBe(true);
      
      dbSpy.mockRestore();
    });

    it("should return 503 degraded when Redis is down", async () => {
      const redisSpy = vi.spyOn(Redis.prototype, "ping").mockRejectedValueOnce(new Error("Redis Connection Error"));
      
      const response = await request(app.server)
        .get("/health")
        .expect(503);

      expect(response.body.status).toBe("degraded");
      expect(response.body.db).toBe(true);
      expect(response.body.redis).toBe(false);

      redisSpy.mockRestore();
    });
  });

  // Suite 6: Rate Limiting
  describe("Rate Limiting", () => {
    it("should return 429 rate limit exceeded after sending 100+ requests", async () => {
      let has429 = false;
      // Send requests sequentially to ensure rate limiter handles and increments the count accurately
      for (let i = 0; i < 110; i++) {
        const response = await request(app.server)
          .post("/api/v1/messages")
          .send({ content: "Simulating rate limit request" });
        if (response.status === 429) {
          has429 = true;
          break;
        }
      }
      expect(has429).toBe(true);
    });
  });
});
