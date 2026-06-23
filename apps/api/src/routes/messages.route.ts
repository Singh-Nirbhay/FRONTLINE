import { FastifyPluginAsync } from "fastify";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "../prisma.js";

// BullMQ Queue setup with standard connection options
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const triageQueue = new Queue("triage", { connection: connection as any });

export const messagesRoutes: FastifyPluginAsync = async (fastify) => {
  
  // POST /messages: Ingest and enqueue message
  fastify.post(
    "/messages",
    {
      config: {
        rateLimit: {
          max: 100,
          timeWindow: 60000 // 1 minute
        }
      },
      schema: {
        description: "Submit a customer message for triage classification",
        tags: ["Messages"],
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 5000 }
          }
        },
        response: {
          202: {
            type: "object",
            properties: {
              message_id: { type: "string", format: "uuid" },
              status: { type: "string" }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { content } = request.body as { content: string };
      const messageId = crypto.randomUUID();
      const receivedAt = new Date();

      // Database transaction: persist message
      const message = await prisma.message.create({
        data: {
          id: messageId,
          content,
          received_at: receivedAt
        }
      });

      // Enqueue BullMQ job
      await triageQueue.add(
        "triage_job",
        { 
          message_id: message.id, 
          content: message.content, 
          received_at: message.received_at.toISOString() 
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000 // starts with 1s backoff
          }
        }
      );

      return reply.code(202).send({
        message_id: message.id,
        status: "queued"
      });
    }
  );

  // GET /messages: List messages with filters, searches, and pagination
  fastify.get(
    "/messages",
    {
      schema: {
        description: "Retrieve a paginated feed of triaged messages",
        tags: ["Messages"],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            per_page: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            category: { 
              type: "string", 
              enum: ["billing", "technical", "complaint", "feature_request", "out_of_scope", "unclear"] 
            },
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            needs_human: { type: "boolean" },
            search: { type: "string" }
          }
        }
      }
    },
    async (request, reply) => {
      const { page, per_page, category, priority, needs_human, search } = request.query as {
        page: number;
        per_page: number;
        category?: "billing" | "technical" | "complaint" | "feature_request" | "out_of_scope" | "unclear";
        priority?: "P0" | "P1" | "P2" | "P3";
        needs_human?: boolean;
        search?: string;
      };

      const where: any = {};

      // Filter by triage result properties
      if (category || priority || needs_human !== undefined) {
        where.triage_results = {
          some: {
            ...(category && { category }),
            ...(priority && { priority }),
            ...(needs_human !== undefined && { needs_human })
          }
        };
      }

      // Free text search in content
      if (search) {
        where.content = {
          contains: search,
          mode: "insensitive"
        };
      }

      const total = await prisma.message.count({ where });
      const totalPages = Math.ceil(total / per_page);

      const data = await prisma.message.findMany({
        where,
        include: {
          triage_results: true,
          eval_label: true
        },
        orderBy: {
          created_at: "desc"
        },
        skip: (page - 1) * per_page,
        take: per_page
      });

      return {
        data,
        pagination: {
          page,
          per_page,
          total,
          total_pages: totalPages
        }
      };
    }
  );

  // GET /messages/stats: Aggregate triage statistics via DB queries
  fastify.get(
    "/messages/stats",
    {
      schema: {
        description: "Retrieve aggregated metrics for triage performance",
        tags: ["Messages"],
        response: {
          200: {
            type: "object",
            properties: {
              total: { type: "integer" },
              by_category: { type: "object", additionalProperties: { type: "integer" } },
              by_priority: { type: "object", additionalProperties: { type: "integer" } },
              needs_human_count: { type: "integer" },
              avg_confidence: { type: "number" },
              avg_latency_ms: { type: "number" },
              total_tokens: {
                type: "object",
                properties: {
                  input: { type: "integer" },
                  output: { type: "integer" }
                }
              }
            }
          }
        }
      }
    },
    async () => {
      const [aggregate, categoryGroup, priorityGroup, needsHumanCount] = await Promise.all([
        prisma.triageResult.aggregate({
          _count: { id: true },
          _avg: { confidence: true, processing_time_ms: true },
          _sum: { input_tokens: true, output_tokens: true }
        }),
        prisma.triageResult.groupBy({
          by: ["category"],
          _count: { id: true }
        }),
        prisma.triageResult.groupBy({
          by: ["priority"],
          _count: { id: true }
        }),
        prisma.triageResult.count({
          where: { needs_human: true }
        })
      ]);

      const byCategory: Record<string, number> = {};
      categoryGroup.forEach((item) => {
        byCategory[item.category] = item._count.id;
      });

      const byPriority: Record<string, number> = {};
      priorityGroup.forEach((item) => {
        byPriority[item.priority] = item._count.id;
      });

      return {
        total: aggregate._count.id,
        by_category: byCategory,
        by_priority: byPriority,
        needs_human_count: needsHumanCount,
        avg_confidence: aggregate._avg.confidence ?? 0,
        avg_latency_ms: aggregate._avg.processing_time_ms ?? 0,
        total_tokens: {
          input: aggregate._sum.input_tokens ?? 0,
          output: aggregate._sum.output_tokens ?? 0
        }
      };
    }
  );

  // GET /messages/:id: Find full details of a single message
  fastify.get(
    "/messages/:id",
    {
      schema: {
        description: "Retrieve a specific message with its triage results and evaluation labels",
        tags: ["Messages"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const message = await prisma.message.findUnique({
        where: { id },
        include: {
          triage_results: true,
          eval_label: true
        }
      });

      if (!message) {
        return reply.notFound("Message not found");
      }

      return message;
    }
  );

  // POST /messages/:id/review: Mark a message as reviewed
  fastify.post(
    "/messages/:id/review",
    {
      schema: {
        description: "Mark a message as reviewed by a human agent",
        tags: ["Messages"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message_id: { type: "string", format: "uuid" }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const message = await prisma.message.update({
          where: { id },
          data: { reviewed: true }
        });
        return { success: true, message_id: message.id };
      } catch (err: any) {
        // Prisma error for record not found
        if (err.code === "P2025") {
          return reply.notFound("Message not found");
        }
        throw err;
      }
    }
  );

  // POST /messages/bulk: Ingest and enqueue multiple messages (from text, JSONs, or CSV)
  fastify.post(
    "/messages/bulk",
    {
      schema: {
        description: "Submit multiple customer messages for triage classification (plain text, JSON list, or CSV)",
        tags: ["Messages"],
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1 }
          }
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              count: { type: "integer" }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { content } = request.body as { content: string };
      const messagesToEnqueue = parseBulkInput(content);

      if (messagesToEnqueue.length === 0) {
        return reply.badRequest("No valid messages found in input.");
      }

      // Ingest each message
      for (const msgContent of messagesToEnqueue) {
        const messageId = crypto.randomUUID();
        const receivedAt = new Date();

        await prisma.message.create({
          data: {
            id: messageId,
            content: msgContent,
            received_at: receivedAt
          }
        });

        await triageQueue.add(
          "triage_job",
          { 
            message_id: messageId, 
            content: msgContent, 
            received_at: receivedAt.toISOString() 
          },
          {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 1000
            }
          }
        );
      }

      return { success: true, count: messagesToEnqueue.length };
    }
  );
};

function parseBulkInput(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // 1. Try JSON Array
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(item => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            return item.content || item.message || item.text || item.body || JSON.stringify(item);
          }
          return String(item);
        }).filter(Boolean);
      }
    } catch (e) {}
  }

  // 2. Try Single JSON Object
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object") {
        const val = parsed.content || parsed.message || parsed.text || parsed.body;
        if (val) return [val];
      }
    } catch (e) {}
  }

  // 3. Try Multiple JSON Objects (one per line, NDJSON, or contiguous)
  const jsonBlocks: string[] = [];
  let braceCount = 0;
  let currentBlock = "";
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escapeNext) {
      currentBlock += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      currentBlock += char;
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
    currentBlock += char;

    if (!inString) {
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0 && currentBlock.trim().startsWith("{")) {
          jsonBlocks.push(currentBlock.trim());
          currentBlock = "";
        }
      }
    }
  }

  if (jsonBlocks.length > 0) {
    try {
      const parsedMessages = jsonBlocks.map(block => {
        try {
          const parsed = JSON.parse(block);
          return parsed.content || parsed.message || parsed.text || parsed.body || JSON.stringify(parsed);
        } catch (e) {
          return null;
        }
      }).filter(Boolean) as string[];
      if (parsedMessages.length > 0) {
        return parsedMessages;
      }
    } catch (e) {}
  }

  // 4. Try CSV Parsing
  if (trimmed.includes(",") || trimmed.includes("\n")) {
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[0].includes(",")) {
      const csvMessages: string[] = [];
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = "";
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result.map(f => (f.startsWith('"') && f.endsWith('"') ? f.slice(1, -1) : f));
      };

      const headers = parseCSVLine(lines[0]);
      let contentIdx = headers.findIndex(h => {
        const l = h.toLowerCase();
        return l === "content" || l === "message" || l === "text" || l === "body";
      });
      if (contentIdx === -1) {
        contentIdx = 0;
      }

      for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVLine(lines[i]);
        if (fields[contentIdx]) {
          csvMessages.push(fields[contentIdx]);
        }
      }
      if (csvMessages.length > 0) {
        return csvMessages;
      }
    }
  }

  // 5. Default: Plain Text paragraphs or lines
  const paragraphs = trimmed.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs;
  }

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    return lines;
  }

  return [trimmed];
}

export default messagesRoutes;
