import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { EvalMessage } from "./dataset.js";
import { TriageService } from "api/dist/services/triage.service.js";
import { TriageResult } from "@frontline/core";

export interface EvalRunItem {
  message_id: string;
  content: string;
  success: boolean;
  error?: string;
  result?: TriageResult;
  latencyNs: string; // Stored as string to prevent bigint serialization issues
  latencyMs: number;
}

export interface EvalRun {
  timestamp: string;
  concurrency: number;
  total_latency_ns: string;
  total_latency_ms: number;
  results: EvalRunItem[];
}

/**
 * Runs all dataset messages through the TriageService with a concurrency limit.
 * Saves the raw run log to `eval-results/run-{timestamp}.json`.
 */
export async function runEval(
  messages: EvalMessage[],
  triageService: TriageService,
  concurrency = 3,
  outputDir = "./eval-results"
): Promise<EvalRun> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const limit = pLimit(concurrency);
  
  const startTimeTotal = process.hrtime.bigint();

  const promises = messages.map((message) => {
    return limit(async (): Promise<EvalRunItem> => {
      const startTimeItem = process.hrtime.bigint();
      try {
        // Prepare InboundMessage format expected by TriageService
        const inboundMessage = {
          id: message.id,
          content: message.content,
          received_at: new Date().toISOString()
        };

        const result = await triageService.triage(inboundMessage);
        
        const endTimeItem = process.hrtime.bigint();
        const latencyNs = endTimeItem - startTimeItem;
        const latencyMs = Number(latencyNs) / 1_000_000;

        return {
          message_id: message.id,
          content: message.content,
          success: true,
          result,
          latencyNs: latencyNs.toString(),
          latencyMs
        };
      } catch (err: any) {
        const endTimeItem = process.hrtime.bigint();
        const latencyNs = endTimeItem - startTimeItem;
        const latencyMs = Number(latencyNs) / 1_000_000;

        return {
          message_id: message.id,
          content: message.content,
          success: false,
          error: err?.message || String(err),
          latencyNs: latencyNs.toString(),
          latencyMs
        };
      }
    });
  });

  const results = await Promise.all(promises);
  
  const endTimeTotal = process.hrtime.bigint();
  const totalLatencyNs = endTimeTotal - startTimeTotal;
  const totalLatencyMs = Number(totalLatencyNs) / 1_000_000;

  const run: EvalRun = {
    timestamp,
    concurrency,
    total_latency_ns: totalLatencyNs.toString(),
    total_latency_ms: totalLatencyMs,
    results
  };

  // Ensure output directory exists and write results
  const resolvedDir = path.resolve(outputDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const outputPath = path.join(resolvedDir, `run-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(run, null, 2), "utf-8");
  console.log(`\n[Runner] Saved raw execution log to: ${outputPath}`);

  return run;
}
