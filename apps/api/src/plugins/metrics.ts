import { FastifyPluginAsync } from "fastify";
import client from "prom-client";

// Collect default node runtime metrics
client.collectDefaultMetrics();

// Prometheus custom metrics
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"]
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

export const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  // Track latency starting time
  fastify.addHook("onRequest", async (request) => {
    (request as any).metricsStartTime = performance.now();
  });

  // Observe final values on response
  fastify.addHook("onResponse", async (request, reply) => {
    const startTime = (request as any).metricsStartTime;
    if (startTime) {
      const durationSeconds = (performance.now() - startTime) / 1000;
      const route = request.routeConfig?.url || request.url;
      const method = request.method;
      const status = reply.statusCode.toString();

      // Only count non-internal metrics scrapes
      if (route !== "/metrics") {
        httpRequestsTotal.inc({ method, route, status });
        httpRequestDuration.observe({ method, route, status }, durationSeconds);
      }
    }
  });

  // GET /metrics route
  fastify.get("/metrics", async (request, reply) => {
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return client.register.metrics();
  });
};

export default metricsPlugin;
