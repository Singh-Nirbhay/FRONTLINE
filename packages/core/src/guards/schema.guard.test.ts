import { describe, it, expect } from "vitest";
import { validateTriageOutput, SchemaValidationError } from "./schema.guard.js";

describe("Schema Guard and Repairs Unit Tests", () => {
  const baseValidResult = {
    message_id: "4ea821a7-0e6d-4951-87ab-f6ad3b0f5ef5",
    category: "technical",
    priority: "P1",
    summary: "Service down.",
    suggested_action: "Examine logs.",
    needs_human: true,
    confidence: 0.95,
    processing_time_ms: 120,
    token_usage: {
      input: 150,
      output: 45
    }
  };

  // Test 1: Happy Path
  it("should return identical output if already valid", () => {
    const validated = validateTriageOutput(baseValidResult);
    expect(validated).toEqual(baseValidResult);
  });

  // Test 2: Falsy inputs
  it("should throw SchemaValidationError for null or undefined input", () => {
    expect(() => validateTriageOutput(null)).toThrow(SchemaValidationError);
    expect(() => validateTriageOutput(undefined)).toThrow(SchemaValidationError);
  });

  // Test 3: Non-object inputs
  it("should throw SchemaValidationError for string or number inputs", () => {
    expect(() => validateTriageOutput("invalid")).toThrow(SchemaValidationError);
    expect(() => validateTriageOutput(123)).toThrow(SchemaValidationError);
  });

  // Test 4: Repair confidence float string
  it("should repair string confidence to a float", () => {
    const input = { ...baseValidResult, confidence: "0.85" };
    const validated = validateTriageOutput(input);
    expect(validated.confidence).toBe(0.85);
  });

  // Test 5: Handle invalid confidence float string
  it("should throw SchemaValidationError when confidence string is not a valid float", () => {
    const input = { ...baseValidResult, confidence: "invalid-float" };
    expect(() => validateTriageOutput(input)).toThrow(SchemaValidationError);
  });

  // Test 6: Repair priority case
  it("should repair lowercase priority to uppercase", () => {
    const input = { ...baseValidResult, priority: "p2" };
    const validated = validateTriageOutput(input);
    expect(validated.priority).toBe("P2");
  });

  // Test 7: Repair needs_human string booleans
  it("should repair string booleans for needs_human", () => {
    const inputTrue = { ...baseValidResult, needs_human: "true" };
    const inputFalse = { ...baseValidResult, needs_human: "false" };
    expect(validateTriageOutput(inputTrue).needs_human).toBe(true);
    expect(validateTriageOutput(inputFalse).needs_human).toBe(false);
  });

  // Test 8: Truncate summary
  it("should truncate summary exceeding limits", () => {
    const overSummary = "A".repeat(150); // Limit is 120
    const input = { ...baseValidResult, summary: overSummary };
    const validated = validateTriageOutput(input);
    expect(validated.summary.length).toBe(120);
    expect(validated.summary.endsWith("...")).toBe(true);
  });

  // Test 9: Truncate suggested_action
  it("should truncate suggested_action exceeding limits", () => {
    const overAction = "B".repeat(250);  // Limit is 200
    const input = { ...baseValidResult, suggested_action: overAction };
    const validated = validateTriageOutput(input);
    expect(validated.suggested_action.length).toBe(200);
    expect(validated.suggested_action.endsWith("...")).toBe(true);
  });

  // Test 10: Category synonym mapping
  it("should map category synonyms correctly", () => {
    const input = { ...baseValidResult, category: "bug" };
    const validated = validateTriageOutput(input);
    expect(validated.category).toBe("technical");
  });

  // Test 11: Handle unknown category synonym
  it("should throw SchemaValidationError for completely unknown category", () => {
    const input = { ...baseValidResult, category: "unknown" };
    expect(() => validateTriageOutput(input)).toThrow(SchemaValidationError);
  });

  // Test 12: Repair processing_time_ms string
  it("should repair string processing_time_ms to integer", () => {
    const input = { ...baseValidResult, processing_time_ms: "450" };
    const validated = validateTriageOutput(input);
    expect(validated.processing_time_ms).toBe(450);
  });

  // Test 13: Handle invalid processing_time_ms string
  it("should not repair invalid processing_time_ms string", () => {
    const input = { ...baseValidResult, processing_time_ms: "not-a-number" };
    // Should still fail validation because processing_time_ms is not a valid number
    expect(() => validateTriageOutput(input)).toThrow(SchemaValidationError);
  });

  // Test 14: Repair nested token usage strings
  it("should repair string token usage values to integers", () => {
    const input = {
      ...baseValidResult,
      token_usage: {
        input: "300",
        output: "90"
      }
    };
    const validated = validateTriageOutput(input);
    expect(validated.token_usage.input).toBe(300);
    expect(validated.token_usage.output).toBe(90);
  });

  // Test 15: Handle invalid nested token usage strings
  it("should not repair invalid token usage strings", () => {
    const input = {
      ...baseValidResult,
      token_usage: {
        input: "abc",
        output: "def"
      }
    };
    expect(() => validateTriageOutput(input)).toThrow(SchemaValidationError);
  });
});
