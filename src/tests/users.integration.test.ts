import { beforeEach, describe, expect, it } from "vitest";

import Fastify from "fastify";

import { AppConfig } from "../app/config.js";
import { monitoringRoutes } from "../app/routes/monitoring.js";
import { usersRoutes } from "../app/routes/users.js";
import { FirebaseIdentity } from "../app/services/firebaseAuthService.js";
import { FirebaseAuthService } from "../app/services/firebaseAuthService.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";
import { AccessDeniedError } from "../app/services/userService.js";
import { NotFoundError } from "../app/services/userService.js";
import { RoleValidationError } from "../app/services/userService.js";
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
    DATABASE_URL: "postgresql://users:users@localhost:7434/usersdb?schema=public",
    SUPERADMIN_FIREBASE_UID: undefined,
    INSPECTOR_EMAILS: undefined
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
  public lastAuthHeader: string | undefined;
  public lastDevUid: string | undefined;

  constructor(
    private readonly authIdentity: FirebaseIdentity,
    private readonly failureMode: "none" | "error" | "non-error" = "none"
  ) {}

  async authenticateFromBearer(
    authorizationHeader?: string,
    devUidHeader?: string
  ): Promise<FirebaseIdentity> {
    this.lastAuthHeader = authorizationHeader;
    this.lastDevUid = devUidHeader;

    if (this.failureMode === "error") {
      throw new Error("invalid token");
    }
    if (this.failureMode === "non-error") {
      throw "invalid token";
    }
    return this.authIdentity;
  }
}

class FakeUserService {
  private created = true;
  private readonly storedEvents: Array<Record<string, unknown>> = [];
  private currentRole: "SuperAdmin" | "Admin" | "Inspector" | "Viewer" | "Gamer" = "Admin";
  private listAssignmentsError: Error | null = null;
  private updateRoleError: Error | null = null;
  private failRoleLookup = false;

  async getRoleByFirebaseUid(): Promise<"SuperAdmin" | "Admin" | "Inspector" | "Viewer" | "Gamer"> {
    if (this.failRoleLookup) {
      throw new Error("role lookup failed");
    }
    return this.currentRole;
  }

  async upsertUserFromIdentity() {
    const created = this.created;
    this.created = false;
    return { userId: "usr-1", created };
  }

  async recordGameEvent(_firebaseUid: string, event: Record<string, unknown>): Promise<void> {
    if (this.currentRole === "Viewer" || this.currentRole === "Inspector") {
      throw new AccessDeniedError("Read-only roles cannot modify data.");
    }
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

  setCurrentRole(role: "SuperAdmin" | "Admin" | "Inspector" | "Viewer" | "Gamer") {
    this.currentRole = role;
  }

  setListAssignmentsError(error: Error | null) {
    this.listAssignmentsError = error;
  }

  async listRoleAssignments() {
    if (this.listAssignmentsError) {
      throw this.listAssignmentsError;
    }
    return [{ firebaseUid: "uid-a", displayName: "A", email: "a@test.dev", role: "Viewer" }];
  }

  setUpdateRoleError(error: Error | null) {
    this.updateRoleError = error;
  }

  setFailRoleLookup(shouldFail: boolean) {
    this.failRoleLookup = shouldFail;
  }

  async updateUserRoleByFirebaseUid() {
    if (this.updateRoleError) {
      throw this.updateRoleError;
    }
    return {
      firebaseUid: "uid-a",
      displayName: "A",
      email: "a@test.dev",
      role: "Viewer",
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    };
  }
}

async function createApp(failureMode: "none" | "error" | "non-error" = "none") {
  const app = Fastify();
  const metrics = new ServiceMetrics(baseConfig());
  const authService = new FakeFirebaseAuthService(identity, failureMode);
  const userService = new FakeUserService();

  await usersRoutes(
    app,
    authService as unknown as FirebaseAuthService,
    userService as unknown as UserService,
    metrics
  );
  await monitoringRoutes(app, metrics);

  return { app, authService, userService };
}

describe("users routes integration", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("creates firebase session and returns created then updated", async () => {
    const { app } = await createApp();

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
    const { app, userService } = await createApp();

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
    const { app } = await createApp();

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
    const { app } = await createApp();

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
    const { app } = await createApp("error");

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

  it("returns profile summary and rejects invalid stats queries", async () => {
    const { app, authService } = await createApp();

    const profile = await app.inject({
      method: "GET",
      url: "/users/me/profile",
      headers: {
        authorization: "Bearer fake",
        "x-dev-firebase-uid": "dev-uid-123"
      }
    });

    expect(profile.statusCode).toBe(200);
    expect(authService.lastDevUid).toBe("dev-uid-123");
    expect(profile.json()).toMatchObject({
      role: "Admin",
      gameSummary: {
        byGameType: [expect.objectContaining({ gameType: "quiz" })],
      },
    });

    const invalidStats = await app.inject({
      method: "GET",
      url: "/users/me/stats?recentLimit=0",
      headers: {
        authorization: "Bearer fake"
      }
    });

    expect(authService.lastDevUid).toBeUndefined();
    expect(invalidStats.statusCode).toBe(400);
    expect(invalidStats.json()).toMatchObject({ message: "Invalid query parameters" });

    await app.close();
  });

  it("rejects invalid game-event payloads and forbidden viewer writes", async () => {
    const { app, userService } = await createApp();

    const invalidPayload = await app.inject({
      method: "POST",
      url: "/users/me/games/events",
      headers: {
        authorization: "Bearer fake"
      },
      payload: {},
    });

    userService.setCurrentRole("Viewer");
    const forbidden = await app.inject({
      method: "POST",
      url: "/users/me/games/events",
      headers: {
        authorization: "Bearer fake"
      },
      payload: {
        gameType: "quiz",
        language: "es",
        outcome: "won",
      },
    });

    expect(invalidPayload.statusCode).toBe(400);
    expect(invalidPayload.json()).toMatchObject({ message: "Invalid payload" });
    expect(forbidden.statusCode).toBe(403);

    await app.close();
  });

  it("covers admin role routes for forbidden, validation, domain errors, and success", async () => {
    const { app, userService } = await createApp();

    userService.setCurrentRole("Admin");
    const forbiddenList = await app.inject({
      method: "GET",
      url: "/users/admin/roles",
      headers: { authorization: "Bearer fake" },
    });

    userService.setCurrentRole("SuperAdmin");
    userService.setListAssignmentsError(new AccessDeniedError("Only SuperAdmin or Inspector can view role assignments."));
    const deniedList = await app.inject({
      method: "GET",
      url: "/users/admin/roles",
      headers: { authorization: "Bearer fake" },
    });
    userService.setListAssignmentsError(null);
    const okList = await app.inject({
      method: "GET",
      url: "/users/admin/roles",
      headers: { authorization: "Bearer fake" },
    });

    userService.setCurrentRole("Inspector");
    const inspectorList = await app.inject({
      method: "GET",
      url: "/users/admin/roles",
      headers: { authorization: "Bearer fake" },
    });
    userService.setCurrentRole("SuperAdmin");

    const invalidPatch = await app.inject({
      method: "PATCH",
      url: "/users/admin/roles/uid-a",
      headers: { authorization: "Bearer fake" },
      payload: {},
    });

    userService.setUpdateRoleError(new AccessDeniedError("blocked"));
    const deniedPatch = await app.inject({
      method: "PATCH",
      url: "/users/admin/roles/uid-a",
      headers: { authorization: "Bearer fake" },
      payload: { role: "Viewer" },
    });
    userService.setUpdateRoleError(new RoleValidationError("Unsupported role"));
    const invalidRolePatch = await app.inject({
      method: "PATCH",
      url: "/users/admin/roles/uid-a",
      headers: { authorization: "Bearer fake" },
      payload: { role: "Viewer" },
    });
    userService.setUpdateRoleError(new NotFoundError("Target user not found."));
    const missingPatch = await app.inject({
      method: "PATCH",
      url: "/users/admin/roles/uid-a",
      headers: { authorization: "Bearer fake" },
      payload: { role: "Viewer" },
    });
    userService.setUpdateRoleError(null);
    const okPatch = await app.inject({
      method: "PATCH",
      url: "/users/admin/roles/uid-a",
      headers: { authorization: "Bearer fake" },
      payload: { role: "Viewer" },
    });

    expect(forbiddenList.statusCode).toBe(403);
    expect(deniedList.statusCode).toBe(403);
    expect(okList.statusCode).toBe(200);
    expect(okList.json()).toMatchObject({ total: 1 });
    expect(inspectorList.statusCode).toBe(200);
    expect(invalidPatch.statusCode).toBe(400);
    expect(deniedPatch.statusCode).toBe(403);
    expect(invalidRolePatch.statusCode).toBe(400);
    expect(missingPatch.statusCode).toBe(404);
    expect(okPatch.statusCode).toBe(200);
    expect(okPatch.json()).toMatchObject({ message: "Role updated" });

    await app.close();
  });

  it("covers invalid session payloads and unknown auth errors", async () => {
    const { app } = await createApp("non-error");

    const invalidPayload = await app.inject({
      method: "POST",
      url: "/users/firebase/session",
      payload: { idToken: "short" },
    });
    const invalidToken = await app.inject({
      method: "POST",
      url: "/users/firebase/session",
      payload: { idToken: "long-enough-token" },
    });
    const profileUnauthorized = await app.inject({
      method: "GET",
      url: "/users/me/profile",
      headers: { authorization: "Bearer fake" },
    });
    const logs = await app.inject({ method: "GET", url: "/monitor/logs?limit=5" });

    expect(invalidPayload.statusCode).toBe(400);
    expect(invalidToken.statusCode).toBe(401);
    expect(invalidToken.json()).toMatchObject({
      message: "Invalid Firebase token",
      error: "Unknown error",
    });
    expect(profileUnauthorized.statusCode).toBe(401);
    expect(logs.json()).toMatchObject({
      logs: [expect.objectContaining({ message: "firebase_auth_failed", context: { error: "Unknown auth error" } })],
    });

    await app.close();
  });

  it("forbids admin routes when role lookup fails during preHandler", async () => {
    const { app, userService } = await createApp();
    userService.setFailRoleLookup(true);

    const response = await app.inject({
      method: "GET",
      url: "/users/admin/roles",
      headers: { authorization: "Bearer fake" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: "Forbidden. SuperAdmin or Inspector required." });

    await app.close();
  });
});
