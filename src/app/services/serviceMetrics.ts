import { AppConfig } from "../config.js";

/**
 * @module services/serviceMetrics
 * In-memory metrics collector for traffic, auth, user, and gameplay counters.
 */

interface LogEvent {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

/** Collects and exposes service metrics, logs, and Prometheus-formatted output. */
export class ServiceMetrics {
  private readonly startedAt = Date.now();
  private readonly routeCounters = new Map<string, number>();
  private readonly logs: LogEvent[] = [];

  private requestsReceivedTotal = 0;
  private requestBytesInTotal = 0;
  private responseBytesOutTotal = 0;

  private authAttemptsTotal = 0;
  private authSuccessTotal = 0;
  private authFailureTotal = 0;

  private usersCreatedTotal = 0;
  private usersUpdatedTotal = 0;

  private gameEventsStoredTotal = 0;
  private gamesWonTotal = 0;
  private gamesLostTotal = 0;
  private gamesDrawTotal = 0;

  private readonly gameEventsByType = new Map<string, number>();
  private readonly gameEventsByLanguage = new Map<string, number>();

  constructor(private readonly config: AppConfig) {}

  recordIncomingRequest(metric: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
    requestBytes: number;
    responseBytes: number;
  }): void {
    this.requestsReceivedTotal += 1;
    this.requestBytesInTotal += metric.requestBytes;
    this.responseBytesOutTotal += metric.responseBytes;

    const key = `${metric.method}|${metric.route}|${metric.statusCode}`;
    this.routeCounters.set(key, (this.routeCounters.get(key) ?? 0) + 1);
  }

  recordAuthAttempt(success: boolean): void {
    this.authAttemptsTotal += 1;
    if (success) {
      this.authSuccessTotal += 1;
      return;
    }
    this.authFailureTotal += 1;
  }

  recordUserSynced(created: boolean): void {
    if (created) {
      this.usersCreatedTotal += 1;
      return;
    }
    this.usersUpdatedTotal += 1;
  }

  recordGameEventStored(payload: { gameType: string; language: string; outcome: "won" | "lost" | "draw" }): void {
    this.gameEventsStoredTotal += 1;

    if (payload.outcome === "won") {
      this.gamesWonTotal += 1;
    }
    if (payload.outcome === "lost") {
      this.gamesLostTotal += 1;
    }
    if (payload.outcome === "draw") {
      this.gamesDrawTotal += 1;
    }

    this.gameEventsByType.set(
      payload.gameType,
      (this.gameEventsByType.get(payload.gameType) ?? 0) + 1
    );
    this.gameEventsByLanguage.set(
      payload.language,
      (this.gameEventsByLanguage.get(payload.language) ?? 0) + 1
    );
  }

  recordLog(level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>): void {
    this.logs.push({
      ts: new Date().toISOString(),
      level,
      message,
      context
    });

    const maxSize = this.config.METRICS_LOG_BUFFER_SIZE;
    if (this.logs.length > maxSize) {
      this.logs.splice(0, this.logs.length - maxSize);
    }
  }

  recentLogs(limit = 200): LogEvent[] {
    return this.logs.slice(-Math.max(1, limit));
  }

  snapshot() {
    return {
      service: this.config.SERVICE_NAME,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      traffic: {
        requestsReceivedTotal: this.requestsReceivedTotal,
        requestBytesInTotal: this.requestBytesInTotal,
        responseBytesOutTotal: this.responseBytesOutTotal
      },
      auth: {
        authAttemptsTotal: this.authAttemptsTotal,
        authSuccessTotal: this.authSuccessTotal,
        authFailureTotal: this.authFailureTotal
      },
      users: {
        usersCreatedTotal: this.usersCreatedTotal,
        usersUpdatedTotal: this.usersUpdatedTotal
      },
      gameplay: {
        gameEventsStoredTotal: this.gameEventsStoredTotal,
        gamesWonTotal: this.gamesWonTotal,
        gamesLostTotal: this.gamesLostTotal,
        gamesDrawTotal: this.gamesDrawTotal,
        byGameType: Array.from(this.gameEventsByType.entries()).map(([gameType, total]) => ({
          gameType,
          total
        })),
        byLanguage: Array.from(this.gameEventsByLanguage.entries()).map(([language, total]) => ({
          language,
          total
        }))
      },
      requestsByRoute: Array.from(this.routeCounters.entries()).map(([key, total]) => {
        const [method, route, statusCode] = key.split("|");
        return {
          method,
          route,
          statusCode: Number(statusCode),
          total
        };
      })
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];

    lines.push("# HELP microservice_requests_received_total Total incoming requests");
    lines.push("# TYPE microservice_requests_received_total counter");
    lines.push(`microservice_requests_received_total ${this.requestsReceivedTotal}`);

    lines.push("# HELP microservice_auth_attempts_total Total Firebase auth attempts");
    lines.push("# TYPE microservice_auth_attempts_total counter");
    lines.push(`microservice_auth_attempts_total ${this.authAttemptsTotal}`);

    lines.push("# HELP microservice_auth_success_total Total successful Firebase auth attempts");
    lines.push("# TYPE microservice_auth_success_total counter");
    lines.push(`microservice_auth_success_total ${this.authSuccessTotal}`);

    lines.push("# HELP microservice_auth_failure_total Total failed Firebase auth attempts");
    lines.push("# TYPE microservice_auth_failure_total counter");
    lines.push(`microservice_auth_failure_total ${this.authFailureTotal}`);

    lines.push("# HELP microservice_users_created_total Total created users");
    lines.push("# TYPE microservice_users_created_total counter");
    lines.push(`microservice_users_created_total ${this.usersCreatedTotal}`);

    lines.push("# HELP microservice_users_updated_total Total updated users");
    lines.push("# TYPE microservice_users_updated_total counter");
    lines.push(`microservice_users_updated_total ${this.usersUpdatedTotal}`);

    lines.push("# HELP microservice_game_events_stored_total Total stored game events");
    lines.push("# TYPE microservice_game_events_stored_total counter");
    lines.push(`microservice_game_events_stored_total ${this.gameEventsStoredTotal}`);

    lines.push("# HELP microservice_games_won_total Total won games");
    lines.push("# TYPE microservice_games_won_total counter");
    lines.push(`microservice_games_won_total ${this.gamesWonTotal}`);

    lines.push("# HELP microservice_games_lost_total Total lost games");
    lines.push("# TYPE microservice_games_lost_total counter");
    lines.push(`microservice_games_lost_total ${this.gamesLostTotal}`);

    lines.push("# HELP microservice_games_draw_total Total draw games");
    lines.push("# TYPE microservice_games_draw_total counter");
    lines.push(`microservice_games_draw_total ${this.gamesDrawTotal}`);

    for (const [gameType, total] of this.gameEventsByType.entries()) {
      lines.push(
        `microservice_game_events_by_type_total{game_type="${gameType}"} ${total}`
      );
    }

    for (const [language, total] of this.gameEventsByLanguage.entries()) {
      lines.push(
        `microservice_game_events_by_language_total{language="${language}"} ${total}`
      );
    }

    return lines.join("\n");
  }
}
