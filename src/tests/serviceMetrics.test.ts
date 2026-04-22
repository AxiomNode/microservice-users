import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../app/config.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-users",
    SERVICE_PORT: 7102,
    NODE_ENV: "test",
    METRICS_LOG_BUFFER_SIZE: 2,
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

describe("ServiceMetrics", () => {
  it("tracks traffic, auth, sync and gameplay counters in the snapshot", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(6_500);
    const metrics = new ServiceMetrics(createConfig());

    metrics.recordIncomingRequest({
      method: "GET",
      route: "/users/me/profile",
      statusCode: 200,
      durationMs: 40,
      requestBytes: 128,
      responseBytes: 256,
    });
    metrics.recordAuthAttempt(true);
    metrics.recordAuthAttempt(false);
    metrics.recordUserSynced(true);
    metrics.recordUserSynced(false);
    metrics.recordGameEventStored({ gameType: "quiz", language: "es", outcome: "won" });
    metrics.recordGameEventStored({ gameType: "wordpass", language: "en", outcome: "lost" });
    metrics.recordGameEventStored({ gameType: "quiz", language: "es", outcome: "draw" });

    const snapshot = metrics.snapshot();

    expect(snapshot).toMatchObject({
      service: "microservice-users",
      uptimeSeconds: 5,
      traffic: {
        requestsReceivedTotal: 1,
        requestBytesInTotal: 128,
        responseBytesOutTotal: 256,
      },
      auth: {
        authAttemptsTotal: 2,
        authSuccessTotal: 1,
        authFailureTotal: 1,
      },
      users: {
        usersCreatedTotal: 1,
        usersUpdatedTotal: 1,
      },
      gameplay: {
        gameEventsStoredTotal: 3,
        gamesWonTotal: 1,
        gamesLostTotal: 1,
        gamesDrawTotal: 1,
      },
    });
    expect(snapshot.gameplay.byGameType).toEqual(
      expect.arrayContaining([
        { gameType: "quiz", total: 2 },
        { gameType: "wordpass", total: 1 },
      ]),
    );
    expect(snapshot.gameplay.byLanguage).toEqual(
      expect.arrayContaining([
        { language: "es", total: 2 },
        { language: "en", total: 1 },
      ]),
    );
    expect(snapshot.requestsByRoute).toEqual([
      { method: "GET", route: "/users/me/profile", statusCode: 200, total: 1 },
    ]);

    nowSpy.mockRestore();
  });

  it("bounds logs and exports Prometheus counters", () => {
    const metrics = new ServiceMetrics(createConfig({ METRICS_LOG_BUFFER_SIZE: 2 }));

    metrics.recordLog("info", "first");
    metrics.recordLog("warn", "second", { attempt: 2 });
    metrics.recordLog("error", "third", { cause: "timeout" });
    metrics.recordGameEventStored({ gameType: "quiz", language: "es", outcome: "won" });

    expect(metrics.recentLogs()).toHaveLength(2);
    expect(metrics.recentLogs(1)).toEqual([expect.objectContaining({ level: "error", message: "third" })]);

    const prometheus = metrics.toPrometheus();
    expect(prometheus).toContain("microservice_requests_received_total 0");
    expect(prometheus).toContain("microservice_game_events_stored_total 1");
    expect(prometheus).toContain('microservice_game_events_by_type_total{game_type="quiz"} 1');
    expect(prometheus).toContain('microservice_game_events_by_language_total{language="es"} 1');
  });
});