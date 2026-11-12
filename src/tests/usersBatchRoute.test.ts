import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import type { AppConfig } from "../app/config.js";
import { usersRoutes } from "../app/routes/users.js";
import type { FirebaseAuthService } from "../app/services/firebaseAuthService.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";
import { AccessDeniedError, type UserService } from "../app/services/userService.js";

const config = {
  SERVICE_NAME: "microservice-users",
  METRICS_LOG_BUFFER_SIZE: 500,
} as AppConfig;

const validEvent = {
  gameId: "g1",
  gameType: "quiz",
  categoryId: "science",
  language: "es",
  outcome: "won",
  score: 10,
  durationSeconds: 5,
  timestamp: 1_710_000_000_000,
};

async function createApp(recordGameEvents: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  const auth = {
    authenticateFromBearer: vi.fn().mockResolvedValue({ firebaseUid: "uid-1", emailVerified: true, provider: "google.com" }),
  };
  const users = {
    getRoleByFirebaseUid: vi.fn().mockResolvedValue("Gamer"),
    recordGameEvents,
  };
  const metrics = new ServiceMetrics(config);
  await usersRoutes(app, auth as unknown as FirebaseAuthService, users as unknown as UserService, metrics);
  return { app, metrics };
}

describe("POST /users/me/games/events/batch", () => {
  it("stores events idempotently and reports synced and duplicate counts", async () => {
    const recordGameEvents = vi.fn().mockResolvedValue({
      synced: 1,
      duplicates: 1,
      accepted: [{ ...validEvent, outcome: "won" }],
    });
    const { app, metrics } = await createApp(recordGameEvents);

    const response = await app.inject({
      method: "POST",
      url: "/users/me/games/events/batch",
      headers: { authorization: "Bearer t" },
      payload: { events: [validEvent, validEvent] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ synced: 1, duplicates: 1, message: "Synced 1 game event(s)" });
    expect(recordGameEvents).toHaveBeenCalledWith("uid-1", [validEvent, validEvent]);
    expect(metrics.snapshot().gameplay.gameEventsStoredTotal).toBe(1);
    await app.close();
  });

  it("validates the payload", async () => {
    const { app } = await createApp(vi.fn());

    for (const payload of [{}, { events: [] }, { events: [{ ...validEvent, outcome: "WON" }] }, { events: [{ ...validEvent, timestamp: 0 }] }]) {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/games/events/batch",
        headers: { authorization: "Bearer t" },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    await app.close();
  });

  it("maps read-only roles to 403 and rethrows unexpected errors as 500", async () => {
    const recordGameEvents = vi.fn()
      .mockRejectedValueOnce(new AccessDeniedError("Read-only roles cannot modify data."))
      .mockRejectedValueOnce(new Error("boom"));
    const { app } = await createApp(recordGameEvents);
    const request = () => app.inject({
      method: "POST",
      url: "/users/me/games/events/batch",
      headers: { authorization: "Bearer t" },
      payload: { events: [validEvent] },
    });

    expect((await request()).statusCode).toBe(403);
    expect((await request()).statusCode).toBe(500);
    await app.close();
  });
});
