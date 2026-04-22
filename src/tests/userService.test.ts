import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    userProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../app/db/client.js", () => ({
  prisma: prismaMock,
}));

import {
  AccessDeniedError,
  NotFoundError,
  RoleValidationError,
  UserService,
} from "../app/services/userService.js";
import type { AppConfig } from "../app/config.js";
import type { FirebaseIdentity } from "../app/services/firebaseAuthService.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-users",
    SERVICE_PORT: 7102,
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
    ...overrides,
  };
}

function createIdentity(overrides: Partial<FirebaseIdentity> = {}): FirebaseIdentity {
  return {
    firebaseUid: "uid-1",
    email: "user@test.dev",
    emailVerified: true,
    displayName: "Test User",
    photoUrl: "https://img.example/u1.png",
    provider: "google.com",
    ...overrides,
  };
}

describe("UserService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns roles by firebase uid and fails when the user does not exist", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce({ role: UserRole.Admin })
      .mockResolvedValueOnce(null);

    const service = new UserService(createConfig());

    await expect(service.getRoleByFirebaseUid("uid-admin")).resolves.toBe(UserRole.Admin);
    await expect(service.getRoleByFirebaseUid("uid-missing")).rejects.toThrow(NotFoundError);
  });

  it("creates a new user from firebase identity and updates existing ones", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "usr-2", role: UserRole.Viewer });
    prismaMock.userProfile.create.mockResolvedValue({ id: "usr-1" });
    prismaMock.userProfile.update.mockResolvedValue({ id: "usr-2" });

    const service = new UserService(createConfig({ SUPERADMIN_FIREBASE_UID: "uid-super" }));

    await expect(service.upsertUserFromIdentity(createIdentity({ firebaseUid: "uid-super" }))).resolves.toEqual({
      userId: "usr-1",
      created: true,
    });
    await expect(service.upsertUserFromIdentity(createIdentity({ firebaseUid: "uid-2" }))).resolves.toEqual({
      userId: "usr-2",
      created: false,
    });

    expect(prismaMock.userProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firebaseUid: "uid-super",
          role: UserRole.SuperAdmin,
        }),
      }),
    );
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "usr-2" },
        data: expect.objectContaining({ role: UserRole.Viewer }),
      }),
    );
  });

  it("keeps the configured superadmin role when updating an existing superadmin identity", async () => {
    prismaMock.userProfile.findUnique.mockResolvedValueOnce({ id: "usr-super", role: UserRole.Gamer });
    prismaMock.userProfile.update.mockResolvedValue({ id: "usr-super" });

    const service = new UserService(createConfig({ SUPERADMIN_FIREBASE_UID: "uid-super" }));

    await expect(
      service.upsertUserFromIdentity(createIdentity({ firebaseUid: "uid-super", provider: "custom" }))
    ).resolves.toEqual({
      userId: "usr-super",
      created: false,
    });

    expect(prismaMock.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "usr-super" },
        data: expect.objectContaining({
          firebaseProvider: "custom",
          role: UserRole.SuperAdmin,
        }),
      }),
    );
  });

  it("returns leaderboards using the correct ordering and clamps the limit", async () => {
    prismaMock.userProfile.findMany.mockResolvedValue([]);

    const service = new UserService(createConfig());

    await service.getLeaderboard("won", 999);
    await service.getLeaderboard("score", 0);
    await service.getLeaderboard("played", 10);

    expect(prismaMock.userProfile.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: [{ gamesWon: "desc" }, { gamesPlayed: "desc" }],
        take: 100,
      }),
    );
    expect(prismaMock.userProfile.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: [{ totalScore: "desc" }, { gamesPlayed: "desc" }],
        take: 1,
      }),
    );
    expect(prismaMock.userProfile.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        orderBy: { gamesPlayed: "desc" },
        take: 10,
      }),
    );
  });

  it("lists role assignments only for superadmins", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce({ role: UserRole.SuperAdmin })
      .mockResolvedValueOnce({ role: UserRole.Gamer });
    prismaMock.userProfile.findMany.mockResolvedValue([{ firebaseUid: "uid-1", role: UserRole.Admin }]);

    const service = new UserService(createConfig());

    await expect(service.listRoleAssignments("uid-super")).resolves.toEqual([
      { firebaseUid: "uid-1", role: UserRole.Admin },
    ]);
    await expect(service.listRoleAssignments("uid-gamer")).rejects.toThrow(AccessDeniedError);
  });

  it("updates roles with superadmin protections and validation", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce({ role: UserRole.Gamer })
      .mockResolvedValueOnce({ role: UserRole.SuperAdmin })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: UserRole.SuperAdmin })
      .mockResolvedValueOnce({ id: "usr-super", firebaseUid: "uid-super", role: UserRole.SuperAdmin, displayName: "Boss", email: "boss@test.dev" })
      .mockResolvedValueOnce({ role: UserRole.SuperAdmin })
      .mockResolvedValueOnce({ id: "usr-2", firebaseUid: "uid-2", role: UserRole.Gamer, displayName: "User", email: "user@test.dev" })
      .mockResolvedValueOnce({ role: UserRole.SuperAdmin })
      .mockResolvedValueOnce({ id: "usr-3", firebaseUid: "uid-3", role: UserRole.Gamer, displayName: "User 3", email: "u3@test.dev" });
    prismaMock.userProfile.update.mockResolvedValue({
      firebaseUid: "uid-3",
      displayName: "User 3",
      email: "u3@test.dev",
      role: UserRole.Admin,
      updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    });

    const service = new UserService(createConfig({ SUPERADMIN_FIREBASE_UID: "uid-super" }));

    await expect(service.updateUserRoleByFirebaseUid("uid-requester", "uid-target", "Admin")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(service.updateUserRoleByFirebaseUid("uid-super", "uid-target", "BadRole")).rejects.toThrow(
      RoleValidationError,
    );
    await expect(service.updateUserRoleByFirebaseUid("uid-super", "uid-missing", "Admin")).rejects.toThrow(
      NotFoundError,
    );
    await expect(service.updateUserRoleByFirebaseUid("uid-super", "uid-super", "Admin")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(service.updateUserRoleByFirebaseUid("uid-super", "uid-2", "SuperAdmin")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(service.updateUserRoleByFirebaseUid("uid-super", "uid-3", "Admin")).resolves.toEqual(
      expect.objectContaining({
        firebaseUid: "uid-3",
        role: UserRole.Admin,
      }),
    );
  });

  it("records game events, rejects missing users, and blocks viewers", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "usr-viewer", role: UserRole.Viewer })
      .mockResolvedValueOnce({ id: "usr-gamer", role: UserRole.Gamer });

    const txMock = {
      userGameEvent: { create: vi.fn().mockResolvedValue(undefined) },
      userProfile: { update: vi.fn().mockResolvedValue(undefined) },
      userGameTypeStat: { upsert: vi.fn().mockResolvedValue(undefined) },
      userCategoryStat: { upsert: vi.fn().mockResolvedValue(undefined) },
      userLanguageStat: { upsert: vi.fn().mockResolvedValue(undefined) },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<void>) => {
      await callback(txMock);
    });

    const service = new UserService(createConfig());

    await expect(
      service.recordGameEvent("uid-missing", {
        gameType: "quiz",
        language: "ES",
        outcome: "won",
      }),
    ).rejects.toThrow("User not found. Sync Firebase session first.");
    await expect(
      service.recordGameEvent("uid-viewer", {
        gameType: "quiz",
        language: "ES",
        outcome: "won",
      }),
    ).rejects.toThrow(AccessDeniedError);

    await expect(
      service.recordGameEvent("uid-gamer", {
        gameType: "quiz",
        categoryId: "17",
        categoryName: "Science",
        language: "ES",
        outcome: "won",
        score: 120,
        durationSeconds: 55,
        metadata: { difficulty: "hard" },
      }),
    ).resolves.toBeUndefined();

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(txMock.userGameEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "usr-gamer",
          language: "es",
          outcome: "won",
          score: 120,
          durationSeconds: 55,
          metadataJson: JSON.stringify({ difficulty: "hard" }),
        }),
      }),
    );
    expect(txMock.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "usr-gamer" },
        data: expect.objectContaining({
          gamesPlayed: { increment: 1 },
          gamesWon: { increment: 1 },
          gamesLost: { increment: 0 },
          gamesDraw: { increment: 0 },
        }),
      }),
    );
    expect(txMock.userCategoryStat.upsert).toHaveBeenCalled();
    expect(txMock.userLanguageStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_gameType_language: {
            userId: "usr-gamer",
            gameType: "quiz",
            language: "es",
          },
        },
      }),
    );
  });

  it("records game events without category metadata and tracks non-win outcomes", async () => {
    prismaMock.userProfile.findUnique.mockResolvedValueOnce({ id: "usr-gamer", role: UserRole.Gamer });

    const txMock = {
      userGameEvent: { create: vi.fn().mockResolvedValue(undefined) },
      userProfile: { update: vi.fn().mockResolvedValue(undefined) },
      userGameTypeStat: { upsert: vi.fn().mockResolvedValue(undefined) },
      userCategoryStat: { upsert: vi.fn().mockResolvedValue(undefined) },
      userLanguageStat: { upsert: vi.fn().mockResolvedValue(undefined) },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
    };
    prismaMock.$transaction.mockImplementationOnce(async (callback: (tx: typeof txMock) => Promise<void>) => {
      await callback(txMock);
    });

    const service = new UserService(createConfig());

    await expect(
      service.recordGameEvent("uid-gamer", {
        gameType: "wordpass",
        language: "EN",
        outcome: "draw",
      }),
    ).resolves.toBeUndefined();

    expect(txMock.userGameEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId: undefined,
          categoryName: undefined,
          metadataJson: undefined,
          durationSeconds: 0,
          score: 0,
        }),
      }),
    );
    expect(txMock.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gamesWon: { increment: 0 },
          gamesLost: { increment: 0 },
          gamesDraw: { increment: 1 },
        }),
      }),
    );
    expect(txMock.userCategoryStat.upsert).not.toHaveBeenCalled();
  });

  it("returns mapped stats snapshots and enforces a minimum recent event limit", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "usr-1",
        firebaseUid: "uid-1",
        role: UserRole.Gamer,
        email: "user@test.dev",
        displayName: "Test User",
        photoUrl: "https://img.example/u1.png",
        gamesPlayed: 2,
        gamesWon: 1,
        gamesLost: 1,
        gamesDraw: 0,
        totalScore: 140,
        bestScore: 110,
        totalDurationSeconds: 250,
        lastLoginAt: new Date("2026-04-20T10:00:00.000Z"),
        createdAt: new Date("2026-04-18T10:00:00.000Z"),
        updatedAt: new Date("2026-04-20T10:00:00.000Z"),
        gameTypeStats: [{ gameType: "quiz", played: 2, won: 1, lost: 1, draw: 0, totalScore: 140, bestScore: 110 }],
        categoryStats: [{ gameType: "quiz", categoryId: "17", categoryName: "Science", played: 2, won: 1, lost: 1, draw: 0 }],
        languageStats: [{ gameType: "quiz", language: "es", played: 2, won: 1, lost: 1, draw: 0 }],
        gameEvents: [{
          id: "evt-1",
          gameType: "quiz",
          categoryId: "17",
          categoryName: "Science",
          language: "es",
          outcome: "won",
          score: 110,
          durationSeconds: 120,
          playedAt: new Date("2026-04-20T09:00:00.000Z"),
        }],
      });

    const service = new UserService(createConfig());

    await expect(service.getMyStats("uid-missing", 5)).rejects.toThrow("User not found. Sync Firebase session first.");

    const snapshot = await service.getMyStats("uid-1", 0);
    expect(snapshot).toMatchObject({
      profile: expect.objectContaining({
        id: "usr-1",
        firebaseUid: "uid-1",
        totalScore: 140,
      }),
      byGameType: [{ gameType: "quiz", played: 2, won: 1, lost: 1, draw: 0, totalScore: 140, bestScore: 110 }],
      byCategory: [{ gameType: "quiz", categoryId: "17", categoryName: "Science", played: 2, won: 1, lost: 1, draw: 0 }],
      byLanguage: [{ gameType: "quiz", language: "es", played: 2, won: 1, lost: 1, draw: 0 }],
      recentEvents: [expect.objectContaining({ id: "evt-1", gameType: "quiz", language: "es" })],
    });
    expect(prismaMock.userProfile.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          gameEvents: expect.objectContaining({ take: 1 }),
        }),
      }),
    );
  });

  it("allows the configured superadmin uid to keep the SuperAdmin role", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce({ role: UserRole.SuperAdmin })
      .mockResolvedValueOnce({
        id: "usr-super",
        firebaseUid: "uid-super",
        role: UserRole.SuperAdmin,
        displayName: "Boss",
        email: "boss@test.dev",
      });
    prismaMock.userProfile.update.mockResolvedValue({
      firebaseUid: "uid-super",
      displayName: "Boss",
      email: "boss@test.dev",
      role: UserRole.SuperAdmin,
      updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    });

    const service = new UserService(createConfig({ SUPERADMIN_FIREBASE_UID: "uid-super" }));

    await expect(
      service.updateUserRoleByFirebaseUid("uid-super", "uid-super", "SuperAdmin")
    ).resolves.toEqual(
      expect.objectContaining({
        firebaseUid: "uid-super",
        role: UserRole.SuperAdmin,
      }),
    );
  });
});