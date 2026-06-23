/**
 * Sanitizes customer messages for the triage system.
 * 1. Trims leading/trailing whitespace
 * 2. Normalizes unicode to NFC
 * 3. Collapses consecutive newlines to a maximum of 2
 * 4. Collapses consecutive spaces to 1 space
 * 5. Strips null bytes and ASCII control characters (keeping only \n and \t)
 * 6. Truncates to 4000 characters, preserving word boundaries
 */
export function sanitizeMessage(content: string): string {
  if (!content) return "";

  // 1. Trim leading/trailing whitespace
  let sanitized = content.trim();

  // 2. Normalize unicode to NFC
  sanitized = sanitized.normalize("NFC");

  // Normalize all Windows-style CRLF (\r\n) to LF (\n) first
  sanitized = sanitized.replace(/\r\n/g, "\n");

  // 5. Strip null bytes and other ASCII control characters (keep \n and \t)
  // ASCII control chars: 0-31 and 127, excluding 9 (\t) and 10 (\n)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  // Remove spaces immediately preceding or succeeding a newline (preserving tabs)
  sanitized = sanitized.replace(/ *\n */g, "\n");

  // 3. Collapse multiple consecutive newlines to max 2
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n");

  // 4. Collapse multiple consecutive spaces to 1
  sanitized = sanitized.replace(/ {2,}/g, " ");

  // Collapse multiple consecutive tabs to 1 tab
  sanitized = sanitized.replace(/\t+/g, "\t");

  // 6. Truncate to 4000 characters if longer, preserving word boundaries
  if (sanitized.length > 4000) {
    let truncated = sanitized.slice(0, 4000);
    
    // Find the last space character in the sliced string
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > 0) {
      truncated = truncated.slice(0, lastSpace);
    }
    
    sanitized = truncated.trim();
  }

  return sanitized;
}

export default sanitizeMessage;
