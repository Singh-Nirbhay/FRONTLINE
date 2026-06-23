import { evalDataset, mockLLMResponses } from "./dataset.js";
import { runEval } from "./runner.js";
import { scoreEvalRun } from "./scorer.js";
import { printReport } from "./reporter.js";
import { TriageService } from "api/dist/services/triage.service.js";
import { sanitizeMessage } from "@frontline/core";

// Minimal metrics registry that acts silently during evaluation
const silentMetricsRegistry = {
  incrementCounter(name: string, labels: Record<string, string>): void {
    // Silent
  },
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    // Silent
  }
};

async function main() {
  // Simple command line argument parsing
  let concurrency = 3;
  let outputDir = "./eval-results";

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--concurrency" && i + 1 < args.length) {
      concurrency = parseInt(args[i + 1], 10) || 3;
    }
    if (args[i] === "--output-dir" && i + 1 < args.length) {
      outputDir = args[i + 1];
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isMock = !apiKey || !apiKey.startsWith("sk-ant-") || apiKey.includes("your-api-key") || apiKey.trim() === "" || apiKey === "placeholder";

  let anthropicClient: any;

  if (isMock) {
    console.log("[CLI] ANTHROPIC_API_KEY is not configured or holds a placeholder. Injecting MOCK Anthropic Client.");
    anthropicClient = {
      messages: {
        create: async (params: any) => {
          const userMsg = params.messages?.[0]?.content || "";
          
          // Extract content from XML tags if present
          let extractedContent = "";
          const xmlMatch = userMsg.match(/<customer_message>([\s\S]*?)<\/customer_message>/);
          if (xmlMatch) {
            extractedContent = xmlMatch[1].trim();
          } else {
            extractedContent = userMsg.trim();
          }

          // Match by looking up dataset messages whose content corresponds
          const match = evalDataset.find(m => {
            const sanitized = sanitizeMessage(m.content || "");
            return sanitized === extractedContent || extractedContent.includes(sanitized) || sanitized.includes(extractedContent);
          });

          const matchedId = match?.id;

          if (matchedId && mockLLMResponses[matchedId]) {
            const text = mockLLMResponses[matchedId];
            
            // Add a slight mock delay to simulate network requests (50ms - 150ms)
            await new Promise(resolve => setTimeout(resolve, 50 + Math.floor(Math.random() * 100)));

            return {
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text
                }
              ],
              usage: {
                input_tokens: 150,
                output_tokens: 80
              }
            };
          }

          // Fallback response for unmatched items
          console.warn(`[Mock Client] Unmatched customer query: "${userMsg.slice(0, 80)}..."`);
          return {
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  category: "unclear",
                  priority: "P3",
                  summary: "Mock fallback response.",
                  suggested_action: "Escalate to human review.",
                  needs_human: true,
                  confidence: 0.3
                })
              }
            ],
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          };
        }
      }
    };
  } else {
    console.log("[CLI] ANTHROPIC_API_KEY detected. Initializing real Anthropic Client.");
    const AnthropicModule = await import("@anthropic-ai/sdk");
    // Handle both default/named ESM imports
    const Anthropic = AnthropicModule.default || (AnthropicModule as any).Anthropic || AnthropicModule;
    anthropicClient = new Anthropic({ apiKey });
  }

  // Instantiate the TriageService with the (mocked/real) Anthropic client
  const triageService = new TriageService(anthropicClient, silentMetricsRegistry as any);

  console.log(`[CLI] Starting evaluation run of ${evalDataset.length} messages (Concurrency limit: ${concurrency})...`);
  
  try {
    const runResult = await runEval(evalDataset, triageService, concurrency, outputDir);
    const scoreResult = scoreEvalRun(runResult, evalDataset);
    
    printReport(scoreResult, outputDir);

    if (scoreResult.overall_accuracy >= 0.8) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (error) {
    console.error("[CLI] Evaluation run failed with unexpected error:", error);
    process.exit(1);
  }
}

main();
