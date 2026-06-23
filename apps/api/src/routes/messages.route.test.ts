import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../index.js";
import { prisma } from "../prisma.js";
import { triageQueue } from "./messages.route.js";

// Mock BullMQ Queue and Redis connections to prevent network attempts during tests
vi.mock("bullmq", () => {
  return {
    Queue: class {
      add = vi.fn().mockResolvedValue({ id: "job-id" });
      close = vi.fn().mockResolvedValue({});
    },
    Worker: class {
      close = vi.fn().mockResolvedValue({});
      on = vi.fn();
    }
  };
});

vi.mock("ioredis", () => {
  const MockRedis = class {
    ping = vi.fn().mockResolvedValue("PONG");
    quit = vi.fn().mockResolvedValue({});
    on = vi.fn();
  };
  return {
    default: MockRedis,
    Redis: MockRedis
  };
});

describe("Messages Routes Integration Tests (Supertest)", () => {
  let app: any;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    vi.clearAllMocks();
  });

  // 1. POST /messages happy path
  it("POST /api/v1/messages should persist message and enqueue triage job", async () => {
    const mockMessage = {
      id: "4ea821a7-0e6d-4951-87ab-f6ad3b0f5ef5",
      content: "Hi there, I would like to report a bug in the billing page.",
      received_at: new Date(),
      created_at: new Date(),
      reviewed: false
    };

    // Spy on Prisma create call
    const prismaCreateSpy = vi.spyOn(prisma.message, "create").mockResolvedValue(mockMessage);
    const queueAddSpy = vi.spyOn(triageQueue, "add");

    const response = await request(app.server)
      .post("/api/v1/messages")
      .send({ content: "Hi there, I would like to report a bug in the billing page." })
      .expect(202);

    expect(response.body).toHaveProperty("message_id");
    expect(response.body.status).toBe("queued");
    
    expect(prismaCreateSpy).toHaveBeenCalled();
    expect(queueAddSpy).toHaveBeenCalledWith(
      "triage_job",
      expect.objectContaining({
        message_id: expect.any(String),
        content: "Hi there, I would like to report a bug in the billing page."
      }),
      expect.objectContaining({
        attempts: 3
      })
    );
  });

  // 2. POST /messages invalid request body
  it("POST /api/v1/messages should fail with 400 when content is empty", async () => {
    const response = await request(app.server)
      .post("/api/v1/messages")
      .send({ content: "" }) // Invalid: length < 1
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error.code).toBe("FST_ERR_VALIDATION");
  });

  // 3. GET /messages with filters
  it("GET /api/v1/messages should return list of filtered messages and pagination metadata", async () => {
    const mockFeed = [
      {
        id: "a7509f6e-1d52-4752-9ef4-d50d03bb63c2",
        content: "Please help, database is down!",
        received_at: new Date(),
        created_at: new Date(),
        triage_results: [
          {
            id: "triage-id",
            category: "technical",
            priority: "P0",
            needs_human: true,
            confidence: 0.95
          }
        ]
      }
    ];

    const prismaFindSpy = vi.spyOn(prisma.message, "findMany").mockResolvedValue(mockFeed as any);
    const prismaCountSpy = vi.spyOn(prisma.message, "count").mockResolvedValue(1);

    const response = await request(app.server)
      .get("/api/v1/messages")
      .query({ page: 1, per_page: 5, category: "technical", priority: "P0" })
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].content).toContain("database is down");
    expect(response.body.pagination).toEqual({
      page: 1,
      per_page: 5,
      total: 1,
      total_pages: 1
    });

    expect(prismaFindSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          triage_results: {
            some: {
              category: "technical",
              priority: "P0"
            }
          }
        }),
        skip: 0,
        take: 5
      })
    );
    expect(prismaCountSpy).toHaveBeenCalled();
  });

  // 4. GET /messages/:id not found (404)
  it("GET /api/v1/messages/:id should return 404 if message does not exist", async () => {
    vi.spyOn(prisma.message, "findUnique").mockResolvedValue(null);

    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    const response = await request(app.server)
      .get(`/api/v1/messages/${nonExistentId}`)
      .expect(404);

    expect(response.body.error.message).toBe("Message not found");
  });
});
