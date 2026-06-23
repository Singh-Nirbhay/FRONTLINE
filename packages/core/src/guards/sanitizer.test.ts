import { describe, it, expect } from "vitest";
import { sanitizeMessage } from "./sanitizer.js";

describe("Message Sanitizer Guards Unit Tests", () => {
  // Edge Case 1: Empty and Null/Undefined Inputs
  it("should handle empty or whitespace-only strings", () => {
    expect(sanitizeMessage("")).toBe("");
    expect(sanitizeMessage("   ")).toBe("");
    expect(sanitizeMessage(null as any)).toBe("");
    expect(sanitizeMessage(undefined as any)).toBe("");
  });

  // Edge Case 2: Control Characters Stripping
  it("should strip control characters but preserve tabs, newlines, and carriage returns", () => {
    // null byte (\x00), escape (\x1B), bell (\x07) should be stripped
    // \t (\x09) and \n (\x0A) should be preserved
    const input = "Line 1\n\tText\x00With\x07Control\x1BChars";
    const expected = "Line 1\n\tTextWithControlChars";
    expect(sanitizeMessage(input)).toBe(expected);
  });

  // Unicode Normalization (NFD -> NFC)
  it("should normalize NFD unicode to NFC", () => {
    // NFD decomposed form for 'é' is 'e' + '\u0301' (combining acute accent)
    const nfd = "e\u0301";
    // NFC precomposed form is '\u00e9'
    const nfc = "\u00e9";
    
    const sanitized = sanitizeMessage(nfd);
    expect(sanitized).toBe(nfc);
    expect(sanitized.normalize("NFC")).toBe(sanitized);
  });

  // Newlines & Spaces Collapse
  it("should collapse multiple newlines and spaces correctly", () => {
    const input = "Multiple    spaces  \n\n\n\nand   newlines\t\t\t\there.";
    // Collapses to max 2 newlines and 1 space, preserving single tab
    const expected = "Multiple spaces\n\nand newlines\there.";
    expect(sanitizeMessage(input)).toBe(expected);
  });

  // Word-boundary Safe Truncation
  it("should truncate strings longer than 4000 characters without cutting mid-word", () => {
    // Build a string that is 4005 characters long
    // Form: "word " repeated
    const word = "hello ";
    let longString = "";
    while (longString.length < 4005) {
      longString += word;
    }
    
    // Ensure length is over 4000
    expect(longString.length).toBeGreaterThan(4000);
    
    const sanitized = sanitizeMessage(longString);
    
    // Output length should be <= 4000
    expect(sanitized.length).toBeLessThanOrEqual(4000);
    // Should end with the word "hello" and not "hell" or "he" (preserving word boundary)
    expect(sanitized.endsWith("hello")).toBe(true);
    expect(sanitized.endsWith("hello ")).toBe(false);
  });

  // Edge Case 3: Truncate strings longer than 4000 characters with NO spaces
  it("should truncate strings longer than 4000 characters with no spaces safely", () => {
    const longWord = "a".repeat(4005);
    const sanitized = sanitizeMessage(longWord);
    expect(sanitized.length).toBe(4000);
    expect(sanitized).toBe("a".repeat(4000));
  });

  // Base Case: Normal text with no special formatting needed
  it("should keep already clean text unchanged", () => {
    const cleanText = "Hello world, this is a clean customer message.";
    expect(sanitizeMessage(cleanText)).toBe(cleanText);
  });
});
