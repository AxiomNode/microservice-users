import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    userProfile: { findUnique: vi.fn() },
    userGameEvent: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../app/db/client.js", () => ({ prisma: prismaMock }));

import { AccessDeniedError, UserService, type BatchGameEventInput } from "../app/services/userService.js";
import type { AppConfig } from "../app/config.js";

const config = { SERVICE_NAME: "microservice-users" } as AppConfig;

function event(overrides: Partial<BatchGameEventInput> = {}): BatchGameEventInput {
  return {
    gameId: "game-1",
    gameType: "quiz",
    categoryId: "science",
    categoryName: "Science",
    language: "ES",
    outcome: "won",
    score: 90,
    durationSeconds: 60,
    timestamp: 1_710_000_000_000,
    ...overrides,
  };
}

function createTx(returnedRows: unknown[]) {
  return {
    userGameEvent: { createManyAndReturn: vi.fn().mockResolvedValue(returnedRows) },
    userProfile: { update: vi.fn().mockResolvedValue(undefined) },
    userGameTypeStat: { upsert: vi.fn().mockResolvedValue(undefined) },
    userCategoryStat: { upsert: vi.fn().mockResolvedValue(undefined) },
    userLanguageStat: { upsert: vi.fn().mockResolvedValue(undefined) },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  };
}

function useTx(tx: ReturnType<typeof createTx>) {
  prismaMock.$transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx));
}

describe("UserService.recordGameEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects unknown users and read-only roles", async () => {
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "u", role: UserRole.Viewer });
    const service = new UserService(config);

    await expect(service.recordGameEvents("uid", [event()])).rejects.toThrow("User not found");
    await expect(service.recordGameEvents("uid", [event()])).rejects.toThrow(AccessDeniedError);
  });

  it("stores new events with deterministic keys and aggregates stats once per group", async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ id: "usr-1", role: UserRole.Gamer });
    prismaMock.userGameEvent.findMany.mockResolvedValue([]);
    const tx = createTx([
      { gameType: "quiz", categoryId: "science", categoryName: "Science", language: "es", outcome: "won", score: 90, durationSeconds: 60 },
      { gameType: "quiz", categoryId: "science", categoryName: "Science", language: "es", outcome: "lost", score: 10, durationSeconds: 30 },
      { gameType: "wordpass", categoryId: null, categoryName: null, language: "en", outcome: "draw", score: 0, durationSeconds: 5 },
    ]);
    useTx(tx);
    const service = new UserService(config);

    const result = await service.recordGameEvents("uid", [
      event({ gameId: "a" }),
      event({ gameId: "b", outcome: "lost", score: 10 }),
      event({ gameId: "c", gameType: "wordpass", categoryId: undefined, categoryName: undefined, language: "EN", outcome: "draw", score: undefined }),
    ]);

    expect(result).toMatchObject({ synced: 3, duplicates: 0 });
    expect(result.accepted).toHaveLength(3);

    const createArgs = tx.userGameEvent.createManyAndReturn.mock.calls[0][0];
    expect(createArgs.skipDuplicates).toBe(true);
    expect(createArgs.data).toHaveLength(3);
    expect(createArgs.data[0]).toMatchObject({
      userId: "usr-1",
      language: "es",
      outcome: "won",
      playedAt: new Date(1_710_000_000_000),
      metadataJson: JSON.stringify({ gameId: "a" }),
    });
    expect(new Set(createArgs.data.map((row: { eventKey: string }) => row.eventKey)).size).toBe(3);

    expect(tx.userProfile.update).toHaveBeenCalledTimes(1);
    expect(tx.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gamesPlayed: { increment: 3 },
          gamesWon: { increment: 1 },
          gamesLost: { increment: 1 },
          gamesDraw: { increment: 1 },
          totalScore: { increment: 100 },
          totalDurationSeconds: { increment: 95 },
        }),
      }),
    );
    expect(tx.userGameTypeStat.upsert).toHaveBeenCalledTimes(2);
    expect(tx.userCategoryStat.upsert).toHaveBeenCalledTimes(1);
    expect(tx.userCategoryStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ played: 2, won: 1, lost: 1, draw: 0 }),
      }),
    );
    expect(tx.userLanguageStat.upsert).toHaveBeenCalledTimes(2);
    // profile best score + one best score per game type
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("ignores events that were already stored and duplicates inside the same batch", async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ id: "usr-1", role: UserRole.Gamer });
    const service = new UserService(config);

    // First call only to learn the key of event "known".
    prismaMock.userGameEvent.findMany.mockResolvedValueOnce([]);
    const probeTx = createTx([
      { gameType: "quiz", categoryId: "science", categoryName: "Science", language: "es", outcome: "won", score: 90, durationSeconds: 60 },
    ]);
    useTx(probeTx);
    await service.recordGameEvents("uid", [event({ gameId: "known" })]);
    const knownKey = probeTx.userGameEvent.createManyAndReturn.mock.calls[0][0].data[0].eventKey as string;

    prismaMock.userGameEvent.findMany.mockResolvedValueOnce([{ eventKey: knownKey }]);
    const tx = createTx([]);
    useTx(tx);

    const replay = await service.recordGameEvents("uid", [event({ gameId: "known" }), event({ gameId: "known" })]);

    expect(replay).toEqual({ synced: 0, duplicates: 2, accepted: [] });
    expect(tx.userGameEvent.createManyAndReturn).not.toHaveBeenCalled();
    expect(tx.userProfile.update).not.toHaveBeenCalled();
  });

  it("does not touch aggregates when concurrent inserts already stored every event", async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ id: "usr-1", role: UserRole.Gamer });
    prismaMock.userGameEvent.findMany.mockResolvedValue([]);
    const tx = createTx([]);
    useTx(tx);
    const service = new UserService(config);

    const result = await service.recordGameEvents("uid", [event()]);

    expect(result).toEqual({ synced: 0, duplicates: 1, accepted: [] });
    expect(tx.userProfile.update).not.toHaveBeenCalled();
  });
});
