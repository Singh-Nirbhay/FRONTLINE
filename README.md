# FRONTLINE Support Triage and Routing Engine

FRONTLINE is an asynchronous support triage classification pipeline designed to ingest, analyze, and route incoming customer support messages. Built as a monorepo, the system uses Fastify for message ingestion, BullMQ for job queue distribution, PostgreSQL for persistence, and the Groq SDK for Large Language Model inference. Incoming messages are sanitized, checked for adversarial content, classified into categories and priorities, and flagged for human review based on AI confidence levels or specific safety constraints.

## System Architecture

The workflow separates message ingestion from classification processing to achieve low-latency input reception and resilient background execution.

```
                              +-------------------------+
                              |    Vite React Portal    |
                              |      (apps/web)         |
                              +------------+------------+
                                           |
                                           | REST API / Polling
                                           v
                              +-------------------------+
                              |    Fastify API Server   |
                              |      (apps/api)         |
                              +------+-------------+----+
                                     |             |
                     Database Queries|             | Enqueue Jobs
                                     v             v
                              +------+----+   +----+----+
                              | Postgres  |   |  Redis  |
                              | Database  |   | (BullMQ)|
                              +------+----+   +----+----+
                                     ^             |
                     Persist Results |             | Consume Jobs
                                     |             v
                              +------+-------------+----+
                              |  BullMQ Background      |
                              |    Triage Worker        |
                              +------------+------------+
                                           |
                                           | LLM Inference
                                           v
                              +-------------------------+
                              |        Groq API         |
                              | (Llama-3.3-70b-versatile|
                              +-------------------------+
```

### Ingestion Flow
1. An incoming message is received by the Fastify API server via a single-message or bulk ingestion endpoint.
2. The raw message is persisted to the database and its reference ID is pushed onto a BullMQ job queue managed in Redis.
3. The server immediately returns an ingestion acknowledgement (`202 Accepted`) containing the unique message identifier, freeing the client connection.

### Asynchronous Processing Flow
1. The background worker picks up the job from the Redis queue.
2. The text content undergoes multi-stage sanitization and checks.
3. If an adversarial pattern is flagged, the worker short-circuits the pipeline, writes an override triage state to the database, and flags the message for human review without contacting the AI model.
4. Clean messages are sent to the Groq API utilizing the Llama-3.3-70b-versatile model. The prompt instructs the model to return a structured JSON categorization.
5. The raw string response from the AI is validated and repaired by the runtime schema guard.
6. The validated classification results, token usage statistics, and processing times are saved to the database.
7. The React client polls the messages endpoint to dynamically fetch the resolved triage details.

---

## Project Structure

The codebase is organized as a Turborepo monorepo:

*   **`apps/api`**: The Fastify HTTP server and background processing worker. It defines controller routes for message ingestion, statistics calculations, and manual review updates, and hosts the BullMQ background consumer.
*   **`apps/web`**: The dashboard frontend built with React, Vite, TanStack Table, and TanStack Query. It handles list rendering, sorting, pagination, and slide-out message reviews.
*   **`packages/core`**: The shared library containing Zod validation schemas, content sanitizers, adversarial filters, and structural type repair engines.
*   **`packages/eval`**: A command-line evaluation harness used to measure classifier performance against a 40-message benchmark suite, computing overall accuracy, category/priority alignment, and adversarial catch rates.
*   **`prisma`**: Houses the database schema representing message ingestions, triage results, and evaluation labels.
*   **`scripts`**: Contains utilities for orchestrating local schema migrations.

---

## Core Components

### Ingestion Engine (`apps/api`)
The API exposes endpoints to ingest customer support queries.
*   **Single Message Ingestion**: Standard HTTP POST requests containing a single text payload are validated and queued.
*   **Bulk Ingestion Parser**: Accepts multi-format payloads including raw plain text (split by newlines or paragraph spacing), JSON objects, JSON arrays, and CSV files. The parser extracts the message text based on standard column header heuristics (`content`, `message`, `text`, `body`) and registers individual database entries and queue tasks concurrently.

### Sanitization Guard (`packages/core`)
Before any message is parsed or submitted to external APIs, it is processed by the sanitizer to prevent injection attacks and ensure uniform formatting:
*   Trims leading/trailing whitespace and normalizes Unicode character sets to NFC.
*   Converts Windows CRLF to standard LF and strips null bytes and non-printable control characters.
*   Collapses duplicate spacing, consecutive tabs, and redundant newlines to prevent layout-based prompt manipulation.
*   Truncates inputs exceeding 4,000 characters while preserving word boundaries.

### Adversarial Guard (`packages/core`)
A rule-based inspection layer checks the sanitized text for prompt injection patterns, role-hijacking requests, instruction overrides, or data exfiltration attempts. If a known threat phrase is discovered, the request is intercepted. The pipeline records the message as a security alert and bypasses the Large Language Model entirely, avoiding API charges and prompt manipulation vulnerability.

### Schema Validation & Repair Engine (`packages/core`)
AI model outputs can occasionally suffer from syntax errors or malformed structures. To prevent pipeline failures, the schema guard implements a validation and repair routine:
*   Standardizes JSON outputs using Zod schema models.
*   Resolves synonyms and redirects common category labels to valid enum tags (e.g. `"bug"` maps to `"technical"`, `"refund"` maps to `"billing"`).
*   Corrects corrupted value types, coersing string confidence scores to floats, and stringified booleans to actual booleans.
*   Truncates over-length summaries and suggested actions to fit database bounds without throwing runtime errors.

### Human Escalation Strategy
The system identifies messages requiring manual review based on three conditions:
1.  **AI Uncertainty**: If the classification confidence score falls below the configurable `CONFIDENCE_THRESHOLD` (defaults to 0.72), the message is flagged for manual review.
2.  **Adversarial and Language Flags**: Messages flagged as adversarial or written in a non-English language are automatically routed to human agents regardless of AI confidence.
3.  **Low-Confidence Fallbacks**: If the AI model fails to respond after three retries or returns un-repairable JSON, the pipeline falls back to an "unclear" state with zero confidence, forcing human intervention.

### Observability and Metrics (`apps/api`)
An integrated Prometheus metrics engine records pipeline activities, tracking:
*   Successful and failed triage counts.
*   Model classification latencies and token counts.
*   HTTP request durations and BullMQ queue depths.
*   Rate limiting event frequencies.

Graceful shutdown hooks are registered to ensure database clients, queue connections, and active background workers complete ongoing tasks before exit.
