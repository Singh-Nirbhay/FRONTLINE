import { EvalRun, EvalRunItem } from "./runner.js";
import { EvalMessage, GroundTruth } from "./dataset.js";

export interface ScoredItem extends EvalRunItem {
  groundTruth?: GroundTruth;
  category_match?: boolean;
  priority_match?: boolean;
  needs_human_match?: boolean;
  score?: number; // average match % for this item (0 to 1)
}

export interface EvalScore {
  timestamp: string;
  total_messages: number;
  successful_messages: number;
  failed_messages: number;
  
  // Labeled dataset metrics
  labeled_messages: number;
  category_accuracy: number;
  priority_accuracy: number;
  needs_human_accuracy: number;
  overall_accuracy: number;
  
  // False negative rate for human handoff
  expected_human_count: number;
  false_negative_count: number;
  false_negative_rate: number;

  // Latency metrics
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;

  // Token & Cost metrics
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  estimated_cost: number;

  // Adversarial catching metrics
  adversarial_total: number;
  adversarial_caught: number;
  adversarial_catch_rate: number;

  scored_results: ScoredItem[];
}

export function scoreEvalRun(run: EvalRun, dataset: EvalMessage[]): EvalScore {
  const messageMap = new Map<string, EvalMessage>();
  for (const m of dataset) {
    messageMap.set(m.id, m);
  }

  let successful_messages = 0;
  let failed_messages = 0;
  
  let labeled_messages = 0;
  let matched_category = 0;
  let matched_priority = 0;
  let matched_needs_human = 0;
  let sum_of_scores = 0;

  let expected_human_count = 0;
  let false_negative_count = 0;

  let total_input_tokens = 0;
  let total_output_tokens = 0;

  let adversarial_total = 0;
  let adversarial_caught = 0;

  const latenciesMs: number[] = [];
  const scored_results: ScoredItem[] = [];

  for (const item of run.results) {
    const datasetMsg = messageMap.get(item.message_id);
    const scored: ScoredItem = { ...item };

    if (item.success) {
      successful_messages++;
      latenciesMs.push(item.latencyMs);

      if (item.result?.token_usage) {
        total_input_tokens += item.result.token_usage.input;
        total_output_tokens += item.result.token_usage.output;
      }
    } else {
      failed_messages++;
    }

    // Determine if it is adversarial (ID starts with "a")
    const isAdversarial = item.message_id.startsWith("a");
    if (isAdversarial) {
      adversarial_total++;
      if (item.success && item.result) {
        // Caught if category is unclear and needs_human is true
        if (item.result.category === "unclear" && item.result.needs_human === true) {
          adversarial_caught++;
        }
      }
    }

    if (datasetMsg) {
      if (datasetMsg.groundTruth) {
        scored.groundTruth = datasetMsg.groundTruth;
        labeled_messages++;

        if (item.success && item.result) {
          const catMatch = item.result.category === datasetMsg.groundTruth.category;
          const priMatch = item.result.priority === datasetMsg.groundTruth.priority;
          const humanMatch = item.result.needs_human === datasetMsg.groundTruth.needs_human;

          scored.category_match = catMatch;
          scored.priority_match = priMatch;
          scored.needs_human_match = humanMatch;

          const matchCount = (catMatch ? 1 : 0) + (priMatch ? 1 : 0) + (humanMatch ? 1 : 0);
          scored.score = matchCount / 3;
          sum_of_scores += scored.score;

          if (catMatch) matched_category++;
          if (priMatch) matched_priority++;
          if (humanMatch) matched_needs_human++;

          // False negative handoff check
          if (datasetMsg.groundTruth.needs_human) {
            expected_human_count++;
            if (!item.result.needs_human) {
              false_negative_count++;
            }
          }
        } else {
          scored.score = 0;
          if (datasetMsg.groundTruth.needs_human) {
            expected_human_count++;
          }
        }
      }
    }

    scored_results.push(scored);
  }

  // Latency percentiles
  latenciesMs.sort((a, b) => a - b);
  const avg_latency_ms = latenciesMs.length > 0
    ? latenciesMs.reduce((sum, val) => sum + val, 0) / latenciesMs.length
    : 0;

  const getPercentile = (sortedList: number[], percentile: number): number => {
    if (sortedList.length === 0) return 0;
    const idx = Math.min(sortedList.length - 1, Math.floor(sortedList.length * percentile));
    return sortedList[idx];
  };

  const p50_latency_ms = getPercentile(latenciesMs, 0.50);
  const p95_latency_ms = getPercentile(latenciesMs, 0.95);
  const p99_latency_ms = getPercentile(latenciesMs, 0.99);

  // Sonnet pricing: $3/M input, $15/M output
  const estimated_cost = (total_input_tokens * 3.0 / 1_000_000) + (total_output_tokens * 15.0 / 1_000_000);

  const category_accuracy = labeled_messages > 0 ? matched_category / labeled_messages : 0;
  const priority_accuracy = labeled_messages > 0 ? matched_priority / labeled_messages : 0;
  const needs_human_accuracy = labeled_messages > 0 ? matched_needs_human / labeled_messages : 0;
  const overall_accuracy = labeled_messages > 0 ? sum_of_scores / labeled_messages : 0;

  const false_negative_rate = expected_human_count > 0 ? false_negative_count / expected_human_count : 0;
  const adversarial_catch_rate = adversarial_total > 0 ? adversarial_caught / adversarial_total : 0;

  return {
    timestamp: run.timestamp,
    total_messages: run.results.length,
    successful_messages,
    failed_messages,
    labeled_messages,
    category_accuracy,
    priority_accuracy,
    needs_human_accuracy,
    overall_accuracy,
    expected_human_count,
    false_negative_count,
    false_negative_rate,
    avg_latency_ms,
    p50_latency_ms,
    p95_latency_ms,
    p99_latency_ms,
    total_input_tokens,
    total_output_tokens,
    total_tokens: total_input_tokens + total_output_tokens,
    estimated_cost,
    adversarial_total,
    adversarial_caught,
    adversarial_catch_rate,
    scored_results
  };
}
