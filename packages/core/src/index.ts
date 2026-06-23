import { z } from "zod";

// Named constant export
export const CONFIDENCE_THRESHOLD = 0.72;

// InboundMessage Zod schema
export const InboundMessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  received_at: z.string().datetime()
});

// Inferred InboundMessage Type
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// TriageResult Zod schema
export const TriageResultSchema = z.object({
  message_id: z.string().uuid(),
  category: z.enum([
    "billing",
    "technical",
    "complaint",
    "feature_request",
    "out_of_scope",
    "unclear"
  ]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  summary: z.string().max(120),
  suggested_action: z.string().max(200),
  needs_human: z.boolean(),
  confidence: z.number().min(0.0).max(1.0),
  processing_time_ms: z.number(),
  token_usage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative()
  })
});

// Inferred TriageResult Type
export type TriageResult = z.infer<typeof TriageResultSchema>;

export * from "./guards/sanitizer.js";
export * from "./guards/adversarial.guard.js";
export * from "./guards/schema.guard.js";
export { z } from "zod";
