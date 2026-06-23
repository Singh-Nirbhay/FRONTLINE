import { TriageResult, TriageResultSchema } from "../index.js";

export class SchemaValidationError extends Error {
  code = "SCHEMA_VALIDATION_ERROR";
  constructor(public errors: any[], public raw_output: string) {
    super("Schema validation failed after repair attempts");
    Object.setPrototypeOf(this, SchemaValidationError.prototype);
  }
}

const CATEGORY_SYNONYMS: Record<string, "billing" | "technical" | "complaint" | "feature_request" | "out_of_scope" | "unclear"> = {
  "bug": "technical",
  "bug report": "technical",
  "bugreport": "technical",
  "error": "technical",
  "issue": "technical",
  "broken": "technical",
  "crash": "technical",
  "payment": "billing",
  "invoice": "billing",
  "subscription": "billing",
  "charge": "billing",
  "refund": "billing",
  "feedback": "feature_request",
  "suggestion": "feature_request",
  "request": "feature_request",
  "anger": "complaint",
  "angry": "complaint",
  "frustration": "complaint",
  "dissatisfaction": "complaint",
  "spam": "out_of_scope",
  "greeting": "out_of_scope",
  "hello": "out_of_scope"
};

/**
 * Validates the triage output against the TriageResult schema.
 * Attempts field-level repairs for common LLM formatting errors.
 */
export function validateTriageOutput(raw: unknown): TriageResult {
  // First attempt standard Zod parse
  const firstParse = TriageResultSchema.safeParse(raw);
  if (firstParse.success) {
    return firstParse.data;
  }

  // Attempt repairs if payload is an object
  if (raw && typeof raw === "object") {
    const repaired: any = { ...raw };

    // 1. Coerce confidence string to float
    if (typeof repaired.confidence === "string") {
      const val = parseFloat(repaired.confidence);
      if (!isNaN(val)) {
        repaired.confidence = val;
      }
    }

    // 2. Coerce priority to uppercase
    if (typeof repaired.priority === "string") {
      repaired.priority = repaired.priority.toUpperCase();
    }

    // 3. Coerce needs_human strings to booleans
    if (repaired.needs_human === "true") {
      repaired.needs_human = true;
    } else if (repaired.needs_human === "false") {
      repaired.needs_human = false;
    }

    // 4. Truncate summary exceeding 120 characters
    if (typeof repaired.summary === "string" && repaired.summary.length > 120) {
      repaired.summary = repaired.summary.slice(0, 117) + "...";
    }

    // 5. Truncate suggested_action exceeding 200 characters
    if (typeof repaired.suggested_action === "string" && repaired.suggested_action.length > 200) {
      repaired.suggested_action = repaired.suggested_action.slice(0, 197) + "...";
    }

    // 6. Map category synonyms
    if (typeof repaired.category === "string") {
      const catLower = repaired.category.toLowerCase().trim();
      if (CATEGORY_SYNONYMS[catLower]) {
        repaired.category = CATEGORY_SYNONYMS[catLower];
      }
    }

    // 7. Repair processing_time_ms if it's a string
    if (typeof repaired.processing_time_ms === "string") {
      const val = parseInt(repaired.processing_time_ms, 10);
      if (!isNaN(val)) {
        repaired.processing_time_ms = val;
      }
    }

    // 8. Repair nested token_usage properties if they are strings
    if (repaired.token_usage && typeof repaired.token_usage === "object") {
      repaired.token_usage = { ...repaired.token_usage };
      if (typeof repaired.token_usage.input === "string") {
        const val = parseInt(repaired.token_usage.input, 10);
        if (!isNaN(val)) repaired.token_usage.input = val;
      }
      if (typeof repaired.token_usage.output === "string") {
        const val = parseInt(repaired.token_usage.output, 10);
        if (!isNaN(val)) repaired.token_usage.output = val;
      }
    }

    // Re-run Zod parse on the repaired object
    const secondParse = TriageResultSchema.safeParse(repaired);
    if (secondParse.success) {
      return secondParse.data;
    } else {
      throw new SchemaValidationError(secondParse.error.errors, JSON.stringify(raw));
    }
  }

  throw new SchemaValidationError(firstParse.error.errors, JSON.stringify(raw));
}
