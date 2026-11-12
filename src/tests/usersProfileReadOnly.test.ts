import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import type { AppConfig } from "../app/config.js";
import { usersRoutes } from "../app/routes/users.js";
import type { FirebaseAuthService } from "../app/services/firebaseAuthService.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";
import { NotFoundError, type UserService } from "../app/services/userService.js";

const config = { SERVICE_NAME: "microservice-users", METRICS_LOG_BUFFER_SIZE: 500 } as AppConfig;

const stats = {
  profile: { firebaseUid: "uid-1", gamesPlayed: 1 },
  byGameType: [],
  byCategory: [],
  byLanguage: [],
  recentEvents: [],
};

async function createApp(getRoleByFirebaseUid: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  const auth = {
    authenticateFromBearer: vi.fn().mockResolvedValue({ firebaseUid: "uid-1", emailVerified: true, provider: "google.com" }),
  };
  const users = {
    getRoleByFirebaseUid,
    upsertUserFromIdentity: vi.fn().mockResolvedValue({ userId: "usr-1", created: true }),
    getMyStats: vi.fn().mockResolvedValue(stats),
  };
  await usersRoutes(app, auth as unknown as FirebaseAuthService, users as unknown as UserService, new ServiceMetrics(config));
  return { app, users };
}

describe("GET /users/me/profile is read-only for known users", () => {
  it("does not upsert and loads the role once", async () => {
    const { app, users } = await createApp(vi.fn().mockResolvedValue("Gamer"));

    const response = await app.inject({ method: "GET", url: "/users/me/profile", headers: { authorization: "Bearer t" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: "Gamer", profile: { firebaseUid: "uid-1" } });
    expect(users.upsertUserFromIdentity).not.toHaveBeenCalled();
    expect(users.getRoleByFirebaseUid).toHaveBeenCalledTimes(1);
    expect(users.getMyStats).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("creates the row only when it is missing, then returns the new role", async () => {
    const getRole = vi.fn()
      .mockRejectedValueOnce(new NotFoundError("User not found. Sync Firebase session first."))
      .mockResolvedValueOnce("Gamer");
    const { app, users } = await createApp(getRole);

    const response = await app.inject({ method: "GET", url: "/users/me/profile", headers: { authorization: "Bearer t" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: "Gamer" });
    expect(users.upsertUserFromIdentity).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
