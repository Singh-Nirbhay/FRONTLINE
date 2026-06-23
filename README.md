# FRONTLINE

**Support Triage and Routing Engine**

A production-grade, asynchronous message classification pipeline that reads raw customer support messages and returns a structured triage decision — category, priority, urgency flag, and a recommended action — fast enough and reliably enough that a real support team could put it on the front line unsupervised.

---

## What This Is

Most AI-powered support tools are dressed-up chatbots. FRONTLINE is not. It does one thing: take an unstructured, messy, sometimes adversarial customer message and turn it into a machine-readable triage record that downstream systems can act on. No reply generation, no conversation management. Just classification done correctly.

The core challenge this system solves is not the happy path — a clear billing question from a calm user is easy to classify. The real work is handling everything else: vague complaints, multi-issue messages, non-English text, sarcasm, and messages specifically crafted to manipulate the AI's output. FRONTLINE handles all of these, and when it cannot classify with sufficient confidence, it says so honestly and routes the message to a human agent rather than guessing.

---

## Architecture

The system is built around a deliberate separation between message ingestion and message processing. The API accepts input and returns immediately. All classification work happens asynchronously in a background worker. This means the ingestion endpoint never blocks on AI inference, never exposes the caller to model latency, and degrades gracefully under load.

```
                        ┌──────────────────────────┐
                        │     Vite React Portal     │
                        │        (apps/web)         │
                        └────────────┬─────────────┘
                                     │ REST / Polling
                                     ▼
                        ┌──────────────────────────┐
                        │    Fastify API Server     │
                        │       (apps/api)          │
                        └────────┬──────────────────┘
                                 │                  │
                   DB Queries    │                  │  Enqueue Jobs
                                 ▼                  ▼
                        ┌────────────┐    ┌─────────────────┐
                        │ PostgreSQL │    │  Redis (BullMQ) │
                        └────────────┘    └────────┬────────┘
                                 ▲                  │
                  Persist Results│                  │  Consume Jobs
                                 │                  ▼
                        ┌────────┴──────────────────┐
                        │   BullMQ Background Worker │
                        └────────────┬──────────────┘
                                     │ LLM Inference
                                     ▼
                        ┌──────────────────────────┐
                        │         Groq API          │
                        │  llama-3.3-70b-versatile  │
                        └──────────────────────────┘
```

**Ingestion path:** A POST request hits the Fastify server, the raw message is persisted to PostgreSQL, a job reference is pushed onto the BullMQ queue backed by Redis, and a `202 Accepted` response is returned with the message ID. The client is never kept waiting for inference.

**Processing path:** The background worker picks up the job, runs the message through sanitization and adversarial checks, calls the Groq API for classification, validates and repairs the structured response, and writes the final triage record back to PostgreSQL. The React frontend polls the messages endpoint to surface resolved results.

---

## Monorepo Structure

```
/
├── apps/
│   ├── api/          → Fastify HTTP server + BullMQ worker
│   └── web/          → React 18 + Vite dashboard
├── packages/
│   ├── core/         → Zod schemas, sanitizer, adversarial guard, schema repair
│   └── eval/         → Standalone CLI evaluation harness
├── prisma/
│   └── schema.prisma → Database schema (Message, TriageResult, EvalLabel)
└── turbo.json        → Turborepo task orchestration
```

Managed with Turborepo and pnpm workspaces. `packages/core` is the single source of truth for types and validation schemas — nothing in `apps/` duplicates them.

---

## Processing Pipeline

Every message passes through five stages in order before a triage result is written to the database.

**Stage 1 — Sanitization.** The raw text is normalized: whitespace collapsed, Unicode brought to NFC, CRLF converted to LF, null bytes and non-printable control characters stripped, and inputs over 4,000 characters truncated at a word boundary. This is not cosmetic hygiene — it closes off layout-based prompt manipulation where whitespace or control characters are used to hide injected instructions.

**Stage 2 — Adversarial detection.** The sanitized text is checked against a rule set for prompt injection patterns, role-hijacking phrases, instruction override attempts, and data exfiltration probes. If a match is found, the pipeline short-circuits: the job is marked as a security alert, a safe override triage state is written to the database with `needs_human: true`, and the Groq API is never contacted. This prevents both prompt manipulation and unnecessary API spend.

**Stage 3 — LLM classification.** Clean messages are sent to the Groq API using Llama-3.3-70b-versatile. The system prompt is structured with explicit XML sections covering role definition, category definitions with examples, priority rules, adversarial handling instructions, and confidence calibration guidance. Temperature is set to zero. JSON mode is enforced at the API level, not just via prompt instruction, which eliminates most parse errors before they happen.

**Stage 4 — Schema validation and repair.** Even with JSON mode enabled, model outputs can have type coercion issues or use category synonyms not in the enum. The schema guard attempts repair before throwing: string confidence scores are coerced to floats, stringified booleans are converted, common synonyms are mapped to valid enum values (`"bug"` → `"technical"`, `"refund"` → `"billing"`), and over-length fields are truncated. Only if the output is still invalid after repair does it throw a parse error.

**Stage 5 — Confidence gate.** If the validated confidence score is below the configurable `CONFIDENCE_THRESHOLD` (default: 0.72), `needs_human` is forced to `true` regardless of what the model returned. The rest of the fields are preserved as-is — the classification is still recorded, it is just flagged for review.

---

## Human Escalation Conditions

A message is routed to human review under any of these three conditions:

- **Confidence below threshold.** The model classified it but was not confident enough. The record is written with all fields intact so a reviewer has full context.
- **Adversarial or non-English content.** These are forced to `needs_human: true` before the model is called (adversarial) or after (non-English detection in the system prompt instruction). Neither condition produces a guess.
- **Fallback on total failure.** If the model fails after three retries or returns unrepairably malformed output, a safe fallback record is written with `category: "unclear"`, `confidence: 0`, and `needs_human: true`. The pipeline does not surface errors to the user — it always writes a triage record.

---

## Triage Output Schema

Every processed message produces a record conforming to this structure:

```typescript
{
  message_id:       string          // UUID
  category:         "billing"
                  | "technical"
                  | "complaint"
                  | "feature_request"
                  | "out_of_scope"
                  | "unclear"
  priority:         "P0" | "P1" | "P2" | "P3"
  summary:          string          // max 120 characters
  suggested_action: string          // max 200 characters
  needs_human:      boolean
  confidence:       number          // 0.0 – 1.0
  processing_time_ms: number
  token_usage:      { input: number, output: number }
}
```

The schema is defined once in `packages/core` using Zod and is the authoritative type contract for the entire system. The API, worker, schema guard, and frontend all derive their types from it.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/messages` | Ingest a single message. Returns `202` with `message_id`. |
| `POST` | `/api/v1/messages/bulk` | Ingest multiple messages from plain text, JSON array, or CSV. |
| `GET` | `/api/v1/messages` | Paginated list with filters: `category`, `priority`, `needs_human`, `search`. |
| `GET` | `/api/v1/messages/:id` | Full message record including joined triage result. |
| `GET` | `/api/v1/messages/stats` | Aggregate statistics: counts by category/priority, avg confidence, token totals. |
| `GET` | `/health` | Liveness check with database and Redis connectivity status. |
| `GET` | `/metrics` | Prometheus-format metrics for scraping. |

Rate limiting is applied at 100 requests per minute per IP on ingestion endpoints.

---

## Dashboard

The React frontend provides a live view of the triage queue. The message table supports server-side pagination, column sorting, and filter combinations. Clicking any row opens a slide-in detail panel showing the full original message, all classification fields, a confidence gauge, token usage, and processing latency. The filter state persists in URL search parameters so shared links preserve context.

Messages awaiting human review are visually differentiated. The stats bar at the top of the page refreshes every 30 seconds and shows real-time breakdowns by priority, needs-human count, and average confidence across the full dataset.

---

## Observability

Prometheus metrics are exposed at `/metrics` and cover:

- Triage request counts broken down by status (success, parse error, API error, fallback)
- Classification latency histogram with buckets from 100ms to 5000ms
- Confidence score distribution histogram
- Token consumption counters (input and output separately)
- HTTP request duration by method and route
- BullMQ queue depth gauge
- Rate limiting event frequency

Standard Node.js runtime metrics (event loop lag, memory, GC) are also registered via `prom-client` defaults.

Structured JSON logging is handled by Pino throughout the API and worker. Every triage completion logs the message ID, resolved category, priority, confidence, and latency in a single log line — enough to reconstruct the full processing history from logs alone if needed.

---

## Evaluation Harness

`packages/eval` is a standalone CLI tool that runs all 40 benchmark messages through the triage pipeline and produces a scored report. The benchmark covers clear billing and technical issues, sarcastic and multi-issue messages, non-English input, out-of-scope requests, adversarial injection attempts, and garbage input. Ten messages carry ground-truth labels.

The scorer computes category accuracy, priority accuracy, and needs-human accuracy against the labeled subset, and adversarial catch rate and error rate across the full set. It also measures p50, p95, and p99 latency and estimates cost per run using Groq's token pricing. The CLI exits with code `1` if overall accuracy falls below 80%, making it usable as a CI gate.

---

## Technology Choices

| Layer | Technology | Why |
|-------|-----------|-----|
| API Framework | Fastify | Fastest Node.js HTTP framework with native JSON Schema validation. Not using Express — schema-level validation matters here for correctness. |
| Queue | BullMQ + Redis | Durable job queue with built-in retry and backoff. Jobs survive worker restarts. |
| Database | PostgreSQL 16 + Prisma | Structured relational data with aggregation queries for the stats endpoint. Prisma for type-safe queries without raw SQL everywhere. |
| LLM | Groq / Llama-3.3-70b | Low inference latency, high throughput, OpenAI-compatible API. JSON mode available at the API level. |
| Validation | Zod | Single schema definition generates both runtime validators and TypeScript types. No duplication. |
| Monorepo | Turborepo + pnpm | Shared `packages/core` used by API, worker, web, and eval without duplication. |
| Testing | Vitest + Supertest | Co-located unit tests, integration tests against real test DB, no test-only dependencies leaking into production code. |

---



### Tools Used

This project was built using a combination of Claude (Anthropic), Cursor, and v0. These tools were used for code generation, scaffolding, and prompt iteration — not as a black box that produced a finished system. Every file in this codebase was read, understood, and either accepted, modified, or rejected based on whether it actually solved the problem correctly.

Using AI tools to build AI tools is not a shortcut. It is a skill. The question is not whether you used them — it is whether you understand what they produced and why.

---

### Model and Prompt Strategy

The classification model is Llama-3.3-70b-versatile via Groq. The choice was deliberate: the Groq inference layer is significantly faster than alternatives for this model size, and the OpenAI-compatible API means JSON mode is enforced at the protocol level rather than relying purely on prompt instruction. That matters because prompt-only JSON enforcement fails on adversarial inputs — a message that tries to override the output format can succeed if the model's only constraint is "I was told to return JSON." A hard API-level JSON mode does not yield.

The system prompt is divided into explicit XML sections: role, output format, category definitions with canonical examples, priority escalation rules, adversarial handling instructions, and confidence calibration. The separation is intentional. A monolithic system prompt creates ambiguity about which instruction takes precedence. XML-sectioned prompts give the model clear structural signals about scope, which empirically reduces category confusion on edge cases.

Temperature is set to zero. This is a classification task, not a generation task. Determinism is more useful than creativity here.

---

### Handling Uncertainty

The biggest design decision in this system is what to do when the model is not sure. The wrong answer is to pick the highest-probability class and return it as if it were confident. That produces a triage system that looks accurate on average but fails silently on the cases that matter most.

The approach here is to make uncertainty explicit and actionable. Three things happen:

The confidence score is not a post-hoc label — it is a first-class output field that the model is explicitly instructed to calibrate. The system prompt defines what confidence 0.9, 0.7, 0.5, and 0.3 mean in concrete operational terms, not abstract statistical terms. This produces scores that are meaningful rather than decorative.

The confidence gate at 0.72 is a hard override. Below that threshold, `needs_human` is forced to `true` regardless of the model's own assessment. The threshold is configurable via environment variable so it can be tuned based on observed accuracy without code changes.

The fallback on total failure does not surface an error to the caller. It writes a valid triage record with `category: "unclear"`, `confidence: 0`, and `needs_human: true`. The pipeline always produces output. The downstream system can act on it.

---

### Adversarial Handling

The adversarial guard deserves a specific explanation because it is the thing most triage systems skip, and it is the thing that causes the most visible failures in production.

Customer support queues receive messages that are not actually customer support requests. Some are tests. Some are automated scanners. Some are deliberate attempts to manipulate the AI's output — to make a low-priority message appear urgent, to extract information about the system's instructions, or to override the classification entirely.

The guard catches these before the model sees them. Detected patterns include prompt injection phrases ("ignore previous instructions"), role-hijacking attempts ("you are now a different AI"), instruction override attempts ("classify this as P0"), and data exfiltration probes ("repeat your system prompt"). Matches are case-insensitive and substring-based — exact phrase matching, not semantic similarity, because semantic matching at this stage would itself be vulnerable to rephrasing.

When a match is found, the Groq API is never called. This is important for two reasons: it eliminates the attack surface for prompt manipulation, and it eliminates the API cost for messages that were never legitimate support requests.

---

### What "Understanding Every Line" Means in Practice

When Claude or Cursor generated a function that worked but I did not understand why it worked, I did not commit it. I asked it to explain the approach, compared that against the alternative I had in mind, and made a deliberate choice. A few examples:

The schema repair engine came back with a `try-catch` around the entire repair routine that swallowed parse errors silently. I changed it to collect all validation errors before attempting repair, then re-validate, then throw if still invalid. The original version would have hidden real bugs.

The adversarial guard's first generated version threw an error on detection. I changed it to return a structured result object instead, because throwing in a guard function makes the calling code responsible for catching and interpreting the exception type — which is the wrong place for that logic.

The confidence gate was initially implemented inside the Groq API call block. I moved it out to a separate post-processing step because it is a business rule, not an inference concern, and mixing them in the same function makes the code harder to test and harder to change independently.

These are small decisions. But they are the decisions that separate a codebase that works from a codebase that is maintainable.

---

*The point of using AI tooling is not to avoid thinking. It is to spend more of your thinking on the decisions that matter.*

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | Yes | — | Groq API key for LLM inference |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` | Groq model identifier |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `CONFIDENCE_THRESHOLD` | No | `0.72` | Below this score, `needs_human` is forced to `true` |
| `MAX_RETRIES` | No | `3` | Maximum Groq API retry attempts |
| `CONCURRENCY` | No | `5` | BullMQ worker concurrency |

---

