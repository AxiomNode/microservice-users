import { beforeEach, describe, expect, it } from "vitest";

import Fastify from "fastify";

import { AppConfig } from "../app/config.js";
import { monitoringRoutes } from "../app/routes/monitoring.js";
import { usersRoutes } from "../app/routes/users.js";
import { FirebaseIdentity } from "../app/services/firebaseAuthService.js";
import { FirebaseAuthService } from "../app/services/firebaseAuthService.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";
import { UserService } from "../app/services/userService.js";
import { UserStatsSnapshot } from "../app/services/userService.js";

const identity: FirebaseIdentity = {
  firebaseUid: "uid-test-1",
  email: "user@test.dev",
  emailVerified: true,
  displayName: "Test User",
  photoUrl: "https://img.example/u1.png",
  provider: "google.com"
};

function baseConfig(): AppConfig {
  return {
    SERVICE_NAME: "microservice-users",
    SERVICE_PORT: 7100,
    NODE_ENV: "test",
    METRICS_LOG_BUFFER_SIZE: 500,
    FIREBASE_PROJECT_ID: undefined,
    FIREBASE_CLIENT_EMAIL: undefined,
    FIREBASE_PRIVATE_KEY: undefined,
    FIREBASE_CREDENTIALS_JSON: undefined,
    FIREBASE_STRICT_AUTH: false,
    PRIVATE_DOCS_ENABLED: false,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: undefined,
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public"
  };
}

function defaultStats(): UserStatsSnapshot {
  return {
    profile: {
      id: "usr-1",
      firebaseUid: identity.firebaseUid,
      role: "Gamer",
      email: identity.email ?? null,
      displayName: identity.displayName ?? null,
      photoUrl: identity.photoUrl ?? null,
      gamesPlayed: 2,
      gamesWon: 1,
      gamesLost: 1,
      gamesDraw: 0,
      totalScore: 140,
      bestScore: 110,
      totalDurationSeconds: 250,
      lastLoginAt: new Date("2026-03-22T10:00:00.000Z"),
      createdAt: new Date("2026-03-20T10:00:00.000Z"),
      updatedAt: new Date("2026-03-22T10:00:00.000Z")
    },
    byGameType: [
      {
        gameType: "quiz",
        played: 2,
        won: 1,
        lost: 1,
        draw: 0,
        totalScore: 140,
        bestScore: 110
      }
    ],
    byCategory: [
      {
        gameType: "quiz",
        categoryId: "17",
        categoryName: "Science & Nature",
        played: 2,
        won: 1,
        lost: 1,
        draw: 0
      }
    ],
    byLanguage: [
      {
        gameType: "quiz",
        language: "es",
        played: 2,
        won: 1,
        lost: 1,
        draw: 0
      }
    ],
    recentEvents: [
      {
        id: "evt-1",
        gameType: "quiz",
        categoryId: "17",
        categoryName: "Science & Nature",
        language: "es",
        outcome: "won",
        score: 110,
        durationSeconds: 120,
        playedAt: new Date("2026-03-22T09:50:00.000Z")
      }
    ]
  };
}

class FakeFirebaseAuthService {
  constructor(private readonly authIdentity: FirebaseIdentity, private readonly shouldFail = false) {}

  async authenticateFromBearer(): Promise<FirebaseIdentity> {
    if (this.shouldFail) {
      throw new Error("invalid token");
    }
    return this.authIdentity;
  }
}

class FakeUserService {
  private created = true;
  private readonly storedEvents: Array<Record<string, unknown>> = [];

  async getRoleByFirebaseUid(): Promise<"SuperAdmin" | "Admin" | "Viewer" | "Gamer"> {
    return "Admin";
  }

  async upsertUserFromIdentity() {
    const created = this.created;
    this.created = false;
    return { userId: "usr-1", created };
  }

  async recordGameEvent(_firebaseUid: string, event: Record<string, unknown>): Promise<void> {
    this.storedEvents.push(event);
  }

  async getMyStats(): Promise<UserStatsSnapshot> {
    return defaultStats();
  }

  async getLeaderboard(metric: "won" | "score" | "played", limit: number) {
    const rows = [
      {
        firebaseUid: "uid-a",
        displayName: "A",
        photoUrl: null,
        gamesWon: 8,
        gamesPlayed: 10,
        totalScore: 900
      },
      {
        firebaseUid: "uid-b",
        displayName: "B",
        photoUrl: null,
        gamesWon: 6,
        gamesPlayed: 8,
        totalScore: 700
      }
    ];

    if (metric === "score") {
      rows.sort((a, b) => b.totalScore - a.totalScore);
    } else if (metric === "played") {
      rows.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    } else {
      rows.sort((a, b) => b.gamesWon - a.gamesWon);
    }

    return rows.slice(0, limit);
  }

  getEventsStored(): number {
    return this.storedEvents.length;
  }
}

async function createApp(shouldAuthFail = false) {
  const app = Fastify();
  const metrics = new ServiceMetrics(baseConfig());
  const authService = new FakeFirebaseAuthService(identity, shouldAuthFail);
  const userService = new FakeUserService();

  await usersRoutes(
    app,
    authService as unknown as FirebaseAuthService,
    userService as unknown as UserService,
    metrics
  );
  await monitoringRoutes(app, metrics);

  return { app, userService };
}

describe("users routes integration", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("creates firebase session and returns created then updated", async () => {
    const { app } = await createApp(false);

    const first = await app.inject({
      method: "POST",
      url: "/users/firebase/session",
      payload: { idToken: "fake-id-token-value" }
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      message: "User created",
      userId: "usr-1",
      firebaseUid: identity.firebaseUid
    });

    const second = await app.inject({
      method: "POST",
      url: "/users/firebase/session",
      payload: { idToken: "fake-id-token-value" }
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      message: "User updated",
      userId: "usr-1"
    });

    await app.close();
  });

  it("stores game event and exposes metrics counters", async () => {
    const { app, userService } = await createApp(false);

    const store = await app.inject({
      method: "POST",
      url: "/users/me/games/events",
      headers: {
        authorization: "Bearer fake"
      },
      payload: {
        gameType: "quiz",
        categoryId: "17",
        categoryName: "Science & Nature",
        language: "es",
        outcome: "won",
        score: 120,
        durationSeconds: 55
      }
    });

    expect(store.statusCode).toBe(201);
    expect(store.json()).toMatchObject({ message: "Game event stored" });
    expect(userService.getEventsStored()).toBe(1);

    const stats = await app.inject({ method: "GET", url: "/monitor/stats" });
    expect(stats.statusCode).toBe(200);
    const body = stats.json() as {
      gameplay: { gameEventsStoredTotal: number; gamesWonTotal: number };
    };
    expect(body.gameplay.gameEventsStoredTotal).toBe(1);
    expect(body.gameplay.gamesWonTotal).toBe(1);

    await app.close();
  });

  it("returns stats and leaderboard with expected shape", async () => {
    const { app } = await createApp(false);

    const stats = await app.inject({
      method: "GET",
      url: "/users/me/stats?recentLimit=5",
      headers: {
        authorization: "Bearer fake"
      }
    });

    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      profile: {
        firebaseUid: identity.firebaseUid,
        gamesPlayed: 2,
        bestScore: 110
      }
    });

    const leaderboard = await app.inject({
      method: "GET",
      url: "/users/leaderboard?metric=score&limit=2"
    });

    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json()).toMatchObject({
      metric: "score",
      total: 2
    });

    await app.close();
  });

  it("returns 400 for invalid leaderboard query params", async () => {
    const { app } = await createApp(false);

    const leaderboard = await app.inject({
      method: "GET",
      url: "/users/leaderboard?limit=9999"
    });

    expect(leaderboard.statusCode).toBe(400);
    expect(leaderboard.json()).toMatchObject({
      message: "Invalid query parameters"
    });

    await app.close();
  });

  it("returns 401 when auth fails", async () => {
    const { app } = await createApp(true);

    const response = await app.inject({
      method: "GET",
      url: "/users/me/profile",
      headers: {
        authorization: "Bearer fake"
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
