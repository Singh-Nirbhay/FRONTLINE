import client from "prom-client";
import { metricsRegistry } from "../services/metrics.service.js";
import { TriageService } from "../services/triage.service.js";
import * as metricsPluginModule from "../plugins/metrics.js";

// 1. Collect default Node.js runtime metrics
try {
  client.collectDefaultMetrics();
} catch (e) {
  // Ignore duplicate registration in tests
}

// 2. Define custom metrics
const triageRequests = new client.Counter({
  name: "triage_requests_total",
  help: "Total number of triage requests",
  labelNames: ["status"]
});

const triageLatency = new client.Histogram({
  name: "triage_latency_ms",
  help: "Triage classification latency in milliseconds",
  buckets: [100, 250, 500, 1000, 2500, 5000]
});

const triageTokensInput = new client.Counter({
  name: "triage_tokens_input_total",
  help: "Total number of input tokens used for triage"
});

const triageTokensOutput = new client.Counter({
  name: "triage_tokens_output_total",
  help: "Total number of output tokens used for triage"
});

const triageConfidence = new client.Histogram({
  name: "triage_confidence_histogram",
  help: "Triage classification confidence level",
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
});

const triageNeedsHuman = new client.Counter({
  name: "triage_needs_human_total",
  help: "Total number of messages flagged as needing human review"
});

const apiRequestDuration = new client.Histogram({
  name: "api_request_duration_ms",
  help: "API request duration in milliseconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000]
});

const queueDepth = new client.Gauge({
  name: "queue_depth",
  help: "Current number of jobs in the triage queue",
  async collect() {
    try {
      const { triageQueue } = await import("../routes/messages.route.js");
      if (triageQueue) {
        const counts = await triageQueue.getJobCounts("wait", "active", "delayed");
        const total = counts.wait + counts.active + counts.delayed;
        this.set(total);
      }
    } catch (e) {
      // ignore errors if queue is not initialized yet
    }
  }
});

// 3. Monkey-patch the DevelopmentMetricsRegistry to delegate to prom-client
metricsRegistry.incrementCounter = (name: string, labels: Record<string, string>): void => {
  if (name === "triage_attempts_total" || name === "triage_requests_total") {
    triageRequests.inc({ status: labels.status });
  }
};

metricsRegistry.recordHistogram = (name: string, value: number, labels?: Record<string, string>): void => {
  if (name === "triage_latency_ms") {
    triageLatency.observe(value);
  } else if (name === "triage_tokens_input") {
    triageTokensInput.inc(value);
  } else if (name === "triage_tokens_output") {
    triageTokensOutput.inc(value);
  }
};

// 4. Monkey-patch TriageService to record confidence and needs_human metrics automatically
const originalTriage = TriageService.prototype.triage;
TriageService.prototype.triage = async function (message: any) {
  const result = await originalTriage.call(this, message);
  if (result) {
    triageConfidence.observe(result.confidence);
    if (result.needs_human) {
      triageNeedsHuman.inc();
    }
  }
  return result;
};

// 5. Monkey-patch Fastify prototype to register hooks for api_request_duration_ms when metricsPlugin is registered
import fastify from "fastify";
try {
  const dummyInstance = fastify();
  const proto = Object.getPrototypeOf(dummyInstance);
  const originalRegister = proto.register;
  proto.register = function (plugin: any, opts: any) {
    if (
      plugin === metricsPluginModule.metricsPlugin ||
      (plugin && plugin.name === "metricsPlugin") ||
      (plugin && plugin.default === metricsPluginModule.metricsPlugin)
    ) {
      this.addHook("onRequest", async (request: any) => {
        request.apiMetricsStartTime = performance.now();
      });

      this.addHook("onResponse", async (request: any, reply: any) => {
        const startTime = request.apiMetricsStartTime;
        if (startTime) {
          const durationMs = performance.now() - startTime;
          const route = request.routeConfig?.url || request.url;
          const method = request.method;
          const statusCode = reply.statusCode.toString();

          if (route !== "/metrics") {
            apiRequestDuration.observe({ method, route, status_code: statusCode }, durationMs);
          }
        }
      });
    }
    return originalRegister.call(this, plugin, opts);
  };
  dummyInstance.close();
} catch (e) {
  // Ignore any errors initializing prototype patch in other contexts
}

export {
  triageRequests,
  triageLatency,
  triageTokensInput,
  triageTokensOutput,
  triageConfidence,
  triageNeedsHuman,
  apiRequestDuration,
  queueDepth
};
