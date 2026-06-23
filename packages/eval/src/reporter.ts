import fs from "fs";
import path from "path";
import Table from "cli-table3";
import chalk from "chalk";
import { EvalScore } from "./scorer.js";

/**
 * Maps accuracy percentages to standard academic grades.
 */
function getAcademicGrade(accuracy: number): string {
  const percentage = accuracy * 100;
  if (percentage >= 90) return chalk.green.bold("A");
  if (percentage >= 80) return chalk.greenBright.bold("B");
  if (percentage >= 70) return chalk.yellow.bold("C");
  if (percentage >= 60) return chalk.yellowBright.bold("D");
  return chalk.red.bold("F");
}

/**
 * Prints a beautiful CLI table and summary of the eval scores.
 * Also persists the score structure to `eval-results/report-{timestamp}.json`.
 */
export function printReport(score: EvalScore, outputDir = "./eval-results"): void {
  console.log("\n" + chalk.cyan.bold("=".repeat(80)));
  console.log(chalk.cyan.bold("            FRONTLINE AI TRIAGE SYSTEM - EVALUATION REPORT"));
  console.log(chalk.cyan.bold("=".repeat(80)));
  console.log(`Run Timestamp : ${score.timestamp}`);
  console.log(`Total Messages: ${score.total_messages} (Successful: ${score.successful_messages}, Failed: ${score.failed_messages})`);
  console.log(`Academic Grade: ${getAcademicGrade(score.overall_accuracy)}`);
  console.log(chalk.cyan("=".repeat(80)));

  // Table 1: Labeled Messages Detail
  const detailTable = new Table({
    head: [
      chalk.blue.bold("ID"),
      chalk.blue.bold("Category (Exp/Got)"),
      chalk.blue.bold("Priority (Exp/Got)"),
      chalk.blue.bold("Needs Human (Exp/Got)"),
      chalk.blue.bold("Match Score"),
      chalk.blue.bold("Status")
    ],
    colWidths: [12, 24, 20, 22, 13, 10]
  });

  const labeledItems = score.scored_results.filter(item => item.groundTruth !== undefined);
  
  for (const item of labeledItems) {
    const idStr = item.message_id.slice(0, 8);
    const expCat = item.groundTruth?.category;
    const gotCat = item.result?.category || "N/A";
    const catStr = item.category_match
      ? chalk.green(`${expCat}`)
      : `${chalk.red(expCat)} / ${chalk.yellow(gotCat)}`;

    const expPri = item.groundTruth?.priority;
    const gotPri = item.result?.priority || "N/A";
    const priStr = item.priority_match
      ? chalk.green(`${expPri}`)
      : `${chalk.red(expPri)} / ${chalk.yellow(gotPri)}`;

    const expHuman = String(item.groundTruth?.needs_human);
    const gotHuman = String(item.result?.needs_human ?? "N/A");
    const humanStr = item.needs_human_match
      ? chalk.green(`${expHuman}`)
      : `${chalk.red(expHuman)} / ${chalk.yellow(gotHuman)}`;

    const scorePct = `${Math.round((item.score || 0) * 100)}%`;
    const scoreStr = item.score === 1
      ? chalk.green(scorePct)
      : item.score === 0
      ? chalk.red(scorePct)
      : chalk.yellow(scorePct);

    const statusStr = item.score === 1
      ? chalk.green.bold("PASS")
      : chalk.red.bold("FAIL");

    detailTable.push([idStr, catStr, priStr, humanStr, scoreStr, statusStr]);
  }

  console.log(chalk.white.bold("\n--- Labeled Samples Detailed Analysis ---"));
  console.log(detailTable.toString());

  // Table 2: Metrics Summary Dashboard
  const summaryTable = new Table({
    head: [chalk.blue.bold("Metric Description"), chalk.blue.bold("Value / Accuracy"), chalk.blue.bold("Status / Info")],
    colWidths: [38, 22, 20]
  });

  const toPercent = (v: number) => `${(v * 100).toFixed(1)}%`;

  summaryTable.push(
    [
      "Overall Labeled Accuracy (Avg)",
      chalk.white.bold(toPercent(score.overall_accuracy)),
      score.overall_accuracy >= 0.8 ? chalk.green.bold("PASS (>= 80%)") : chalk.red.bold("FAIL (< 80%)")
    ],
    [
      "Category Classification Accuracy",
      toPercent(score.category_accuracy),
      ""
    ],
    [
      "Priority Classification Accuracy",
      toPercent(score.priority_accuracy),
      ""
    ],
    [
      "Needs Human Classification Accuracy",
      toPercent(score.needs_human_accuracy),
      ""
    ],
    [
      "Human Handoff False Negative Rate",
      toPercent(score.false_negative_rate),
      score.false_negative_rate === 0
        ? chalk.green("0.0% (Perfect)")
        : score.false_negative_rate <= 0.1
        ? chalk.yellow("Low")
        : chalk.red("High")
    ],
    [
      "Adversarial Catch Rate",
      `${score.adversarial_caught}/${score.adversarial_total} (${toPercent(score.adversarial_catch_rate)})`,
      score.adversarial_catch_rate === 1.0 ? chalk.green("Perfect") : chalk.yellow("Degraded")
    ],
    [
      "Latency (P50 / P95 / P99)",
      `${score.p50_latency_ms.toFixed(1)} / ${score.p95_latency_ms.toFixed(1)} / ${score.p99_latency_ms.toFixed(1)} ms`,
      `Avg: ${score.avg_latency_ms.toFixed(1)} ms`
    ],
    [
      "Estimated Token Cost (Sonnet)",
      `$${score.estimated_cost.toFixed(4)}`,
      `Tokens: ${score.total_tokens}`
    ]
  );

  console.log(chalk.white.bold("\n--- Summary Performance Metrics ---"));
  console.log(summaryTable.toString());

  // Save the report to a JSON file
  const resolvedDir = path.resolve(outputDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const outputPath = path.join(resolvedDir, `report-${score.timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(score, null, 2), "utf-8");
  console.log(`\n[Reporter] Saved final evaluation report to: ${outputPath}`);

  if (score.overall_accuracy >= 0.8) {
    console.log(chalk.green.bold("\n🎉 SUCCESS: Overall evaluation accuracy meets the 80% threshold!\n"));
  } else {
    console.log(chalk.red.bold("\n❌ FAILURE: Overall evaluation accuracy is below the 80% threshold.\n"));
  }
}
