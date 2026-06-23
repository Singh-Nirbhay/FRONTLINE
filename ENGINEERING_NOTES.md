# Engineering Design Notes - FRONTLINE Support Triage Pipeline

These engineering notes outline the architectural decisions, design tradeoffs, and technical reasoning behind the implementation of the FRONTLINE triage classifier system.

---

## 1. Large Language Model Selection

### Model Used
*   **Primary Inference Model**: `llama-3.3-70b-versatile` via the Groq SDK.
*   **Model Role**: High-throughput structured classification, priority matching, and initial customer sentiment parsing.

### Selection Reasoning & Trade-offs
The prototype was originally designed around Anthropic Claude Sonnet models. However, to meet local enterprise performance baselines, inference was migrated to the Groq Cloud platform utilizing Llama 3.3. 

1.  **Latency vs. Capability**: Support triage requires sub-second execution. Traditional commercial API providers introduce latencies between 1.5 to 3 seconds per completion. Groq's LPUs (Language Processing Units) achieve completion latencies of 200–500ms, making it ideal for real-time background queues.
2.  **Model Scale Trade-off**: The 70B parameter version of Llama was selected over the faster 8B parameter model. While the 8B model is faster and cheaper, it failed to reliably follow structured JSON instructions, frequently returned markdown-wrapped blocks, and failed to correctly categorize complex multilingual queries. The 70B model provides reasoning capabilities comparable to larger models while maintaining high token throughput.
3.  **Context Window Limitations**: Support queries are typically short (under 500 words). The Llama 3.3 model's context window is more than sufficient for support query ingestion.

---

## 2. Development Tools Integration

Development was completed using collaborative AI pair programming:
*   **Cursor**: Used for repository navigation, structural code edits, and refactoring monorepo package imports. Cursor's inline diffs were instrumental in moving between packages without breaking dependency compilation.
*   **Antigravity (Google DeepMind)**: Provided the primary task execution, background compiler monitoring, and automated test suite verification. Antigravity was used to write and run unit and integration test scripts, track database transactions, resolve script path discrepancies, and ensure that the evaluation suite maintained its 80% accuracy threshold.
*   **v0 by Vercel**: Used to generate the initial component layouts and visual tokens for the React dashboard interface, which were subsequently adapted into CSS variables and React JSX files.

---

## 3. Prompt Engineering & Deterministic Structure

### Structured Prompt Design
The system prompt in the triage service is structured as a series of XML tags: `<role>`, `<output_format>`, `<categories>`, `<priority_rules>`, and `<adversarial_rules>`. 

```
<output_format>
Respond ONLY with a single valid JSON object. Do not wrap the JSON in markdown code blocks...
</output_format>
```

XML tags are used to partition prompt instructions because LLMs are trained on web text, making them effective at distinguishing instructions enclosed within XML brackets. This design reduces prompt confusion compared to markdown headers.

### Enforcing JSON Mode
To prevent model drift and garbage outputs, the Groq API completion request is configured with `response_format: { type: "json_object" }`. This forces the engine to return a syntactically valid JSON string.

Additionally, to avoid introductory or concluding text, the prompt explicitly instructs the model to omit conversational prefixes or suffixes. A fallback schema validator and repair engine in `packages/core` intercepts the output, correcting minor structural issues (like converting stringified numbers or aliases) before database storage.

---

## 4. Handling Uncertainty and Edge Cases

A major source of failure in support classification is the handling of vague, non-English, or malformed inputs.

### Ambiguity and Low Confidence
If a customer submits vague text (e.g. "help me please"), the model will return a low confidence score. If this score falls below `CONFIDENCE_THRESHOLD` (0.72), the pipeline marks the message as `needs_human: true`. This redirects the message to human review.

### Multilingual Inputs
To prevent non-spaced languages (such as Chinese, Japanese, Korean, and Thai) from failing the initial length checks, a character script regex checks the input first. If non-spaced characters are present, the validation bypasses token count splits (which require spaces) and uses a raw character-length boundary instead. The system prompt instructs the model to translate and classify foreign content normally but always flag the message as requiring human verification (`needs_human: true`) to ensure translation accuracy.

### Multiple Intents
When a message contains multiple issues (e.g. billing and login errors), the system prompt directs the model to prioritize the highest risk issue (P0/P1 over P2/P3) and categorize based on the dominant theme, assigning a lower confidence score if the classification is ambiguous.

---

## 5. Major Engineering Decisions

### Why use a background worker queue (BullMQ/Redis) instead of inline REST requests?
*   **Alternative considered**: Processing the LLM call directly inside the Fastify POST handler and returning the classification immediately to the client.
*   **Trade-off**: Inline calls expose the customer to LLM latency (300ms–800ms) and network failures. If the Groq API times out or experiences rate limits, the client request fails.
*   **Chosen Solution**: By saving the raw request to the database and enqueuing it to BullMQ immediately, the API returns a `202 Accepted` response in under 20ms. The background worker handles model latency, retries, and rate limits independently. If the API fails, the message is not lost and is retried.

### Why create a custom schema guard instead of relying solely on Zod schema validations?
*   **Alternative considered**: Throwing an error and retrying the LLM completion if the output fails Zod validation.
*   **Trade-off**: LLM API calls are expensive and slow. Retrying on minor format issues (like returning `"bug"` instead of `"technical"`) increases API costs and execution times.
*   **Chosen Solution**: The schema guard acts as a repair layer. It intercepts the parsed object, maps common synonyms, coerces stringified types, and truncates text overflow. This repairs over 90% of minor formatting errors, avoiding unnecessary API retries.

### Why implement custom Fastify prototype monkey-patching for Prometheus metrics?
*   **Alternative considered**: Registering metrics hooks manually inside every route definition.
*   **Trade-off**: Code duplication and maintenance complexity.
*   **Chosen Solution**: Monkey-patching the Fastify prototype `register` method allows global request/response lifecycle hooks to be automatically registered for all routes. This provides full request coverage with zero developer overhead.

---

## 6. Lessons Learned

1.  **LLMs are unreliable for counting tokens**: Early iterations showed that LLMs are poor at counting word tokens when applying fail-fast filters. Simple runtime code logic remains more reliable than model checks for preprocessing.
2.  **Concurrency limits are critical**: During local testing, high concurrency settings caused Groq API keys to reach rate limits quickly. Setting the worker concurrency limit to `5` prevents rate limit issues while keeping queue execution smooth.
3.  **Local state must be persisted**: Optimistic UI updates on the frontend are helpful, but without corresponding database updates (as discovered with the "Mark as Reviewed" button), state updates will revert during refetch cycles. Persistence must be handled at both database and routing levels.
