import { describe, expect, it } from "vitest";

import Fastify from "fastify";

import { AppConfig } from "../app/config.js";
import { usersRoutes } from "../app/routes/users.js";
import { FirebaseAuthService } from "../app/services/firebaseAuthService.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";
import { UserService } from "../app/services/userService.js";

const config: AppConfig = {
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
  INSPECTOR_EMAILS: undefined,
};

// Authentication always fails, so no route reaches the database; the limiter runs first either way.
const failingAuth = {
  authenticateFromBearer: async () => {
    throw new Error("unauthorized");
  },
} as unknown as FirebaseAuthService;
const unusedUserService = {} as unknown as UserService;

const ROUTES: Array<{ method: "GET" | "POST" | "PATCH"; url: string }> = [
  { method: "POST", url: "/users/firebase/session" },
  { method: "GET", url: "/users/me/profile" },
  { method: "GET", url: "/users/me/stats" },
  { method: "POST", url: "/users/me/games/events" },
  { method: "GET", url: "/users/admin/roles" },
  { method: "PATCH", url: "/users/admin/roles/uid-1" },
  { method: "GET", url: "/users/leaderboard" },
];

async function buildApp(rateLimit?: { max: number; windowMs: number }, trustProxy: string | boolean = false) {
  const app = Fastify({ trustProxy });
  await usersRoutes(app, failingAuth, unusedUserService, new ServiceMetrics(config), rateLimit);
  return app;
}

describe("users routes rate limiting", () => {
  it.each(ROUTES)("limits $method $url per client IP", async ({ method, url }) => {
    const app = await buildApp({ max: 1, windowMs: 60_000 });
    const payload = method === "GET" ? undefined : {};

    const first = await app.inject({ method, url, payload });
    expect(first.statusCode).not.toBe(429);

    const second = await app.inject({ method, url, payload });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ message: "Too many requests" });
    expect(second.headers["retry-after"]).toBeDefined();

    const otherClient = await app.inject({ method, url, payload, remoteAddress: "10.20.30.40" });
    expect(otherClient.statusCode).not.toBe(429);
    await app.close();
  });

  it("answers 429 before authentication is attempted", async () => {
    const app = await buildApp({ max: 1, windowMs: 60_000 });

    expect((await app.inject({ method: "GET", url: "/users/me/profile" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/users/me/profile" })).statusCode).toBe(429);
    await app.close();
  });

  it("applies the documented default limit when none is passed", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users/me/profile" });
    expect(response.headers["x-ratelimit-limit"]).toBe("1000");
    await app.close();
  });

  it("can be disabled with max 0", async () => {
    const app = await buildApp({ max: 0, windowMs: 60_000 });

    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: "GET", url: "/users/me/profile" });
      expect(response.statusCode).toBe(401);
    }
    await app.close();
  });

  it("does not limit health checks registered outside the users routes", async () => {
    const app = await buildApp({ max: 1, windowMs: 60_000 });
    app.get("/health", async () => ({ status: "ok" }));

    for (let i = 0; i < 3; i += 1) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
    await app.close();
  });
});
