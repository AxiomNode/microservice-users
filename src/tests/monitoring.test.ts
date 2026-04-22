import { describe, expect, it } from "vitest";
import Fastify from "fastify";

import type { AppConfig } from "../app/config.js";
import { monitoringRoutes } from "../app/routes/monitoring.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-users",
    SERVICE_PORT: 7102,
    NODE_ENV: "test",
    METRICS_LOG_BUFFER_SIZE: 3,
    FIREBASE_PROJECT_ID: undefined,
    FIREBASE_CLIENT_EMAIL: undefined,
    FIREBASE_PRIVATE_KEY: undefined,
    FIREBASE_CREDENTIALS_JSON: undefined,
    FIREBASE_STRICT_AUTH: false,
    PRIVATE_DOCS_ENABLED: false,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: undefined,
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
    SUPERADMIN_FIREBASE_UID: undefined,
    ...overrides,
  };
}

describe("monitoring routes", () => {
  it("returns stats, bounded logs and prometheus metrics", async () => {
    const app = Fastify();
    const metrics = new ServiceMetrics(createConfig({ METRICS_LOG_BUFFER_SIZE: 2 }));

    metrics.recordIncomingRequest({
      method: "GET",
      route: "/users/me/profile",
      statusCode: 200,
      durationMs: 20,
      requestBytes: 64,
      responseBytes: 128,
    });
    metrics.recordLog("info", "first");
    metrics.recordLog("warn", "second");
    metrics.recordLog("error", "third");

    await monitoringRoutes(app, metrics);

    const statsResponse = await app.inject({ method: "GET", url: "/monitor/stats" });
    const logsResponse = await app.inject({ method: "GET", url: "/monitor/logs?limit=2" });
    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });

    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toMatchObject({
      service: "microservice-users",
      traffic: { requestsReceivedTotal: 1 },
    });
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toMatchObject({
      service: "microservice-users",
      total: 2,
      logs: [
        expect.objectContaining({ level: "warn", message: "second" }),
        expect.objectContaining({ level: "error", message: "third" }),
      ],
    });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.body).toContain("microservice_requests_received_total 1");

    await app.close();
  });

  it("rejects invalid log queries and uses default query values when omitted", async () => {
    const app = Fastify();
    const metrics = new ServiceMetrics(createConfig());
    metrics.recordLog("info", "kept");

    await monitoringRoutes(app, metrics);

    const invalidResponse = await app.inject({ method: "GET", url: "/monitor/logs?limit=0" });
    const defaultResponse = await app.inject({ method: "GET", url: "/monitor/logs" });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toMatchObject({
      service: "microservice-users",
      total: 1,
      logs: [expect.objectContaining({ message: "kept" })],
    });

    await app.close();
  });
});